// ingest.ts - the master-facing WebSocket server (:8787/ingest). Exactly one
// peer: the ESP32 master, which dials OUT to us. We run the handshake/replay/ack
// contract (docs §4-§5), archive durable streams idempotently, and forward live
// telemetry to the browser hub. The master initiates the connection so the
// cluster never depends on us being up.
import { WebSocketServer, WebSocket, type RawData } from "ws";
import type { Config } from "./config";
import type { Store } from "./store";
import type { Hub } from "./hub";
import {
  FIELD_MAGIC,
  type MasterMessage,
  type SelisHello,
  type SelisAck,
  parseFieldFrame,
} from "./protocol";
import { logger } from "./log";

const log = logger("ingest");

export class Ingest {
  private wss: WebSocketServer;

  constructor(
    private cfg: Config,
    private store: Store,
    private hub: Hub,
  ) {
    this.wss = new WebSocketServer({ port: cfg.ingestPort, path: cfg.ingestPath });
    this.wss.on("listening", () =>
      log.info(`master ingest on ws://0.0.0.0:${cfg.ingestPort}${cfg.ingestPath}`),
    );
    this.wss.on("connection", (sock, req) => this.onMaster(sock, req.socket.remoteAddress ?? "?"));
  }

  private onMaster(sock: WebSocket, addr: string): void {
    log.info("master connected from", addr);
    this.hub.setClusterOnline(true);

    const ackTimer = setInterval(() => this.sendAck(sock), this.cfg.ackIntervalMs);

    sock.on("message", (data, isBinary) => this.onMessage(sock, data, isBinary));
    sock.on("close", () => {
      clearInterval(ackTimer);
      this.hub.setClusterOnline(false);
      log.info("master disconnected");
    });
    sock.on("error", (e) => log.error("master socket error:", e.message));
  }

  private onMessage(sock: WebSocket, data: RawData, isBinary: boolean): void {
    // Binary => field frame (T1 ephemeral): forward to browsers, do not archive.
    if (isBinary) {
      const buf = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
      if (buf.length && buf[0] === FIELD_MAGIC && parseFieldFrame(buf)) {
        this.hub.broadcastField(buf);
      }
      return;
    }

    let msg: MasterMessage;
    try {
      msg = JSON.parse(data.toString()) as MasterMessage;
    } catch {
      log.warn("bad JSON from master");
      return;
    }

    switch (msg.t) {
      case "hello": {
        // Reply with what we already have so the master replays only the gap.
        const { ev, vit } = this.store.acks();
        const reply: SelisHello = { t: "hello", ackEv: ev, ackVit: vit };
        sock.send(JSON.stringify(reply));
        log.info(
          `hello: master has ev<=${msg.evSeqMax} vit<=${msg.vitSeqMax}; we ack ev=${ev} vit=${vit}` +
            (msg.firmware ? ` (fw ${msg.firmware})` : ""),
        );
        break;
      }
      case "vitals":
        this.hub.broadcastVitals(msg);
        break;
      case "snap":
        this.store.insertVitals(msg); // durable, idempotent
        break;
      case "event":
        this.store.insertEvent(msg); // durable, idempotent
        this.hub.broadcastEvent(msg);
        break;
      default: {
        const _exhaustive: never = msg;
        log.warn("unknown message type", (_exhaustive as { t?: string }).t);
      }
    }
  }

  private sendAck(sock: WebSocket): void {
    if (sock.readyState !== WebSocket.OPEN) return;
    const { ev, vit } = this.store.acks();
    const ack: SelisAck = { t: "ack", ev, vit };
    sock.send(JSON.stringify(ack));
  }
}
