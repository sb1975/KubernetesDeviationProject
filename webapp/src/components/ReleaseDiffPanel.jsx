import { useState, useEffect } from 'react'

const SEVERITY_CLASS = {
  OK: 'badge-ok',
  WARNING: 'badge-warning',
  CRITICAL: 'badge-critical',
  INFO: 'badge-info',
}

export default function ReleaseDiffPanel() {
  const [releases, setReleases] = useState({})
  const [releaseOrder, setReleaseOrder] = useState([])
  const [fromRelease, setFromRelease] = useState('')
  const [toRelease, setToRelease] = useState('')
  const [releaseDiff, setReleaseDiff] = useState(null)
  const [diffing, setDiffing] = useState(false)

  useEffect(() => {
    fetch('/api/releases').then(r => r.json()).then(d => {
      setReleases(d.releases || {})
      const order = d.order || []
      setReleaseOrder(order)
      if (order.length) {
        setFromRelease(order[0])
        setToRelease(order[order.length - 1])
      }
    }).catch(() => {})
  }, [])

  const diffReleases = async () => {
    if (!fromRelease || !toRelease) return
    setDiffing(true)
    setReleaseDiff(null)
    try {
      const resp = await fetch('/api/releases/diff', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from_release: fromRelease, to_release: toRelease }),
      })
      if (!resp.ok) {
        const t = await resp.text()
        try { setReleaseDiff(JSON.parse(t)) } catch { setReleaseDiff({ error: `Server error (${resp.status}): ${t}` }) }
        return
      }
      setReleaseDiff(await resp.json())
    } catch (e) {
      setReleaseDiff({ error: e.message })
    } finally {
      setDiffing(false)
    }
  }

  return (
    <div>
      <div className="card">
        <div className="card-title">Release-to-Release Diff</div>
        <div className="form-row">
          <div>
            <label>From Release</label>
            <select value={fromRelease} onChange={e => setFromRelease(e.target.value)}>
              {releaseOrder.map(r => (
                <option key={r} value={r}>{r} — k8s {releases[r]?.kubernetes_version}</option>
              ))}
            </select>
          </div>
          <div>
            <label>To Release</label>
            <select value={toRelease} onChange={e => setToRelease(e.target.value)}>
              {releaseOrder.map(r => (
                <option key={r} value={r}>{r} — k8s {releases[r]?.kubernetes_version}</option>
              ))}
            </select>
          </div>
        </div>
        <button
          className="btn-blue"
          disabled={diffing || fromRelease === toRelease}
          onClick={diffReleases}
          style={{ width: '100%' }}
        >
          {diffing ? <><span className="spinner" />Comparing…</> : `🔄 Compare ${fromRelease} → ${toRelease}`}
        </button>
      </div>

      {releaseDiff && (
        <div className="card">
          {releaseDiff.error ? (
            <div style={{ color: '#f85149', fontSize: 13 }}>⚠ {releaseDiff.error}</div>
          ) : (
            <>
              <div className="card-title">
                Changes: {releaseDiff.from_release} → {releaseDiff.to_release}
              </div>

              {releaseDiff.intermediate_releases?.length > 0 && (
                <div style={{ marginBottom: 12, fontSize: 12, color: '#8b949e' }}>
                  Intermediate releases traversed:{' '}
                  {releaseDiff.intermediate_releases.map(r => (
                    <span key={r} className="badge badge-info" style={{ marginRight: 4 }}>{r}</span>
                  ))}
                </div>
              )}

              {releaseDiff.changes?.length === 0 ? (
                <div style={{ color: '#3fb950', fontSize: 13 }}>✓ No specification changes between these releases</div>
              ) : (
                <table className="deviation-table" style={{ marginBottom: 16 }}>
                  <thead>
                    <tr><th>Field</th><th>From</th><th>To</th><th>Severity</th></tr>
                  </thead>
                  <tbody>
                    {releaseDiff.changes.map((c, i) => (
                      <tr key={i}>
                        <td style={{ fontWeight: 600 }}>{c.field}</td>
                        <td><code style={{ color: '#f85149', fontSize: 12 }}>{c.from}</code></td>
                        <td><code style={{ color: '#3fb950', fontSize: 12 }}>{c.to}</code></td>
                        <td><span className={`badge ${SEVERITY_CLASS[c.severity] || 'badge-unknown'}`}>{c.severity}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              {releaseDiff.cumulative_changes?.length > 0 && (
                <>
                  <div className="card-title">Cumulative Changelog</div>
                  <ul style={{ fontSize: 12, color: '#8b949e', marginLeft: 16 }}>
                    {releaseDiff.cumulative_changes.map((c, i) => <li key={i}>{c}</li>)}
                  </ul>
                </>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
