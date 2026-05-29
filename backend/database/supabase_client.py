"""
Supabase client — wraps supabase-py for async-friendly usage.
Falls back gracefully to in-memory simulation if Supabase is not configured.
"""

import os
from typing import Optional, Any
from dotenv import load_dotenv

load_dotenv()

_client = None
_enabled = False


def get_client():
    """Return the Supabase client (lazy init)."""
    global _client, _enabled

    url = os.getenv("SUPABASE_URL", "")
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_KEY", "")

    if not url or not key or "your-project" in url:
        # Supabase not configured — run in simulation-only mode
        return None

    if _client is None:
        try:
            from supabase import create_client
            _client = create_client(url, key)
            _enabled = True
            print("✅ Supabase connected")
        except Exception as e:
            print(f"⚠️  Supabase connection failed: {e}. Running in simulation mode.")
            _client = None

    return _client


def is_enabled() -> bool:
    return _enabled


async def insert(table: str, data: dict | list) -> Optional[Any]:
    """Insert row(s) into a table. No-op if Supabase not configured."""
    client = get_client()
    if not client:
        return None
    try:
        result = client.table(table).insert(data).execute()
        return result.data
    except Exception as e:
        print(f"Supabase insert error [{table}]: {e}")
        return None


async def upsert(table: str, data: dict | list, on_conflict: str = "id") -> Optional[Any]:
    client = get_client()
    if not client:
        return None
    try:
        result = client.table(table).upsert(data, on_conflict=on_conflict).execute()
        return result.data
    except Exception as e:
        print(f"Supabase upsert error [{table}]: {e}")
        return None


async def select(table: str, filters: dict = None, limit: int = 100) -> list:
    client = get_client()
    if not client:
        return []
    try:
        q = client.table(table).select("*")
        if filters:
            for k, v in filters.items():
                q = q.eq(k, v)
        result = q.limit(limit).execute()
        return result.data or []
    except Exception as e:
        print(f"Supabase select error [{table}]: {e}")
        return []
