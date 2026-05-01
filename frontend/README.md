# Agent Slam Frontend

Vite + React cockpit for the local Agent Slam hackathon demo.

```bash
npm install
npm run dev
```

Backend target comes from `.env`:

```bash
VITE_API_BASE_URL=http://127.0.0.1:8787
```

The WebSocket URL is derived from the same Vite env value and connects to `/ws/matches/:id`.

Useful commands:

```bash
npm run build
npm run preview
```
