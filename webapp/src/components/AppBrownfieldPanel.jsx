import { useState, useEffect } from 'react'

const HIDDEN_CLUSTER_NAMES = new Set(['eric15'])

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
  // Approval workflow state per app (keyed by report_id)
  const [approvalStatus, setApprovalStatus] = useState({}) // report_id -> 'pending'|'approved'|'remediating'|'remediated'|'rejected'
  const [remediationResults, setRemediationResults] = useState({}) // report_id -> result
  const [actionLoading, setActionLoading] = useState({}) // report_id -> boolean

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
      if (order.length) setTargetRelease(order[order.length - 1])
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

  const scanApps = async () => {
    if (!selectedCluster || !targetRelease) return
    setScanning(true)
    setScanResult(null)
    setFixResults({})
    setApprovalStatus({})
    setRemediationResults({})
    setActionLoading({})
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
      const data = await resp.json()
      setScanResult(data)
      // Initialize approval status for each deviated app report
      const initStatus = {}
      for (const r of (data.reports || [])) {
        if (r.report_id) {
          initStatus[r.report_id] = r.approval_status || 'pending_approval'
        }
      }
      setApprovalStatus(initStatus)
    } catch (e) {
      setScanResult({ error: e.message })
    } finally {
      setScanning(false)
    }
  }

  const approveAndRemediate = async (reportId) => {
    if (!reportId) return
    setActionLoading(prev => ({ ...prev, [reportId]: true }))
    try {
      // Step 1: Approve
      const approveResp = await fetch(`/api/reports/${reportId}/approve`, { method: 'POST' })
      if (!approveResp.ok) {
        alert('Failed to approve report')
        return
      }
      setApprovalStatus(prev => ({ ...prev, [reportId]: 'approved' }))

      // Step 2: Execute remediation
      setApprovalStatus(prev => ({ ...prev, [reportId]: 'remediating' }))
      const remResp = await fetch(`/api/reports/${reportId}/remediate`, { method: 'POST' })
      if (!remResp.ok) {
        const err = await remResp.text()
        alert(`Remediation failed: ${err}`)
        setApprovalStatus(prev => ({ ...prev, [reportId]: 'approved' }))
        return
      }
      const result = await remResp.json()
      setRemediationResults(prev => ({ ...prev, [reportId]: result }))
      setApprovalStatus(prev => ({ ...prev, [reportId]: 'remediated' }))
    } finally {
      setActionLoading(prev => ({ ...prev, [reportId]: false }))
    }
  }

  const rejectReport = async (reportId) => {
    if (!reportId) return
    setActionLoading(prev => ({ ...prev, [reportId]: true }))
    try {
      await fetch(`/api/reports/${reportId}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'User rejected from UI' }),
      })
      setApprovalStatus(prev => ({ ...prev, [reportId]: 'rejected' }))
    } finally {
      setActionLoading(prev => ({ ...prev, [reportId]: false }))
    }
  }

  const approveAndRemediateAll = async () => {
    if (!scanResult?.reports) return
    const deviated = scanResult.reports.filter(r => !r.compliant && r.report_id)
    for (const report of deviated) {
      await approveAndRemediate(report.report_id)
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

        {/* Selected cluster + app info */}
        {selectedCluster && (() => {
          const c = clusters.find(cl => cl.name === selectedCluster)
          if (!c) return null
          const targetRel = releases[targetRelease]
          const apps = targetRel?.applications || []
          return (
            <div style={{ background: '#21262d', borderRadius: 6, padding: '10px 14px', marginBottom: 12, marginTop: 8 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#58a6ff', marginBottom: 6 }}>
                📊 Current State
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8, fontSize: 12, marginBottom: 8 }}>
                <div>
                  <span style={{ color: '#8b949e' }}>Cluster Release:</span>{' '}
                  <span className="badge badge-info">{c.detected_release || 'Unknown'}</span>
                </div>
                <div>
                  <span style={{ color: '#8b949e' }}>K8s Version:</span>{' '}
                  <strong style={{ color: '#c9d1d9' }}>v{c.version}</strong>
                </div>
                <div>
                  <span style={{ color: '#8b949e' }}>Status:</span>{' '}
                  <span style={{ color: c.ready ? '#3fb950' : '#f85149' }}>{c.ready ? '● Ready' : '● Not Ready'}</span>
                </div>
                <div>
                  <span style={{ color: '#8b949e' }}>Runtime:</span>{' '}
                  <span style={{ color: '#c9d1d9' }}>{c.container_runtime || '—'}</span>
                </div>
              </div>
              {apps.length > 0 && (
                <>
                  <div style={{ fontSize: 11, color: '#8b949e', marginBottom: 4 }}>
                    Expected apps in {targetRelease}:
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {apps.map(app => (
                      <span key={app.name} style={{ background: '#161b22', border: '1px solid #30363d', borderRadius: 4, padding: '2px 8px', fontSize: 11, color: '#c9d1d9' }}>
                        {app.name} <span style={{ color: '#8b949e' }}>({app.image})</span>
                      </span>
                    ))}
                  </div>
                </>
              )}
            </div>
          )
        })()}

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

              {/* Approve & Remediate All button */}
              {hasDeviations && (
                <button
                  className="btn-blue"
                  onClick={approveAndRemediateAll}
                  style={{ width: '100%', marginBottom: 16 }}
                >
                  ✓ Approve & Remediate All Deviations
                </button>
              )}

              {/* Per-app reports */}
              {scanResult.reports.map((report, idx) => (
                <AppReportCard
                  key={idx}
                  report={report}
                  approvalStatus={approvalStatus[report.report_id]}
                  remediationResult={remediationResults[report.report_id]}
                  isLoading={!!actionLoading[report.report_id]}
                  onApprove={() => approveAndRemediate(report.report_id)}
                  onReject={() => rejectReport(report.report_id)}
                />
              ))}
            </>
          )}
        </div>
      )}
    </div>
  )
}

function AppReportCard({ report, approvalStatus, remediationResult, isLoading, onApprove, onReject }) {
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
          {report.report_id && (
            <span style={{ marginLeft: 8, fontSize: 10, color: '#8b949e' }}>
              ID: {report.report_id.slice(0, 8)}
            </span>
          )}
        </div>
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

        {/* AI Analysis */}
        {report.llm_analysis && (
          <div style={{ background: '#21262d', borderRadius: 6, padding: '10px 12px', marginTop: 10, borderLeft: '3px solid #58a6ff' }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: '#58a6ff', marginBottom: 4 }}>🤖 AI Risk Assessment</div>
            <div style={{ fontSize: 12, color: '#c9d1d9', marginBottom: 4 }}>{report.llm_analysis.risk_assessment}</div>
            <div style={{ fontSize: 11, color: '#8b949e' }}>
              Priority: <span className={`badge ${report.llm_analysis.priority === 'immediate' ? 'badge-critical' : report.llm_analysis.priority === 'scheduled' ? 'badge-warning' : 'badge-ok'}`}>
                {report.llm_analysis.priority}
              </span>
            </div>
            {report.llm_analysis.impact_notes && (
              <div style={{ fontSize: 11, color: '#8b949e', marginTop: 4 }}>{report.llm_analysis.impact_notes}</div>
            )}
          </div>
        )}

        {/* Remediation Steps */}
        {hasDeviations && (
          <div style={{ marginTop: 10 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: '#c9d1d9', marginBottom: 4 }}>Remediation Steps:</div>
            <ul style={{ margin: 0, paddingLeft: 16, fontSize: 11 }}>
              {report.deviations.map((d, i) => (
                <li key={i} style={{ marginBottom: 4, color: '#8b949e' }}>
                  <strong>{d.field}:</strong> <span className="remediation">{d.remediation}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* ─── APPROVAL SECTION ─── */}
        {!isCompliant && report.report_id && (
          <div style={{
            background: '#161b22',
            border: '1px solid #30363d',
            borderRadius: 8,
            padding: 12,
            marginTop: 12,
          }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#c9d1d9', marginBottom: 6 }}>
              {(!approvalStatus || approvalStatus === 'pending_approval') && '⏳ Awaiting Approval'}
              {approvalStatus === 'approved' && '✓ Approved'}
              {approvalStatus === 'remediating' && '🔧 Remediating...'}
              {approvalStatus === 'remediated' && '✓ Remediation Complete'}
              {approvalStatus === 'rejected' && '✗ Rejected'}
            </div>

            {(!approvalStatus || approvalStatus === 'pending_approval') && (
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  className="btn-blue"
                  onClick={onApprove}
                  disabled={isLoading}
                  style={{ fontSize: 11, padding: '6px 14px' }}
                >
                  {isLoading ? <><span className="spinner" />Processing…</> : '✓ Approve & Remediate'}
                </button>
                <button
                  className="btn-red"
                  onClick={onReject}
                  disabled={isLoading}
                  style={{ fontSize: 11, padding: '6px 14px' }}
                >
                  ✗ Reject
                </button>
              </div>
            )}

            {approvalStatus === 'remediating' && (
              <div style={{ fontSize: 12, color: '#d29922' }}>
                <span className="spinner" /> Executing remediation...
              </div>
            )}

            {approvalStatus === 'remediated' && remediationResult && (
              <div style={{ fontSize: 11 }}>
                <div style={{ color: '#3fb950', marginBottom: 6 }}>
                  ✓ {remediationResult.successful_steps}/{remediationResult.total_steps} steps completed successfully
                </div>
                {remediationResult.steps_executed?.map((step, i) => (
                  <div key={i} style={{ marginBottom: 3, color: step.success ? '#3fb950' : '#f85149' }}>
                    {step.success ? '✓' : '✗'} {step.description || step.action}
                  </div>
                ))}
              </div>
            )}

            {approvalStatus === 'rejected' && (
              <div style={{ fontSize: 11, color: '#8b949e' }}>
                Report dismissed. No changes made.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
