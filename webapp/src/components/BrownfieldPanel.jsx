import { useState, useEffect } from 'react'

const HIDDEN_CLUSTER_NAMES = new Set(['eric15'])

const SEVERITY_CLASS = {
  OK: 'badge-ok',
  WARNING: 'badge-warning',
  CRITICAL: 'badge-critical',
  INFO: 'badge-info',
}

export default function BrownfieldPanel() {
  const [clusters, setClusters] = useState([])
  const [releases, setReleases] = useState({})
  const [releaseOrder, setReleaseOrder] = useState([])
  const [selectedCluster, setSelectedCluster] = useState('')
  const [targetRelease, setTargetRelease] = useState('')
  const [report, setReport] = useState(null)
  const [analyzing, setAnalyzing] = useState(false)

  useEffect(() => {
    fetch('/api/clusters').then(r => r.json()).then(d => {
      const cls = (d.clusters || []).filter(c => !HIDDEN_CLUSTER_NAMES.has(c.name))
      setClusters(cls)
      setSelectedCluster(prev => {
        if (cls.some(c => c.name === prev)) return prev
        return cls[0]?.name || ''
      })
    }).catch(() => {})

    fetch('/api/releases').then(r => r.json()).then(d => {
      setReleases(d.releases || {})
      const order = d.order || []
      setReleaseOrder(order)
      if (order.length) {
        setTargetRelease(order[order.length - 1])
      }
    }).catch(() => {})
  }, [])

  useEffect(() => {
    const handleClustersUpdated = () => {
      fetch('/api/clusters').then(r => r.json()).then(d => {
        const cls = (d.clusters || []).filter(c => !HIDDEN_CLUSTER_NAMES.has(c.name))
        setClusters(cls)
        setSelectedCluster(prev => {
          if (cls.some(c => c.name === prev)) return prev
          return cls[0]?.name || ''
        })
      }).catch(() => {})
    }

    window.addEventListener('clusters-updated', handleClustersUpdated)
    return () => window.removeEventListener('clusters-updated', handleClustersUpdated)
  }, [])

  const analyze = async () => {
    if (!selectedCluster || !targetRelease) return
    setAnalyzing(true)
    setReport(null)
    try {
      const resp = await fetch('/api/brownfield/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cluster_name: selectedCluster, target_release: targetRelease }),
      })
      if (!resp.ok) {
        const t = await resp.text()
        try { setReport(JSON.parse(t)) } catch { setReport({ error: `Server error (${resp.status}): ${t}` }) }
        return
      }
      setReport(await resp.json())
    } catch (e) {
      setReport({ error: e.message })
    } finally {
      setAnalyzing(false)
    }
  }

  return (
    <div>
          {/* Cluster deviation analysis */}
          <div className="card">
            <div className="card-title">Cluster Deviation Analysis</div>
            <div className="form-row">
              <div>
                <label>Cluster</label>
                <select value={selectedCluster} onChange={e => setSelectedCluster(e.target.value)}>
                  {clusters.map(c => (
                    <option key={c.name} value={c.name}>
                      {c.name} (v{c.version}) {c.ready ? '✓' : '✗'}
                    </option>
                  ))}
                  {clusters.length === 0 && <option value="">No clusters running</option>}
                </select>
              </div>
              <div>
                <label>Target Release</label>
                <select value={targetRelease} onChange={e => setTargetRelease(e.target.value)}>
                  {releaseOrder.map(r => (
                    <option key={r} value={r}>{r} — k8s {releases[r]?.kubernetes_version}</option>
                  ))}
                </select>
              </div>
            </div>
            <button
              className="btn-blue"
              disabled={analyzing || !selectedCluster || !targetRelease}
              onClick={analyze}
              style={{ width: '100%' }}
            >
              {analyzing ? <><span className="spinner" />Analyzing…</> : '🔍 Analyze Deviations'}
            </button>
          </div>

          {/* Report */}
          {report && (
            <div className="card">
              {report.error ? (
                <div style={{ color: '#f85149', fontSize: 13 }}>⚠ {report.error}</div>
              ) : (
                <>
                  {/* Summary banner */}
                  <div style={{
                    padding: '10px 14px',
                    borderRadius: 6,
                    marginBottom: 16,
                    background: report.compliant ? '#1f4429' : '#3d1e1e',
                    border: `1px solid ${report.compliant ? '#3fb950' : '#f85149'}`,
                    fontSize: 13,
                  }}>
                    <strong style={{ color: report.compliant ? '#3fb950' : '#f85149' }}>
                      {report.compliant ? '✓ COMPLIANT' : '✗ DEVIATIONS DETECTED'}
                    </strong>
                    <span style={{ marginLeft: 10, color: '#c9d1d9' }}>{report.summary}</span>
                  </div>

                  {/* Metadata row */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 16 }}>
                    {[
                      ['Cluster', report.cluster],
                      ['Current Version', `v${report.current_version}`],
                      ['Current Release', report.current_release || 'Unknown'],
                      ['Target Release', report.target_release],
                    ].map(([label, val]) => (
                      <div key={label} style={{ background: '#21262d', borderRadius: 6, padding: '8px 10px' }}>
                        <div style={{ fontSize: 11, color: '#8b949e' }}>{label}</div>
                        <div style={{ fontSize: 13, fontWeight: 600, marginTop: 2 }}>{val}</div>
                      </div>
                    ))}
                  </div>

                  {/* Deviations table */}
                  {report.deviations?.length > 0 && (
                    <>
                      <div className="card-title">Deviations</div>
                      <table className="deviation-table" style={{ marginBottom: 16 }}>
                        <thead>
                          <tr>
                            <th>Field</th>
                            <th>Current</th>
                            <th>Expected</th>
                            <th>Severity</th>
                            <th>Action</th>
                          </tr>
                        </thead>
                        <tbody>
                          {report.deviations.map((d, i) => (
                            <tr key={i}>
                              <td style={{ fontWeight: 600 }}>{d.field}</td>
                              <td><code style={{ color: '#f85149', fontSize: 12 }}>{d.current}</code></td>
                              <td><code style={{ color: '#3fb950', fontSize: 12 }}>{d.expected}</code></td>
                              <td><span className={`badge ${SEVERITY_CLASS[d.severity] || 'badge-unknown'}`}>{d.severity}</span></td>
                              <td style={{ color: '#d29922', fontSize: 12 }}>{d.action}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>

                      {/* Remediation steps */}
                      <div className="card-title">Remediation Steps</div>
                      {report.deviations.map((d, i) => (
                        <div key={i} style={{ marginBottom: 10 }}>
                          <div style={{ fontSize: 12, color: '#c9d1d9', marginBottom: 4 }}>
                            {i + 1}. Fix <strong>{d.field}</strong>:
                          </div>
                          <div className="remediation">{d.remediation}</div>
                        </div>
                      ))}
                    </>
                  )}

                  {/* Upgrade path */}
                  {report.upgrade_path?.length > 0 && (
                    <>
                      <div className="card-title" style={{ marginTop: 16 }}>Recommended Upgrade Path</div>
                      {report.upgrade_path.map((step, i) => (
                        <div key={i} style={{ marginBottom: 10 }}>
                          <div style={{ fontSize: 12, color: '#c9d1d9', marginBottom: 4 }}>
                            Step {i + 1}: Upgrade to <span className="badge badge-info">{step.release}</span> (k8s {step.kubernetes_version})
                          </div>
                          {step.changes?.length > 0 && (
                            <ul style={{ fontSize: 12, color: '#8b949e', marginLeft: 16, marginBottom: 4 }}>
                              {step.changes.map((c, j) => <li key={j}>{c}</li>)}
                            </ul>
                          )}
                          <div className="remediation">{step.command}</div>
                        </div>
                      ))}
                    </>
                  )}

                  <div style={{ fontSize: 11, color: '#8b949e', marginTop: 12 }}>
                    Generated at {new Date(report.generated_at).toLocaleString()}
                  </div>
                </>
              )}
            </div>
          )}
    </div>
  )
}
