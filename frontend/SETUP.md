# InsightGuard AI — Frontend Setup

## Requirements
- Node.js 20+ (or Bun)
- A running InsightGuard FastAPI backend

## Install
```sh
npm install        # or: bun install
```
The dependency lockfile (`bun.lock`) is included for reproducible installs.

## Configure the backend URL
Create a `.env` file in the project root (this file is intentionally not
included in the export — it contains environment-specific configuration):

```
VITE_API_BASE_URL=https://your-backend-url.example.com
```

Without this variable the app runs in clearly labeled demo mode.

## Run
```sh
npm run dev        # local development server
npm run build      # production build
npm run test       # run the test suite (vitest)
```

## Notes
- All backend calls go through `src/services/api.ts`.
- The FastAPI backend must allow the frontend's origin in its CORS settings.
