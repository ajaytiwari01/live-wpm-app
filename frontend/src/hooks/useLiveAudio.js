import { useCallback, useEffect, useRef, useState } from 'react'
import { createLiveSocket } from '../services/websocket'
import { floatToPcm16, resampleFloat32 } from '../utils/audioUtils'

const INITIAL_METRICS = { live_wpm: 0, average_wpm: 0, total_words: 0, final_words: 0, duration_seconds: 0 }

export function useLiveAudio() {
  const [status, setStatus] = useState('idle')
  const [metrics, setMetrics] = useState(INITIAL_METRICS)
  const [transcriptItems, setTranscriptItems] = useState({})
  const [chartData, setChartData] = useState([])
  const [error, setError] = useState('')
  const [inputDevice, setInputDevice] = useState('microphone')
  const resources = useRef({ socket: null, stream: null, context: null, source: null, worklet: null, pending: new Float32Array(0), sampleRate: 0, stopping: false })

  const cleanup = useCallback(async () => {
    const r = resources.current
    r.stopping = true
    if (r.worklet) { r.worklet.port.onmessage = null; r.worklet.disconnect(); r.worklet = null }
    if (r.source) { r.source.disconnect(); r.source = null }
    if (r.stream) { r.stream.getTracks().forEach(track => track.stop()); r.stream = null }
    if (r.context) { const ctx = r.context; r.context = null; try { await ctx.close() } catch {} }
    if (r.socket && r.socket.readyState < WebSocket.CLOSING) r.socket.close()
    r.socket = null
    r.pending = new Float32Array(0)
  }, [])

  const reset = useCallback(() => {
    setStatus('idle')
    setMetrics(INITIAL_METRICS)
    setTranscriptItems({})
    setChartData([])
    setError('')
  }, [])

  const stop = useCallback(async () => {
    const r = resources.current
    if (r.socket?.readyState === WebSocket.OPEN) {
      r.stopping = true
      await new Promise(resolve => {
        const socket = r.socket
        const finish = () => {
          window.clearTimeout(timeout)
          socket.removeEventListener('message', handleMessage)
          resolve()
        }
        const handleMessage = event => {
          try {
            const message = JSON.parse(event.data)
            if (message.type === 'status' && message.status === 'stopped') finish()
          } catch {}
        }
        const timeout = window.setTimeout(finish, 1500)
        socket.addEventListener('message', handleMessage)
        try {
          socket.send('STOP')
        } catch {
          finish()
        }
      })
    }
    await cleanup()
    setStatus('stopped')
  }, [cleanup])

  const start = useCallback(async () => {
    if (status === 'listening' || status === 'connecting') return
    reset()
    setStatus('connecting')
    resources.current.stopping = false
    try {
      let stream
      if (inputDevice === 'speaker') {
    if (!navigator.mediaDevices?.getDisplayMedia) {
        throw new Error(
            'System audio capture is not supported in this browser.'
        )
    }

    stream = await navigator.mediaDevices.getDisplayMedia({
        audio: true,
        video: true,
    })

    const audioTracks = stream.getAudioTracks()

    if (audioTracks.length === 0) {
        stream.getTracks().forEach(track => track.stop())

        throw new Error(
            'No audio detected. Please select a Chrome tab and enable Share tab audio.'
        )
    }

    console.log('Speaker audio captured:', audioTracks)
} else {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error('Microphone capture requires localhost or HTTPS in a supported browser.')
        }
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            channelCount: 1,
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        })
      }
      resources.current.stream = stream
      const socket = createLiveSocket((message) => {
        if (message.type === 'status' && message.status === 'listening') setStatus('listening')
        if (message.type === 'metrics' && message.metrics) {
          setMetrics(message.metrics)
          setChartData(old => {
            const point = { time: new Date().toLocaleTimeString(), average_wpm: message.metrics.average_wpm }
            if (old.length && old[old.length - 1].time === point.time) return [...old.slice(0, -1), point]
            return [...old, point].slice(-60)
          })
        }
        if (message.type === 'transcript_partial') {
          setTranscriptItems(old => ({ ...old, __partial: message.text || '' }))
          if (message.metrics) setMetrics(message.metrics)
        }
        if (message.type === 'transcript_final') {
          setTranscriptItems(old => {
            const next = { ...old }
            delete next.__partial
            const key = `final-${Object.keys(next).filter(k => k.startsWith('final-')).length}`
            next[key] = message.text
            return next
          })
          if (message.metrics) {
            setMetrics(message.metrics)
            setChartData(old => [...old, { time: new Date().toLocaleTimeString(), average_wpm: message.metrics.average_wpm }].slice(-60))
          }
        }
        if (message.type === 'status' && message.status === 'stopped') setStatus('stopped')
        if (message.type === 'error') setError(message.message || 'Transcription error.')
      }, (message) => setError(message))
      resources.current.socket = socket
      await new Promise((resolve, reject) => {
        const timeout = window.setTimeout(() => reject(new Error('Backend connection timed out. Start the FastAPI server and try again.')), 8000)
        socket.addEventListener('open', () => { window.clearTimeout(timeout); resolve() }, { once: true })
        socket.addEventListener('error', () => { window.clearTimeout(timeout); reject(new Error('Could not connect to FastAPI at 127.0.0.1:8000.')) }, { once: true })
      })
      const context = new AudioContext()
      resources.current.context = context
      resources.current.sampleRate = context.sampleRate
      await context.audioWorklet.addModule('/audio-processor.js')
      const source = context.createMediaStreamSource(stream)
      resources.current.source = source
      const worklet = new AudioWorkletNode(context, 'microphone-processor')
      resources.current.worklet = worklet
      const silentGain = context.createGain()
      silentGain.gain.value = 0
      worklet.port.onmessage = (event) => {
        const r = resources.current
        if (r.socket?.readyState !== WebSocket.OPEN || r.stopping) return
        const combined = new Float32Array(r.pending.length + event.data.length)
        combined.set(r.pending)
        combined.set(event.data, r.pending.length)
        const sourceChunkSamples = Math.round(r.sampleRate * 0.1)
        let offset = 0
        while (combined.length - offset >= sourceChunkSamples) {
          const sourceChunk = combined.subarray(offset, offset + sourceChunkSamples)
          const converted = resampleFloat32(sourceChunk, r.sampleRate, 16000)
          const pcm = floatToPcm16(converted)
          if (r.socket?.readyState === WebSocket.OPEN) r.socket.send(pcm.buffer)
          offset += sourceChunkSamples
        }
        r.pending = combined.slice(offset)
      }
      source.connect(worklet)
      worklet.connect(silentGain)
      silentGain.connect(context.destination)
      await context.resume()
      setStatus('listening')
    } catch (err) {
      setError(err.message || 'Could not start microphone.')
      await cleanup()
      setStatus('error')
    }
  }, [cleanup, inputDevice, reset, status])

  useEffect(() => () => { cleanup() }, [cleanup])

  const transcript = Object.entries(transcriptItems)
    .filter(([key]) => key !== '__partial')
    .map(([, value]) => value)
    .concat(transcriptItems.__partial ? [transcriptItems.__partial] : [])
    .join(' ')

  return {
    start,
    stop,
    reset,
    status,
    metrics,
    transcript,
    chartData,
    error,
    inputDevice,
    setInputDevice,
  }
}
