import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

export default function WpmChart({ data }) {
  return <section className="panel chart-panel">
    <div className="section-heading"><div><h2>Speaking speed</h2><p>Recent finalized speech events</p></div><span className="live-dot-label">● LIVE</span></div>
    <div className="chart-wrap">
      {data.length < 2 ? <div className="chart-empty">Your WPM trend will appear as speech is recognized.</div> :
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 10, right: 12, left: -18, bottom: 0 }}>
            <CartesianGrid stroke="#253149" strokeDasharray="4 4" vertical={false} />
            <XAxis dataKey="time" tick={{ fill: '#8290a8', fontSize: 11 }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fill: '#8290a8', fontSize: 11 }} axisLine={false} tickLine={false} />
            <Tooltip contentStyle={{ background: '#111b2d', border: '1px solid #293750', borderRadius: 10, color: '#fff' }} />
            <Line type="monotone" dataKey="wpm" name="WPM" stroke="#54d6a0" strokeWidth={3} dot={false} activeDot={{ r: 5 }} />
          </LineChart>
        </ResponsiveContainer>}
    </div>
  </section>
}
