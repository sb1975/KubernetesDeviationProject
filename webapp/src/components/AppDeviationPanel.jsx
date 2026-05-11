import { useState } from 'react'
import AppGreenfieldPanel from './AppGreenfieldPanel.jsx'
import AppBrownfieldPanel from './AppBrownfieldPanel.jsx'

export default function AppDeviationPanel() {
  const [activeView, setActiveView] = useState('greenfield')

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <button
          className={activeView === 'greenfield' ? 'btn-blue' : 'btn-gray'}
          onClick={() => setActiveView('greenfield')}
        >
          🌱 Greenfield — Deploy
        </button>
        <button
          className={activeView === 'brownfield' ? 'btn-blue' : 'btn-gray'}
          onClick={() => setActiveView('brownfield')}
        >
          🏗️ Brownfield — Deviations
        </button>
      </div>

      {activeView === 'greenfield' && <AppGreenfieldPanel />}
      {activeView === 'brownfield' && <AppBrownfieldPanel />}
    </div>
  )
}
