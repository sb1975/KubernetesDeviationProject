import { useState, useEffect } from 'react'

export default function AppGreenfieldPanel() {
  const [clusters, setClusters] = useState([])
  const [releases, setReleases] = useState({})
  const [releaseOrder, setReleaseOrder] = useState([])
  const [selectedCluster, setSelectedCluster] = useState('')
  const [selectedRelease, setSelectedRelease] = useState('')
  const [clusterApps, setClusterApps] = useState([])
  const [loadingApps, setLoadingApps] = useState(false)
  const [selectedApps, setSelectedApps] = useState({})
  const [deploying, setDeploying] = useState(false)
  const [deployResults, setDeployResults] = useState([])

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
      if (order.length) setSelectedRelease(order[order.length - 1])
    }).catch(() => {})
  }, [])

  // Fetch deployed apps when cluster changes
  useEffect(() => {
    if (!selectedCluster) return
    refreshApps()
  }, [selectedCluster])

  const refreshApps = () => {
    if (!selectedCluster) return
    setLoadingApps(true)
    fetch(`/api/apps/list/${selectedCluster}`)
      .then(r => r.json())
      .then(d => { setClusterApps(d.apps || []); setLoadingApps(false) })
      .catch(() => setLoadingApps(false))
  }

  const releaseApps = releases[selectedRelease]?.applications || []

  const toggleApp = (appName) => {
    setSelectedApps(prev => ({ ...prev, [appName]: !prev[appName] }))
  }

  const selectAll = () => {
    const all = {}
    releaseApps.forEach(a => { all[a.name] = true })
    setSelectedApps(all)
  }

  const selectNone = () => setSelectedApps({})

  const deploySelected = async () => {
    const apps = releaseApps.filter(a => selectedApps[a.name])
    if (!apps.length || !selectedCluster) return
    setDeploying(true)
    setDeployResults([])
    const results = []
    for (const app of apps) {
      try {
        const resp = await fetch('/api/apps/deploy', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            cluster_name: selectedCluster,
            app_spec: {
              name: app.name,
              namespace: app.namespace || 'default',
              image: app.image,
              replicas: app.replicas,
            },
          }),
        })
        const data = await resp.json()
        results.push({ app: app.name, ...data })
      } catch (e) {
        results.push({ app: app.name, success: false, error: e.message })
      }
    }
    setDeployResults(results)
    setDeploying(false)
    refreshApps()
  }

  return (
    <div>
      {/* Deployed apps in selected cluster */}
      <div className="card">
        <div className="card-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>Deployed Applications</span>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <select
              value={selectedCluster}
              onChange={e => setSelectedCluster(e.target.value)}
              style={{ fontSize: 12, padding: '3px 8px' }}
            >
              {clusters.map(c => (
                <option key={c.name} value={c.name}>{c.name} (v{c.version})</option>
              ))}
              {clusters.length === 0 && <option value="">No clusters</option>}
            </select>
            <button className="btn-gray" style={{ fontSize: 11, padding: '3px 10px' }} onClick={refreshApps}>
              ↻ Refresh
            </button>
          </div>
        </div>
        {loadingApps ? (
          <span style={{ color: '#8b949e', fontSize: 13 }}><span className="spinner" />Loading...</span>
        ) : clusterApps.length === 0 ? (
          <div style={{ color: '#8b949e', fontSize: 13 }}>No applications deployed in this cluster</div>
        ) : (
          <div className="cluster-grid">
            {clusterApps.map(a => (
              <div className="cluster-card" key={a.name}>
                <h4>
                  <span className={`dot ${a.ready_replicas > 0 ? 'dot-green' : 'dot-red'}`} />
                  {a.name}
                </h4>
                <div style={{ fontSize: 11, color: '#8b949e', marginTop: 4 }}>
                  <code>{a.image}</code>
                </div>
                <div style={{ fontSize: 11, color: '#8b949e', marginTop: 2 }}>
                  Replicas: {a.ready_replicas}/{a.replicas}
                </div>
                {a.detected_release && (
                  <div style={{ marginTop: 4 }}>
                    <span className="badge badge-info">{a.detected_release}</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Release selector */}
      <div className="card">
        <div className="card-title">Select Release to Deploy</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
          {releaseOrder.map(r => (
            <div
              key={r}
              className={`release-pill ${selectedRelease === r ? 'selected' : ''}`}
              onClick={() => { setSelectedRelease(r); setSelectedApps({}) }}
            >
              {r}
            </div>
          ))}
        </div>

        {releaseApps.length > 0 && (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <div style={{ fontSize: 12, color: '#8b949e' }}>
                {releaseApps.length} application(s) in {selectedRelease}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn-gray" style={{ fontSize: 11, padding: '2px 8px' }} onClick={selectAll}>
                  Select All
                </button>
                <button className="btn-gray" style={{ fontSize: 11, padding: '2px 8px' }} onClick={selectNone}>
                  Clear
                </button>
              </div>
            </div>

            <table className="deviation-table" style={{ marginBottom: 16 }}>
              <thead>
                <tr>
                  <th style={{ width: 30 }}></th>
                  <th>Application</th>
                  <th>Image</th>
                  <th>Replicas</th>
                  <th>Service</th>
                </tr>
              </thead>
              <tbody>
                {releaseApps.map(a => {
                  const deployed = clusterApps.find(ca => ca.name === a.name)
                  return (
                    <tr key={a.name} style={{ opacity: deployed ? 0.6 : 1 }}>
                      <td>
                        <input
                          type="checkbox"
                          checked={!!selectedApps[a.name]}
                          onChange={() => toggleApp(a.name)}
                        />
                      </td>
                      <td style={{ fontWeight: 600 }}>
                        {a.name}
                        {deployed && (
                          <span className="badge badge-ok" style={{ marginLeft: 6, fontSize: 10 }}>deployed</span>
                        )}
                      </td>
                      <td><code style={{ fontSize: 12 }}>{a.image}</code></td>
                      <td>{a.replicas}</td>
                      <td>{a.service_type}:{a.service_port}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </>
        )}

        <button
          className="btn-blue"
          disabled={deploying || !selectedCluster || Object.values(selectedApps).filter(Boolean).length === 0}
          onClick={deploySelected}
          style={{ width: '100%' }}
        >
          {deploying ? (
            <><span className="spinner" />Deploying...</>
          ) : (
            `🚀 Deploy ${Object.values(selectedApps).filter(Boolean).length} App(s) to ${selectedCluster}`
          )}
        </button>
      </div>

      {/* Deploy results */}
      {deployResults.length > 0 && (
        <div className="card">
          <div className="card-title">Deployment Results</div>
          {deployResults.map((r, i) => (
            <div key={i} style={{
              padding: '8px 12px',
              marginBottom: 6,
              borderRadius: 6,
              background: r.success ? '#1f4429' : '#3d1e1e',
              border: `1px solid ${r.success ? '#3fb950' : '#f85149'}`,
              fontSize: 12,
            }}>
              <strong>{r.app}</strong>
              <span style={{ marginLeft: 8, color: r.success ? '#3fb950' : '#f85149' }}>
                {r.success ? '✓ Deployed' : `✗ Failed: ${r.error || r.stderr || 'unknown error'}`}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
