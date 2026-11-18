import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

export default function WpmChart({ data }) {
  return <section className="panel chart-panel">
    <div className="section-heading"><div><h2>Average speaking speed</h2><p>Average WPM throughout the session</p></div></div>
    <div className="chart-wrap">
      {data.length < 2 ? <div className="chart-empty">Not enough data to show an average WPM trend.</div> :
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 10, right: 12, left: -18, bottom: 0 }}>
            <CartesianGrid stroke="#253149" strokeDasharray="4 4" vertical={false} />
            <XAxis dataKey="time" tick={{ fill: '#8290a8', fontSize: 11 }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fill: '#8290a8', fontSize: 11 }} axisLine={false} tickLine={false} />
            <Tooltip contentStyle={{ background: '#111b2d', border: '1px solid #293750', borderRadius: 10, color: '#fff' }} />
            <Line type="monotone" dataKey="average_wpm" name="Average WPM" stroke="#54d6a0" strokeWidth={3} dot={false} activeDot={{ r: 5 }} />
          </LineChart>
        </ResponsiveContainer>}
    </div>
  </section>
}
