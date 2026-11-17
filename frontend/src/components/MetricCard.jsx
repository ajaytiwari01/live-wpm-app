export default function MetricCard({ label, value, hint, accent = false }) {
  return <article className="metric-card">
    <p className="metric-label">{label}</p>
    <p className={`metric-value ${accent ? 'accent' : ''}`}>{value}</p>
    <p className="metric-hint">{hint}</p>
  </article>
}
