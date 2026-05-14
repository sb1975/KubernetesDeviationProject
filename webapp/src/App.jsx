import { useState, useCallback, useRef } from 'react'
import ChatBox from './components/ChatBox.jsx'
import ClusterPanel from './components/ClusterPanel.jsx'
import AppDeviationPanel from './components/AppDeviationPanel.jsx'
import ReleasePanel from './components/ReleasePanel.jsx'
import ReportsPanel from './components/ReportsPanel.jsx'

export default function App() {
  const [activeTab, setActiveTab] = useState('releases')
  const [chatWidth, setChatWidth] = useState(33.33)
  const dragging = useRef(false)

  const onMouseDown = useCallback((e) => {
    e.preventDefault()
    dragging.current = true
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    const onMouseMove = (ev) => {
      if (!dragging.current) return
      const pct = (ev.clientX / window.innerWidth) * 100
      setChatWidth(Math.min(60, Math.max(15, pct)))
    }

    const onMouseUp = () => {
      dragging.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }

    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
  }, [])

  return (
    <div className="app">
      <header className="app-header">
        <span style={{ fontSize: 20 }}>⚙️</span>
        <h1>Kubernetes Deviation Dashboard</h1>
        <span>Releases · Clusters · Applications</span>
      </header>

      <div className="app-body">
        {/* Chat panel */}
        <aside className="chat-panel" style={{ width: `${chatWidth}%` }}>
          <ChatBox />
        </aside>

        {/* Resize handle */}
        <div className="resize-handle" onMouseDown={onMouseDown} />

        {/* Main panel */}
        <main className="main-panel">
          <div className="tabs">
            <div
              className={`tab ${activeTab === 'releases' ? 'active' : ''}`}
              onClick={() => setActiveTab('releases')}
            >
              🏷️ Releases
            </div>
            <div
              className={`tab ${activeTab === 'clusters' ? 'active' : ''}`}
              onClick={() => setActiveTab('clusters')}
            >
              🖥️ Clusters
            </div>
            <div
              className={`tab ${activeTab === 'apps' ? 'active' : ''}`}
              onClick={() => setActiveTab('apps')}
            >
              📦 Applications
            </div>
            <div
              className={`tab ${activeTab === 'reports' ? 'active' : ''}`}
              onClick={() => setActiveTab('reports')}
            >
              📋 Reports
            </div>
          </div>

          <div className="panel-content">
            {activeTab === 'clusters' && <ClusterPanel />}
            {activeTab === 'apps' && <AppDeviationPanel />}
            {activeTab === 'releases' && <ReleasePanel />}
            {activeTab === 'reports' && <ReportsPanel />}
          </div>
        </main>
      </div>
    </div>
  )
}
