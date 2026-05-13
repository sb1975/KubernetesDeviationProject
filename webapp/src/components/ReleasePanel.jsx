import { useEffect, useState } from 'react'
import ReleaseDiffPanel from './ReleaseDiffPanel'

export default function ReleasePanel() {
  const [activeView, setActiveView] = useState('catalog') // 'catalog' | 'diff'
  const [releases, setReleases] = useState({})
  const [releaseOrder, setReleaseOrder] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState('')
  const [form, setForm] = useState(null)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    fetch('/api/releases')
      .then(async r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then(d => {
        setReleases(d.releases || {})
        setReleaseOrder(d.order || [])
      })
      .catch(e => setError(e.message || 'Failed to load releases'))
      .finally(() => setLoading(false))
  }, [])

  const beginEdit = (name, rel) => {
    setEditing(name)
    setMessage('')
    setForm({
      kubernetes_version: rel.kubernetes_version || '',
      kind_image: rel.kind_image || '',
      cpus: rel.cpus ?? 0.5,
      memory: rel.memory || '',
      description: rel.description || '',
      changes_text: (rel.changes || []).join('\n'),
      applications: (rel.applications || []).map(app => ({
        name: app.name || '',
        namespace: app.namespace || 'default',
        kind: app.kind || 'Deployment',
        image: app.image || '',
        replicas: app.replicas ?? 1,
        service_type: app.service_type || 'ClusterIP',
        service_port: app.service_port ?? 80,
      })),
    })
  }

  const cancelEdit = () => {
    setEditing('')
    setForm(null)
  }

  const addApp = () => {
    setForm(f => ({
      ...f,
      applications: [
        ...(f.applications || []),
        {
          name: '',
          namespace: 'default',
          kind: 'Deployment',
          image: '',
          replicas: 1,
          service_type: 'ClusterIP',
          service_port: 80,
        },
      ],
    }))
  }

  const removeApp = idx => {
    setForm(f => ({
      ...f,
      applications: (f.applications || []).filter((_, i) => i !== idx),
    }))
  }

  const updateAppField = (idx, field, value) => {
    setForm(f => ({
      ...f,
      applications: (f.applications || []).map((app, i) => {
        if (i !== idx) return app
        return { ...app, [field]: value }
      }),
    }))
  }

  const saveEdit = async (name, rel) => {
    if (!form) return
    setSaving(true)
    setMessage('')
    try {
      const changes = form.changes_text
        .split('\n')
        .map(s => s.trim())
        .filter(Boolean)

      const applications = (form.applications || []).map(app => ({
        name: String(app.name || '').trim(),
        namespace: String(app.namespace || 'default').trim() || 'default',
        kind: String(app.kind || 'Deployment').trim() || 'Deployment',
        image: String(app.image || '').trim(),
        replicas: Number(app.replicas),
        service_type: String(app.service_type || 'ClusterIP').trim() || 'ClusterIP',
        service_port: Number(app.service_port),
      }))

      const resp = await fetch(`/api/releases/${name}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kubernetes_version: form.kubernetes_version,
          kind_image: form.kind_image,
          cpus: Number(form.cpus),
          memory: form.memory,
          description: form.description,
          changes,
          applications,
        }),
      })

      if (!resp.ok) {
        const t = await resp.text()
        throw new Error(t)
      }

      const data = await resp.json()
      setReleases(prev => ({
        ...prev,
        [name]: {
          ...rel,
          ...data.updated,
        },
      }))
      setMessage(`${name} updated successfully.`)
      cancelEdit()
    } catch (e) {
      setMessage(`Failed to update ${name}: ${e.message || 'unknown error'}`)
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="card">
        <span style={{ color: '#8b949e', fontSize: 13 }}><span className="spinner" />Loading releases...</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className="card" style={{ color: '#f85149', fontSize: 13 }}>
        Failed to fetch releases: {error}
      </div>
    )
  }

  return (
    <div>
      {/* Sub-tabs */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <button
          className={activeView === 'catalog' ? 'btn-blue' : 'btn-gray'}
          onClick={() => setActiveView('catalog')}
        >
          📋 Release Catalog
        </button>
        <button
          className={activeView === 'diff' ? 'btn-blue' : 'btn-gray'}
          onClick={() => setActiveView('diff')}
        >
          🔄 Release Diff
        </button>
      </div>

      {activeView === 'diff' && <ReleaseDiffPanel />}

      {activeView === 'catalog' && (<>
      <div className="card">
        <div className="card-title">Release Catalog</div>
        <div style={{ color: '#8b949e', fontSize: 12 }}>
          All release baselines used by cluster and application deployment.
        </div>
        {message && (
          <div style={{ marginTop: 10, color: message.startsWith('Failed') ? '#f85149' : '#3fb950', fontSize: 12 }}>
            {message}
          </div>
        )}
      </div>

      <div className="releases-grid">
        {releaseOrder.map(name => {
          const rel = releases[name]
          if (!rel) return null

          return (
            <div key={name} className="release-card">
              <div className="release-card-head">
                <span className="badge badge-info">{name}</span>
                <span className="release-version">k8s {rel.kubernetes_version}</span>
              </div>

              <h3 className="release-name">{rel.description || name}</h3>

              <div className="release-meta">
                <div><strong>Node image:</strong> {rel.kind_image}</div>
                <div><strong>CPU:</strong> {rel.cpus}</div>
                <div><strong>Memory:</strong> {rel.memory}</div>
              </div>

              {editing === name && form ? (
                <div className="release-edit-box">
                  <div className="form-row" style={{ marginTop: 10 }}>
                    <div>
                      <label>Kubernetes Version</label>
                      <input value={form.kubernetes_version} onChange={e => setForm(f => ({ ...f, kubernetes_version: e.target.value }))} />
                    </div>
                    <div>
                      <label>Kind Image</label>
                      <input value={form.kind_image} onChange={e => setForm(f => ({ ...f, kind_image: e.target.value }))} />
                    </div>
                  </div>

                  <div className="form-row">
                    <div>
                      <label>CPU</label>
                      <input type="number" step="0.1" value={form.cpus} onChange={e => setForm(f => ({ ...f, cpus: e.target.value }))} />
                    </div>
                    <div>
                      <label>Memory</label>
                      <input value={form.memory} onChange={e => setForm(f => ({ ...f, memory: e.target.value }))} />
                    </div>
                  </div>

                  <label>Description</label>
                  <input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />

                  <label>Changes (one per line)</label>
                  <textarea
                    rows={4}
                    value={form.changes_text}
                    onChange={e => setForm(f => ({ ...f, changes_text: e.target.value }))}
                  />

                  <div className="release-section-title" style={{ marginTop: 8 }}>Applications Editor</div>
                  <div style={{ marginBottom: 8 }}>
                    <button className="btn-gray" onClick={addApp} type="button" disabled={saving}>+ Add Application</button>
                  </div>

                  {(form.applications || []).map((app, idx) => (
                    <div key={`${name}-app-edit-${idx}`} className="release-edit-app-row">
                      <div className="form-row">
                        <div>
                          <label>Name</label>
                          <input value={app.name} onChange={e => updateAppField(idx, 'name', e.target.value)} />
                        </div>
                        <div>
                          <label>Namespace</label>
                          <input value={app.namespace} onChange={e => updateAppField(idx, 'namespace', e.target.value)} />
                        </div>
                      </div>

                      <div className="form-row">
                        <div>
                          <label>Kind</label>
                          <input value={app.kind} onChange={e => updateAppField(idx, 'kind', e.target.value)} />
                        </div>
                        <div>
                          <label>Image</label>
                          <input value={app.image} onChange={e => updateAppField(idx, 'image', e.target.value)} />
                        </div>
                      </div>

                      <div className="form-row">
                        <div>
                          <label>Replicas</label>
                          <input type="number" value={app.replicas} onChange={e => updateAppField(idx, 'replicas', e.target.value)} />
                        </div>
                        <div>
                          <label>Service Type</label>
                          <input value={app.service_type} onChange={e => updateAppField(idx, 'service_type', e.target.value)} />
                        </div>
                      </div>

                      <div className="form-row" style={{ gridTemplateColumns: '1fr auto' }}>
                        <div>
                          <label>Service Port</label>
                          <input type="number" value={app.service_port} onChange={e => updateAppField(idx, 'service_port', e.target.value)} />
                        </div>
                        <div style={{ alignSelf: 'end' }}>
                          <button className="btn-red" type="button" onClick={() => removeApp(idx)} disabled={saving}>Remove</button>
                        </div>
                      </div>
                    </div>
                  ))}

                  {(form.applications || []).length === 0 && (
                    <div className="release-empty" style={{ marginBottom: 10 }}>No applications in this release.</div>
                  )}

                  <div style={{ display: 'flex', gap: 8 }}>
                    <button className="btn-blue" onClick={() => saveEdit(name, rel)} disabled={saving}>
                      {saving ? 'Saving...' : 'Save Release'}
                    </button>
                    <button className="btn-gray" onClick={cancelEdit} disabled={saving}>Cancel</button>
                  </div>
                </div>
              ) : (
                <div style={{ marginTop: 10 }}>
                  <button className="btn-gray" onClick={() => beginEdit(name, rel)}>Edit Release</button>
                </div>
              )}

              <div className="release-section-title">Changes</div>
              {rel.changes?.length ? (
                <ul className="release-list">
                  {rel.changes.map((change, i) => (
                    <li key={i}>{change}</li>
                  ))}
                </ul>
              ) : (
                <div className="release-empty">No changes listed for this baseline.</div>
              )}

              <div className="release-section-title" style={{ marginTop: 12 }}>Applications</div>
              {rel.applications?.length ? (
                <div className="release-apps">
                  {rel.applications.map(app => (
                    <div key={app.name} className="release-app-row">
                      <div>
                        <div className="release-app-name">{app.name}</div>
                        <div className="release-app-ns">ns: {app.namespace || 'default'}</div>
                      </div>
                      <div className="release-app-right">
                        <div>{app.image}</div>
                        <div>replicas: {app.replicas}</div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="release-empty">No applications defined.</div>
              )}
            </div>
          )
        })}
      </div>
      </>)}
    </div>
  )
}
