# Northstar Frontend

React + TypeScript + Vite, with Tailwind and the React Compiler enabled.
This application is the `northstar-frontend` npm workspace in the
[Northstar monorepo](../../README.md).

## Development

Install from the repository root with `npm ci`. Copy this application's
`.env.example` to `.env` and set `VITE_API_BASE=/api` for local development.
The Vite server proxies `/api` to `http://localhost:3000`; without an override,
the API configuration retains its existing deployed backend fallback.

From the repository root:

```sh
npm run dev:frontend
npm run build --workspace=northstar-frontend
npm run lint --workspace=northstar-frontend
npm test --workspace=northstar-frontend
npm run preview --workspace=northstar-frontend
```

Public build output is `apps/frontend/dist`. `VITE_*` variables are included in
browser code and must never contain backend secrets.

## Authentication

Access-token/session handling is implemented in `src/auth/session.ts` and
`src/api/client.ts`. See [`FRONTEND_AUTH_MIGRATION.md`](FRONTEND_AUTH_MIGRATION.md)
for the renewable-session contract; do not implement legacy localStorage JWT
handling from older template documentation.

The repository move does not change API endpoints, production API configuration,
or the extension manifest. See the root README for deployment setup.
