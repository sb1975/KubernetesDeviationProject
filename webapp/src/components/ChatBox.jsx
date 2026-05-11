import { useState, useRef, useEffect } from 'react'

export default function ChatBox() {
  const [providers, setProviders] = useState([])
  const [provider, setProvider] = useState('')
  const [messages, setMessages] = useState([
    {
      role: 'assistant',
      content: `👋 Hi! I'm your Kubernetes Dashboard assistant. What would you like to work on today?

• **Clusters** — Deploy new clusters, check status, or analyze deviations
• **Applications** — Deploy apps, scan for version drift, or fix deviations
• **Troubleshooting** — Diagnose issues with services, Docker, or connectivity

Just pick one or ask me anything!`,
    },
  ])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const bottomRef = useRef(null)

  // Fetch available providers from backend
  useEffect(() => {
    fetch('/api/chat/providers')
      .then(r => r.json())
      .then(d => {
        const list = d.providers || []
        setProviders(list)
        // Auto-select first ready provider
        const ready = list.find(p => p.ready)
        if (ready) setProvider(ready.value)
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const currentProvider = providers.find(p => p.value === provider)
  const isReady = currentProvider?.ready

  const send = async () => {
    if (!input.trim() || loading || !isReady) return
    setError('')

    const userMsg = { role: 'user', content: input.trim() }
    const next = [...messages, userMsg]
    setMessages(next)
    setInput('')
    setLoading(true)

    try {
      const apiMessages = next.filter(m => m.role !== 'system')
      const resp = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: apiMessages, provider }),
      })
      if (!resp.ok) {
        const err = await resp.json()
        throw new Error(err.detail || 'API error')
      }
      const data = await resp.json()
      setMessages(prev => [...prev, { role: 'assistant', content: data.reply }])
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  const onKey = e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
  }

  const quickActions = [
    { label: '🖥️ Clusters', text: 'I want to work with clusters — deploy, check status, or analyze deviations.' },
    { label: '📦 Applications', text: 'I want to work with applications — deploy apps, check versions, or fix deviations.' },
    { label: '🔍 Troubleshoot', text: 'I need help troubleshooting an issue with my setup.' },
    { label: '📖 How does this app work?', text: 'Explain how this Kubernetes Deviation Dashboard works and what I can do with it.' },
  ]

  const sendQuickAction = (text) => {
    setInput(text)
    // Trigger send on next tick after state update
    setTimeout(() => {
      const userMsg = { role: 'user', content: text }
      setMessages(prev => [...prev, userMsg])
      setLoading(true)
      setError('')
      fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: [userMsg], provider }),
      })
        .then(r => { if (!r.ok) return r.json().then(e => { throw new Error(e.detail || 'API error') }); return r.json() })
        .then(data => setMessages(prev => [...prev, { role: 'assistant', content: data.reply }]))
        .catch(e => setError(e.message))
        .finally(() => { setLoading(false); setInput('') })
    }, 0)
  }

  const showSuggestions = messages.length === 1 && !loading

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header */}
      <div style={{
        padding: '12px 14px',
        borderBottom: '1px solid #30363d',
        background: '#161b22',
        flexShrink: 0,
      }}>
        <div style={{ fontWeight: 600, fontSize: 13, color: '#58a6ff', marginBottom: 8 }}>
          🤖 AI Assistant
        </div>

        <select
          value={provider}
          onChange={e => setProvider(e.target.value)}
          style={{ marginBottom: 0, fontSize: 12 }}
        >
          {providers.map(p => (
            <option key={p.value} value={p.value}>
              {p.label} {p.ready ? '✓' : '(not configured)'}
            </option>
          ))}
          {providers.length === 0 && <option value="">Loading...</option>}
        </select>

        {currentProvider && !currentProvider.ready && (
          <div style={{ fontSize: 11, color: '#d29922', marginTop: 6 }}>
            ⚠ Set the API key in <code>.env</code> file and restart the backend
          </div>
        )}
      </div>

      {/* Messages */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '14px' }}>
        {messages.map((m, i) => (
          <div key={i} style={{
            marginBottom: 12,
            display: 'flex',
            flexDirection: 'column',
            alignItems: m.role === 'user' ? 'flex-end' : 'flex-start',
          }}>
            <div style={{
              background: m.role === 'user' ? '#1f6feb' : '#21262d',
              color: '#c9d1d9',
              padding: '8px 12px',
              borderRadius: m.role === 'user' ? '12px 12px 4px 12px' : '12px 12px 12px 4px',
              fontSize: 13,
              maxWidth: '90%',
              lineHeight: 1.5,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}>
              {m.content}
            </div>
          </div>
        ))}
        {loading && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#8b949e', fontSize: 12 }}>
            <span className="spinner" /> Thinking...
          </div>
        )}
        {showSuggestions && isReady && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>
            {quickActions.map((qa, i) => (
              <button
                key={i}
                className="btn-gray"
                onClick={() => sendQuickAction(qa.text)}
                style={{
                  fontSize: 12,
                  padding: '6px 12px',
                  textAlign: 'left',
                  cursor: 'pointer',
                  border: '1px solid #30363d',
                  borderRadius: 8,
                }}
              >
                {qa.label}
              </button>
            ))}
          </div>
        )}
        {error && (
          <div style={{ color: '#f85149', fontSize: 12, padding: '6px 0' }}>
            ⚠ {error}
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div style={{
        padding: '12px',
        borderTop: '1px solid #30363d',
        flexShrink: 0,
        display: 'flex',
        gap: 8,
      }}>
        <textarea
          rows={2}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={onKey}
          placeholder={isReady ? 'Ask about clusters, releases, deviations…' : 'Configure an LLM provider in .env first'}
          disabled={!isReady}
          style={{ flex: 1, resize: 'none', fontSize: 13, marginBottom: 0 }}
        />
        <button
          className="btn-blue"
          onClick={send}
          disabled={!input.trim() || !isReady || loading}
          style={{ alignSelf: 'flex-end', whiteSpace: 'nowrap' }}
        >
          Send
        </button>
      </div>
    </div>
  )
}
