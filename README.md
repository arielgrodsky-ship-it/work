# Hours Ledger

Hours Ledger is a static GitHub Pages frontend with an optional Cloudflare Worker and D1 backend.

## Frontend

```powershell
npm install
npm run dev
```

Without `VITE_API_URL`, the app uses browser localStorage. To use the hosted backend, copy `.env.example` to `.env`, set the Worker URL and token, then run `npm run build`.

## Cloudflare backend

1. In Cloudflare, create a D1 database named `hours-ledger` and copy its id into `worker/wrangler.toml`.
2. In the D1 SQL console, run the contents of `worker/schema.sql`.
3. Create the Worker from this repository, or let the GitHub Action deploy it after secrets are configured.
4. Add an `API_TOKEN` secret in the Worker settings.
5. Set `ALLOWED_ORIGIN` and the API URL to your deployed domains. This repository's Pages URL is `https://arielgrodsky-ship-it.github.io/work/`.
6. Add `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` to GitHub repository secrets. The included Worker workflow uses Cloudflare's Wrangler Action, so no local `npm install` is required.

The frontend token is a personal workspace credential, not a server secret. For multiple users, add Cloudflare Access or an identity provider before exposing the Worker publicly.
