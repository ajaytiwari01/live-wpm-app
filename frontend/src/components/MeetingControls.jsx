import { Mic, Square, RotateCcw } from 'lucide-react'
export default function MeetingControls({ status, onStart, onStop, onReset }) {
  const busy = status === 'connecting' || status === 'listening'
  return <div className="controls">
    <button className="button primary" onClick={onStart} disabled={busy}><Mic size={17} /> {status === 'connecting' ? 'Connecting…' : 'Start listening'}</button>
    <button className="button danger" onClick={onStop} disabled={!busy}><Square size={15} /> Stop</button>
    <button className="button secondary" onClick={onReset} disabled={busy}><RotateCcw size={16} /> Reset</button>
  </div>
}
