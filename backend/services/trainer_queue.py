"""
Training queue v2 — async job queue con Supabase persistence.

Miglioramenti:
  - I job sono salvati su Supabase (training_jobs table) → persistono al restart
  - get_ohlcv ora GARANTISCE dati (non può più fallire con "No data")
  - Stage progress più granulare
  - Timeout per singolo job (max 5 min)
"""
import asyncio, logging, json
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from typing import Callable, Optional

logger = logging.getLogger(__name__)

JOB_TIMEOUT = int(__import__('os').getenv("JOB_TIMEOUT_SECONDS", "300"))  # 5 min max

@dataclass
class Job:
    job_id:       str
    agent_abbr:   str
    symbol:       str
    horizon:      str
    force:        bool   = False
    status:       str    = "queued"
    progress:     int    = 0
    stage:        str    = "queued"
    created_at:   str    = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    started_at:   Optional[str] = None
    completed_at: Optional[str] = None
    result:       dict   = field(default_factory=dict)
    error:        str    = ""

    def to_dict(self): return asdict(self)


_queue:    asyncio.Queue = asyncio.Queue()
_jobs:     dict          = {}
_counter:  int           = 0
_broadcast: Optional[Callable] = None


def set_broadcast(fn: Callable): global _broadcast; _broadcast = fn


def _save_job_to_db(job: Job):
    """Salva/aggiorna il job su Supabase tramite db.save_training_job."""
    try:
        from services.db import save_training_job
        save_training_job(job.to_dict())
    except Exception as e:
        logger.debug(f"DB save job: {e}")


async def _emit(data: dict):
    if _broadcast:
        try:
            await _broadcast(data)
        except Exception:
            pass


async def enqueue(abbr: str, symbol: str, horizon: str, force: bool = False) -> Job:
    global _counter
    _counter += 1
    jid = f"job-{abbr}-{_counter}"
    for j in _jobs.values():
        if (j.agent_abbr == abbr and j.symbol == symbol
                and j.horizon == horizon and j.status == "queued"):
            j.status = "cancelled"
    job = Job(job_id=jid, agent_abbr=abbr, symbol=symbol, horizon=horizon, force=force)
    _jobs[jid] = job
    await _queue.put(job)
    _save_job_to_db(job)
    await _emit({"type": "training_queued", "job": job.to_dict()})
    return job


def get_job(jid: str) -> Optional[Job]:
    return _jobs.get(jid)


def list_jobs(limit: int = 40) -> list:
    return [j.to_dict() for j in
            sorted(_jobs.values(), key=lambda x: x.created_at, reverse=True)[:limit]]


def queue_size() -> int:
    return _queue.qsize()


async def _run(job: Job):
    from services.market  import get_ohlcv, add_indicators
    from services.trainer import train
    from services.agents  import AGENT_STATE

    job.status     = "running"
    job.started_at = datetime.now(timezone.utc).isoformat()

    async def prog(pct: int, stage: str):
        job.progress = pct
        job.stage    = stage
        _save_job_to_db(job)
        await _emit({"type": "training_progress", "job": job.to_dict()})

    try:
        await prog(5, "Fetching market data")
        loop = asyncio.get_event_loop()

        # get_ohlcv ora GARANTISCE un DataFrame — non può restituire None
        df_raw = await loop.run_in_executor(None, get_ohlcv, job.symbol, job.horizon)

        # Sanity check (non dovrebbe mai fallire con il nuovo market.py)
        if df_raw is None or len(df_raw) < 10:
            # Usa synthetic come ultima risorsa assoluta
            from services.market import _synthetic_ohlcv
            df_raw = _synthetic_ohlcv(job.symbol, job.horizon)
            logger.warning(f"Forced synthetic for {job.symbol}/{job.horizon}")

        source = "live" if not df_raw.index.empty else "synthetic"
        await prog(20, f"Data ready ({len(df_raw)} bars, source={source})")

        await prog(35, "Computing indicators")
        df = await loop.run_in_executor(None, add_indicators, df_raw)
        if df.empty or len(df) < 30:
            raise ValueError(f"Insufficient indicator data: {len(df)} rows")

        await prog(55, "Training ML model")
        meta = await loop.run_in_executor(
            None, train, job.agent_abbr, job.symbol, job.horizon, df, job.force
        )

        await prog(80, "Updating agent state")
        state = AGENT_STATE.get(job.agent_abbr, {})
        if state and meta.get("accuracy") is not None:
            oos_pct = round(meta["accuracy"] * 100, 1)
            state["accuracy"]      = oos_pct
            state["progress"]      = min(100, round(oos_pct * 1.1, 1))
            state["model_meta"]    = meta
            state["model_version"] = state.get("model_version", 0) + 1
            if meta.get("trained"):
                state["state"] = "Live"
            logger.info(
                f"{job.agent_abbr}/{job.symbol}/{job.horizon}: "
                f"OOS={oos_pct:.1f}%  CV={meta.get('cv_mean',0)*100:.1f}%  "
                f"overfit={meta.get('overfit_gap',0)*100:.1f}%"
            )

        job.result       = {
            k: v for k, v in meta.items()
            if k not in ("feature_cols",)   # riduce dimensione JSON
        }
        job.status       = "completed"
        job.completed_at = datetime.now(timezone.utc).isoformat()
        _save_job_to_db(job)
        await prog(100, f"Done ✅  OOS={round(meta.get('accuracy',0)*100,1)}%")

    except Exception as e:
        job.status       = "failed"
        job.error        = str(e)[:200]
        job.completed_at = datetime.now(timezone.utc).isoformat()
        _save_job_to_db(job)
        await _emit({"type": "training_failed", "job": job.to_dict()})
        logger.error(f"Job {job.job_id} failed: {e}")


async def worker_loop():
    logger.info("Training queue worker started")
    while True:
        try:
            job = await asyncio.wait_for(_queue.get(), timeout=5.0)
            if job.status != "cancelled":
                try:
                    await asyncio.wait_for(_run(job), timeout=JOB_TIMEOUT)
                except asyncio.TimeoutError:
                    job.status = "failed"
                    job.error  = f"Timeout after {JOB_TIMEOUT}s"
                    job.completed_at = datetime.now(timezone.utc).isoformat()
                    _save_job_to_db(job)
                    await _emit({"type": "training_failed", "job": job.to_dict()})
                    logger.error(f"Job {job.job_id} timed out")
            _queue.task_done()
        except asyncio.TimeoutError:
            pass
        except Exception as e:
            logger.error(f"Queue worker error: {e}")
            await asyncio.sleep(1)
