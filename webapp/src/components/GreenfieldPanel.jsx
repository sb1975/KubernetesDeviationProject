import { useState, useEffect } from 'react'

const DEFAULT_SUBNETS = {
  c1: { pod: '10.10.0.0/16', svc: '10.110.0.0/12', port: 30001 },
  c2: { pod: '10.20.0.0/16', svc: '10.120.0.0/12', port: 30002 },
  c3: { pod: '10.30.0.0/16', svc: '10.130.0.0/12', port: 30003 },
  c4: { pod: '10.40.0.0/16', svc: '10.140.0.0/12', port: 30004 },
}

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000'
const HIDDEN_CLUSTER_NAMES = new Set(['eric15'])

function deriveClusterNetwork(name) {
  const key = name.trim().toLowerCase()
  if (!key) {
    return { pod: '10.244.0.0/16', svc: '10.96.0.0/12', port: 30000 }
  }

  if (DEFAULT_SUBNETS[key]) {
    return DEFAULT_SUBNETS[key]
  }

  const digitGroups = key.match(/\d+/g)
  let idx = digitGroups?.length ? parseInt(digitGroups[digitGroups.length - 1], 10) : NaN

  if (!Number.isFinite(idx) || idx <= 0) {
    idx = [...key].reduce((acc, ch) => acc + ch.charCodeAt(0), 0) % 99 + 1
  }

  const podOctet = ((idx * 10 - 1) % 200) + 1
  const svcOctet = 100 + ((idx * 10 - 1) % 100)
  const hostPort = 30000 + idx

  return {
    pod: `10.${podOctet}.0.0/16`,
    svc: `10.${svcOctet}.0.0/12`,
    port: hostPort,
  }
}

export default function GreenfieldPanel() {
  const [releases, setReleases] = useState({})
  const [releaseOrder, setReleaseOrder] = useState([])
  const [clusters, setClusters] = useState([])
  const [selectedRelease, setSelectedRelease] = useState('')
  const [form, setForm] = useState({
    cluster_name: '',
    pod_subnet: '10.244.0.0/16',
    service_subnet: '10.96.0.0/12',
    host_port: 30000,
    recreate: false,
    verbose: true,
  })
  const [deploying, setDeploying] = useState(false)
  const [deletingCluster, setDeletingCluster] = useState(null)
  const [log, setLog] = useState('')
  const [result, setResult] = useState(null)
  const [loadingClusters, setLoadingClusters] = useState(true)

  // Fetch releases and cluster status on mount
  useEffect(() => {
    fetch('/api/releases')
      .then(r => r.json())
      .then(d => {
        setReleases(d.releases || {})
        setReleaseOrder(d.order || [])
        if (d.order?.length) setSelectedRelease(d.order[d.order.length - 1])
      })
      .catch(() => {})

    refreshClusters()
  }, [])

  useEffect(() => {
    const handleClustersUpdated = () => {
      refreshClusters()
    }

    window.addEventListener('clusters-updated', handleClustersUpdated)
    return () => window.removeEventListener('clusters-updated', handleClustersUpdated)
  }, [])

  const refreshClusters = () => {
    setLoadingClusters(true)
    fetch(`${API_BASE}/api/clusters`)
      .then(r => r.json())
      .then(d => {
        const nextClusters = (d.clusters || []).filter(c => !HIDDEN_CLUSTER_NAMES.has(c.name))
        setClusters(nextClusters)
        setLoadingClusters(false)
      })
      .catch(() => setLoadingClusters(false))
  }

  const waitForCluster = async (name, attempts = 12, delayMs = 5000) => {
    for (let i = 0; i < attempts; i += 1) {
      try {
        const r = await fetch(`${API_BASE}/api/clusters`)
        if (r.ok) {
          const d = await r.json()
          const found = (d.clusters || []).some(c => c.name === name)
          if (found) return true
        }
      } catch {
        // keep retrying
      }
      await new Promise(resolve => setTimeout(resolve, delayMs))
    }
    return false
  }

  const onClusterNameChange = name => {
    const preset = deriveClusterNetwork(name)
    setForm(f => ({ ...f, cluster_name: name, pod_subnet: preset.pod, service_subnet: preset.svc, host_port: preset.port }))
  }

  const deploy = async () => {
    if (!form.cluster_name || !selectedRelease) return
    setDeploying(true)
    setLog('')
    setResult(null)

    try {
      const resp = await fetch(`${API_BASE}/api/greenfield/deploy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, release: selectedRelease }),
      })
      if (!resp.ok) {
        const errText = await resp.text()
        try {
          const errJson = JSON.parse(errText)
          setLog(`Error: ${errJson.detail || errText}`)
        } catch {
          setLog(`Error (${resp.status}): ${errText}`)
        }
        return
      }
      const data = await resp.json()
      setResult(data)
      setLog((data.stdout || '') + (data.stderr || ''))
      refreshClusters()
    } catch (e) {
      const msg = String(e?.message || 'Network request failed')
      if (msg.toLowerCase().includes('networkerror') || msg.toLowerCase().includes('failed to fetch')) {
        const created = await waitForCluster(form.cluster_name)
        if (created) {
          setResult({ success: true, exit_code: 0, stdout: 'Cluster created (verified after transient network disconnect).' })
          setLog('Cluster deployment completed. Connection dropped while waiting, but cluster is now running.')
          refreshClusters()
        } else {
          setLog('Error: Lost connection while waiting for deployment response. Backend may still be processing; click Refresh in Running Clusters after 30-60s.')
        }
      } else {
        setLog(`Error: ${msg}`)
      }
    } finally {
      setDeploying(false)
    }
  }

  const deleteCluster = async name => {
    if (!confirm(`Delete cluster '${name}'?`)) return
    setDeletingCluster(name)
    setLog('')
    try {
      const resp = await fetch(`${API_BASE}/api/greenfield/cluster/${name}`, { method: 'DELETE' })
      const data = await resp.json().catch(() => null)
      if (!resp.ok || (data && data.success === false)) {
        const errMsg = data?.detail || data?.stdout || `Delete failed (HTTP ${resp.status})`
        setLog(`Error deleting '${name}': ${errMsg}`)
      } else {
        setLog(`Cluster '${name}' deleted successfully.`)
        window.dispatchEvent(new Event('clusters-updated'))
      }
    } catch (e) {
      setLog(`Error deleting '${name}': ${String(e?.message || e)}`)
    } finally {
      setDeletingCluster(null)
      refreshClusters()
    }
  }

  const rel = releases[selectedRelease]

  return (
    <div>
      {/* Cluster status */}
      <div className="card">
        <div className="card-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>Running Clusters</span>
          <button className="btn-gray" style={{ fontSize: 11, padding: '3px 10px' }} onClick={refreshClusters}>
            ↻ Refresh
          </button>
        </div>
        {loadingClusters ? (
          <span style={{ color: '#8b949e', fontSize: 13 }}><span className="spinner" />Loading...</span>
        ) : clusters.length === 0 ? (
          <div style={{ color: '#8b949e', fontSize: 13 }}>No kind clusters running</div>
        ) : (
          <div className="cluster-grid">
            {clusters.map(c => (
              <div className="cluster-card" key={c.name}>
                <h4>
                  <span className={`dot ${c.ready ? 'dot-green' : 'dot-red'}`} />
                  {c.name}
                </h4>
                <div className="version">v{c.version}</div>
                {c.detected_release && (
                  <div style={{ marginTop: 4 }}>
                    <span className="badge badge-info">{c.detected_release}</span>
                  </div>
                )}
                <button
                  className="btn-red"
                  style={{ fontSize: 11, padding: '3px 8px', marginTop: 8 }}
                  onClick={() => deleteCluster(c.name)}
                  disabled={deletingCluster === c.name}
                >
                  {deletingCluster === c.name ? 'Deleting…' : 'Delete'}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Release selector */}
      <div className="card">
        <div className="card-title">Select Release</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
          {releaseOrder.map(r => (
            <div
              key={r}
              className={`release-pill ${selectedRelease === r ? 'selected' : ''}`}
              onClick={() => setSelectedRelease(r)}
            >
              {r}
            </div>
          ))}
        </div>
        {rel && (
          <div style={{ fontSize: 12, color: '#8b949e', lineHeight: 1.7 }}>
            <div><strong style={{ color: '#c9d1d9' }}>K8s version:</strong> {rel.kubernetes_version}</div>
            <div><strong style={{ color: '#c9d1d9' }}>Node image:</strong> {rel.kind_image}</div>
            <div><strong style={{ color: '#c9d1d9' }}>Description:</strong> {rel.description}</div>
            {rel.changes?.length > 0 && (
              <div style={{ marginTop: 6 }}>
                <strong style={{ color: '#c9d1d9' }}>Changes in this release:</strong>
                <ul style={{ marginLeft: 16, marginTop: 4 }}>
                  {rel.changes.map((c, i) => <li key={i}>{c}</li>)}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Deploy form */}
      <div className="card">
        <div className="card-title">Deploy New Cluster</div>
        <div className="form-row">
          <div>
            <label>Cluster Name</label>
            <input
              placeholder="e.g. c1, c4, dev-cluster"
              value={form.cluster_name}
              onChange={e => onClusterNameChange(e.target.value)}
            />
          </div>
          <div>
            <label>Host Port</label>
            <input
              type="number"
              value={form.host_port}
              onChange={e => setForm(f => ({ ...f, host_port: parseInt(e.target.value) }))}
            />
          </div>
        </div>
        <div className="form-row">
          <div>
            <label>Pod Subnet</label>
            <input
              value={form.pod_subnet}
              onChange={e => setForm(f => ({ ...f, pod_subnet: e.target.value }))}
            />
          </div>
          <div>
            <label>Service Subnet</label>
            <input
              value={form.service_subnet}
              onChange={e => setForm(f => ({ ...f, service_subnet: e.target.value }))}
            />
          </div>
        </div>
        <div style={{ display: 'flex', gap: 16, alignItems: 'center', marginBottom: 12 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 0, cursor: 'pointer' }}>
            <input
              type="checkbox"
              style={{ width: 'auto', marginBottom: 0 }}
              checked={form.recreate}
              onChange={e => setForm(f => ({ ...f, recreate: e.target.checked }))}
            />
            Recreate if exists
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 0, cursor: 'pointer' }}>
            <input
              type="checkbox"
              style={{ width: 'auto', marginBottom: 0 }}
              checked={form.verbose}
              onChange={e => setForm(f => ({ ...f, verbose: e.target.checked }))}
            />
            Verbose output
          </label>
        </div>

        <button
          className="btn-primary"
          disabled={deploying || !form.cluster_name || !selectedRelease}
          onClick={deploy}
          style={{ width: '100%' }}
        >
          {deploying ? <><span className="spinner" />Deploying {form.cluster_name} with {selectedRelease}…</> : `🚀 Deploy ${form.cluster_name || 'cluster'} with ${selectedRelease || '...'}`}
        </button>

        {result && (
          <div style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
            {result.success
              ? <span style={{ color: '#3fb950' }}>✓ Cluster deployed successfully</span>
              : <span style={{ color: '#f85149' }}>✗ Deployment failed (exit {result.exit_code})</span>
            }
          </div>
        )}

        {log && <div className="log-box">{log}</div>}
      </div>
    </div>
  )
}
