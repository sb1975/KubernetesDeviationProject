import { useState, useEffect } from 'react'

const STATUS_BADGE = {
  pending_approval: { label: '⏳ Pending', cls: 'badge-warning' },
  approved: { label: '✓ Approved', cls: 'badge-ok' },
  rejected: { label: '✗ Rejected', cls: 'badge-critical' },
  remediated: { label: '🔧 Remediated', cls: 'badge-info' },
}

export default function ReportsPanel() {
  const [reports, setReports] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all') // all, pending_approval, approved, remediated, rejected
  const [actionLoading, setActionLoading] = useState({})
  const [planPreview, setPlanPreview] = useState(null)
  const [planLoading, setPlanLoading] = useState(false)

  const fetchReports = () => {
    const url = filter === 'all' ? '/api/reports' : `/api/reports?status=${filter}`
    fetch(url)
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() })
      .then(d => setReports(d.reports || []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }

  useEffect(() => { fetchReports() }, [filter])

  const approveReport = async (id) => {
    setActionLoading(prev => ({ ...prev, [id]: 'approving' }))
    try {
      const resp = await fetch(`/api/reports/${id}/approve`, { method: 'POST' })
      if (resp.ok) fetchReports()
    } finally {
      setActionLoading(prev => ({ ...prev, [id]: null }))
    }
  }

  const rejectReport = async (id) => {
    const reason = prompt('Rejection reason (optional):') || ''
    setActionLoading(prev => ({ ...prev, [id]: 'rejecting' }))
    try {
      await fetch(`/api/reports/${id}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason }),
      })
      fetchReports()
    } finally {
      setActionLoading(prev => ({ ...prev, [id]: null }))
    }
  }

  const viewPlan = async (id) => {
    setPlanLoading(true)
    setPlanPreview(null)
    try {
      const resp = await fetch(`/api/reports/${id}/plan`, { method: 'POST' })
      if (resp.ok) {
        const data = await resp.json()
        setPlanPreview({ id, ...data })
      }
    } finally {
      setPlanLoading(false)
    }
  }

  const executeRemediation = async (id) => {
    if (!confirm('Execute remediation? This will modify the cluster/application.')) return
    setActionLoading(prev => ({ ...prev, [id]: 'remediating' }))
    try {
      const resp = await fetch(`/api/reports/${id}/remediate`, { method: 'POST' })
      if (resp.ok) fetchReports()
      else {
        const err = await resp.text()
        alert(`Remediation failed: ${err}`)
      }
    } finally {
      setActionLoading(prev => ({ ...prev, [id]: null }))
    }
  }

  if (loading) {
    return (
      <div className="card">
        <span style={{ color: '#8b949e', fontSize: 13 }}><span className="spinner" />Loading reports...</span>
      </div>
    )
  }

  return (
    <div>
      <div className="card">
        <div className="card-title">Deviation Reports & Approval</div>
        <div style={{ color: '#8b949e', fontSize: 12, marginBottom: 12 }}>
          Review deviation reports, approve for remediation, or reject.
        </div>

        {/* Filter tabs */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
          {['all', 'pending_approval', 'approved', 'remediated', 'rejected'].map(f => (
            <button
              key={f}
              className={filter === f ? 'btn-blue' : 'btn-gray'}
              onClick={() => setFilter(f)}
              style={{ fontSize: 11, padding: '4px 10px' }}
            >
              {f === 'all' ? 'All' : f.replace('_', ' ')}
            </button>
          ))}
          <button
            className="btn-gray"
            onClick={fetchReports}
            style={{ fontSize: 11, padding: '4px 10px', marginLeft: 'auto' }}
          >
            🔄 Refresh
          </button>
        </div>
      </div>

      {reports.length === 0 && (
        <div className="card" style={{ color: '#8b949e', fontSize: 13 }}>
          No reports found. Run a deviation analysis to generate reports.
        </div>
      )}

      {reports.map(r => {
        const report = r.report || {}
        const badge = STATUS_BADGE[r.status] || { label: r.status, cls: '' }
        const isActioning = actionLoading[r.id]

        return (
          <div key={r.id} className="card" style={{ borderLeft: `3px solid ${r.status === 'pending_approval' ? '#d29922' : r.status === 'approved' ? '#3fb950' : r.status === 'rejected' ? '#f85149' : '#58a6ff'}` }}>
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <div>
                <span className={`badge ${badge.cls}`} style={{ marginRight: 8 }}>{badge.label}</span>
                <span style={{ fontSize: 12, color: '#8b949e' }}>
                  {r.type === 'cluster' ? '🖥️' : '📦'} {r.type} • ID: {r.id}
                </span>
              </div>
              <span style={{ fontSize: 11, color: '#8b949e' }}>
                {new Date(r.created_at).toLocaleString()}
              </span>
            </div>

            {/* Summary */}
            <div style={{ fontSize: 13, marginBottom: 8 }}>
              <strong>{report.cluster || report.app_name || '—'}</strong>
              {report.target_release && <span className="badge badge-info" style={{ marginLeft: 8 }}>→ {report.target_release}</span>}
            </div>
            <div style={{ fontSize: 12, color: '#c9d1d9', marginBottom: 8 }}>
              {report.summary || 'No summary'}
            </div>

            {/* LLM Analysis */}
            {report.llm_analysis && (
              <div style={{ background: '#21262d', borderRadius: 6, padding: '8px 12px', marginBottom: 8, fontSize: 12 }}>
                <div style={{ color: '#58a6ff', fontWeight: 600, marginBottom: 4 }}>🤖 AI Analysis</div>
                <div style={{ color: '#c9d1d9' }}>{report.llm_analysis.risk_assessment}</div>
                <div style={{ color: '#8b949e', marginTop: 4 }}>
                  Priority: <span className={`badge ${report.llm_analysis.priority === 'immediate' ? 'badge-critical' : report.llm_analysis.priority === 'scheduled' ? 'badge-warning' : 'badge-ok'}`}>
                    {report.llm_analysis.priority}
                  </span>
                </div>
                {report.llm_analysis.impact_notes && (
                  <div style={{ color: '#8b949e', marginTop: 4 }}>{report.llm_analysis.impact_notes}</div>
                )}
              </div>
            )}

            {/* Deviations summary */}
            {report.deviations?.length > 0 && (
              <div style={{ fontSize: 12, marginBottom: 8 }}>
                <strong style={{ color: '#f85149' }}>{report.deviations.length} deviation(s):</strong>{' '}
                {report.deviations.map((d, i) => (
                  <span key={i} style={{ color: '#c9d1d9' }}>
                    {d.field} ({d.current} → {d.expected}){i < report.deviations.length - 1 ? ', ' : ''}
                  </span>
                ))}
              </div>
            )}

            {/* Actions */}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {r.status === 'pending_approval' && (
                <>
                  <button
                    className="btn-blue"
                    onClick={() => approveReport(r.id)}
                    disabled={!!isActioning}
                    style={{ fontSize: 12 }}
                  >
                    {isActioning === 'approving' ? <><span className="spinner" />Approving…</> : '✓ Approve'}
                  </button>
                  <button
                    className="btn-red"
                    onClick={() => rejectReport(r.id)}
                    disabled={!!isActioning}
                    style={{ fontSize: 12 }}
                  >
                    {isActioning === 'rejecting' ? <><span className="spinner" />…</> : '✗ Reject'}
                  </button>
                  <button
                    className="btn-gray"
                    onClick={() => viewPlan(r.id)}
                    disabled={planLoading}
                    style={{ fontSize: 12 }}
                  >
                    📋 Preview Plan
                  </button>
                </>
              )}
              {r.status === 'approved' && (
                <button
                  className="btn-blue"
                  onClick={() => executeRemediation(r.id)}
                  disabled={!!isActioning}
                  style={{ fontSize: 12 }}
                >
                  {isActioning === 'remediating' ? <><span className="spinner" />Remediating…</> : '🔧 Execute Remediation'}
                </button>
              )}
              {r.status === 'remediated' && r.remediation_result && (
                <div style={{ fontSize: 12, color: '#3fb950' }}>
                  ✓ {r.remediation_result.successful_steps}/{r.remediation_result.total_steps} steps completed
                </div>
              )}
              {r.status === 'rejected' && r.rejected_reason && (
                <div style={{ fontSize: 12, color: '#f85149' }}>
                  Reason: {r.rejected_reason}
                </div>
              )}
            </div>

            {/* Plan preview */}
            {planPreview && planPreview.id === r.id && (
              <div style={{ marginTop: 10, background: '#21262d', borderRadius: 6, padding: 10 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: '#58a6ff', marginBottom: 6 }}>Remediation Plan</div>
                {planPreview.plan?.steps?.map((step, i) => (
                  <div key={i} style={{ fontSize: 12, marginBottom: 6, color: '#c9d1d9' }}>
                    <span style={{ color: step.risk === 'high' ? '#f85149' : step.risk === 'medium' ? '#d29922' : '#3fb950' }}>
                      [{step.risk}]
                    </span>{' '}
                    {step.description || step.action}
                  </div>
                ))}
                {(!planPreview.plan?.steps || planPreview.plan.steps.length === 0) && (
                  <div style={{ fontSize: 12, color: '#8b949e' }}>No steps generated.</div>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
