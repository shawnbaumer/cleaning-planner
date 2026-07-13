# Cleaning Planner

## Purpose

A personal iPhone cleaning-planner PWA. Helps track and schedule household
cleaning tasks. Installable to the iPhone home screen, works offline, and
stores all data locally on-device — no backend, no account, no sync.

## Tech stack

- **Vite** — build tool / dev server
- **React 19** + **TypeScript** — UI
- **Tailwind CSS v4** (`@tailwindcss/vite`) — styling
- **vite-plugin-pwa** — service worker + web app manifest for installability
  and offline support
- **Dexie** — wrapper around IndexedDB for local data persistence

## Folder structure

```
├── public/              Static assets served as-is (favicon, etc.)
├── src/
│   ├── lib/
│   │   └── db.ts        Dexie database instance (IndexedDB schema lives here)
│   ├── App.tsx           Root component
│   ├── main.tsx          React entry point / DOM mount
│   └── index.css         Tailwind entry point
├── index.html            Vite HTML entry
├── vite.config.ts         Vite config: React, Tailwind, and PWA plugins
└── package.json
```

## Status

Skeleton stage: project scaffolding only, no features built yet. `npm run
dev` should show a plain "Hello World" screen. Future work will add the
actual cleaning task/schedule data model (in `src/lib/db.ts`) and UI.

## Commands

- `npm run dev` — start dev server
- `npm run build` — type-check and build for production
- `npm run preview` — preview the production build
- `npm run lint` — run oxlint
