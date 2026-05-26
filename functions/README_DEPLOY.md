Deploy notes for `approve-user` function

Supabase Functions (recommended):
- Install supabase CLI and login.
- From repo root run:

  supabase login
  supabase functions deploy approve-user --project-ref <your-project-ref>

- Set secret in Supabase:

  supabase secrets set SUPABASE_SERVICE_ROLE_KEY="<service_role_key>"
  supabase secrets set SUPABASE_URL="https://<project>.supabase.co"

Vercel/Netlify:
- Deploy `functions/approve-user/index.js` as serverless function.
- Ensure env vars `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` configured in project settings.

Client:
- After deploy, set `window.APPROVE_USER_ENDPOINT` in `config.js` to the deployed URL.
