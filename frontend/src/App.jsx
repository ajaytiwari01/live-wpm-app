import { useEffect, useRef } from 'react'
import { Activity, AudioLines, ShieldCheck } from 'lucide-react'
import { useLiveAudio } from './hooks/useLiveAudio'
import MetricCard from './components/MetricCard'
import WpmChart from './components/WpmChart'
import TranscriptPreview from './components/TranscriptPreview'
import MeetingControls from './components/MeetingControls'

function duration(seconds) {
  const minutes = Math.floor(seconds / 60)
  const remaining = seconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(remaining).padStart(2, '0')}`
}

export default function App() {
  const resultsRef = useRef(null)
  const {
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
  } = useLiveAudio()
  const isLive = status === 'listening'

  useEffect(() => {
    if (status === 'stopped') {
      resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }, [status])

  return <main className="app-shell">
    <div className="ambient ambient-one" /><div className="ambient ambient-two" />
    <div className={`dashboard ${status === 'stopped' ? 'dashboard-results' : ''}`}>
      <header className="topbar">
        <div className="brand"><div className="brand-icon"><AudioLines size={23} /></div><div><h1>Live WPM Monitor</h1><p>Real-time speaking analytics</p></div></div>
        <div className={`status-pill ${isLive ? 'is-live' : ''}`}><span className="status-dot" />{status === 'idle' ? 'Ready' : status === 'connecting' ? 'Connecting' : status === 'listening' ? 'Listening' : status === 'stopped' ? 'Stopped' : 'Error'}</div>
      </header>

      <section className="intro"><div><div className="eyebrow"><Activity size={14} /> LIVE SPEECH ANALYTICS</div><h2>Measure the pace<br /><span>of every conversation.</span></h2><p>Listen through your Input device and see speaking speed update as speech is recognized.</p></div><div className="privacy-chip"><ShieldCheck size={18} /><p>Your data is private and secure.</p></div></section>

      <div className="action-row">
        <div className="device-panel">
          <label className="device-field">
            <span>Input device</span>
            <select value={inputDevice} onChange={(event) => setInputDevice(event.target.value)} disabled={status === 'connecting' || status === 'listening'}>
              <option value="microphone">Microphone</option>
              <option value="speaker">Speaker</option>
            </select>
          </label>
        </div>

        <MeetingControls status={status} onStart={start} onStop={stop} onReset={reset} />
      </div>
      {error && <div className="error-banner" role="alert">{error}</div>}

      {status === 'stopped' ? (
        <div className="results-layout" ref={resultsRef}>
          <section className="results-column">
            <section className="metrics-grid results-metrics">
              <MetricCard label="Live WPM" value={metrics.live_wpm} hint="Recognized in last 60 seconds" accent />
              <MetricCard label="Average WPM" value={metrics.average_wpm} hint="Since this session started" />
              <MetricCard label="Total words" value={metrics.total_words.toLocaleString()} hint="Final + current provisional words" />
              <MetricCard label="Session duration" value={duration(metrics.duration_seconds)} hint="Minutes : seconds" />
            </section>
            <WpmChart data={chartData} />
          </section>
          <TranscriptPreview transcript={transcript} />
        </div>
      ) : (
        <section className="metrics-grid">
          <MetricCard label="Live WPM" value={metrics.live_wpm} hint="Recognized in last 60 seconds" accent />
          <MetricCard label="Average WPM" value={metrics.average_wpm} hint="Since this session started" />
          <MetricCard label="Total words" value={metrics.total_words.toLocaleString()} hint="Final + current provisional words" />
          <MetricCard label="Session duration" value={duration(metrics.duration_seconds)} hint="Minutes : seconds" />
        </section>
      )}
      <footer><span>Live speech recognition</span><span>Input device audio is processed· Session data is temporary</span></footer>
    </div>
  </main>
}
