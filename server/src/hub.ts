// hub.ts - browser-facing layer: serves the built SPA, mounts REST history
// endpoints, and fans out live telemetry over a WebSocket. Decoupled from the
// master ingest so a cluster outage just freezes the live view, not the server.
import express from "express";
import { createServer, type Server } from "node:http";
import { existsSync, mkdirSync } from "node:fs";
import { WebSocketServer, WebSocket } from "ws";
import type { Config } from "./config";
import type { Store } from "./store";
import { makeRestRouter } from "./rest";
import type { FossilEvent, HubSnapshot, LiveVitals, MasterLog, StripFitness } from "./protocol";
import { logger } from "./log";

const log = logger("hub");

export type CommandSender = (name: string, args: Record<string, unknown>) => boolean;

export class Hub {
  private wss: WebSocketServer;
  private http: Server;
  private clients = new Set<WebSocket>();

  // Live caches used to seed a snapshot for newly-connected browsers.
  private lastVitals: LiveVitals | null = null;
  private lastField: Buffer | null = null;
  private strips: StripFitness[];
  private clusterOnline = false;
  // Set after construction (Ingest is created last); forwards operator commands.
  private commandSender: CommandSender | null = null;

  constructor(
    cfg: Config,
    private store: Store,
  ) {
    this.strips = store.emptyStripFitness();

    const app = express();
    app.use("/api", makeRestRouter(store, (name, args) =>
      this.commandSender ? this.commandSender(name, args) : false,
    ));

    // HLS "cinema" stream from the GPU dream renderer (NVENC). The playlist must
    // never be cached so the browser keeps pulling fresh live segments.
    mkdirSync(cfg.hlsDir, { recursive: true });
    app.use(
      "/cinema",
      express.static(cfg.hlsDir, {
        setHeaders: (res, path) => {
          if (path.endsWith(".m3u8")) res.setHeader("Cache-Control", "no-cache, no-store");
        },
      }),
    );

    // GPU timelapse MP4s, listed by /api/recordings.
    mkdirSync(cfg.recordingsDir, { recursive: true });
    app.use("/recordings", express.static(cfg.recordingsDir));

    if (existsSync(cfg.webDist)) {
      app.use(express.static(cfg.webDist));
      app.get("*", (_req, res) => res.sendFile(`${cfg.webDist}/index.html`));
      log.info("serving SPA from", cfg.webDist);
    } else {
      log.warn("web/dist not found - run `npm run build` for production SPA (dev uses Vite)");
      app.get("/", (_req, res) =>
        res.type("text/plain").send("Chimera Selis server up. Dashboard: run Vite dev (npm run dev:web)."),
      );
    }

    this.http = createServer(app);
    this.wss = new WebSocketServer({ server: this.http, path: cfg.wsPath });

    this.wss.on("connection", (sock) => {
      this.clients.add(sock);
      log.info(`browser connected (${this.clients.size} total)`);
      sock.send(JSON.stringify(this.snapshot()));
      if (this.lastField) sock.send(this.lastField, { binary: true });
      sock.on("close", () => {
        this.clients.delete(sock);
        log.info(`browser disconnected (${this.clients.size} total)`);
      });
      sock.on("error", () => this.clients.delete(sock));
    });

    this.http.listen(cfg.httpPort, () => log.info(`dashboard on http://0.0.0.0:${cfg.httpPort}`));
  }

  private snapshot(): HubSnapshot {
    return {
      t: "snapshot",
      clusterOnline: this.clusterOnline,
      vitals: this.lastVitals,
      strips: this.strips,
      events: this.store.recentEvents(80),
    };
  }

  private broadcastText(obj: unknown): void {
    const s = JSON.stringify(obj);
    for (const c of this.clients) if (c.readyState === WebSocket.OPEN) c.send(s);
  }

  broadcastField(buf: Buffer): void {
    this.lastField = buf;
    for (const c of this.clients) if (c.readyState === WebSocket.OPEN) c.send(buf, { binary: true });
  }

  broadcastVitals(v: LiveVitals): void {
    this.lastVitals = v;
    if (v.strips && v.strips.length) this.strips = v.strips;
    this.broadcastText(v);
  }

  broadcastEvent(e: FossilEvent): void {
    this.broadcastText(e);
  }

  broadcastLog(l: MasterLog): void {
    this.broadcastText({ t: "log", type: l.type, text: l.text });
  }

  setClusterOnline(online: boolean): void {
    if (online === this.clusterOnline) return;
    this.clusterOnline = online;
    log.info("cluster link:", online ? "ONLINE" : "offline");
    this.broadcastText({ t: "cluster", online });
  }

  setCommandSender(fn: CommandSender): void {
    this.commandSender = fn;
  }
}
