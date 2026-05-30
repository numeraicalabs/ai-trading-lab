// Deterministic seeded random for reproducible demo data
function rng(seed) { let s=seed; return ()=>{ s=(s*16807)%2147483647; return (s-1)/2147483646 } }
function genEq(n,start,drift,vol,seed) { const r=rng(seed); let v=start; return Array.from({length:n},(_,i)=>{ v=v*(1+drift+(r()-0.5)*vol); return {i,v:+v.toFixed(2)} }) }
function genRw(n,seed) { const r=rng(seed+99); let x=0; return Array.from({length:n},(_,i)=>{ x+=(r()-0.3)*5; return {ep:i,r:+x.toFixed(1)} }) }

export const FALLBACK_AGENTS = [
  {abbr:'MOM',name:'Momentum Agent',    strategy:'Trend Following',        type:'Rule-Based + ML',    color:'#06b6d4',icon:'↑', state:'Live',    stateColor:'#10b981',perf:18.4,sharpe:1.82,sortino:2.14,accuracy:68,reward:842, trades_count:1240,assets:['SPY','QQQ','MSFT'],    progress:88,risk:'Medium',   confidence:79,maxDD:-8.2, lastTrade:'BUY QQQ @ 432.10',  equity:genEq(80,100,0.003,0.04,1),  rewards:genRw(60,1),  alpha:6.2, winRate:58,profitFactor:1.9},
  {abbr:'MRV',name:'Mean Reversion',     strategy:'Contrarian',             type:'Statistical ML',     color:'#8b5cf6',icon:'⇄',state:'Live',    stateColor:'#10b981',perf:12.1,sharpe:2.11,sortino:2.80,accuracy:72,reward:612, trades_count:2100,assets:['GLD','TLT','SPY'],     progress:92,risk:'Low',      confidence:84,maxDD:-4.1, lastTrade:'SELL GLD @ 184.5',  equity:genEq(80,100,0.002,0.025,2), rewards:genRw(60,2),  alpha:3.8, winRate:64,profitFactor:2.1},
  {abbr:'PPO',name:'RL PPO Agent',       strategy:'Reinforcement Learning', type:'Policy Gradient',    color:'#3b82f6',icon:'🧠',state:'Training',stateColor:'#f59e0b',perf:9.7, sharpe:1.43,sortino:1.67,accuracy:61,reward:1204,trades_count:870, assets:['QQQ','NVDA'],         progress:65,risk:'High',     confidence:61,maxDD:-14.3,lastTrade:'BUY QQQ @ 432.0',   equity:genEq(80,100,0.0015,0.07,3), rewards:genRw(60,3),  alpha:9.1, winRate:52,profitFactor:1.5},
  {abbr:'DQN',name:'DQN Agent',          strategy:'Deep Q-Learning',        type:'Value-Based RL',     color:'#ec4899',icon:'⚡',state:'Backtest',stateColor:'#64748b',perf:7.3, sharpe:1.21,sortino:1.44,accuracy:59,reward:488, trades_count:560, assets:['NVDA','TSLA'],         progress:45,risk:'High',     confidence:55,maxDD:-18.1,lastTrade:'HOLD NVDA @ 840',   equity:genEq(80,100,0.001,0.06,4),  rewards:genRw(60,4),  alpha:4.4, winRate:49,profitFactor:1.3},
  {abbr:'MAC',name:'Macro Agent',        strategy:'Macro / Top-Down',       type:'Factor Model',       color:'#f59e0b',icon:'🌐',state:'Live',    stateColor:'#10b981',perf:14.8,sharpe:1.68,sortino:2.01,accuracy:65,reward:720, trades_count:320, assets:['GLD','TLT'],           progress:80,risk:'Medium',   confidence:72,maxDD:-6.9, lastTrade:'BUY TLT @ 96.3',    equity:genEq(80,100,0.0025,0.035,5),rewards:genRw(60,5),  alpha:5.6, winRate:60,profitFactor:1.8},
  {abbr:'SEN',name:'Sentiment Agent',    strategy:'NLP / News Sentiment',   type:'LLM-Powered',        color:'#f97316',icon:'📰',state:'Live',    stateColor:'#10b981',perf:11.2,sharpe:1.55,sortino:1.92,accuracy:63,reward:540, trades_count:710, assets:['TSLA','META','AMZN'],  progress:74,risk:'Medium',   confidence:68,maxDD:-9.7, lastTrade:'BUY TSLA @ 248.6',  equity:genEq(80,100,0.0018,0.05,6), rewards:genRw(60,6),  alpha:4.9, winRate:55,profitFactor:1.7},
  {abbr:'VOL',name:'Volatility Agent',   strategy:'Vol Trading / VIX',      type:'Options Simulation', color:'#ef4444',icon:'📊',state:'Live',    stateColor:'#10b981',perf:22.6,sharpe:1.94,sortino:2.40,accuracy:71,reward:980, trades_count:440, assets:['SPY','QQQ'],           progress:86,risk:'Very High',confidence:76,maxDD:-22.4,lastTrade:'SELL SPY @ 480.0',   equity:genEq(80,100,0.0038,0.09,7), rewards:genRw(60,7),  alpha:11.2,winRate:61,profitFactor:2.3},
  {abbr:'REG',name:'Market Regime',      strategy:'Regime Detection',       type:'HMM + Clustering',   color:'#14b8a6',icon:'🔍',state:'Training',stateColor:'#f59e0b',perf:6.1, sharpe:1.12,sortino:1.30,accuracy:74,reward:310, trades_count:180, assets:['SPY','TLT'],           progress:52,risk:'Low',      confidence:66,maxDD:-3.2, lastTrade:'REGIME: Bull',      equity:genEq(80,100,0.0008,0.02,8), rewards:genRw(60,8),  alpha:2.1, winRate:66,profitFactor:1.4},
  {abbr:'OPT',name:'Portfolio Optimizer',strategy:'Dynamic Allocation',     type:'MVO + RL',           color:'#10b981',icon:'⚖️',state:'Live',   stateColor:'#10b981',perf:16.3,sharpe:2.28,sortino:2.91,accuracy:70,reward:860, trades_count:290, assets:['SPY','GLD','TLT'],     progress:95,risk:'Low',      confidence:88,maxDD:-5.1, lastTrade:'REBALANCE → 40/30', equity:genEq(80,100,0.0028,0.022,9),rewards:genRw(60,9),  alpha:7.8, winRate:62,profitFactor:2.0},
]

export const FALLBACK_PORTFOLIO = {
  equity:127400,cash:45864,invested:81536,total_return:27.4,daily_pnl:1240.5,
  sharpe:1.87,sortino:2.31,max_drawdown:-8.2,volatility:12.4,alpha:9.3,
  win_rate:62,profit_factor:1.91,exposure_pct:64,active_agents:7,
}

export const FALLBACK_PRICES = {
  SPY:480.20,QQQ:432.10,AAPL:189.50,MSFT:415.30,NVDA:840.50,
  TSLA:248.60,META:512.40,AMZN:185.70,GLD:184.30,TLT:96.20,
  'BTC-USD':68200,'ETH-USD':3800,VIX:14.10,
}
