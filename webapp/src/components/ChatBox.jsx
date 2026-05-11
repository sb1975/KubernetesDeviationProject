import { useState, useRef, useEffect } from 'react'

const PROVIDERS = [
  { value: 'openai', label: 'OpenAI (GPT)', placeholder: 'sk-...' },
  { value: 'gemini', label: 'Google Gemini', placeholder: 'AIza...' },
]

const SYSTEM_PROMPT = `You are a Kubernetes infrastructure assistant with expertise in:
- kind cluster deployments and configuration
- Release management (R1/R2/R3/R4) with specific k8s versions
- Deviation detection and remediation between cluster releases
- Greenfield (new cluster) and Brownfield (upgrade path) scenarios
Be concise and practical. When asked about commands, provide exact CLI examples.`

export default function ChatBox() {
  const [provider, setProvider] = useState('openai')
  const [apiKey, setApiKey] = useState('')
  const [messages, setMessages] = useState([
    {
      role: 'assistant',
      content: 'Hello! I can help with Kubernetes cluster management, release upgrades, and deviation analysis. Set your API key above to start chatting.',
    },
  ])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const bottomRef = useRef(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const send = async () => {
    if (!input.trim() || !apiKey.trim() || loading) return
    setError('')

    const userMsg = { role: 'user', content: input.trim() }
    const next = [...messages, userMsg]
    setMessages(next)
    setInput('')
    setLoading(true)

    try {
      const apiMessages = [
        { role: 'user', content: SYSTEM_PROMPT },
        ...next.filter(m => m.role !== 'system'),
      ]
      const resp = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: apiMessages, provider, api_key: apiKey }),
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
          style={{ marginBottom: 6, fontSize: 12 }}
        >
          {PROVIDERS.map(p => (
            <option key={p.value} value={p.value}>{p.label}</option>
          ))}
        </select>

        <input
          type="password"
          placeholder={PROVIDERS.find(p => p.value === provider)?.placeholder}
          value={apiKey}
          onChange={e => setApiKey(e.target.value)}
          style={{ marginBottom: 0, fontSize: 12 }}
        />
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
          placeholder="Ask about clusters, releases, deviations…"
          style={{ flex: 1, resize: 'none', fontSize: 13, marginBottom: 0 }}
        />
        <button
          className="btn-blue"
          onClick={send}
          disabled={!input.trim() || !apiKey || loading}
          style={{ alignSelf: 'flex-end', whiteSpace: 'nowrap' }}
        >
          Send
        </button>
      </div>
    </div>
  )
}
