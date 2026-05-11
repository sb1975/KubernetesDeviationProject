import { useState } from 'react'
import ChatBox from './components/ChatBox.jsx'
import ClusterPanel from './components/ClusterPanel.jsx'
import AppDeviationPanel from './components/AppDeviationPanel.jsx'

export default function App() {
  const [activeTab, setActiveTab] = useState('clusters')

  return (
    <div className="app">
      <header className="app-header">
        <span style={{ fontSize: 20 }}>⚙️</span>
        <h1>Kubernetes Deviation Dashboard</h1>
        <span>Clusters · Applications</span>
      </header>

      <div className="app-body">
        {/* Chat panel — 1/3 */}
        <aside className="chat-panel">
          <ChatBox />
        </aside>

        {/* Main panel — 2/3 */}
        <main className="main-panel">
          <div className="tabs">
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
          </div>

          <div className="panel-content">
            {activeTab === 'clusters' && <ClusterPanel />}
            {activeTab === 'apps' && <AppDeviationPanel />}
          </div>
        </main>
      </div>
    </div>
  )
}
