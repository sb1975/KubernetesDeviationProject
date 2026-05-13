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
  const [approvalStatus, setApprovalStatus] = useState(null) // null | 'pending' | 'approved' | 'rejected' | 'remediating' | 'remediated'
  const [remediationResult, setRemediationResult] = useState(null)
  const [actionLoading, setActionLoading] = useState(false)

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
    setApprovalStatus(null)
    setRemediationResult(null)
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
      const data = await resp.json()
      setReport(data)
      // If there are deviations, report is pending approval
      if (data.deviations?.length > 0 && data.report_id) {
        setApprovalStatus('pending')
      }
    } catch (e) {
      setReport({ error: e.message })
    } finally {
      setAnalyzing(false)
    }
  }

  const approveAndRemediate = async () => {
    if (!report?.report_id) return
    setActionLoading(true)
    try {
      // Step 1: Approve
      const approveResp = await fetch(`/api/reports/${report.report_id}/approve`, { method: 'POST' })
      if (!approveResp.ok) {
        alert('Failed to approve report')
        return
      }
      setApprovalStatus('approved')

      // Step 2: Execute remediation
      setApprovalStatus('remediating')
      const remResp = await fetch(`/api/reports/${report.report_id}/remediate`, { method: 'POST' })
      if (!remResp.ok) {
        const err = await remResp.text()
        alert(`Remediation failed: ${err}`)
        setApprovalStatus('approved')
        return
      }
      const result = await remResp.json()
      setRemediationResult(result)
      setApprovalStatus('remediated')
    } finally {
      setActionLoading(false)
    }
  }

  const rejectReport = async () => {
    if (!report?.report_id) return
    setActionLoading(true)
    try {
      await fetch(`/api/reports/${report.report_id}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'User rejected from UI' }),
      })
      setApprovalStatus('rejected')
    } finally {
      setActionLoading(false)
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
                      {report.compliant ? '✓ COMPLIANT — No action needed' : '✗ DEVIATIONS DETECTED — Review required'}
                    </strong>
                    {report.report_id && (
                      <span style={{ float: 'right', fontSize: 11, color: '#8b949e' }}>
                        Report ID: {report.report_id}
                      </span>
                    )}
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

                  {/* AI Analysis */}
                  {report.llm_analysis && (
                    <div style={{ background: '#21262d', borderRadius: 6, padding: '12px 14px', marginBottom: 16, borderLeft: '3px solid #58a6ff' }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: '#58a6ff', marginBottom: 6 }}>🤖 AI Risk Assessment</div>
                      <div style={{ fontSize: 12, color: '#c9d1d9', marginBottom: 6 }}>{report.llm_analysis.risk_assessment}</div>
                      <div style={{ fontSize: 12, color: '#8b949e' }}>
                        Priority: <span className={`badge ${report.llm_analysis.priority === 'immediate' ? 'badge-critical' : report.llm_analysis.priority === 'scheduled' ? 'badge-warning' : 'badge-ok'}`}>
                          {report.llm_analysis.priority}
                        </span>
                      </div>
                      {report.llm_analysis.impact_notes && (
                        <div style={{ fontSize: 12, color: '#8b949e', marginTop: 4 }}>{report.llm_analysis.impact_notes}</div>
                      )}
                    </div>
                  )}

                  {/* Key Deviations — bullet points */}
                  {report.deviations?.length > 0 && (
                    <div style={{ marginBottom: 16 }}>
                      <div className="card-title">Key Deviations</div>
                      <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                        {report.deviations.map((d, i) => (
                          <li key={i} style={{ fontSize: 13, padding: '6px 0', borderBottom: '1px solid #21262d', display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span className={`badge ${SEVERITY_CLASS[d.severity] || ''}`} style={{ minWidth: 70, textAlign: 'center' }}>{d.severity}</span>
                            <span style={{ color: '#c9d1d9' }}>
                              <strong>{d.field}</strong>: <code style={{ color: '#f85149' }}>{d.current}</code> → <code style={{ color: '#3fb950' }}>{d.expected}</code>
                            </span>
                            <span style={{ marginLeft: 'auto', color: '#d29922', fontSize: 11 }}>{d.action}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Remediation Steps — bullet points */}
                  {report.deviations?.length > 0 && (
                    <div style={{ marginBottom: 16 }}>
                      <div className="card-title">Remediation Steps</div>
                      <ul style={{ margin: 0, paddingLeft: 20, fontSize: 12 }}>
                        {report.deviations.map((d, i) => (
                          <li key={i} style={{ marginBottom: 8, color: '#c9d1d9' }}>
                            <strong>Fix {d.field}:</strong>
                            <div className="remediation" style={{ marginTop: 4 }}>{d.remediation}</div>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Upgrade path */}
                  {report.upgrade_path?.length > 0 && (
                    <div style={{ marginBottom: 16 }}>
                      <div className="card-title">Recommended Upgrade Path</div>
                      <ul style={{ margin: 0, paddingLeft: 20, fontSize: 12 }}>
                        {report.upgrade_path.map((step, i) => (
                          <li key={i} style={{ marginBottom: 8, color: '#c9d1d9' }}>
                            Upgrade to <span className="badge badge-info">{step.release}</span> (k8s {step.kubernetes_version})
                            {step.changes?.length > 0 && (
                              <ul style={{ color: '#8b949e', marginTop: 4, paddingLeft: 16 }}>
                                {step.changes.map((c, j) => <li key={j}>{c}</li>)}
                              </ul>
                            )}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* ─── APPROVAL SECTION ─── */}
                  {report.deviations?.length > 0 && (
                    <div style={{
                      background: '#161b22',
                      border: '1px solid #30363d',
                      borderRadius: 8,
                      padding: 16,
                      marginTop: 16,
                    }}>
                      <div className="card-title" style={{ marginBottom: 8 }}>
                        {approvalStatus === 'pending' && '⏳ Awaiting Your Approval'}
                        {approvalStatus === 'approved' && '✓ Approved'}
                        {approvalStatus === 'remediating' && '🔧 Remediating...'}
                        {approvalStatus === 'remediated' && '✓ Remediation Complete'}
                        {approvalStatus === 'rejected' && '✗ Rejected'}
                      </div>

                      {approvalStatus === 'pending' && (
                        <>
                          <div style={{ fontSize: 12, color: '#8b949e', marginBottom: 12 }}>
                            Review the deviations and remediation steps above. Click <strong>Approve & Remediate</strong> to
                            execute the fix, or <strong>Reject</strong> to dismiss this report.
                          </div>
                          <div style={{ display: 'flex', gap: 10 }}>
                            <button
                              className="btn-blue"
                              onClick={approveAndRemediate}
                              disabled={actionLoading}
                              style={{ padding: '8px 20px' }}
                            >
                              {actionLoading ? <><span className="spinner" />Processing…</> : '✓ Approve & Remediate'}
                            </button>
                            <button
                              className="btn-red"
                              onClick={rejectReport}
                              disabled={actionLoading}
                              style={{ padding: '8px 20px' }}
                            >
                              ✗ Reject
                            </button>
                          </div>
                        </>
                      )}

                      {approvalStatus === 'remediating' && (
                        <div style={{ fontSize: 13, color: '#d29922' }}>
                          <span className="spinner" /> Executing remediation steps via Deployment Agent...
                        </div>
                      )}

                      {approvalStatus === 'remediated' && remediationResult && (
                        <div style={{ fontSize: 12 }}>
                          <div style={{ color: '#3fb950', marginBottom: 8 }}>
                            ✓ {remediationResult.successful_steps}/{remediationResult.total_steps} steps completed successfully
                          </div>
                          {remediationResult.steps_executed?.map((step, i) => (
                            <div key={i} style={{ marginBottom: 4, color: step.success ? '#3fb950' : '#f85149' }}>
                              {step.success ? '✓' : '✗'} {step.description || step.action}
                            </div>
                          ))}
                        </div>
                      )}

                      {approvalStatus === 'rejected' && (
                        <div style={{ fontSize: 12, color: '#8b949e' }}>
                          Report dismissed. No changes were made to the cluster.
                        </div>
                      )}
                    </div>
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
