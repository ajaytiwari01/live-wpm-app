
import { useCallback, useEffect, useRef, useState } from 'react';

import { createLiveSocket } from '../services/websocket';
import {
  floatToPcm16,
  resampleFloat32,
} from '../utils/audioUtils';

const INITIAL_METRICS = {
  live_wpm: 0,
  average_wpm: 0,
  total_words: 0,
  final_words: 0,
  duration_seconds: 0,
};

export function useLiveAudio() {
  const [status, setStatus] = useState('idle');
  const [metrics, setMetrics] = useState(INITIAL_METRICS);
  const [transcriptItems, setTranscriptItems] = useState({});
  const [chartData, setChartData] = useState([]);
  const [error, setError] = useState('');
  const [inputDevice, setInputDevice] = useState('microphone');

  const resources = useRef({
    socket: null,
    stream: null,
    context: null,
    source: null,
    worklet: null,
    silentGain: null,
    pending: new Float32Array(0),
    sampleRate: 0,
    stopping: false,
  });

  // ------------------------------------
  // Cleanup all active resources
  // ------------------------------------

  const cleanup = useCallback(async () => {
    const r = resources.current;

    r.stopping = true;

    if (r.worklet) {
      r.worklet.port.onmessage = null;
      r.worklet.disconnect();
      r.worklet = null;
    }

    if (r.source) {
      r.source.disconnect();
      r.source = null;
    }

    if (r.silentGain) {
      r.silentGain.disconnect();
      r.silentGain = null;
    }

    if (r.stream) {
      r.stream.getTracks().forEach((track) => {
        track.stop();
      });

      r.stream = null;
    }

    if (r.context) {
      const context = r.context;
      r.context = null;

      try {
        await context.close();
      } catch (err) {
        console.warn('AudioContext cleanup:', err);
      }
    }

    if (
      r.socket &&
      r.socket.readyState < WebSocket.CLOSING
    ) {
      r.socket.close();
    }

    r.socket = null;
    r.pending = new Float32Array(0);
    r.sampleRate = 0;
  }, []);

  // ------------------------------------
  // Reset application metrics
  // ------------------------------------

  const reset = useCallback(() => {
    setStatus('idle');
    setMetrics(INITIAL_METRICS);
    setTranscriptItems({});
    setChartData([]);
    setError('');
  }, []);

  // ------------------------------------
  // Stop live audio processing
  // ------------------------------------

  const stop = useCallback(async () => {
    const r = resources.current;

    r.stopping = true;

    if (r.socket?.readyState === WebSocket.OPEN) {
      const socket = r.socket;

      try {
        await new Promise((resolve) => {
          let finished = false;

          const finish = () => {
            if (finished) return;

            finished = true;

            window.clearTimeout(timeout);
            socket.removeEventListener('message', handleMessage);

            resolve();
          };

          const handleMessage = (event) => {
            try {
              const message = JSON.parse(event.data);

              if (
                message.type === 'status' &&
                message.status === 'stopped'
              ) {
                finish();
              }
            } catch {
              // Ignore non-JSON messages.
            }
          };

          const timeout = window.setTimeout(finish, 2000);

          socket.addEventListener('message', handleMessage);

          socket.send('STOP');
        });
      } catch (err) {
        console.warn('Error stopping session:', err);
      }
    }

    await cleanup();

    setStatus('stopped');
  }, [cleanup]);

  // ------------------------------------
  // Start live audio processing
  // ------------------------------------

  const start = useCallback(async () => {
    if (
      status === 'listening' ||
      status === 'connecting'
    ) {
      return;
    }

    await cleanup();

    reset();

    setStatus('connecting');

    resources.current.stopping = false;

    try {
      let stream;

      // --------------------------------
      // Speaker / system audio capture
      // --------------------------------

      if (inputDevice === 'speaker') {
        if (!navigator.mediaDevices?.getDisplayMedia) {
          throw new Error(
            'System audio capture is not supported in this browser. Use Chrome or Edge.'
          );
        }

        stream = await navigator.mediaDevices.getDisplayMedia({
          audio: true,
          video: true,
        });

        const audioTracks = stream.getAudioTracks();

        if (audioTracks.length === 0) {
          stream.getTracks().forEach((track) => track.stop());

          throw new Error(
            'No system audio captured. Select a Chrome tab and enable Share tab audio.'
          );
        }

        console.log(
          '[Live WPM] Speaker audio captured:',
          audioTracks.length
        );
      }

      // --------------------------------
      // Microphone audio capture
      // --------------------------------

      else {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error(
            'Microphone capture requires HTTPS or localhost.'
          );
        }

        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            channelCount: 1,
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
      }

      resources.current.stream = stream;

      // --------------------------------
      // Connect to FastAPI WebSocket
      // --------------------------------

      const socket = createLiveSocket(
        (message) => {
          if (
            message.type === 'status' &&
            message.status === 'listening'
          ) {
            setStatus('listening');
          }

          // Live metrics
          if (
            message.type === 'metrics' &&
            message.metrics
          ) {
            setMetrics(message.metrics);

            setChartData((old) => {
              const point = {
                time: new Date().toLocaleTimeString(),
                average_wpm: message.metrics.average_wpm,
              };

              if (
                old.length &&
                old[old.length - 1].time === point.time
              ) {
                return [
                  ...old.slice(0, -1),
                  point,
                ];
              }

              return [...old, point].slice(-60);
            });
          }

          // Partial transcription
          if (message.type === 'transcript_partial') {
            setTranscriptItems((old) => ({
              ...old,
              __partial: message.text || '',
            }));

            if (message.metrics) {
              setMetrics(message.metrics);
            }
          }

          // Final transcription
          if (message.type === 'transcript_final') {
            setTranscriptItems((old) => {
              const next = { ...old };

              delete next.__partial;

              const key = `final-${
                Object.keys(next).filter((k) =>
                  k.startsWith('final-')
                ).length
              }`;

              next[key] = message.text;

              return next;
            });

            if (message.metrics) {
              setMetrics(message.metrics);

              setChartData((old) => [
                ...old,
                {
                  time: new Date().toLocaleTimeString(),
                  average_wpm: message.metrics.average_wpm,
                },
              ].slice(-60));
            }
          }

          // Backend stopped
          if (
            message.type === 'status' &&
            message.status === 'stopped'
          ) {
            setStatus('stopped');
          }

          // Backend error
          if (message.type === 'error') {
            setError(
              message.message || 'Transcription error.'
            );
          }
        },

        (message) => {
          setError(message);
        }
      );

      resources.current.socket = socket;

      // --------------------------------
      // Wait for WebSocket connection
      // --------------------------------

      await new Promise((resolve, reject) => {
        let settled = false;

        const finish = (callback, value) => {
          if (settled) return;

          settled = true;

          window.clearTimeout(timeout);

          socket.removeEventListener('open', handleOpen);
          socket.removeEventListener('error', handleError);
          socket.removeEventListener('close', handleClose);

          callback(value);
        };

        const handleOpen = () => {
          console.log(
            '[Live WPM] Connected to backend successfully.'
          );

          finish(resolve);
        };

        const handleError = () => {
          finish(
            reject,
            new Error(
              'WebSocket connection failed. Check the production backend URL and Render logs.'
            )
          );
        };

        const handleClose = (event) => {
          finish(
            reject,
            new Error(
              `WebSocket closed before connecting. Code: ${event.code}`
            )
          );
        };

        const timeout = window.setTimeout(() => {
          finish(
            reject,
            new Error(
              'Backend connection timed out. Check your Render backend.'
            )
          );
        }, 15000);

        socket.addEventListener('open', handleOpen);
        socket.addEventListener('error', handleError);
        socket.addEventListener('close', handleClose);
      });

      // --------------------------------
      // Initialize browser audio context
      // --------------------------------

      const context = new AudioContext();

      resources.current.context = context;
      resources.current.sampleRate = context.sampleRate;

      await context.audioWorklet.addModule(
        '/audio-processor.js'
      );

      const source = context.createMediaStreamSource(stream);

      resources.current.source = source;

      const worklet = new AudioWorkletNode(
        context,
        'microphone-processor'
      );

      resources.current.worklet = worklet;

      const silentGain = context.createGain();

      silentGain.gain.value = 0;

      resources.current.silentGain = silentGain;

      // --------------------------------
      // Process audio chunks
      // --------------------------------

      worklet.port.onmessage = (event) => {
        const r = resources.current;

        if (
          r.socket?.readyState !== WebSocket.OPEN ||
          r.stopping
        ) {
          return;
        }

        const audioData = event.data;

        if (!(audioData instanceof Float32Array)) {
          console.warn('Invalid audio data received.');
          return;
        }

        // Combine pending audio with the new chunk
        const combined = new Float32Array(
          r.pending.length + audioData.length
        );

        combined.set(r.pending);
        combined.set(audioData, r.pending.length);

        // Process approximately 100 ms chunks
        const sourceChunkSamples = Math.round(
          r.sampleRate * 0.1
        );

        let offset = 0;

        while (
          combined.length - offset >= sourceChunkSamples
        ) {
          const sourceChunk = combined.subarray(
            offset,
            offset + sourceChunkSamples
          );

          // Resample to 16 kHz for Vosk
          const converted = resampleFloat32(
            sourceChunk,
            r.sampleRate,
            16000
          );

          // Convert Float32 to PCM16
          const pcm = floatToPcm16(converted);

          if (
            r.socket?.readyState === WebSocket.OPEN &&
            !r.stopping
          ) {
            r.socket.send(pcm.buffer);
          }

          offset += sourceChunkSamples;
        }

        // Retain incomplete audio samples
        r.pending = combined.slice(offset);
      };

      // Connect audio processing nodes
      source.connect(worklet);
      worklet.connect(silentGain);
      silentGain.connect(context.destination);

      await context.resume();

      setStatus('listening');

      console.log(
        '[Live WPM] Audio processing started successfully.'
      );

    } catch (err) {
      console.error('[Live WPM] Start error:', err);

      setError(
        err.message ||
        'Unable to start live audio processing.'
      );

      await cleanup();

      setStatus('error');
    }
  }, [
    cleanup,
    inputDevice,
    reset,
    status,
  ]);

  // ------------------------------------
  // Cleanup when component unmounts
  // ------------------------------------

  useEffect(() => {
    return () => {
      cleanup();
    };
  }, [cleanup]);

  // ------------------------------------
  // Combine final and partial transcript
  // ------------------------------------

  const transcript = Object.entries(transcriptItems)
    .filter(([key]) => key !== '__partial')
    .map(([, value]) => value)
    .concat(
      transcriptItems.__partial
        ? [transcriptItems.__partial]
        : []
    )
    .join(' ');

  // ------------------------------------
  // Return hook values
  // ------------------------------------

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
  };
}
