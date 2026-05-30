"""Async training queue — each job runs in an executor, broadcasts progress via WebSocket."""
import asyncio, logging
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from typing import Callable, Optional

logger = logging.getLogger(__name__)

@dataclass
class Job:
    job_id:       str
    agent_abbr:   str
    symbol:       str
    horizon:      str
    force:        bool   = False
    status:       str    = "queued"   # queued | running | completed | failed | cancelled
    progress:     int    = 0
    stage:        str    = "queued"
    created_at:   str    = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    started_at:   Optional[str] = None
    completed_at: Optional[str] = None
    result:       dict   = field(default_factory=dict)
    error:        str    = ""

    def to_dict(self): return asdict(self)

_queue:   asyncio.Queue = asyncio.Queue()
_jobs:    dict          = {}          # job_id → Job
_counter: int           = 0
_broadcast: Optional[Callable] = None

def set_broadcast(fn: Callable): global _broadcast; _broadcast = fn

async def _emit(data: dict):
    if _broadcast:
        try: await _broadcast(data)
        except Exception: pass

async def enqueue(abbr: str, symbol: str, horizon: str, force: bool = False) -> Job:
    global _counter
    _counter += 1
    jid = f"job-{abbr}-{_counter}"
    # cancel any queued duplicate
    for j in _jobs.values():
        if j.agent_abbr == abbr and j.symbol == symbol and j.horizon == horizon and j.status == "queued":
            j.status = "cancelled"
    job = Job(job_id=jid, agent_abbr=abbr, symbol=symbol, horizon=horizon, force=force)
    _jobs[jid] = job
    await _queue.put(job)
    await _emit({"type": "training_queued", "job": job.to_dict()})
    return job

def get_job(jid: str) -> Optional[Job]:    return _jobs.get(jid)
def list_jobs(limit: int = 40) -> list:    return [j.to_dict() for j in sorted(_jobs.values(), key=lambda x: x.created_at, reverse=True)[:limit]]
def queue_size() -> int:                   return _queue.qsize()

async def _run(job: Job):
    from services.market  import get_ohlcv, add_indicators
    from services.trainer import train
    from services.agents  import AGENT_STATE

    job.status     = "running"
    job.started_at = datetime.now(timezone.utc).isoformat()

    async def prog(pct: int, stage: str):
        job.progress = pct; job.stage = stage
        await _emit({"type": "training_progress", "job": job.to_dict()})

    try:
        await prog(5, "Fetching market data")
        loop   = asyncio.get_event_loop()
        df_raw = await loop.run_in_executor(None, get_ohlcv, job.symbol, job.horizon)
        if df_raw is None or df_raw.empty:
            raise ValueError(f"No data for {job.symbol}/{job.horizon}")

        await prog(25, "Computing indicators")
        df = await loop.run_in_executor(None, add_indicators, df_raw)
        if df.empty:
            raise ValueError("Empty after indicators")

        await prog(55, "Training ML model")
        meta = await loop.run_in_executor(None, train, job.agent_abbr, job.symbol, job.horizon, df, job.force)

        await prog(85, "Updating agent state")
        if job.agent_abbr in AGENT_STATE and meta.get("accuracy"):
            AGENT_STATE[job.agent_abbr]["accuracy"] = round(meta["accuracy"] * 100, 1)
            AGENT_STATE[job.agent_abbr]["progress"]  = min(100, round(meta["accuracy"] * 110, 1))
            AGENT_STATE[job.agent_abbr]["model_meta"] = meta
            if meta.get("trained"):
                AGENT_STATE[job.agent_abbr]["state"] = "Live"

        job.result       = meta
        job.status       = "completed"
        job.completed_at = datetime.now(timezone.utc).isoformat()
        await prog(100, "Completed ✅")

    except Exception as e:
        job.status       = "failed"
        job.error        = str(e)
        job.completed_at = datetime.now(timezone.utc).isoformat()
        await _emit({"type": "training_failed", "job": job.to_dict()})
        logger.error(f"Job {job.job_id} failed: {e}")

async def worker_loop():
    logger.info("Training queue worker started")
    while True:
        try:
            job = await asyncio.wait_for(_queue.get(), timeout=5.0)
            if job.status != "cancelled":
                await _run(job)
            _queue.task_done()
        except asyncio.TimeoutError:
            pass
        except Exception as e:
            logger.error(f"Queue worker error: {e}")
            await asyncio.sleep(1)
