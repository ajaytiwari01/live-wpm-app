import { FileText } from 'lucide-react'
export default function TranscriptPreview({ transcript }) {
  return <section className="panel transcript-panel">
    <div className="section-heading"><div><h2><FileText size={17} /> Live transcript</h2><p>Temporary preview · cleared when you stop</p></div></div>
    <div className="transcript-content">{transcript || <span className="muted">Start listening and your recognized speech will appear here.</span>}</div>
  </section>
}
