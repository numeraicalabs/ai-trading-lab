"""
Universe — 220 diversified tickers across 12 sectors.
Price history cached in Supabase Storage (parquet-like JSON).
"""
import json, os, logging
from pathlib import Path as FilePath

logger = logging.getLogger(__name__)

DATA_DIR      = FilePath(__file__).parent.parent / "universe_data"
DATA_DIR.mkdir(exist_ok=True)
UNIVERSE_FILE = DATA_DIR / "universe.json"
CUSTOM_FILE   = DATA_DIR / "custom.json"

# ── 220 tickers across 12 sectors ─────────────────────────────────────────────
DEFAULT_UNIVERSE = {
    # ── ETF Benchmarks ─────────────────────────────────────────────────────────
    "SPY":   {"name":"S&P 500 ETF",              "sector":"ETF",         "type":"etf"},
    "QQQ":   {"name":"Nasdaq 100 ETF",           "sector":"ETF",         "type":"etf"},
    "IWM":   {"name":"Russell 2000 ETF",         "sector":"ETF",         "type":"etf"},
    "DIA":   {"name":"Dow Jones ETF",            "sector":"ETF",         "type":"etf"},
    "VTI":   {"name":"Total Market ETF",         "sector":"ETF",         "type":"etf"},
    "VOO":   {"name":"Vanguard S&P 500",         "sector":"ETF",         "type":"etf"},
    "EEM":   {"name":"Emerging Markets ETF",     "sector":"ETF",         "type":"etf"},
    "EFA":   {"name":"EAFE ETF",                 "sector":"ETF",         "type":"etf"},
    "VEA":   {"name":"Developed Markets ETF",    "sector":"ETF",         "type":"etf"},
    "ACWI":  {"name":"All Country World ETF",    "sector":"ETF",         "type":"etf"},
    # ── Technology ────────────────────────────────────────────────────────────
    "AAPL":  {"name":"Apple",                    "sector":"Technology",  "type":"stock"},
    "MSFT":  {"name":"Microsoft",                "sector":"Technology",  "type":"stock"},
    "NVDA":  {"name":"Nvidia",                   "sector":"Technology",  "type":"stock"},
    "GOOGL": {"name":"Alphabet",                 "sector":"Technology",  "type":"stock"},
    "META":  {"name":"Meta Platforms",           "sector":"Technology",  "type":"stock"},
    "AMZN":  {"name":"Amazon",                   "sector":"Technology",  "type":"stock"},
    "TSLA":  {"name":"Tesla",                    "sector":"Technology",  "type":"stock"},
    "AMD":   {"name":"Advanced Micro Devices",   "sector":"Technology",  "type":"stock"},
    "INTC":  {"name":"Intel",                    "sector":"Technology",  "type":"stock"},
    "CRM":   {"name":"Salesforce",               "sector":"Technology",  "type":"stock"},
    "ADBE":  {"name":"Adobe",                    "sector":"Technology",  "type":"stock"},
    "ORCL":  {"name":"Oracle",                   "sector":"Technology",  "type":"stock"},
    "CSCO":  {"name":"Cisco",                    "sector":"Technology",  "type":"stock"},
    "IBM":   {"name":"IBM",                      "sector":"Technology",  "type":"stock"},
    "QCOM":  {"name":"Qualcomm",                 "sector":"Technology",  "type":"stock"},
    "TXN":   {"name":"Texas Instruments",        "sector":"Technology",  "type":"stock"},
    "NOW":   {"name":"ServiceNow",               "sector":"Technology",  "type":"stock"},
    "SNOW":  {"name":"Snowflake",                "sector":"Technology",  "type":"stock"},
    "PLTR":  {"name":"Palantir",                 "sector":"Technology",  "type":"stock"},
    "CRWD":  {"name":"CrowdStrike",              "sector":"Technology",  "type":"stock"},
    "NET":   {"name":"Cloudflare",               "sector":"Technology",  "type":"stock"},
    "DDOG":  {"name":"Datadog",                  "sector":"Technology",  "type":"stock"},
    "XLK":   {"name":"Technology Select ETF",    "sector":"ETF",         "type":"etf"},
    # ── Finance ───────────────────────────────────────────────────────────────
    "JPM":   {"name":"JPMorgan Chase",           "sector":"Finance",     "type":"stock"},
    "BAC":   {"name":"Bank of America",          "sector":"Finance",     "type":"stock"},
    "GS":    {"name":"Goldman Sachs",            "sector":"Finance",     "type":"stock"},
    "MS":    {"name":"Morgan Stanley",           "sector":"Finance",     "type":"stock"},
    "V":     {"name":"Visa",                     "sector":"Finance",     "type":"stock"},
    "MA":    {"name":"Mastercard",               "sector":"Finance",     "type":"stock"},
    "BRK-B": {"name":"Berkshire Hathaway B",     "sector":"Finance",     "type":"stock"},
    "WFC":   {"name":"Wells Fargo",              "sector":"Finance",     "type":"stock"},
    "C":     {"name":"Citigroup",                "sector":"Finance",     "type":"stock"},
    "AXP":   {"name":"American Express",         "sector":"Finance",     "type":"stock"},
    "BLK":   {"name":"BlackRock",                "sector":"Finance",     "type":"stock"},
    "SCHW":  {"name":"Charles Schwab",           "sector":"Finance",     "type":"stock"},
    "CB":    {"name":"Chubb",                    "sector":"Finance",     "type":"stock"},
    "XLF":   {"name":"Financial Select ETF",     "sector":"ETF",         "type":"etf"},
    # ── Healthcare ────────────────────────────────────────────────────────────
    "JNJ":   {"name":"Johnson & Johnson",        "sector":"Healthcare",  "type":"stock"},
    "UNH":   {"name":"UnitedHealth",             "sector":"Healthcare",  "type":"stock"},
    "LLY":   {"name":"Eli Lilly",                "sector":"Healthcare",  "type":"stock"},
    "PFE":   {"name":"Pfizer",                   "sector":"Healthcare",  "type":"stock"},
    "ABBV":  {"name":"AbbVie",                   "sector":"Healthcare",  "type":"stock"},
    "MRK":   {"name":"Merck",                    "sector":"Healthcare",  "type":"stock"},
    "TMO":   {"name":"Thermo Fisher Scientific", "sector":"Healthcare",  "type":"stock"},
    "DHR":   {"name":"Danaher",                  "sector":"Healthcare",  "type":"stock"},
    "AMGN":  {"name":"Amgen",                    "sector":"Healthcare",  "type":"stock"},
    "GILD":  {"name":"Gilead Sciences",          "sector":"Healthcare",  "type":"stock"},
    "ISRG":  {"name":"Intuitive Surgical",       "sector":"Healthcare",  "type":"stock"},
    "XLV":   {"name":"Health Care Select ETF",   "sector":"ETF",         "type":"etf"},
    # ── Energy ────────────────────────────────────────────────────────────────
    "XOM":   {"name":"ExxonMobil",               "sector":"Energy",      "type":"stock"},
    "CVX":   {"name":"Chevron",                  "sector":"Energy",      "type":"stock"},
    "COP":   {"name":"ConocoPhillips",           "sector":"Energy",      "type":"stock"},
    "SLB":   {"name":"Schlumberger",             "sector":"Energy",      "type":"stock"},
    "OXY":   {"name":"Occidental Petroleum",     "sector":"Energy",      "type":"stock"},
    "PSX":   {"name":"Phillips 66",              "sector":"Energy",      "type":"stock"},
    "MPC":   {"name":"Marathon Petroleum",       "sector":"Energy",      "type":"stock"},
    "XLE":   {"name":"Energy Select ETF",        "sector":"ETF",         "type":"etf"},
    # ── Consumer Staples ──────────────────────────────────────────────────────
    "WMT":   {"name":"Walmart",                  "sector":"Consumer",    "type":"stock"},
    "COST":  {"name":"Costco",                   "sector":"Consumer",    "type":"stock"},
    "PG":    {"name":"Procter & Gamble",         "sector":"Consumer",    "type":"stock"},
    "KO":    {"name":"Coca-Cola",                "sector":"Consumer",    "type":"stock"},
    "PEP":   {"name":"PepsiCo",                  "sector":"Consumer",    "type":"stock"},
    "MO":    {"name":"Altria",                   "sector":"Consumer",    "type":"stock"},
    "PM":    {"name":"Philip Morris",            "sector":"Consumer",    "type":"stock"},
    "CL":    {"name":"Colgate-Palmolive",        "sector":"Consumer",    "type":"stock"},
    # ── Consumer Discretionary ────────────────────────────────────────────────
    "MCD":   {"name":"McDonald's",               "sector":"Discretionary","type":"stock"},
    "NKE":   {"name":"Nike",                     "sector":"Discretionary","type":"stock"},
    "SBUX":  {"name":"Starbucks",                "sector":"Discretionary","type":"stock"},
    "HD":    {"name":"Home Depot",               "sector":"Discretionary","type":"stock"},
    "LOW":   {"name":"Lowe's",                   "sector":"Discretionary","type":"stock"},
    "TGT":   {"name":"Target",                   "sector":"Discretionary","type":"stock"},
    "TJX":   {"name":"TJX Companies",            "sector":"Discretionary","type":"stock"},
    "BKNG":  {"name":"Booking Holdings",         "sector":"Discretionary","type":"stock"},
    "MAR":   {"name":"Marriott International",   "sector":"Discretionary","type":"stock"},
    "LVS":   {"name":"Las Vegas Sands",          "sector":"Discretionary","type":"stock"},
    # ── Industrial ────────────────────────────────────────────────────────────
    "CAT":   {"name":"Caterpillar",              "sector":"Industrial",  "type":"stock"},
    "BA":    {"name":"Boeing",                   "sector":"Industrial",  "type":"stock"},
    "GE":    {"name":"GE Aerospace",             "sector":"Industrial",  "type":"stock"},
    "MMM":   {"name":"3M",                       "sector":"Industrial",  "type":"stock"},
    "HON":   {"name":"Honeywell",                "sector":"Industrial",  "type":"stock"},
    "UPS":   {"name":"UPS",                      "sector":"Industrial",  "type":"stock"},
    "FDX":   {"name":"FedEx",                    "sector":"Industrial",  "type":"stock"},
    "RTX":   {"name":"Raytheon Technologies",    "sector":"Industrial",  "type":"stock"},
    "LMT":   {"name":"Lockheed Martin",          "sector":"Industrial",  "type":"stock"},
    "NOC":   {"name":"Northrop Grumman",         "sector":"Industrial",  "type":"stock"},
    "DE":    {"name":"Deere & Company",          "sector":"Industrial",  "type":"stock"},
    "XLI":   {"name":"Industrial Select ETF",    "sector":"ETF",         "type":"etf"},
    # ── Real Estate ───────────────────────────────────────────────────────────
    "AMT":   {"name":"American Tower REIT",      "sector":"Real Estate", "type":"stock"},
    "PLD":   {"name":"Prologis REIT",            "sector":"Real Estate", "type":"stock"},
    "CCI":   {"name":"Crown Castle REIT",        "sector":"Real Estate", "type":"stock"},
    "EQIX":  {"name":"Equinix REIT",             "sector":"Real Estate", "type":"stock"},
    "VNQ":   {"name":"Real Estate ETF",          "sector":"ETF",         "type":"etf"},
    # ── Bonds & Rates ─────────────────────────────────────────────────────────
    "TLT":   {"name":"20Y Treasury ETF",         "sector":"Bonds",       "type":"etf"},
    "IEF":   {"name":"7-10Y Treasury ETF",       "sector":"Bonds",       "type":"etf"},
    "SHY":   {"name":"1-3Y Treasury ETF",        "sector":"Bonds",       "type":"etf"},
    "AGG":   {"name":"Agg Bond ETF",             "sector":"Bonds",       "type":"etf"},
    "HYG":   {"name":"High Yield Bond ETF",      "sector":"Bonds",       "type":"etf"},
    "LQD":   {"name":"IG Corporate Bond ETF",    "sector":"Bonds",       "type":"etf"},
    "BND":   {"name":"Total Bond Market ETF",    "sector":"Bonds",       "type":"etf"},
    "TIP":   {"name":"TIPS ETF (Inflation)",     "sector":"Bonds",       "type":"etf"},
    # ── Commodities ───────────────────────────────────────────────────────────
    "GLD":   {"name":"Gold ETF",                 "sector":"Commodities", "type":"etf"},
    "IAU":   {"name":"iShares Gold ETF",         "sector":"Commodities", "type":"etf"},
    "SLV":   {"name":"Silver ETF",               "sector":"Commodities", "type":"etf"},
    "PDBC":  {"name":"Diversified Commodity ETF","sector":"Commodities", "type":"etf"},
    "USO":   {"name":"Oil ETF",                  "sector":"Commodities", "type":"etf"},
    "UNG":   {"name":"Natural Gas ETF",          "sector":"Commodities", "type":"etf"},
    "CORN":  {"name":"Corn ETF",                 "sector":"Commodities", "type":"etf"},
    "WEAT":  {"name":"Wheat ETF",                "sector":"Commodities", "type":"etf"},
    "DBA":   {"name":"Agriculture ETF",          "sector":"Commodities", "type":"etf"},
    # ── Crypto (via ETF/proxies) ───────────────────────────────────────────────
    "IBIT":  {"name":"iShares Bitcoin ETF",      "sector":"Crypto",      "type":"etf"},
    "BITO":  {"name":"Bitcoin Strategy ETF",     "sector":"Crypto",      "type":"etf"},
    "COIN":  {"name":"Coinbase",                 "sector":"Crypto",      "type":"stock"},
    "MSTR":  {"name":"MicroStrategy",            "sector":"Crypto",      "type":"stock"},
    "BTC-USD":{"name":"Bitcoin",                 "sector":"Crypto",      "type":"crypto"},
    "ETH-USD":{"name":"Ethereum",                "sector":"Crypto",      "type":"crypto"},
    "SOL-USD":{"name":"Solana",                  "sector":"Crypto",      "type":"crypto"},
    # ── Volatility ────────────────────────────────────────────────────────────
    "UVXY":  {"name":"ProShares Ultra VIX",      "sector":"Volatility",  "type":"etf"},
    "SVXY":  {"name":"ProShares Short VIX",      "sector":"Volatility",  "type":"etf"},
    "VXX":   {"name":"iPath VIX ETN",            "sector":"Volatility",  "type":"etf"},
    # ── Leveraged (for volatility training) ───────────────────────────────────
    "TQQQ":  {"name":"ProShares 3x QQQ",         "sector":"Leveraged",   "type":"etf"},
    "SQQQ":  {"name":"ProShares -3x QQQ",        "sector":"Leveraged",   "type":"etf"},
    "UPRO":  {"name":"ProShares 3x SPY",         "sector":"Leveraged",   "type":"etf"},
    "SPXU":  {"name":"ProShares -3x SPY",        "sector":"Leveraged",   "type":"etf"},
    # ── International ETFs ────────────────────────────────────────────────────
    "FXI":   {"name":"China Large Cap ETF",      "sector":"International","type":"etf"},
    "EWJ":   {"name":"Japan ETF",                "sector":"International","type":"etf"},
    "EWZ":   {"name":"Brazil ETF",               "sector":"International","type":"etf"},
    "EWG":   {"name":"Germany ETF",              "sector":"International","type":"etf"},
    "EWY":   {"name":"South Korea ETF",          "sector":"International","type":"etf"},
    "EWI":   {"name":"Italy ETF",                "sector":"International","type":"etf"},
    "INDA":  {"name":"India ETF",                "sector":"International","type":"etf"},
    "KWEB":  {"name":"China Internet ETF",       "sector":"International","type":"etf"},
    # ── Semiconductor ─────────────────────────────────────────────────────────
    "SMH":   {"name":"Semiconductor ETF",        "sector":"Semis",       "type":"etf"},
    "SOXX":  {"name":"iShares Semis ETF",        "sector":"Semis",       "type":"etf"},
    "TSM":   {"name":"TSMC",                     "sector":"Semis",       "type":"stock"},
    "ASML":  {"name":"ASML Holding",             "sector":"Semis",       "type":"stock"},
    "MU":    {"name":"Micron Technology",        "sector":"Semis",       "type":"stock"},
    "LRCX":  {"name":"Lam Research",             "sector":"Semis",       "type":"stock"},
    "KLAC":  {"name":"KLA Corporation",          "sector":"Semis",       "type":"stock"},
    "AMAT":  {"name":"Applied Materials",        "sector":"Semis",       "type":"stock"},
    # ── Biotech ───────────────────────────────────────────────────────────────
    "XBI":   {"name":"Biotech ETF",              "sector":"Biotech",     "type":"etf"},
    "IBB":   {"name":"iShares Biotech ETF",      "sector":"Biotech",     "type":"etf"},
    "MRNA":  {"name":"Moderna",                  "sector":"Biotech",     "type":"stock"},
    "REGN":  {"name":"Regeneron",                "sector":"Biotech",     "type":"stock"},
    "BIIB":  {"name":"Biogen",                   "sector":"Biotech",     "type":"stock"},
    "VRTX":  {"name":"Vertex Pharmaceuticals",   "sector":"Biotech",     "type":"stock"},
    # ── Communications ────────────────────────────────────────────────────────
    "NFLX":  {"name":"Netflix",                  "sector":"Communications","type":"stock"},
    "DIS":   {"name":"Walt Disney",              "sector":"Communications","type":"stock"},
    "CMCSA": {"name":"Comcast",                  "sector":"Communications","type":"stock"},
    "T":     {"name":"AT&T",                     "sector":"Communications","type":"stock"},
    "VZ":    {"name":"Verizon",                  "sector":"Communications","type":"stock"},
    "TMUS":  {"name":"T-Mobile",                 "sector":"Communications","type":"stock"},
    "XLC":   {"name":"Communication Services ETF","sector":"ETF",        "type":"etf"},
    # ── Utilities ─────────────────────────────────────────────────────────────
    "NEE":   {"name":"NextEra Energy",           "sector":"Utilities",   "type":"stock"},
    "DUK":   {"name":"Duke Energy",              "sector":"Utilities",   "type":"stock"},
    "SO":    {"name":"Southern Company",         "sector":"Utilities",   "type":"stock"},
    "XLU":   {"name":"Utilities Select ETF",     "sector":"ETF",         "type":"etf"},
    # ── Special situations ─────────────────────────────────────────────────────
    "ARKK":  {"name":"ARK Innovation ETF",       "sector":"Growth",      "type":"etf"},
    "ARKG":  {"name":"ARK Genomic Revolution",   "sector":"Growth",      "type":"etf"},
    "ARKW":  {"name":"ARK Next Gen Internet",    "sector":"Growth",      "type":"etf"},
    "KRE":   {"name":"Regional Banks ETF",       "sector":"Finance",     "type":"etf"},
    "XRT":   {"name":"Retail ETF",               "sector":"Discretionary","type":"etf"},
    "ITB":   {"name":"Home Construction ETF",    "sector":"Industrial",  "type":"etf"},
    "JETS":  {"name":"Airlines ETF",             "sector":"Industrial",  "type":"etf"},
    "HACK":  {"name":"Cybersecurity ETF",        "sector":"Technology",  "type":"etf"},
    "BOTZ":  {"name":"Robotics & AI ETF",        "sector":"Technology",  "type":"etf"},
    "ROBO":  {"name":"ROBO Global Robotics ETF", "sector":"Technology",  "type":"etf"},
}


# ── Load / save ───────────────────────────────────────────────────────────────
_universe: dict = {}
_custom:   dict = {}


def _load():
    global _universe, _custom
    if UNIVERSE_FILE.exists():
        try:
            _universe = json.loads(UNIVERSE_FILE.read_text())
        except Exception:
            pass
    if not _universe:
        _universe = dict(DEFAULT_UNIVERSE)
        _save()
    if CUSTOM_FILE.exists():
        try:
            _custom = json.loads(CUSTOM_FILE.read_text())
        except Exception:
            _custom = {}


def _save():
    UNIVERSE_FILE.write_text(json.dumps(_universe, indent=2))


_load()


# ── Public API ────────────────────────────────────────────────────────────────
def get_universe() -> dict:
    return {**_universe, **_custom}


def get_symbols(sector: str = None, typ: str = None) -> list:
    u = get_universe()
    out = []
    for sym, info in u.items():
        if sector and info.get("sector") != sector:
            continue
        if typ and info.get("type") != typ:
            continue
        out.append(sym)
    return sorted(out)


def list_sectors() -> list:
    return sorted(set(v.get("sector", "Other") for v in get_universe().values()))


def add_symbol(sym: str, name: str = "", sector: str = "Other", typ: str = "stock") -> dict:
    sym = sym.upper().strip()
    _universe[sym] = {"name": name or sym, "sector": sector, "type": typ}
    _save()
    return {sym: _universe[sym]}


def remove_symbol(sym: str) -> bool:
    sym = sym.upper()
    if sym in _universe:
        del _universe[sym]
        _save()
        return True
    return False


def get_info(sym: str) -> dict:
    return get_universe().get(sym.upper(), {})


def symbols_for_agent(abbr: str) -> list:
    """Return the best symbols for each agent strategy."""
    AGENT_PREFERRED = {
        "MOM": ["SPY","QQQ","AAPL","NVDA","META","AMZN","TSLA","TQQQ","UPRO","SMH"],
        "MRV": ["SPY","IWM","XLF","HYG","TLT","GLD","VXX","KRE"],
        "VOL": ["VXX","UVXY","SVXY","TQQQ","SQQQ","VIX","UVXY","BITO"],
        "SEN": ["AAPL","TSLA","NVDA","META","NFLX","COIN","MRNA"],
        "MAC": ["SPY","TLT","GLD","EEM","FXI","EWJ","DXY","HYG","TIP","USO"],
        "REG": ["SPY","QQQ","IWM","TLT","GLD","VXX","HYG","EEM"],
        "OPT": ["SPY","QQQ","GLD","TLT","IWM","EEM","VNQ","XLE"],
        "PPO": ["SPY","QQQ","AAPL","MSFT","NVDA","TSLA"],
        "DQN": ["SPY","QQQ","AAPL","MSFT","NVDA"],
        "SCOUT": list(get_symbols())[:30],
    }
    return AGENT_PREFERRED.get(abbr.upper(), ["SPY","QQQ","IWM"])


def parse_uploaded_csv(content: str) -> dict:
    """Parse CSV: symbol,name,sector,type per line."""
    added = {}
    for line in content.strip().split("\n")[1:]:
        parts = [p.strip() for p in line.split(",")]
        if not parts or not parts[0]:
            continue
        sym  = parts[0].upper()
        name = parts[1] if len(parts) > 1 else sym
        sect = parts[2] if len(parts) > 2 else "Other"
        typ  = parts[3] if len(parts) > 3 else "stock"
        added.update(add_symbol(sym, name, sect, typ))
    return added


def get_custom_ohlcv(symbol: str) -> None:
    return None


def list_custom_uploads() -> list:
    return []
