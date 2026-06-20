// rest.ts - history endpoints over the SQLite archive, for the dashboard's
// charts, fossil-record view, field guide, and (later) the history scrubber.
import { Router, json } from "express";
import { readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { Store } from "./store";
import { config } from "./config";

function intParam(v: unknown, def: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

// Commands the dashboard is allowed to forward to the master. Whitelisted so a
// generic POST can't push arbitrary opcodes onto the cluster.
const ALLOWED_COMMANDS = new Set(["reset_environment"]);

type CommandSender = (name: string, args: Record<string, unknown>) => boolean;

export function makeRestRouter(store: Store, sendCommand: CommandSender): Router {
  const r = Router();
  const DAY = 86_400_000;

  r.get("/health", (_req, res) => {
    res.json({ ok: true, acks: store.acks() });
  });

  // Operator command -> master (e.g. full environment reset). Best-effort: if no
  // master is connected, the cluster keeps running autonomously.
  r.post("/command", json(), (req, res) => {
    const body = (req.body ?? {}) as { name?: unknown; args?: unknown };
    const name = typeof body.name === "string" ? body.name : "";
    const args =
      body.args && typeof body.args === "object" ? (body.args as Record<string, unknown>) : {};
    if (!ALLOWED_COMMANDS.has(name)) {
      return res.status(400).json({ ok: false, error: "unknown command" });
    }
    const delivered = sendCommand(name, args);
    res.json({ ok: true, delivered });
  });

  r.get("/vitals", (req, res) => {
    const to = intParam(req.query.to, Date.now());
    const from = intParam(req.query.from, to - DAY);
    res.json(store.vitalsRange(from, to));
  });

  r.get("/events", (req, res) => {
    const to = intParam(req.query.to, Date.now());
    const from = intParam(req.query.from, to - 7 * DAY);
    const kind = typeof req.query.kind === "string" ? req.query.kind : undefined;
    res.json(store.eventsRange(from, to, kind));
  });

  r.get("/events/recent", (req, res) => {
    res.json(store.recentEvents(intParam(req.query.limit, 100)));
  });

  r.get("/organisms", (_req, res) => {
    res.json(store.organisms());
  });

  // GPU timelapse recordings (MP4s written by the dream renderer), served from
  // /recordings (see hub.ts). Newest first.
  r.get("/recordings", (_req, res) => {
    const dir = config.recordingsDir;
    if (!existsSync(dir)) return res.json([]);
    const files = readdirSync(dir)
      .filter((f) => f.endsWith(".mp4"))
      .map((f) => {
        const st = statSync(join(dir, f));
        return { name: f, bytes: st.size, mtime: st.mtimeMs, url: `/recordings/${f}` };
      })
      .sort((a, b) => b.mtime - a.mtime);
    res.json(files);
  });

  return r;
}
