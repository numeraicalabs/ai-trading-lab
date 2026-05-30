# Supabase Setup Guide

## ⚠️ Important: Do NOT use Supabase CLI

Run the SQL files manually from the **Supabase Dashboard → SQL Editor**.
Do not use `supabase db push` — it requires a `schema_migrations` table
that is only present when using the full Supabase CLI local development setup.

---

## Step 1 — Create project

1. Go to [supabase.com](https://supabase.com) → New project
2. Note down: **Project URL** and **API Keys**

---

## Step 2 — Run migrations in SQL Editor

1. Supabase Dashboard → **SQL Editor** (left sidebar)
2. Click **New query**
3. Copy-paste the contents of `supabase/migrations/001_init.sql`
4. Click **Run** — you should see: `Setup complete — 7 tables created`
5. Repeat for `supabase/migrations/002_model_versions.sql`

---

## Step 3 — Get your API keys

Go to: **Project Settings → API**

| Key | Where to find | Render env var |
|-----|--------------|----------------|
| Project URL | Settings → API → Project URL | `SUPABASE_URL` |
| anon/public key | Settings → API → Project API keys → anon public | `SUPABASE_KEY` |
| service_role key | Settings → API → Project API keys → service_role | `SUPABASE_SERVICE_ROLE_KEY` |

> ⚠️ The `service_role` key is secret — never expose it in frontend code.
> The backend uses this key to bypass Row Level Security for writes.

---

## Step 4 — Set env vars in Render

Render → your service → **Environment** → **Add Environment Variable**:

```
SUPABASE_URL            = https://YOUR_PROJECT_ID.supabase.co
SUPABASE_KEY            = eyJhbGci... (anon key)
SUPABASE_SERVICE_ROLE_KEY = eyJhbGci... (service_role key)
```

After saving, **Manual Deploy** to restart the service.

---

## Verify it's working

Go to your app URL → **Training Lab → 🩺 Health** tab.

You should see:
- ✅ **Supabase DB: Connected**

Or check: `https://your-app.onrender.com/health`

```json
{
  "supabase": { "connected": true, "error": "" }
}
```

---

## Common errors

| Error | Cause | Fix |
|-------|-------|-----|
| `schema_migrations not found` | Used Supabase CLI instead of Dashboard | Run SQL directly in Dashboard SQL Editor |
| `new row violates row-level security` | Missing `WITH CHECK (true)` on RLS policy | Re-run `001_init.sql` (it drops and recreates policies) |
| `JWT expired` | Using anon key instead of service_role key | Set `SUPABASE_SERVICE_ROLE_KEY` in Render |
| `relation "trades" does not exist` | Migrations not run | Run `001_init.sql` in SQL Editor |
| `connected: false` | Wrong URL or key | Check `SUPABASE_URL` starts with `https://` |
