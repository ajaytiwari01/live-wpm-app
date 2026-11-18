import { FileText } from 'lucide-react'
export default function TranscriptPreview({ transcript }) {
  return <section className="panel transcript-panel">
    <div className="section-heading"><div><h2><FileText size={17} /> Transcript</h2><p>Session transcript</p></div></div>
    <div className="transcript-content">{transcript || <span className="muted">No speech was recognized in this session.</span>}</div>
  </section>
}
