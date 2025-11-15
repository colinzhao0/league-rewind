<!-- Add demo video and deployment note -->
# League Rewind / League Wrapped

<!-- Demo video: clickable YouTube thumbnail -->
DEMO:
[![Demo video](https://img.youtube.com/vi/gavkIN8jR3U/0.jpg)](https://youtu.be/gavkIN8jR3U)

A playful, League of Legends-inspired season summary dashboard built with React for the client and a Node.js backend. The UI is themed with neon/gold accents and a scrollytelling layout that displays one stat per full-screen section.

## Project structure

- `client/` — React frontend (Create React App style)
  - `src/` — React app source
  - `public/` — static assets
- `server/` — Node.js backend (Express-style with optional WebSocket progress updates)
- `vercel.json` — Vercel build / route config (review before deployment)

## Quick start (development)

1. Install dependencies for client and server:

```bash
cd client
npm install

# in a separate terminal
cd server
npm install
```

2. Run the client and server locally (two terminals):

```bash
# Terminal 1: client
cd client
npm start

# Terminal 2: server
cd server
npm start
```

The client runs on `http://localhost:3000` by default and the server on `http://localhost:3001` (or the port set in `server/.env`).

## Environment variables

- `RIOT_API_KEY` — required by the server to access Riot APIs. Do NOT commit this to source control. Use platform environment variables for production (Vercel/Render/Railway).

IMPORTANT: If a Riot API key was ever committed to this repository, revoke it immediately and rotate the key. Then purge the secret from the repo history (use `git filter-repo` or BFG) and add `.env` to `.gitignore`.

## Deployment notes

- Vercel: The frontend (`client`) can be deployed as a static site. The backend is an Express + WebSocket server and will not work unchanged in Vercel's serverless functions. Options:
  - Convert server endpoints into serverless functions under `api/` and replace WebSocket progress with polling or SSE.
  - Deploy the backend to a process host (Render, Railway, Heroku) and point the frontend to that host.

- Environment variables should be set in the host dashboard (Vercel/Render) rather than committed.

- Note: I did not deploy this project because the Riot API key used for server requests must be regenerated every 24 hours, which prevents a stable public deployment without a different API strategy.

## Design & features

- Scrollytelling UI: each stat section is a full-screen scroll-snap section with smooth transitions.
- Champion-style cards with neon/gold accents and decorative header.
- Progress indicator shows analysis progress; the app currently supports WebSocket-based progress updates when using a stateful backend.

## Troubleshooting

- If you see a black screen after submitting the summoner, check the browser console for runtime errors and ensure the backend returned `matchStats` and `championMastery` payloads.
- If deploying to Vercel and API routes return 404, confirm your backend strategy (see Deployment notes).

## Next steps

- Convert the server to serverless functions for Vercel, or deploy the current server to a process host.
- Purge any leaked secrets from git history and rotate keys.
- Add a CONTRIBUTING.md and more detailed developer notes.

## License

MIT
