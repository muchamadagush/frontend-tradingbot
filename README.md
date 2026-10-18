# TradingBot Frontend Dashboard

Real-time React dashboard for TradingBot, providing controls, charts, and metrics for both CEX (Tokocrypto) and DEX (Solana) algorithmic trading engines.

---

## 🛠️ Tech Stack

- **Framework**: React 18 + Vite
- **HTTP & WS**: Axios, Native WebSocket hook
- **Icons & Visualization**: Lucide-React, Recharts
- **Styling**: Native CSS

---

## 🚀 Getting Started

### 1. Install Dependencies
```bash
npm install
```

### 2. Environment Configuration
Copy `.env.example` to `.env` and configure your backend endpoint:
```bash
cp .env.example .env
```
Default configuration:
```env
VITE_API_URL=http://127.0.0.1:8000
VITE_WS_URL=ws://127.0.0.1:8000/ws
```

### 3. Run Development Server
```bash
npm run dev
```

### 4. Build for Production
```bash
npm run build
```
Preview production build:
```bash
npm run preview
```
