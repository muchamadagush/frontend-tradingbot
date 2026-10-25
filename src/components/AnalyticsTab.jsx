import React, { useState, useEffect } from 'react';
import axios from 'axios';
import {
  LineChart,
  Line,
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';

const VITE_API_URL = import.meta.env.VITE_API_URL || 'http://127.0.0.1:8000';

const dateInputStyles = `
  .analytics-date-input {
    width: 150px;
    padding: 10px 12px !important;
    border: 2px solid #d1d5db !important;
    border-radius: 4px !important;
    font-size: 14px !important;
    font-weight: 500 !important;
    background-color: #ffffff !important;
    color: #1f2937 !important;
    box-sizing: border-box !important;
    transition: border-color 0.2s !important;
    cursor: pointer !important;
    pointer-events: auto !important;
  }

  .analytics-date-input:focus {
    outline: none !important;
    border-color: #3b82f6 !important;
    box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1) !important;
  }

  .analytics-date-input::-webkit-calendar-picker-indicator {
    cursor: pointer !important;
    color: #6b7280 !important;
    filter: invert(0.8);
  }
`;

const formatIdr = (val) => {
  const num = Number(val || 0);
  const sign = num >= 0 ? '+' : '-';
  return `${sign}Rp ${Math.abs(Math.round(num)).toLocaleString('id-ID')}`;
};

const AnalyticsTab = () => {
  // 'combined' (Keseluruhan), 'tokocrypto' (Hunter CEX), or 'solana' (DEX)
  const [activeTab, setActiveTab] = useState('combined');
  // Sub-filter for Solana: 'ALL' | 'TRADER' | 'SNIPER'
  const [solanaStrategyFilter, setSolanaStrategyFilter] = useState('ALL');
  const [startDate, setStartDate] = useState(null);
  const [endDate, setEndDate] = useState(null);
  const [timeframe, setTimeframe] = useState('daily');
  const [analyticsData, setAnalyticsData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    const style = document.createElement('style');
    style.innerHTML = dateInputStyles;
    document.head.appendChild(style);
    return () => document.head.removeChild(style);
  }, []);

  const fetchAnalytics = async (tab, start, end, tf, solStrat = 'ALL') => {
    setLoading(true);
    setError(null);
    try {
      let endpoint = `${VITE_API_URL}/api/analytics/combined`;
      if (tab === 'solana') {
        endpoint = `${VITE_API_URL}/api/analytics/solana`;
      } else if (tab === 'tokocrypto') {
        endpoint = `${VITE_API_URL}/api/analytics/tokocrypto`;
      }

      const params = new URLSearchParams();
      if (start) params.append('start_date', start);
      if (end) params.append('end_date', end);
      params.append('timeframe', tf);
      if (tab === 'solana') {
        params.append('strategy', solStrat);
      }

      const response = await axios.get(`${endpoint}?${params.toString()}`);
      setAnalyticsData(response.data);
    } catch (err) {
      setError(`Gagal memuat data analytics: ${err.message}`);
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAnalytics(activeTab, startDate, endDate, timeframe, solanaStrategyFilter);
  }, [activeTab, timeframe, solanaStrategyFilter]);

  const handleApplyDateFilter = () => {
    fetchAnalytics(activeTab, startDate, endDate, timeframe, solanaStrategyFilter);
  };

  const handleResetFilters = () => {
    setStartDate(null);
    setEndDate(null);
    setTimeframe('daily');
    setSolanaStrategyFilter('ALL');
    fetchAnalytics(activeTab, null, null, 'daily', 'ALL');
  };

  const getColorByValue = (value) => (Number(value || 0) >= 0 ? '#10b981' : '#ef4444');

  const summary = analyticsData?.summary || {};
  const breakdown = analyticsData?.breakdown || {};
  const chartData = analyticsData?.data || [];

  return (
    <div style={styles.container}>
      <h1 style={styles.title}>📊 Analytics Dashboard (Keseluruhan & Per Jenis Bot)</h1>

      {/* ===== MAIN PORTFOLIO TAB SWITCHER ===== */}
      <div style={styles.tabSwitcher}>
        <button
          style={{
            ...styles.tabButton,
            ...(activeTab === 'combined' ? styles.tabButtonActiveCombined : {}),
          }}
          onClick={() => setActiveTab('combined')}
        >
          🌐 Keseluruhan (Gabungan USD & IDR)
        </button>
        <button
          style={{
            ...styles.tabButton,
            ...(activeTab === 'tokocrypto' ? styles.tabButtonActiveToko : {}),
          }}
          onClick={() => setActiveTab('tokocrypto')}
        >
          🤖 Tokocrypto Hunter (CEX)
        </button>
        <button
          style={{
            ...styles.tabButton,
            ...(activeTab === 'solana' ? styles.tabButtonActiveSolana : {}),
          }}
          onClick={() => setActiveTab('solana')}
        >
          ☀️ Solana Portfolio (DEX)
        </button>
      </div>

      {/* ===== SOLANA SUB-STRATEGY FILTER (ALL / TRADER v4 / SNIPER v3) ===== */}
      {activeTab === 'solana' && (
        <div style={styles.subFilterBar}>
          <span style={styles.subFilterLabel}>Filter Strategi Solana:</span>
          {[
            { id: 'ALL', label: '🌊 Semua Solana (Trader + Sniper)' },
            { id: 'TRADER', label: '📈 Solana Trader v4 (Swing/Pullback)' },
            { id: 'SNIPER', label: '⚡ Solana Sniper v3 (Fast Momentum)' },
          ].map((item) => (
            <button
              key={item.id}
              onClick={() => setSolanaStrategyFilter(item.id)}
              style={{
                ...styles.subFilterBtn,
                ...(solanaStrategyFilter === item.id ? styles.subFilterBtnActive : {}),
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}

      {/* ===== FILTER CONTROLS ===== */}
      <div style={styles.filterContainer}>
        <div style={styles.filterGroup}>
          <label style={styles.label}>Start Date:</label>
          <input
            type="date"
            value={startDate || ''}
            onChange={(e) => setStartDate(e.target.value)}
            className="analytics-date-input"
          />
        </div>

        <div style={styles.filterGroup}>
          <label style={styles.label}>End Date:</label>
          <input
            type="date"
            value={endDate || ''}
            onChange={(e) => setEndDate(e.target.value)}
            className="analytics-date-input"
          />
        </div>

        <div style={styles.filterGroup}>
          <label style={styles.label}>Timeframe:</label>
          <select
            value={timeframe}
            onChange={(e) => setTimeframe(e.target.value)}
            style={styles.select}
          >
            <option value="daily">📅 Daily</option>
            <option value="weekly">📆 Weekly</option>
            <option value="monthly">📊 Monthly</option>
            <option value="yearly">📈 Yearly</option>
          </select>
        </div>

        <div style={styles.filterButtons}>
          <button
            onClick={handleApplyDateFilter}
            style={styles.buttonApply}
            disabled={loading}
          >
            {loading ? '⏳ Loading...' : '🔍 Apply Filter'}
          </button>
          <button onClick={handleResetFilters} style={styles.buttonReset}>
            🔄 Reset
          </button>
        </div>
      </div>

      {error && <div style={styles.errorMessage}>❌ {error}</div>}
      {loading && <div style={styles.loadingMessage}>⏳ Memuat data analytics...</div>}

      {/* =========================================================
          VIEW 1: KESELURUHAN / COMBINED ANALYTICS
         ========================================================= */}
      {analyticsData && !loading && activeTab === 'combined' && (
        <>
          <div style={styles.summaryCardsContainer}>
            <SummaryCard
              title="Total Net Profit (Gabungan)"
              value={summary.net_profit_usd || 0}
              prefix="$"
              subtitle={formatIdr(summary.net_profit_idr || 0)}
              color={getColorByValue(summary.net_profit_usd)}
              icon="🌐"
            />
            <SummaryCard
              title="Kontribusi Tokocrypto"
              value={summary.tokocrypto_net_usd || 0}
              prefix="$"
              subtitle={`${breakdown?.tokocrypto?.total_trades || 0} trades (WR ${breakdown?.tokocrypto?.win_rate || 0}%)`}
              color={getColorByValue(summary.tokocrypto_net_usd)}
              icon="🤖"
            />
            <SummaryCard
              title="Kontribusi Solana DEX"
              value={summary.solana_net_usd || 0}
              prefix="$"
              subtitle={`${(summary.solana_net_sol || 0).toFixed(4)} SOL (${breakdown?.solana?.total_trades || 0} trades)`}
              color={getColorByValue(summary.solana_net_usd)}
              icon="☀️"
            />
            <SummaryCard
              title="Win Rate Keseluruhan"
              value={summary.win_rate || 0}
              suffix="%"
              subtitle={`${summary.winning_trades || 0}W / ${summary.losing_trades || 0}L (${summary.total_trades || 0} total)`}
              color="#3b82f6"
              icon="🎯"
            />
            <SummaryCard
              title="Profit Factor Gabungan"
              value={summary.profit_factor || 0}
              suffix="x"
              subtitle={`Gross +$${(summary.total_profit_usd || 0).toFixed(2)} / -$${Math.abs(summary.total_loss_usd || 0).toFixed(2)}`}
              color="#8b5cf6"
              icon="⚖️"
            />
          </div>

          {/* ===== PER-ENGINE BREAKDOWN TABLE ===== */}
          <div style={styles.tableCard}>
            <h2 style={styles.chartTitle}>📋 Perbandingan Performa Per Jenis Bot</h2>
            <div style={{ overflowX: 'auto' }}>
              <table style={styles.comparisonTable}>
                <thead>
                  <tr style={styles.tableHeaderRow}>
                    <th style={styles.th}>Jenis Mesin / Strategi</th>
                    <th style={styles.th}>Total Trades</th>
                    <th style={styles.th}>Win / Loss</th>
                    <th style={styles.th}>Win Rate</th>
                    <th style={styles.th}>Profit Factor</th>
                    <th style={styles.th}>Net Profit (Native)</th>
                    <th style={styles.th}>Net Profit (USD)</th>
                    <th style={styles.th}>Estimasi Rupiah</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    {
                      name: '🤖 Tokocrypto Hunter v2 (CEX)',
                      badgeBg: '#2563eb',
                      trades: breakdown?.tokocrypto?.total_trades || 0,
                      wins: breakdown?.tokocrypto?.winning_trades || 0,
                      losses: breakdown?.tokocrypto?.losing_trades || 0,
                      wr: breakdown?.tokocrypto?.win_rate || 0,
                      pf: breakdown?.tokocrypto?.profit_factor || 0,
                      native: `$${Number(breakdown?.tokocrypto?.net_profit_usdt || 0).toFixed(2)} USDT`,
                      usd: Number(breakdown?.tokocrypto?.net_profit_usdt || 0),
                      idr: Number(breakdown?.tokocrypto?.net_profit_idr || 0),
                    },
                    {
                      name: '📈 Solana Trader v4 (DEX Pullback)',
                      badgeBg: '#7c3aed',
                      trades: breakdown?.solana_trader?.total_trades || 0,
                      wins: breakdown?.solana_trader?.winning_trades || 0,
                      losses: breakdown?.solana_trader?.losing_trades || 0,
                      wr: breakdown?.solana_trader?.win_rate || 0,
                      pf: breakdown?.solana_trader?.profit_factor || 0,
                      native: `${Number(breakdown?.solana_trader?.net_profit_sol || 0).toFixed(5)} SOL`,
                      usd: Number(breakdown?.solana_trader?.net_profit_usd || 0),
                      idr: Number(breakdown?.solana_trader?.net_profit_idr || 0),
                    },
                    {
                      name: '⚡ Solana Sniper v3 (DEX Momentum)',
                      badgeBg: '#db2777',
                      trades: breakdown?.solana_sniper?.total_trades || 0,
                      wins: breakdown?.solana_sniper?.winning_trades || 0,
                      losses: breakdown?.solana_sniper?.losing_trades || 0,
                      wr: breakdown?.solana_sniper?.win_rate || 0,
                      pf: breakdown?.solana_sniper?.profit_factor || 0,
                      native: `${Number(breakdown?.solana_sniper?.net_profit_sol || 0).toFixed(5)} SOL`,
                      usd: Number(breakdown?.solana_sniper?.net_profit_usd || 0),
                      idr: Number(breakdown?.solana_sniper?.net_profit_idr || 0),
                    },
                  ].map((row, idx) => (
                    <tr key={idx} style={styles.tableRow}>
                      <td style={styles.td}>
                        <span style={{ ...styles.engineBadge, backgroundColor: row.badgeBg }}>{row.name}</span>
                      </td>
                      <td style={styles.td}>{row.trades}</td>
                      <td style={styles.td}>
                        <span style={{ color: '#10b981', fontWeight: 700 }}>{row.wins}W</span> /{' '}
                        <span style={{ color: '#ef4444', fontWeight: 700 }}>{row.losses}L</span>
                      </td>
                      <td style={styles.td}><strong>{row.wr.toFixed(1)}%</strong></td>
                      <td style={styles.td}>{row.pf.toFixed(2)}x</td>
                      <td style={{ ...styles.td, fontWeight: 700, color: getColorByValue(row.usd) }}>{row.native}</td>
                      <td style={{ ...styles.td, fontWeight: 700, color: getColorByValue(row.usd) }}>
                        {row.usd >= 0 ? `+$${row.usd.toFixed(2)}` : `-$${Math.abs(row.usd).toFixed(2)}`}
                      </td>
                      <td style={{ ...styles.td, fontWeight: 700, color: getColorByValue(row.idr) }}>
                        {formatIdr(row.idr)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* ===== COMBINED CHARTS ===== */}
          {chartData.length > 0 ? (
            <div style={styles.chartsContainer}>
              <div style={styles.chartWrapper}>
                <h2 style={styles.chartTitle}>📈 Pertumbuhan Profit Kumulatif: Total vs Tokocrypto vs Solana (USD)</h2>
                <ResponsiveContainer width="100%" height={320}>
                  <LineChart data={chartData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" angle={-45} textAnchor="end" height={70} tick={{ fontSize: 12 }} />
                    <YAxis tick={{ fontSize: 12 }} />
                    <Tooltip formatter={(val) => `$${Number(val).toFixed(2)}`} />
                    <Legend />
                    <Line type="monotone" dataKey="cumulative_profit_usd" stroke="#10b981" strokeWidth={3} name="Total Gabungan ($)" />
                    <Line type="monotone" dataKey="cumulative_tokocrypto_usd" stroke="#2563eb" strokeWidth={2} name="Tokocrypto Hunter ($)" />
                    <Line type="monotone" dataKey="cumulative_solana_usd" stroke="#9333ea" strokeWidth={2} name="Solana DEX ($)" />
                  </LineChart>
                </ResponsiveContainer>
              </div>

              <div style={styles.chartWrapper}>
                <h2 style={styles.chartTitle}>📊 Perbandingan Profit/Loss Per Periode: Tokocrypto vs Solana (USD)</h2>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={chartData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" angle={-45} textAnchor="end" height={70} tick={{ fontSize: 12 }} />
                    <YAxis tick={{ fontSize: 12 }} />
                    <Tooltip formatter={(val) => `$${Number(val).toFixed(2)}`} />
                    <Legend />
                    <Bar dataKey="tokocrypto_profit_usd" fill="#2563eb" name="Tokocrypto Profit ($)" />
                    <Bar dataKey="solana_profit_usd" fill="#9333ea" name="Solana Profit ($)" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          ) : (
            <div style={styles.noDataMessage}>📭 Belum ada transaksi tertutup pada periode yang dipilih.</div>
          )}
        </>
      )}

      {/* =========================================================
          VIEW 2 & 3: TOKOCRYPTO OR SOLANA INDIVIDUAL ANALYTICS
         ========================================================= */}
      {analyticsData && !loading && activeTab !== 'combined' && (
        <>
          <div style={styles.summaryCardsContainer}>
            <SummaryCard
              title={activeTab === 'solana' ? `Net Profit Solana (${solanaStrategyFilter})` : 'Net Profit Tokocrypto'}
              value={activeTab === 'solana' ? summary.net_profit_sol : summary.net_profit_usdt}
              suffix={activeTab === 'solana' ? 'SOL' : 'USDT'}
              isSol={activeTab === 'solana'}
              subtitle={
                activeTab === 'solana'
                  ? `$${Number(summary.net_profit_usd || 0).toFixed(2)} (${formatIdr(summary.net_profit_idr || 0)})`
                  : formatIdr(summary.net_profit_idr || 0)
              }
              color={getColorByValue(activeTab === 'solana' ? summary.net_profit_sol : summary.net_profit_usdt)}
              icon="💰"
            />
            <SummaryCard
              title="Win Rate"
              value={summary.win_rate || 0}
              suffix="%"
              subtitle={`${summary.winning_trades || 0} Menang / ${summary.losing_trades || 0} Kalah`}
              color="#3b82f6"
              icon="🎯"
            />
            <SummaryCard
              title="Profit Factor"
              value={summary.profit_factor || 0}
              suffix="x"
              subtitle={`Total ${summary.total_trades || 0} Closed Trades`}
              color="#8b5cf6"
              icon="⚖️"
            />
            <SummaryCard
              title="Gross Profit (Winning)"
              value={activeTab === 'solana' ? summary.total_profit_sol : summary.total_profit_usdt}
              suffix={activeTab === 'solana' ? 'SOL' : 'USDT'}
              isSol={activeTab === 'solana'}
              subtitle={
                activeTab === 'solana'
                  ? `Avg Win: +${Number(summary.avg_win_sol || 0).toFixed(5)} SOL`
                  : `Avg Win: +$${Number(summary.avg_win_usdt || 0).toFixed(2)}`
              }
              color="#10b981"
              icon="📈"
            />
            <SummaryCard
              title="Gross Loss (Losing)"
              value={activeTab === 'solana' ? summary.total_loss_sol : summary.total_loss_usdt}
              suffix={activeTab === 'solana' ? 'SOL' : 'USDT'}
              isSol={activeTab === 'solana'}
              subtitle={
                activeTab === 'solana'
                  ? `Avg Loss: ${Number(summary.avg_loss_sol || 0).toFixed(5)} SOL`
                  : `Avg Loss: $${Number(summary.avg_loss_usdt || 0).toFixed(2)}`
              }
              color="#ef4444"
              icon="📉"
            />
          </div>

          {chartData.length > 0 ? (
            <div style={styles.chartsContainer}>
              <div style={styles.chartWrapper}>
                <h2 style={styles.chartTitle}>
                  📈 Cumulative Profit Growth ({activeTab === 'solana' ? `Solana ${solanaStrategyFilter} - SOL` : 'Tokocrypto - USDT'})
                </h2>
                <ResponsiveContainer width="100%" height={300}>
                  <AreaChart data={chartData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="colorGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#10b981" stopOpacity={0.8} />
                        <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" angle={-45} textAnchor="end" height={70} tick={{ fontSize: 12 }} />
                    <YAxis tick={{ fontSize: 12 }} />
                    <Tooltip
                      formatter={(value) =>
                        activeTab === 'solana' ? `${Number(value).toFixed(6)} SOL` : `$${Number(value).toFixed(2)}`
                      }
                    />
                    <Area
                      type="monotone"
                      dataKey={activeTab === 'solana' ? 'cumulative_profit_sol' : 'cumulative_profit'}
                      stroke="#10b981"
                      fillOpacity={1}
                      fill="url(#colorGradient)"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>

              <div style={styles.chartWrapper}>
                <h2 style={styles.chartTitle}>📊 Profit/Loss per Period</h2>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={chartData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" angle={-45} textAnchor="end" height={70} tick={{ fontSize: 12 }} />
                    <YAxis tick={{ fontSize: 12 }} />
                    <Tooltip
                      formatter={(value) =>
                        activeTab === 'solana' ? `${Number(value).toFixed(6)} SOL` : `$${Number(value).toFixed(2)}`
                      }
                    />
                    <Legend />
                    <Bar
                      dataKey={activeTab === 'solana' ? 'profit_sol' : 'profit_usdt'}
                      fill={activeTab === 'solana' ? '#9333ea' : '#2563eb'}
                      name={activeTab === 'solana' ? 'Profit (SOL)' : 'Profit (USDT)'}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          ) : (
            <div style={styles.noDataMessage}>📭 Belum ada data untuk filter ini.</div>
          )}
        </>
      )}
    </div>
  );
};

const SummaryCard = ({ title, value, prefix = '', suffix = '', isSol = false, subtitle = '', color, icon }) => {
  const num = Number(value || 0);
  const formattedValue = isSol
    ? num.toFixed(6)
    : typeof value === 'number' && value % 1 !== 0
    ? num.toFixed(2)
    : num;

  return (
    <div style={{ ...styles.summaryCard, borderLeft: `4px solid ${color}` }}>
      <div style={styles.cardIcon}>{icon}</div>
      <div style={styles.cardTitle}>{title}</div>
      <div style={{ ...styles.cardValue, color }}>
        {prefix}{formattedValue} {suffix}
      </div>
      {subtitle && <div style={styles.cardSubtitle}>{subtitle}</div>}
    </div>
  );
};

const styles = {
  container: {
    padding: '20px',
    backgroundColor: '#f9fafb',
    borderRadius: '8px',
    fontFamily: 'Segoe UI, Tahoma, Geneva, Verdana, sans-serif',
  },
  title: {
    fontSize: '26px',
    fontWeight: '900',
    marginBottom: '20px',
    color: '#0f172a',
  },
  tabSwitcher: {
    display: 'flex',
    gap: '10px',
    marginBottom: '16px',
    borderBottom: '2px solid #e5e7eb',
    flexWrap: 'wrap',
  },
  tabButton: {
    padding: '12px 20px',
    border: 'none',
    backgroundColor: 'transparent',
    color: '#6b7280',
    cursor: 'pointer',
    fontSize: '15px',
    fontWeight: '600',
    borderBottom: '3px solid transparent',
    transition: 'all 0.2s ease',
  },
  tabButtonActiveCombined: {
    color: '#059669',
    borderBottom: '3px solid #10b981',
    fontWeight: '800',
  },
  tabButtonActiveToko: {
    color: '#1d4ed8',
    borderBottom: '3px solid #2563eb',
    fontWeight: '800',
  },
  tabButtonActiveSolana: {
    color: '#7e22ce',
    borderBottom: '3px solid #9333ea',
    fontWeight: '800',
  },
  subFilterBar: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    marginBottom: '16px',
    padding: '12px 16px',
    backgroundColor: '#f3e8ff',
    borderRadius: '8px',
    border: '1px solid #d8b4fe',
    flexWrap: 'wrap',
  },
  subFilterLabel: {
    fontSize: '13px',
    fontWeight: '700',
    color: '#581c87',
  },
  subFilterBtn: {
    padding: '7px 14px',
    borderRadius: '6px',
    border: '1px solid #c084fc',
    backgroundColor: '#ffffff',
    color: '#6b21a8',
    cursor: 'pointer',
    fontSize: '13px',
    fontWeight: '600',
  },
  subFilterBtnActive: {
    backgroundColor: '#7e22ce',
    color: '#ffffff',
    borderColor: '#7e22ce',
    fontWeight: '700',
  },
  filterContainer: {
    display: 'flex',
    gap: '15px',
    marginBottom: '20px',
    padding: '18px',
    backgroundColor: 'white',
    borderRadius: '8px',
    boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
    flexWrap: 'wrap',
    alignItems: 'flex-end',
    border: '1px solid #e5e7eb',
  },
  filterGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: '5px',
  },
  label: {
    fontSize: '13px',
    fontWeight: '700',
    color: '#1f2937',
    textTransform: 'uppercase',
  },
  select: {
    padding: '10px 12px',
    border: '2px solid #d1d5db',
    borderRadius: '4px',
    fontSize: '14px',
    fontWeight: '500',
    width: '150px',
    backgroundColor: 'white',
    color: '#1f2937',
    cursor: 'pointer',
  },
  filterButtons: {
    display: 'flex',
    gap: '10px',
  },
  buttonApply: {
    padding: '10px 18px',
    backgroundColor: '#3b82f6',
    color: 'white',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: '700',
  },
  buttonReset: {
    padding: '10px 18px',
    backgroundColor: '#e5e7eb',
    color: '#374151',
    border: '1px solid #d1d5db',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: '700',
  },
  errorMessage: {
    padding: '14px 16px',
    backgroundColor: '#fecaca',
    color: '#7f1d1d',
    borderRadius: '6px',
    marginBottom: '20px',
    fontSize: '14px',
    fontWeight: '600',
  },
  loadingMessage: {
    padding: '25px',
    textAlign: 'center',
    color: '#4b5563',
    fontSize: '16px',
    fontWeight: '600',
  },
  noDataMessage: {
    padding: '40px 20px',
    textAlign: 'center',
    color: '#6b7280',
    fontSize: '15px',
    fontWeight: '600',
    backgroundColor: '#ffffff',
    borderRadius: '8px',
    border: '1px solid #e5e7eb',
  },
  summaryCardsContainer: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
    gap: '15px',
    marginBottom: '25px',
  },
  summaryCard: {
    padding: '20px',
    backgroundColor: 'white',
    borderRadius: '8px',
    boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
  },
  cardIcon: {
    fontSize: '28px',
    marginBottom: '8px',
  },
  cardTitle: {
    fontSize: '12px',
    color: '#374151',
    fontWeight: '700',
    textTransform: 'uppercase',
    marginBottom: '8px',
  },
  cardValue: {
    fontSize: '22px',
    fontWeight: '900',
  },
  cardSubtitle: {
    fontSize: '12px',
    color: '#6b7280',
    marginTop: '6px',
    fontWeight: '600',
  },
  tableCard: {
    backgroundColor: 'white',
    padding: '20px',
    borderRadius: '8px',
    boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
    border: '1px solid #e5e7eb',
    marginBottom: '25px',
  },
  comparisonTable: {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: '13px',
    color: '#1f2937',
  },
  tableHeaderRow: {
    backgroundColor: '#f3f4f6',
    borderBottom: '2px solid #e5e7eb',
    textAlign: 'left',
  },
  th: {
    padding: '10px 12px',
    fontWeight: '700',
    color: '#374151',
  },
  tableRow: {
    borderBottom: '1px solid #e5e7eb',
  },
  td: {
    padding: '12px',
  },
  engineBadge: {
    display: 'inline-block',
    padding: '4px 10px',
    borderRadius: '6px',
    color: '#ffffff',
    fontWeight: '700',
    fontSize: '12px',
  },
  chartsContainer: {
    display: 'flex',
    flexDirection: 'column',
    gap: '25px',
  },
  chartWrapper: {
    backgroundColor: 'white',
    padding: '22px',
    borderRadius: '8px',
    boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
    border: '1px solid #e5e7eb',
  },
  chartTitle: {
    fontSize: '17px',
    fontWeight: '800',
    marginBottom: '16px',
    color: '#0f172a',
  },
};

export default AnalyticsTab;
