# Chimera Lenia — Selis Server & Dashboard

Linux-side ingest server, durable archive, and web dashboard for the distributed
Chimera Lenia cluster. The ESP32 *master* dials **out** to this server over a
single WebSocket; this server archives the durable streams, fans out to browsers,
and serves the dashboard. The cluster runs fully autonomously when this server is
down — see the firmware-side spec for the autonomy/persistence contract.

Design docs (in the firmware repo): `docs/selis-server-and-dashboard.md` and
`docs/cluster-telemetry-and-persistence.md`. This project implements the Selis
side. (Note: those docs assumed a `dashboard/` subfolder inside the firmware repo;
here Selis has its own dedicated repo, so the project lives at the root.)

## Layout

```
.
├─ server/          # Node + TS: ingest (from master), SQLite archive, browser hub, REST
│  └─ src/
│     ├─ index.ts        # boot: starts ingest + hub
│     ├─ config.ts       # env-driven config
│     ├─ protocol.ts     # wire protocol types/constants (master<->selis, selis<->browser)
│     ├─ store.ts        # SQLite (better-sqlite3): events, vitals, organisms, ack cursors
│     ├─ ingest.ts       # master WS server (:8787/ingest) + handshake/replay/ack
│     ├─ hub.ts          # browser WS fan-out + static SPA + REST (:8080)
│     ├─ rest.ts         # history endpoints
│     ├─ recorder.ts     # (optional) timelapse recorder — off by default
│     ├─ log.ts          # tiny logger
│     └─ mock-master.ts  # dev simulator: streams fake field/vitals/events (no hardware)
└─ web/             # Vite + TS dashboard SPA
   └─ src/
      ├─ main.ts        ├─ field.ts     ├─ vitals.ts
      ├─ lineage.ts     ├─ organisms.ts ├─ history.ts
      └─ style.css
```

## Run on Selis (Linux)

> Install/build/run **on Selis**, not on the Windows authoring machine — the
> SQLite driver is a native module and `node_modules` is platform-specific.

```bash
npm install            # installs both workspaces (builds native better-sqlite3)
npm run dev            # server (tsx watch) + web (vite dev) together
```

Then, in another terminal, drive it without hardware:

```bash
npm run mock           # simulated master streams to the ingest socket
```

Open the dashboard:
- dev: the Vite URL it prints (defaults to http://localhost:5173)
- prod: `npm run build` then `npm start`, dashboard at http://localhost:8080

## Ports

| Port | Purpose | Exposure |
|---|---|---|
| `8787` | master → Selis ingest WS (`/ingest`) | LAN-only |
| `8080` | dashboard SPA + browser WS + REST | LAN (or wherever you view it) |
| `5173` | Vite dev server (dev only) | local |

Configure via env (see `server/src/config.ts`): `INGEST_PORT`, `HTTP_PORT`,
`DB_PATH`, `ACK_INTERVAL_MS`, `RECORD`.
