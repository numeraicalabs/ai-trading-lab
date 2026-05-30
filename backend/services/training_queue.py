"""Async training queue with real-time progress broadcast."""
import asyncio, logging
from datetime import datetime, timezone
from dataclasses import dataclass, field, asdict
from typing import Optional, Callable

logger = logging.getLogger(__name__)

@dataclass
class Job:
    job_id: str; agent_abbr: str; symbol: str; horizon: str
    force: bool = False; status: str = "queued"; progress: int = 0
    stage: str = "queued"; created_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    started_at: Optional[str] = None; completed_at: Optional[str] = None
    result: dict = field(default_factory=dict); error: str = ""
    def to_dict(self): return asdict(self)

_queue: asyncio.Queue = asyncio.Queue()
_jobs: dict = {}
_counter = 0
_broadcast_fn: Optional[Callable] = None

def set_broadcast(fn): global _broadcast_fn; _broadcast_fn = fn

async def _bcast(data):
    if _broadcast_fn:
        try: await _broadcast_fn(data)
        except: pass

async def enqueue(abbr, symbol, horizon, force=False):
    global _counter; _counter += 1
    jid = f"job-{abbr}-{_counter}"
    for j in list(_jobs.values()):
        if j.agent_abbr==abbr and j.symbol==symbol and j.horizon==horizon and j.status=="queued":
            j.status="cancelled"
    job = Job(job_id=jid,agent_abbr=abbr,symbol=symbol,horizon=horizon,force=force)
    _jobs[jid] = job
    await _queue.put(job)
    await _bcast({"type":"training_queued","job":job.to_dict()})
    return job

def get_job(jid): return _jobs.get(jid)
def list_jobs(limit=40): return [j.to_dict() for j in sorted(_jobs.values(),key=lambda x:x.created_at,reverse=True)[:limit]]
def queue_size(): return _queue.qsize()

async def _run_job(job: Job):
    from services.market_data   import get_ohlcv, add_indicators
    from services.model_trainer import train_agent_model
    from services.agent_engine  import _agent_state

    job.status = "running"; job.started_at = datetime.now(timezone.utc).isoformat()

    async def prog(pct, stage):
        job.progress=pct; job.stage=stage
        await _bcast({"type":"training_progress","job":job.to_dict()})

    try:
        await prog(5,"Fetching market data")
        loop = asyncio.get_event_loop()
        df_raw = await loop.run_in_executor(None, get_ohlcv, job.symbol, job.horizon)
        if df_raw is None or df_raw.empty: raise ValueError(f"No data for {job.symbol}/{job.horizon}")
        await prog(20,"Computing indicators")
        df = await loop.run_in_executor(None, add_indicators, df_raw)
        if df.empty: raise ValueError("Empty indicators")
        await prog(50,"Training ML model")
        meta = await loop.run_in_executor(None, train_agent_model, job.agent_abbr, job.symbol, job.horizon, df, job.force)
        await prog(85,"Updating agent state")
        if job.agent_abbr in _agent_state and meta.get("accuracy"):
            _agent_state[job.agent_abbr]["accuracy"] = round(meta["accuracy"]*100,1)
            _agent_state[job.agent_abbr]["progress"] = min(100,round(meta["accuracy"]*110,1))
            _agent_state[job.agent_abbr]["model_meta"] = meta
            if meta.get("trained"): _agent_state[job.agent_abbr]["state"] = "Live"
        job.result = meta; job.status = "completed"; job.completed_at = datetime.now(timezone.utc).isoformat()
        await prog(100,"Completed ✅")
    except Exception as e:
        job.status="failed"; job.error=str(e); job.completed_at=datetime.now(timezone.utc).isoformat()
        await _bcast({"type":"training_failed","job":job.to_dict()})
        logger.error(f"Job {job.job_id} failed: {e}")

async def worker_loop():
    logger.info("Training worker started")
    while True:
        try:
            job = await asyncio.wait_for(_queue.get(),timeout=5.0)
            if job.status != "cancelled": await _run_job(job)
            _queue.task_done()
        except asyncio.TimeoutError: pass
        except Exception as e: logger.error(f"Worker: {e}"); await asyncio.sleep(1)
