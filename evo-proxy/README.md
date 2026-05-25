# evo-proxy (enqueue + worker)

Minimal example to run a tiny web service (enqueue) and a worker (process sends) using Supabase as queue storage.

Files:
- `web/index.js` - small Express app: POST /enqueue and health endpoints
- `worker/worker.js` - polling worker that claims jobs and calls Evolution API
- `supabase.sql` - table schema for `whatsapp_jobs`
- `Dockerfile` - multi-stage image; default starts web service

Environment variables required:
- `SUPABASE_URL`, `SUPABASE_KEY`
- `EVO_API_URL`, `EVO_API_KEY`, `EVO_INSTANCE` (for the worker)
- `PORT` (optional, default 3000)

Deploy notes (Render):
1. Create two services in Render:
   - Web Service (Docker): build from this repo, command left as default; set health check to `/health` and readiness to `/ready`.
   - Background Worker (Docker): use same image but set the start command to `npm run worker`.
2. Set environment variables on both services.

Supabase setup:
1. Run the SQL in `supabase.sql` (via SQL editor or psql) to create `whatsapp_jobs`.

Basic usage:
POST /enqueue JSON { "number": "5584988887777", "text": "Mensagem teste", "meta": {}} -> returns 202 and job_id
