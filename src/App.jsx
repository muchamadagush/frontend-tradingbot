import { useEffect, useState, useCallback, useRef } from 'react'
import axios from 'axios'
import './App.css'
import { DashboardTab } from './components/DashboardTab'
import { BacktestingTab } from './components/BacktestingTab'
import { PaperTradingTab } from './components/PaperTradingTab'
import { RiskManagementTab } from './components/RiskManagementTab'
import { FeeCalculatorTab } from './components/FeeCalculatorTab'
import AnalyticsTab from './components/AnalyticsTab'
import { useWebSocket } from './hooks/useWebSocket'
import { authService, configureAxiosAuth } from './services/authService'

// Configure axios with auth headers
configureAxiosAuth(axios)

const VITE_API_URL = import.meta.env.VITE_API_URL || 'http://127.0.0.1:8000'
// Always use VITE_WS_URL if set, otherwise construct from VITE_API_URL
const getWsUrl = () => {
  let base = VITE_API_URL.replace(/\/$/, '')
  base = base.replace(/\/api.*/, '')
  let wsProto = base.startsWith('https') ? 'wss' : 'ws'
  let host = base.replace(/^https?:\/\//, '')
  return `${wsProto}://${host}/ws`
}
const VITE_WS_URL = typeof import.meta.env.VITE_WS_URL !== 'undefined' && import.meta.env.VITE_WS_URL
  ? import.meta.env.VITE_WS_URL
  : getWsUrl()

// Helper: enrich Solana trades with FIFO realized PnL (SOL & %) by matching BUY -> SELL pairs
function enrichSolanaTradesWithPnL(solTrades) {
  if (!Array.isArray(solTrades)) return []
  const chronological = [...solTrades].sort((a, b) => {
    const tA = new Date(a.created_at || a.timestamp || 0).getTime()
    const tB = new Date(b.created_at || b.timestamp || 0).getTime()
    return tA - tB
  })

  const inventory = {} // key -> [{ tokens, sol_cost }]
  const pnlByKey = {}

  for (const t of chronological) {
    const side = String(t.side || '').toUpperCase()
    const tokenKey = t.token_address || t.symbol || 'UNKNOWN'
    const amtIn = Number(t.amount_in || 0)
    const amtOut = Number(t.amount_out || 0)
    const rowId = t.id || `${t.timestamp}_${t.side}_${t.symbol}`

    if (side === 'BUY') {
      if (!inventory[tokenKey]) inventory[tokenKey] = []
      if (amtOut > 0) {
        inventory[tokenKey].push({ tokens: amtOut, sol_cost: amtIn })
      }
      pnlByKey[rowId] = { cost_sol: amtIn }
    } else if (side === 'SELL') {
      let toMatch = amtIn
      let matchedCostSol = 0
      const queue = inventory[tokenKey] || []

      while (queue.length > 0 && toMatch > 1e-9) {
        const lot = queue[0]
        if (lot.tokens <= 1e-9) {
          queue.shift()
          continue
        }
        const take = Math.min(toMatch, lot.tokens)
        const fraction = take / lot.tokens
        const costTaken = fraction * lot.sol_cost
        matchedCostSol += costTaken
        lot.tokens -= take
        lot.sol_cost -= costTaken
        toMatch -= take
        if (lot.tokens <= 1e-9) queue.shift()
      }

      if (matchedCostSol > 0) {
        const pnlSol = amtOut - matchedCostSol
        const pnlPct = (pnlSol / matchedCostSol) * 100
        pnlByKey[rowId] = {
          cost_sol: matchedCostSol,
          pnl_sol: pnlSol,
          pnl_pct: pnlPct,
          is_profit: pnlSol >= 0,
        }
      }
    }
  }

  return solTrades.map(t => {
    const rowId = t.id || `${t.timestamp}_${t.side}_${t.symbol}`
    return {
      ...t,
      source: 'Jupiter',
      ...(pnlByKey[rowId] || {}),
    }
  })
}

function App() {
  const [serverStatus, setServerStatus] = useState("Checking...")
  const [activeTab, setActiveTab] = useState('trading')
  const [authRequired, setAuthRequired] = useState(false)
  const [apiKeyInput, setApiKeyInput] = useState('')
  const [authError, setAuthError] = useState('')

  // --- STATE BOT HUNTER (Tokocrypto) ---
  const [botStatus, setBotStatus] = useState({ is_running: false, current_activity: "Idle" })
  const [activeSymbol, setActiveSymbol] = useState("BTC/USDT")
  const [marketData, setMarketData] = useState(null)

  // --- STATE JUPITER SNIPER (Solana) ---
  const [balances, setBalances] = useState({ SOL: 0 })
  const [swapInput, setSwapInput] = useState(0.01)
  const [targetToken, setTargetToken] = useState("USDC")
  const [swapQuote, setSwapQuote] = useState(null)
  const [isQuoting, setIsQuoting] = useState(false)
  const [isSwapping, setIsSwapping] = useState(false)
  const [txResult, setTxResult] = useState(null)

  // --- STATE AUTO & GOD MODE ---
  const [solanaAutoStatus, setSolanaAutoStatus] = useState({ is_running: false, target: "", position: null, strategy: "TRADER" })
  const [solanaStrategy, setSolanaStrategy] = useState('TRADER')

  const [systemLogs, setSystemLogs] = useState([])
  const [tokoLogs, setTokoLogs] = useState([])
  const [solanaLogs, setSolanaLogs] = useState([])
  const [logChannelView, setLogChannelView] = useState("SPLIT") // ALL | TOKOCRYPTO | SOLANA | SPLIT
  const [historyFilter, setHistoryFilter] = useState("ALL") // ALL | Hunter | Jupiter

  // --- DATA PENDUKUNG ---
  const [history, setHistory] = useState([])
  const availableTokens = ["USDC", "USDT", "BONK", "WIF", "RAY", "JUP", "PYTH"]

  // --- WEBSOCKET MESSAGE HANDLER ---
  const handleWsMessage = useCallback((message) => {
    const { type, data } = message
    
    switch (type) {
      case 'connected':
        setServerStatus("Connected (WS)")
        if (data.bot_running !== undefined) {
          setBotStatus(prev => ({
            ...prev,
            is_running: data.bot_running,
            current_activity: data.activity || prev.current_activity,
          }))
        }
        break
        
      case 'bot_status':
        setBotStatus(data)
        if (data.current_activity) {
          const parts = data.current_activity.split(" ")
          if (parts.length > 1 && (data.current_activity.includes("Managing") || data.current_activity.includes("Scanning"))) {
            setActiveSymbol(parts[1].trim())
          }
        }
        break
        
      case 'trade_update':
        setHistory(prev => {
          const exists = prev.find(t => t.id === data.id && t.source === 'Hunter')
          if (exists) {
            return prev.map(t => (t.id === data.id && t.source === 'Hunter') ? { ...t, ...data } : t)
          }
          return [{ ...data, source: 'Hunter' }, ...prev].slice(0, 50)
        })
        break
        
      case 'system_log': {
        const msg = data.message || ""
        const src = (data.source || "").toUpperCase()
        setSystemLogs(prev => [...prev.slice(-149), msg])
        if (src === "SOLANA" || msg.includes("[SOL]")) {
          setSolanaLogs(prev => [...prev.slice(-99), msg])
        } else if (src === "TOKOCRYPTO" || msg.includes("[TOKO]")) {
          setTokoLogs(prev => [...prev.slice(-99), msg])
        }
        break
      }
        
      case 'balance_update':
        setBalances(data)
        break
        
      case 'solana_status':
        setSolanaAutoStatus(data)
        if (data.strategy && data.is_running) {
          setSolanaStrategy(data.strategy)
        }
        break
        
      case 'price_update':
        if (data.symbol === activeSymbol) {
          setMarketData(prev => ({ ...prev, ...data }))
        }
        break
        
      default:
        break
    }
  }, [activeSymbol])

  // --- WEBSOCKET CONNECTION ---
  const { isConnected, connectionState, shouldUseFallback } = useWebSocket(
    VITE_WS_URL,
    handleWsMessage,
    { fallbackPolling: true, pollingInterval: 3000 }
  )

  // --- FUNGSI UTAMA (FETCH DATA LOOP) ---
  const fetchData = async () => {
    if (typeof document !== 'undefined' && document.hidden) return
    try {
      // 1. Cek Status Bot Hunter
      const resBot = await axios.get(`${VITE_API_URL}/api/bot/status`)
      setBotStatus(resBot.data)

      let targetSymbol = "BTC/USDT"
      if (resBot.data.current_activity) {
        if (resBot.data.current_activity.includes("Managing") || resBot.data.current_activity.includes("Scanning")) {
          const parts = resBot.data.current_activity.split(" ")
          if (parts.length > 1) targetSymbol = parts[1]
        }
      }
      setActiveSymbol(targetSymbol.trim())

      // 2. Harga Market Exchange
      try {
        const resPrice = await axios.get(`${VITE_API_URL}/api/toko/price/${targetSymbol}`)
        setMarketData(resPrice.data)
      } catch (e) { console.debug("Price fetch error", e) }

      // 3. Portfolio Solana
      try {
        const resBal = await axios.get(`${VITE_API_URL}/api/solana/balance`)
        setBalances(resBal.data)
      } catch (e) { console.error("Balance Error", e) }

      // 4. Status Auto Solana
      try {
        const resAuto = await axios.get(`${VITE_API_URL}/api/solana/auto/status`)
        setSolanaAutoStatus(resAuto.data)
        if (resAuto.data.strategy && resAuto.data.is_running) {
          setSolanaStrategy(resAuto.data.strategy)
        }
      } catch (e) { }

      // 5. Global History (dengan kalkulasi PnL FIFO untuk Solana & status lengkap untuk Hunter)
      try {
        const resToko = await axios.get(`${VITE_API_URL}/api/trade/history`)
        const tokoData = (resToko.data || []).map(item => ({ ...item, source: 'Hunter' }))

        const resSol = await axios.get(`${VITE_API_URL}/api/solana/history`)
        const solData = enrichSolanaTradesWithPnL(resSol.data || [])

        const combined = [...solData, ...tokoData].sort((a, b) => {
          const dateA = new Date(a.created_at || a.timestamp)
          const dateB = new Date(b.created_at || b.timestamp)
          return dateB - dateA
        })
        setHistory(combined)
      } catch (e) { console.error("History Error", e) }

      // 6. Ambil System Logs (Gabungan + Terpisah Tokocrypto & Solana)
      try {
        const resLogs = await axios.get(`${VITE_API_URL}/api/system/logs`)
        const allLogs = resLogs.data?.logs || (Array.isArray(resLogs.data) ? resLogs.data : [])
        const tLogs = resLogs.data?.tokocrypto_logs || allLogs.filter(l => String(l).includes("[TOKO]"))
        const sLogs = resLogs.data?.solana_logs || allLogs.filter(l => String(l).includes("[SOL]"))
        setSystemLogs(Array.isArray(allLogs) ? allLogs : [])
        setTokoLogs(Array.isArray(tLogs) ? tLogs : [])
        setSolanaLogs(Array.isArray(sLogs) ? sLogs : [])
      } catch (e) {
        console.error("System Logs Error", e)
      }

      setServerStatus("Connected")

    } catch (error) {
      setServerStatus("Error / Offline")
    }
  }

  // --- HANDLERS ---
  const handleToggleBot = async () => {
    try { await axios.post(`${VITE_API_URL}/api/bot/toggle`); fetchData(); } catch { alert("Gagal koneksi bot") }
  }

  const handleGetQuote = async () => {
    setIsQuoting(true); setSwapQuote(null); setTxResult(null);
    try {
      const res = await axios.get(`${VITE_API_URL}/api/solana/quote?amount=${swapInput}&to_token=${targetToken}`)
      setSwapQuote(res.data)
    } catch { alert("Gagal mengambil quote.") } finally { setIsQuoting(false) }
  }

  const handleExecuteSwap = async () => {
    if (!swapQuote) return;
    setIsSwapping(true)
    try {
      const payload = swapQuote?.raw_data
        ? { quote_response: swapQuote.raw_data }
        : { amount: parseFloat(swapInput), input_token: "SOL", output_token: targetToken }
      const res = await axios.post(`${VITE_API_URL}/api/solana/swap`, payload)
      if (res.data?.error) {
        alert("Swap Gagal: " + res.data.error)
      } else {
        setTxResult(res.data)
        setSwapQuote(null)
      }
      setTimeout(fetchData, 4000)
    } catch (e) { 
      alert("Gagal Swap: " + (e.response?.data?.error || e.message)) 
    } finally { 
      setIsSwapping(false) 
    }
  }

  const handleToggleAuto = async (mode) => {
    try {
      await axios.post(`${VITE_API_URL}/api/solana/auto/toggle`, { mode: mode, token: targetToken, strategy: solanaStrategy })
      fetchData()
    } catch (e) { alert("Gagal toggle auto") }
  }

  // Initial data fetch
  useEffect(() => { fetchData() }, [])

  // Check auth status and handle auth:expired event
  useEffect(() => {
    const checkAuth = async () => {
      const status = await authService.checkAuthStatus()
      if (status.auth_enabled && !authService.isAuthenticated()) {
        setAuthRequired(true)
      }
    }
    checkAuth()
    
    const handleAuthExpired = () => {
      setAuthRequired(true)
      setAuthError('Session expired. Please login again.')
    }
    window.addEventListener('auth:expired', handleAuthExpired)
    return () => window.removeEventListener('auth:expired', handleAuthExpired)
  }, [])

  // Handle login
  const handleLogin = async () => {
    setAuthError('')
    const result = await authService.login(apiKeyInput)
    if (result.success) {
      setAuthRequired(false)
      setApiKeyInput('')
      fetchData()
    } else {
      setAuthError(result.error || 'Login failed')
    }
  }

  // Handle logout
  const handleLogout = () => {
    authService.logout()
    setAuthRequired(true)
  }

  // Polling fallback when WebSocket is not connected
  useEffect(() => {
    let interval;
    if (shouldUseFallback) {
      interval = setInterval(fetchData, 3000)
    } else if (!shouldUseFallback && isConnected && connectionState === 'connected') {
      interval = setInterval(() => {
        fetchBalancesAndPrices()
      }, 5000)
    }
    return () => {
      if (interval) clearInterval(interval)
    }
  }, [shouldUseFallback, isConnected, connectionState])

  // Lighter fetch for WS-connected mode
  const fetchBalancesAndPrices = async () => {
    if (typeof document !== 'undefined' && document.hidden) return
    try {
      const resBal = await axios.get(`${VITE_API_URL}/api/solana/balance`)
      setBalances(resBal.data)
      
      const resPrice = await axios.get(`${VITE_API_URL}/api/toko/price/${activeSymbol}`)
      setMarketData(resPrice.data)
      
      const resAuto = await axios.get(`${VITE_API_URL}/api/solana/auto/status`)
      setSolanaAutoStatus(resAuto.data)
    } catch (e) {
      console.debug('[WS] Background fetch error', e)
    }
  }

  // Connection status display
  const getConnectionDisplay = () => {
    if (isConnected) return { text: 'Connected (WS)', color: '#2ecc71' }
    if (connectionState === 'reconnecting') return { text: 'Reconnecting...', color: '#f39c12' }
    if (connectionState === 'fallback') return { text: 'Connected (Polling)', color: '#3498db' }
    if (serverStatus === 'Connected') return { text: 'Connected', color: '#2ecc71' }
    return { text: serverStatus, color: '#e74c3c' }
  }
  const connectionDisplay = getConnectionDisplay()

  const tabs = [
    { id: 'trading', label: '🎯 Trading', icon: '📱' },
    { id: 'backtest', label: '📊 Backtesting', icon: '📈' },
    { id: 'paper', label: '📄 Paper Trading', icon: '💼' },
    { id: 'risk', label: '⚠️ Risk Manager', icon: '🔒' },
    { id: 'fees', label: '💰 Fee Calculator', icon: '💵' },
    { id: 'analytics', label: '📈 Analytics', icon: '📉' }
  ]

  // Helper untuk merender kolom Side (membedakan OPEN vs CLOSED pada Hunter & BUY vs SELL pada Jupiter)
  const renderTradeSide = (trade) => {
    if (trade.source !== 'Jupiter') {
      const st = String(trade.status || '').toUpperCase()
      const isClosed = st.includes('CLOSED') || trade.side === 'SELL'
      return (
        <span style={{
          fontWeight: 'bold',
          color: isClosed ? '#8e44ad' : '#27ae60',
          backgroundColor: isClosed ? '#f3e5f5' : '#e8f8f5',
          padding: '2px 6px',
          borderRadius: '4px',
          fontSize: '11px'
        }}>
          {isClosed ? 'CLOSED' : 'BUY (OPEN)'}
        </span>
      )
    }
    return (
      <span style={{ fontWeight: 'bold', color: trade.side === 'BUY' ? '#27ae60' : '#c0392b' }}>
        {trade.side}
      </span>
    )
  }

  // Helper untuk merender kolom Amount secara jelas (baik untuk Hunter USDT maupun Jupiter SOL)
  const renderTradeAmount = (trade) => {
    const baseToken = (trade.symbol || '').split('/')[0] || 'TOKEN'

    if (trade.source !== 'Jupiter') {
      const totalUsdt = Number(trade.total_usdt || (Number(trade.buy_price || 0) * Number(trade.amount || 0)))
      const coinQty = Number(trade.amount || 0)
      return (
        <div>
          <span style={{ fontWeight: 'bold', color: '#2c3e50' }}>
            ${totalUsdt.toFixed(2)} USDT
          </span>
          {coinQty > 0 && (
            <div style={{ fontSize: '11px', color: '#7f8c8d' }}>
              {coinQty.toLocaleString(undefined, { maximumFractionDigits: 6 })} {baseToken}
            </div>
          )}
        </div>
      )
    }

    const amtIn = Number(trade.amount_in || 0)
    const amtOut = Number(trade.amount_out || 0)

    if (trade.side === 'BUY') {
      return (
        <div>
          <span style={{ fontWeight: 'bold', color: '#2c3e50' }}>
            +{amtOut.toLocaleString(undefined, { maximumFractionDigits: 4 })} {baseToken}
          </span>
          {amtIn > 0 && (
            <div style={{ fontSize: '11px', color: '#7f8c8d' }}>
              Modal: {amtIn.toFixed(4)} SOL
            </div>
          )}
        </div>
      )
    }

    // SELL: amount_out adalah SOL yang diterima kembali ke wallet
    return (
      <div>
        <span style={{ fontWeight: 'bold', color: '#2c3e50' }}>
          {amtOut.toFixed(6)} SOL
        </span>
        {amtIn > 0 && (
          <div style={{ fontSize: '11px', color: '#7f8c8d' }}>
            Jual: {amtIn.toLocaleString(undefined, { maximumFractionDigits: 2 })} {baseToken}
          </div>
        )}
      </div>
    )
  }

  // Helper untuk merender kolom Info (Badge Untung/Rugi + Harga Entry/Exit + Alasan Exit + Link TX)
  const renderTradeInfo = (trade) => {
    if (trade.source !== 'Jupiter') {
      const buyPrice = Number(trade.buy_price || 0)
      const sellPrice = Number(trade.sell_price || 0)
      const totalUsdt = Number(trade.total_usdt || 0)
      const hasPnl = trade.profit_usdt !== undefined && trade.profit_usdt !== null
      const pnl = hasPnl ? Number(trade.profit_usdt) : 0
      const pnlPct = (hasPnl && totalUsdt > 0) ? (pnl / totalUsdt) * 100 : (buyPrice > 0 && sellPrice > 0 ? ((sellPrice - buyPrice) / buyPrice) * 100 : 0)

      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          {hasPnl && (
            <span style={{
              display: 'inline-block',
              width: 'fit-content',
              fontWeight: 'bold',
              color: pnl >= 0 ? '#155724' : '#721c24',
              backgroundColor: pnl >= 0 ? '#d4edda' : '#f8d7da',
              padding: '2px 6px',
              borderRadius: '4px',
              fontSize: '11px'
            }}>
              {pnl >= 0 ? 'UNTUNG' : 'RUGI'} {pnl >= 0 ? `+$${pnl.toFixed(2)}` : `-$${Math.abs(pnl).toFixed(2)}`} ({pnlPct >= 0 ? '+' : ''}{pnlPct.toFixed(2)}%)
            </span>
          )}
          <div style={{ fontSize: '11px', color: '#7f8c8d' }}>
            {buyPrice > 0 && (
              <span>
                Entry: ${buyPrice.toLocaleString(undefined, { maximumFractionDigits: 6 })}
                {sellPrice > 0 ? ` ➜ Exit: $${sellPrice.toLocaleString(undefined, { maximumFractionDigits: 6 })}` : ' (Masih Aktif)'}
              </span>
            )}
          </div>
        </div>
      )
    }

    const hasPnl = trade.side === 'SELL' && typeof trade.pnl_sol === 'number'
    const isWin = hasPnl ? trade.pnl_sol >= 0 : false

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
        {hasPnl && (
          <span style={{
            display: 'inline-block',
            width: 'fit-content',
            fontWeight: 'bold',
            color: isWin ? '#155724' : '#721c24',
            backgroundColor: isWin ? '#d4edda' : '#f8d7da',
            padding: '2px 6px',
            borderRadius: '4px',
            fontSize: '11px'
          }}>
            {isWin ? 'UNTUNG' : 'RUGI'} {trade.pnl_sol >= 0 ? '+' : ''}{trade.pnl_sol.toFixed(4)} SOL ({trade.pnl_pct >= 0 ? '+' : ''}{trade.pnl_pct.toFixed(2)}%)
          </span>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '11px' }}>
          {trade.status && trade.status !== 'Success' && (
            <span style={{ color: '#7f8c8d' }}>{trade.status}</span>
          )}
          {trade.txid && trade.txid !== 'UNKNOWN' ? (
            <a
              href={`https://solscan.io/tx/${trade.txid}`}
              target="_blank"
              rel="noreferrer"
              style={{ color: '#3498db', fontWeight: 'bold' }}
            >
              View TX
            </a>
          ) : (
            <span>-</span>
          )}
        </div>
      </div>
    )
  }

  // Login form if auth required
  if (authRequired) {
    return (
      <div style={{ 
        padding: '20px', fontFamily: 'Arial', maxWidth: '400px', margin: '100px auto', 
        color: '#ecf0f1', backgroundColor: '#2c3e50', borderRadius: '10px'
      }}>
        <div style={{ textAlign: 'center', marginBottom: '30px' }}>
          <h1>🦅 Crypto Hybrid Bot</h1>
          <p style={{ color: '#bdc3c7' }}>Authentication Required</p>
        </div>
        
        <div style={{ marginBottom: '20px' }}>
          <label style={{ display: 'block', marginBottom: '8px', color: '#bdc3c7' }}>API Key</label>
          <input
            type="password"
            value={apiKeyInput}
            onChange={(e) => setApiKeyInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
            placeholder="Enter your API key"
            style={{
              width: '100%', padding: '12px', borderRadius: '5px', border: '1px solid #34495e',
              backgroundColor: '#34495e', color: '#ecf0f1', fontSize: '14px', boxSizing: 'border-box'
            }}
          />
        </div>
        
        {authError && (
          <p style={{ color: '#e74c3c', marginBottom: '15px', fontSize: '14px' }}>{authError}</p>
        )}
        
        <button
          onClick={handleLogin}
          style={{
            width: '100%', padding: '12px', backgroundColor: '#3498db', color: 'white',
            border: 'none', borderRadius: '5px', fontSize: '16px', cursor: 'pointer',
            fontWeight: 'bold'
          }}
        >
          🔓 Login
        </button>
        
        <p style={{ marginTop: '20px', fontSize: '12px', color: '#7f8c8d', textAlign: 'center' }}>
          Set BOT_API_KEY in .env or API_KEYS for multiple keys.<br/>
          Set AUTH_MODE=disabled to skip authentication.
        </p>
      </div>
    )
  }

  return (
    <div style={{ padding: '20px', fontFamily: 'Arial', maxWidth: '1200px', margin: '0 auto', color: '#ecf0f1', backgroundColor: '#2c3e50', minHeight: '100vh' }}>

      <div style={{ textAlign: 'center', marginBottom: '30px' }}>
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '20px' }}>
          <h1 style={{ margin: 0 }}>🦅 Crypto Hybrid Bot</h1>
          {authService.isAuthenticated() && authService.authEnabled && (
            <button
              onClick={handleLogout}
              style={{
                padding: '6px 12px', backgroundColor: 'transparent', color: '#e74c3c',
                border: '1px solid #e74c3c', borderRadius: '4px', fontSize: '12px', cursor: 'pointer'
              }}
            >
              Logout
            </button>
          )}
        </div>
        <p style={{ fontSize: '14px', color: '#bdc3c7' }}>
          System: <span style={{ color: connectionDisplay.color, fontWeight: 'bold' }}>{connectionDisplay.text}</span>
          {isConnected && <span style={{ marginLeft: '8px', fontSize: '10px' }}>⚡ Real-time</span>}
        </p>
      </div>

      {/* TAB NAVIGATION */}
      <div style={{
        display: 'flex',
        gap: '8px',
        marginBottom: '20px',
        borderBottom: '2px solid rgba(255,255,255,0.1)',
        overflowX: 'auto',
        paddingBottom: '0'
      }}>
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              padding: '12px 20px',
              fontSize: '14px',
              fontWeight: 'bold',
              border: 'none',
              borderBottom: activeTab === tab.id ? '3px solid #3498db' : '3px solid transparent',
              backgroundColor: activeTab === tab.id ? 'rgba(52, 152, 219, 0.2)' : 'transparent',
              color: activeTab === tab.id ? '#3498db' : '#bdc3c7',
              cursor: 'pointer',
              transition: 'all 0.3s ease',
              whiteSpace: 'nowrap'
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* TAB CONTENT */}
      {activeTab === 'trading' && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', marginBottom: '20px' }}>
            <div style={cardStyle}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
                <h3 style={{ margin: 0, color: '#34495e' }}>🎮 Hunter</h3>
                <span style={{ fontSize: '10px', fontWeight: 'bold', background: botStatus.is_running ? '#d4edda' : '#f8d7da', color: botStatus.is_running ? '#155724' : '#721c24', padding: '2px 6px', borderRadius: '4px' }}>
                  {botStatus.is_running ? "ON" : "OFF"}
                </span>
              </div>
              <div style={{ backgroundColor: '#ecf0f1', padding: '10px', borderRadius: '8px', textAlign: 'center', marginBottom: '15px' }}>
                <small style={{ color: '#7f8c8d' }}>ACTIVITY</small><br /><strong style={{ color: '#2980b9' }}>{botStatus.current_activity}</strong>
              </div>
              <button onClick={handleToggleBot} style={{ width: '100%', backgroundColor: botStatus.is_running ? '#e74c3c' : '#27ae60', color: 'white', padding: '10px', border: 'none', cursor: 'pointer', borderRadius: '8px', fontWeight: 'bold' }}>
                {botStatus.is_running ? "STOP SCANNING" : "START SCANNING"}
              </button>
            </div>

            {/* KANAN: SNIPER */}
            <div style={{ ...cardStyle, background: 'linear-gradient(135deg, #8e44ad 0%, #c0392b 100%)', color: 'white', border: 'none' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                <h3 style={{ margin: 0 }}>🪐 Jupiter Sniper</h3>
                <span style={{ fontSize: '10px', background: 'rgba(0,0,0,0.3)', padding: '2px 8px', borderRadius: '10px' }}>Unified API</span>
              </div>

              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                {Object.entries(balances || {}).map(([symbol, amount]) => (
                  <div key={symbol} style={{ background: 'rgba(255,255,255,0.2)', padding: '5px 10px', borderRadius: '15px', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '5px' }}>
                    <span style={{ fontWeight: 'bold' }}>{symbol}</span>
                    <span>{parseFloat(amount).toLocaleString(undefined, { maximumFractionDigits: 4 })}</span>
                  </div>
                ))}
                {(!balances || Object.keys(balances).length === 0) && <span style={{ fontSize: '12px', opacity: 0.7 }}>Loading portfolio...</span>}
              </div>

              <div style={{ background: 'rgba(255,255,255,0.15)', padding: '15px', borderRadius: '8px' }}>
                {!txResult ? (
                  <>
                    <div style={{ fontSize: '11px', marginBottom: '5px', fontWeight: 'bold', textTransform: 'uppercase' }}>{swapQuote ? "Konfirmasi" : "Sniper Console"}</div>

                    <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap', marginBottom: '8px' }}>
                      <span style={{ fontSize: '11px', fontWeight: 'bold', letterSpacing: '0.5px' }}>Strategy</span>
                      <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px' }}>
                        <input type="radio" name="solana-strategy" value="TRADER" checked={solanaStrategy === 'TRADER'} onChange={(e) => setSolanaStrategy(e.target.value)} />
                        <span>Trader (TA + 1% slip)</span>
                      </label>
                      <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px' }}>
                        <input type="radio" name="solana-strategy" value="SNIPER" checked={solanaStrategy === 'SNIPER'} onChange={(e) => setSolanaStrategy(e.target.value)} />
                        <span>Sniper (Rug + 20% slip)</span>
                      </label>
                      {solanaAutoStatus.is_running && (
                        <span style={{ fontSize: '11px', background: 'rgba(0,0,0,0.25)', padding: '4px 8px', borderRadius: '6px' }}>
                          Running: {solanaAutoStatus.strategy || 'TRADER'}
                        </span>
                      )}
                    </div>

                    <div style={{ display: 'flex', gap: '10px', alignItems: 'center', marginBottom: '10px' }}>
                      <div style={{ background: 'rgba(0,0,0,0.2)', padding: '5px 10px', borderRadius: '4px', flex: 1 }}>
                        <input type="number" value={swapInput} onChange={(e) => setSwapInput(e.target.value)} disabled={!!swapQuote} style={{ width: '50px', background: 'transparent', border: 'none', color: 'white', fontWeight: 'bold' }} />
                        <span style={{ fontSize: '12px' }}>SOL</span>
                      </div>
                      <span style={{ fontWeight: 'bold' }}>➜</span>
                      <select value={targetToken} onChange={(e) => setTargetToken(e.target.value)} disabled={!!swapQuote} style={{ padding: '5px', borderRadius: '4px', border: 'none', fontWeight: 'bold', color: '#2c3e50', background: '#ecf0f1', cursor: 'pointer' }}>
                        {availableTokens.map(token => <option key={token} value={token}>{token}</option>)}
                      </select>
                    </div>

                    {!swapQuote ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                        <div style={{ display: 'flex', gap: '5px' }}>
                          <button onClick={handleGetQuote} disabled={isQuoting} style={{ ...btnActionStyle, flex: 1 }}>
                            {isQuoting ? "..." : `CEK ${targetToken}`}
                          </button>
                          <button
                            onClick={() => handleToggleAuto('MANUAL_TARGET')}
                            style={{ ...btnActionStyle, background: '#8e44ad', flex: 1 }}>
                            🤖 AUTO {targetToken}
                          </button>
                        </div>

                        <button
                          onClick={() => handleToggleAuto('AUTO_DISCOVERY')}
                          style={{
                            ...btnActionStyle,
                            background: solanaAutoStatus.is_running && !availableTokens.includes(solanaAutoStatus.target) ? '#c0392b' : '#34495e',
                            border: '1px dashed #f1c40f', fontSize: '11px', padding: '10px'
                          }}>
                          {solanaAutoStatus.is_running && !availableTokens.includes(solanaAutoStatus.target)
                            ? `⛔ STOP HUNTING (${solanaAutoStatus.target})`
                            : "🕵️ AKTIFKAN GOD MODE (AUTO CARI COIN)"}
                        </button>

                        {solanaAutoStatus.position && (
                          <div style={{ fontSize: '10px', background: '#2ecc71', padding: '5px', borderRadius: '4px', textAlign: 'center', color: 'black' }}>
                            Holding: {parseFloat(solanaAutoStatus.position.token_amount).toFixed(2)} {solanaAutoStatus.position.token} ({solanaAutoStatus.position.entry_price_sol} SOL)
                          </div>
                        )}
                      </div>
                    ) : (
                      <div style={{ display: 'flex', gap: '5px' }}>
                        <button onClick={() => setSwapQuote(null)} style={{ ...btnActionStyle, background: '#7f8c8d', flex: 1 }}>BATAL</button>
                        <button onClick={handleExecuteSwap} disabled={isSwapping} style={{ ...btnActionStyle, background: '#27ae60', flex: 1 }}>{isSwapping ? "PROSES..." : "BELI MANUAL"}</button>
                      </div>
                    )}

                    {swapQuote && !swapQuote.error && <div style={{ marginTop: '10px', padding: '10px', background: 'rgba(0,0,0,0.3)', borderRadius: '4px', fontSize: '13px' }}>Estimasi: <span style={{ fontWeight: 'bold', color: '#55efc4' }}>{swapQuote.output_estimate} {targetToken}</span></div>}
                    {swapQuote && swapQuote.error && <div style={{ marginTop: '10px', color: '#ff7675', fontSize: '11px' }}>Error: {swapQuote.error}</div>}
                  </>
                ) : (
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: '40px', marginBottom: '10px' }}>{txResult.status === 'success' ? '✅' : '❌'}</div>
                    <h4 style={{ margin: '0 0 5px 0' }}>{txResult.status === 'success' ? 'Sukses!' : 'Gagal'}</h4>
                    {txResult.txid && <div style={{ fontSize: '11px', background: 'rgba(0,0,0,0.2)', padding: '5px', borderRadius: '4px', margin: '10px 0' }}>TX: {txResult.txid.slice(0, 10)}...</div>}
                    <button onClick={() => { setTxResult(null); setSwapInput(0.01); }} style={{ ...btnActionStyle, width: '100%', marginTop: '10px' }}>KEMBALI</button>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div style={cardStyle}>
            <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #bdc3c7', paddingBottom: '10px', marginBottom: '15px' }}>
              <h3 style={{ margin: 0, color: '#34495e' }}>Market Monitor</h3>
              <span style={{ background: '#f1c40f', color: '#2c3e50', padding: '2px 8px', borderRadius: '4px', fontSize: '12px', fontWeight: 'bold' }}>TARGET: {activeSymbol}</span>
            </div>
            {marketData ? (
              <div style={{ textAlign: 'center' }}>
                <h1 style={{ margin: '0', fontSize: '42px', color: '#2c3e50' }}>${(marketData.price ? parseFloat(marketData.price) : 0).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 8})}</h1>
              </div>
            ) : <p style={{ textAlign: 'center', color: '#7f8c8d' }}>Scanner Idle...</p>}
          </div>

          {/* SYSTEM TERMINAL (SEPARATED & COMBINED LIVE LOGS) */}
          <div style={cardStyle}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', flexWrap: 'wrap', gap: '8px' }}>
              <div>
                <h3 style={{ margin: 0, color: '#34495e' }}>💻 Live Terminal (Log Terpisah & Gabungan)</h3>
                <span style={{ fontSize: '11px', color: '#7f8c8d' }}>Pantau aktivitas Tokocrypto Hunter & Solana DEX secara terpisah atau berdampingan</span>
              </div>
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                {[
                  { id: 'SPLIT', label: '🪟 Split 2 Panel', bg: '#1e293b' },
                  { id: 'TOKOCRYPTO', label: `🤖 Tokocrypto (${tokoLogs.length})`, bg: '#2563eb' },
                  { id: 'SOLANA', label: `☀️ Solana (${solanaLogs.length})`, bg: '#7c3aed' },
                  { id: 'ALL', label: `🌐 Semua (${systemLogs.length})`, bg: '#059669' },
                ].map(tab => (
                  <button
                    key={tab.id}
                    onClick={() => setLogChannelView(tab.id)}
                    style={{
                      padding: '6px 12px',
                      borderRadius: '6px',
                      border: 'none',
                      cursor: 'pointer',
                      fontSize: '11px',
                      fontWeight: 'bold',
                      backgroundColor: logChannelView === tab.id ? tab.bg : '#ecf0f1',
                      color: logChannelView === tab.id ? '#ffffff' : '#2c3e50',
                    }}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>

            {logChannelView === 'SPLIT' ? (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '14px' }}>
                {/* PANEL KIRI: TOKOCRYPTO HUNTER */}
                <div>
                  <div style={{ background: '#1e3a8a', color: '#fff', padding: '6px 12px', borderTopLeftRadius: '8px', borderTopRightRadius: '8px', fontSize: '12px', fontWeight: 'bold', display: 'flex', justifyContent: 'space-between' }}>
                    <span>🤖 Log Tokocrypto Hunter (CEX)</span>
                    <span>{tokoLogs.length} baris</span>
                  </div>
                  <div style={{
                    background: '#090d16',
                    color: '#38bdf8',
                    fontFamily: 'monospace',
                    fontSize: '11.5px',
                    padding: '12px',
                    borderBottomLeftRadius: '8px',
                    borderBottomRightRadius: '8px',
                    height: '220px',
                    overflowY: 'auto',
                    border: '1px solid #1e3a8a'
                  }}>
                    {tokoLogs.length === 0 ? (
                      <div style={{ color: '#64748b' }}>Belum ada log aktivitas Tokocrypto Hunter...</div>
                    ) : (
                      tokoLogs.slice().reverse().map((log, index) => (
                        <div key={index} style={{ marginBottom: '4px', borderBottom: '1px solid #111827', paddingBottom: '2px' }}>
                          {log}
                        </div>
                      ))
                    )}
                  </div>
                </div>

                {/* PANEL KANAN: SOLANA DEX (TRADER v4 / SNIPER v3) */}
                <div>
                  <div style={{ background: '#581c87', color: '#fff', padding: '6px 12px', borderTopLeftRadius: '8px', borderTopRightRadius: '8px', fontSize: '12px', fontWeight: 'bold', display: 'flex', justifyContent: 'space-between' }}>
                    <span>☀️ Log Solana DEX (Trader v4 / Sniper v3)</span>
                    <span>{solanaLogs.length} baris</span>
                  </div>
                  <div style={{
                    background: '#0f0718',
                    color: '#c084fc',
                    fontFamily: 'monospace',
                    fontSize: '11.5px',
                    padding: '12px',
                    borderBottomLeftRadius: '8px',
                    borderBottomRightRadius: '8px',
                    height: '220px',
                    overflowY: 'auto',
                    border: '1px solid #581c87'
                  }}>
                    {solanaLogs.length === 0 ? (
                      <div style={{ color: '#64748b' }}>Belum ada log aktivitas Solana DEX...</div>
                    ) : (
                      solanaLogs.slice().reverse().map((log, index) => (
                        <div key={index} style={{ marginBottom: '4px', borderBottom: '1px solid #1f122b', paddingBottom: '2px' }}>
                          {log}
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <div style={{
                background: '#000',
                color: logChannelView === 'TOKOCRYPTO' ? '#38bdf8' : logChannelView === 'SOLANA' ? '#c084fc' : '#00ff00',
                fontFamily: 'monospace',
                fontSize: '12px',
                padding: '15px',
                borderRadius: '8px',
                height: '220px',
                overflowY: 'auto',
                border: '1px solid #333'
              }}>
                {(() => {
                  const activeLogs = logChannelView === 'TOKOCRYPTO' ? tokoLogs : logChannelView === 'SOLANA' ? solanaLogs : systemLogs
                  if (activeLogs.length === 0) {
                    return <div style={{ color: '#555' }}>Belum ada log untuk kategori ini...</div>
                  }
                  return activeLogs.slice().reverse().map((log, index) => (
                    <div key={index} style={{ marginBottom: '4px', borderBottom: '1px solid #111' }}>
                      {log}
                    </div>
                  ))
                })()}
              </div>
            )}
          </div>

          <div style={cardStyle}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
              <h3 style={{ margin: 0, color: '#34495e' }}>📜 Global & Separated Trade History</h3>
              <div style={{ display: 'flex', gap: '6px' }}>
                {[
                  { id: 'ALL', label: '🌐 Semua Transaksi' },
                  { id: 'Hunter', label: '🤖 Tokocrypto (Hunter)' },
                  { id: 'Jupiter', label: '☀️ Solana (Jupiter)' },
                ].map(f => (
                  <button
                    key={f.id}
                    onClick={() => setHistoryFilter(f.id)}
                    style={{
                      padding: '5px 10px',
                      borderRadius: '6px',
                      border: 'none',
                      cursor: 'pointer',
                      fontSize: '11px',
                      fontWeight: 'bold',
                      backgroundColor: historyFilter === f.id ? '#2c3e50' : '#ecf0f1',
                      color: historyFilter === f.id ? '#fff' : '#2c3e50',
                    }}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '10px', fontSize: '13px', color: '#2c3e50' }}>
              <thead>
                <tr style={{ textAlign: 'left', borderBottom: '2px solid #ecf0f1', color: '#7f8c8d' }}>
                  <th style={{ padding: '8px' }}>Time</th><th>Source</th><th>Pair</th><th>Side</th><th>Amount (Real Coin/SOL/USDT)</th><th>PnL & Info</th>
                </tr>
              </thead>
              <tbody>
                {history.filter(t => historyFilter === 'ALL' || t.source === historyFilter).map((trade, idx) => (
                  <tr key={idx} style={{ borderBottom: '1px solid #ecf0f1' }}>
                    <td style={{ padding: '8px', color: '#7f8c8d' }}>{new Date(trade.created_at || trade.timestamp).toLocaleTimeString()}</td>
                    <td><span style={{ padding: '2px 6px', borderRadius: '4px', fontSize: '10px', fontWeight: 'bold', color: 'white', background: trade.source === 'Jupiter' ? 'linear-gradient(135deg, #8e44ad, #c0392b)' : '#2980b9' }}>{trade.source}</span></td>
                    <td style={{ fontWeight: 'bold' }}>{trade.symbol}</td>
                    <td>{renderTradeSide(trade)}</td>
                    <td style={{ padding: '6px 4px' }}>{renderTradeAmount(trade)}</td>
                    <td style={{ padding: '6px 4px', fontSize: '11px', color: '#95a5a6' }}>{renderTradeInfo(trade)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {activeTab === 'backtest' && <BacktestingTab />}
      {activeTab === 'paper' && <PaperTradingTab />}
      {activeTab === 'risk' && <RiskManagementTab />}
      {activeTab === 'fees' && <FeeCalculatorTab />}
      {activeTab === 'analytics' && <AnalyticsTab />}
    </div>
  )
}

const cardStyle = { borderRadius: '12px', padding: '20px', marginBottom: '20px', backgroundColor: '#ffffff', boxShadow: '0 4px 6px rgba(0,0,0,0.1)' }
const btnActionStyle = { background: '#f39c12', color: 'white', border: 'none', padding: '8px 15px', borderRadius: '4px', cursor: 'pointer', fontSize: '12px', fontWeight: 'bold' }

export default App
