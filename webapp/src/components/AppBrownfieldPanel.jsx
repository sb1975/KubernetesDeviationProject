import { useState, useEffect } from 'react'

const SEVERITY_CLASS = {
  OK: 'badge-ok',
  WARNING: 'badge-warning',
  CRITICAL: 'badge-critical',
  INFO: 'badge-info',
}

export default function AppBrownfieldPanel() {
  const [clusters, setClusters] = useState([])
  const [releases, setReleases] = useState({})
  const [releaseOrder, setReleaseOrder] = useState([])
  const [selectedCluster, setSelectedCluster] = useState('')
  const [targetRelease, setTargetRelease] = useState('')
  const [scanResult, setScanResult] = useState(null)
  const [scanning, setScanning] = useState(false)
  const [fixing, setFixing] = useState({})  // keyed by app name
  const [fixResults, setFixResults] = useState({})

  useEffect(() => {
    fetch('/api/clusters').then(r => r.json()).then(d => {
      const cls = d.clusters || []
      setClusters(cls)
      if (cls.length) setSelectedCluster(cls[0].name)
    }).catch(() => {})

    fetch('/api/releases').then(r => r.json()).then(d => {
      setReleases(d.releases || {})
      const order = d.order || []
      setReleaseOrder(order)
      if (order.length) setTargetRelease(order[order.length - 1])
    }).catch(() => {})
  }, [])

  const scanApps = async () => {
    if (!selectedCluster || !targetRelease) return
    setScanning(true)
    setScanResult(null)
    setFixResults({})
    try {
      const resp = await fetch('/api/apps/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cluster_name: selectedCluster, target_release: targetRelease }),
      })
      if (!resp.ok) {
        const t = await resp.text()
        try { setScanResult(JSON.parse(t)) } catch { setScanResult({ error: `Server error (${resp.status}): ${t}` }) }
        return
      }
      setScanResult(await resp.json())
    } catch (e) {
      setScanResult({ error: e.message })
    } finally {
      setScanning(false)
    }
  }

  const fixApp = async (report) => {
    const appName = report.app_name
    setFixing(prev => ({ ...prev, [appName]: true }))
    try {
      const resp = await fetch('/api/apps/fix', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cluster_name: selectedCluster,
          app_name: appName,
          namespace: report.namespace || 'default',
          expected_image: report.expected_image,
          expected_replicas: report.expected_replicas,
          app_found: !!report.app_found,
        }),
      })
      if (!resp.ok) {
        const t = await resp.text()
        setFixResults(prev => ({ ...prev, [appName]: { success: false, error: `Server error (${resp.status}): ${t}` } }))
        return
      }
      const data = await resp.json()
      setFixResults(prev => ({ ...prev, [appName]: data }))
    } catch (e) {
      setFixResults(prev => ({ ...prev, [appName]: { success: false, error: e.message } }))
    } finally {
      setFixing(prev => ({ ...prev, [appName]: false }))
    }
  }

  const fixAll = async () => {
    if (!scanResult?.reports) return
    const nonCompliant = scanResult.reports.filter(r => !r.compliant && !r.error?.startsWith('Unknown'))
    for (const report of nonCompliant) {
      await fixApp(report)
    }
  }

  const hasDeviations = scanResult?.reports?.some(r => !r.compliant)

  return (
    <div>
      {/* Scan controls */}
      <div className="card">
        <div className="card-title">Application Deviation Scan</div>
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
          disabled={scanning || !selectedCluster || !targetRelease}
          onClick={scanApps}
          style={{ width: '100%' }}
        >
          {scanning ? <><span className="spinner" />Scanning...</> : '🔍 Scan All Applications'}
        </button>
      </div>

      {/* Scan results */}
      {scanResult && (
        <div className="card">
          {scanResult.error ? (
            <div style={{ color: '#f85149', fontSize: 13 }}>⚠ {scanResult.error}</div>
          ) : (
            <>
              {/* Summary banner */}
              <div style={{
                padding: '10px 14px',
                borderRadius: 6,
                marginBottom: 16,
                background: scanResult.non_compliant === 0 ? '#1f4429' : '#3d1e1e',
                border: `1px solid ${scanResult.non_compliant === 0 ? '#3fb950' : '#f85149'}`,
                fontSize: 13,
              }}>
                <strong style={{ color: scanResult.non_compliant === 0 ? '#3fb950' : '#f85149' }}>
                  {scanResult.non_compliant === 0 ? '✓ ALL COMPLIANT' : `✗ ${scanResult.non_compliant} DEVIATION(S)`}
                </strong>
                <span style={{ marginLeft: 10, color: '#c9d1d9' }}>
                  {scanResult.compliant}/{scanResult.total} apps compliant with {targetRelease}
                </span>
              </div>

              {/* Summary counters */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 16 }}>
                {[
                  ['Cluster', selectedCluster],
                  ['Target Release', targetRelease],
                  ['Compliant', `${scanResult.compliant}/${scanResult.total}`],
                  ['Deviations', scanResult.non_compliant],
                ].map(([label, val]) => (
                  <div key={label} style={{ background: '#21262d', borderRadius: 6, padding: '8px 10px' }}>
                    <div style={{ fontSize: 11, color: '#8b949e' }}>{label}</div>
                    <div style={{ fontSize: 13, fontWeight: 600, marginTop: 2 }}>{val}</div>
                  </div>
                ))}
              </div>

              {/* Fix All button */}
              {hasDeviations && (
                <button
                  className="btn-blue"
                  onClick={fixAll}
                  style={{ width: '100%', marginBottom: 16, background: '#da3633', borderColor: '#f85149' }}
                >
                  🔧 Fix All Deviations
                </button>
              )}

              {/* Per-app reports */}
              {scanResult.reports.map((report, idx) => (
                <AppReportCard
                  key={idx}
                  report={report}
                  fixing={!!fixing[report.app_name]}
                  fixResult={fixResults[report.app_name]}
                  onFix={() => fixApp(report)}
                />
              ))}
            </>
          )}
        </div>
      )}
    </div>
  )
}

function AppReportCard({ report, fixing, fixResult, onFix }) {
  const isCompliant = report.compliant
  const notDeployed = !report.app_found && !report.error?.startsWith('Unknown')
  const hasDeviations = report.deviations?.length > 0

  return (
    <div style={{
      border: `1px solid ${isCompliant ? '#30363d' : '#f85149'}`,
      borderRadius: 8,
      marginBottom: 12,
      overflow: 'hidden',
    }}>
      {/* App header */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '10px 14px',
        background: isCompliant ? '#161b22' : '#1c1118',
      }}>
        <div>
          <strong style={{ fontSize: 14, color: '#c9d1d9' }}>{report.app_name}</strong>
          <span style={{ marginLeft: 8 }}>
            <span className={`badge ${isCompliant ? 'badge-ok' : 'badge-critical'}`}>
              {isCompliant ? 'COMPLIANT' : notDeployed ? 'NOT DEPLOYED' : 'DEVIATED'}
            </span>
          </span>
          {report.detected_release && (
            <span className="badge badge-info" style={{ marginLeft: 6 }}>{report.detected_release}</span>
          )}
          <span style={{ marginLeft: 8, fontSize: 11, color: '#8b949e' }}>
            ns: {report.namespace || 'default'}
          </span>
        </div>
        {!isCompliant && (
          <button
            className="btn-blue"
            style={{ fontSize: 11, padding: '4px 12px' }}
            disabled={fixing}
            onClick={onFix}
          >
            {fixing ? <><span className="spinner" />Fixing...</> : '🔧 Fix'}
          </button>
        )}
      </div>

      {/* Details */}
      <div style={{ padding: '10px 14px' }}>
        {/* Not deployed */}
        {notDeployed && (
          <div style={{ fontSize: 12, color: '#c9d1d9' }}>
            <div style={{ marginBottom: 6 }}>
              Application is not deployed. Expected by {report.target_release || 'target release'}:
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <div style={{ background: '#21262d', padding: '6px 10px', borderRadius: 6 }}>
                <div style={{ fontSize: 10, color: '#8b949e' }}>Expected Image</div>
                <code style={{ fontSize: 12, color: '#3fb950' }}>{report.expected_image}</code>
              </div>
              <div style={{ background: '#21262d', padding: '6px 10px', borderRadius: 6 }}>
                <div style={{ fontSize: 10, color: '#8b949e' }}>Expected Replicas</div>
                <div style={{ fontSize: 12, fontWeight: 600 }}>{report.expected_replicas}</div>
              </div>
            </div>
          </div>
        )}

        {/* Has deviations (app exists but doesn't match) */}
        {report.app_found && hasDeviations && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 10 }}>
              <div style={{ background: '#21262d', padding: '6px 10px', borderRadius: 6 }}>
                <div style={{ fontSize: 10, color: '#8b949e' }}>Current Image</div>
                <code style={{ fontSize: 12, color: '#f85149' }}>{report.current_image}</code>
              </div>
              <div style={{ background: '#21262d', padding: '6px 10px', borderRadius: 6 }}>
                <div style={{ fontSize: 10, color: '#8b949e' }}>Expected Image</div>
                <code style={{ fontSize: 12, color: '#3fb950' }}>{report.expected_image}</code>
              </div>
            </div>

            <table className="deviation-table" style={{ fontSize: 12 }}>
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
                    <td>
                      <span className={`badge ${SEVERITY_CLASS[d.severity] || 'badge-unknown'}`}>
                        {d.severity}
                      </span>
                    </td>
                    <td style={{ color: '#d29922', fontSize: 11 }}>{d.action}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}

        {/* Compliant */}
        {isCompliant && (
          <div style={{ fontSize: 12, display: 'flex', gap: 12, color: '#8b949e' }}>
            <span>Image: <code>{report.current_image}</code></span>
            <span>Replicas: {report.current_replicas}/{report.expected_replicas}</span>
          </div>
        )}

        {/* Fix result */}
        {fixResult && (
          <div style={{
            marginTop: 10,
            padding: '8px 12px',
            borderRadius: 6,
            background: fixResult.success ? '#1f4429' : '#3d1e1e',
            border: `1px solid ${fixResult.success ? '#3fb950' : '#f85149'}`,
            fontSize: 12,
          }}>
            <strong style={{ color: fixResult.success ? '#3fb950' : '#f85149' }}>
              {fixResult.success ? '✓ Fixed successfully' : '✗ Fix failed'}
            </strong>
            {fixResult.actions?.map((a, i) => (
              <div key={i} style={{ marginTop: 4, color: '#c9d1d9' }}>
                {a.action}: {a.success ? '✓' : `✗ ${a.stderr || a.error || ''}`}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
