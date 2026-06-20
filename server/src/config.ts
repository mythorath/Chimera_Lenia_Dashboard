// config.ts - environment-driven configuration with sane LAN defaults.
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url)); // server/src

function num(name: string, def: number): number {
  const v = process.env[name];
  if (v === undefined || v === "") return def;
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

function str(name: string, def: string): string {
  const v = process.env[name];
  return v === undefined || v === "" ? def : v;
}

function bool(name: string, def: boolean): boolean {
  const v = process.env[name];
  if (v === undefined || v === "") return def;
  return v === "1" || v.toLowerCase() === "true";
}

export interface Config {
  ingestPort: number; // master -> Selis WS
  ingestPath: string;
  httpPort: number; // dashboard SPA + browser WS + REST
  wsPath: string; // browser WS path on the http server
  dbPath: string;
  ackIntervalMs: number; // how often to ack the master
  record: boolean; // enable timelapse recorder (off by default)
  webDist: string; // built SPA to serve in production
  recordingsDir: string;
  hlsDir: string; // NVENC HLS stream output (served at /cinema)
}

export const config: Config = {
  ingestPort: num("INGEST_PORT", 8787),
  ingestPath: str("INGEST_PATH", "/ingest"),
  httpPort: num("HTTP_PORT", 8080),
  wsPath: str("WS_PATH", "/ws"),
  dbPath: resolve(here, "..", "data", str("DB_FILE", "chimera.db")),
  ackIntervalMs: num("ACK_INTERVAL_MS", 2000),
  record: bool("RECORD", false),
  webDist: resolve(here, "..", "..", "web", "dist"),
  recordingsDir: resolve(here, "..", "data", "recordings"),
  hlsDir: resolve(here, "..", "data", "hls"),
};
