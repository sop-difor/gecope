Implementation notes — approve-user function

Deploy options:
- Supabase Edge Functions: place the file as `functions/approve-user/index.js` and run `supabase functions deploy approve-user`.
- Vercel/Netlify: adapt to serverless handler export (this file uses default export handler compatible with Vercel).

Env vars required:
- SUPABASE_URL=https://<project>.supabase.co
- SUPABASE_SERVICE_ROLE_KEY=<service_role_key>

Security:
- Do NOT commit the service_role key to the client or repo. Store it in the platform's secret store.

Client integration:
- Call the endpoint with the admin's access token in Authorization header.
