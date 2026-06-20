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
  type SelisCommand,
  parseFieldFrame,
} from "./protocol";
import { logger } from "./log";

const log = logger("ingest");

export class Ingest {
  private wss: WebSocketServer;
  private master: WebSocket | null = null; // the single connected master, if any

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

  // Forward an operator command to the master. Returns false if no master is
  // connected (the cluster runs autonomously, so this is best-effort).
  sendCommand(name: string, args: Record<string, unknown>): boolean {
    if (!this.master || this.master.readyState !== WebSocket.OPEN) return false;
    const cmd: SelisCommand = { t: "cmd", name, args };
    this.master.send(JSON.stringify(cmd));
    log.info(`forwarded cmd '${name}' to master`, args);
    return true;
  }

  private onMaster(sock: WebSocket, addr: string): void {
    log.info("master connected from", addr);
    this.master = sock;
    this.hub.setClusterOnline(true);

    const ackTimer = setInterval(() => this.sendAck(sock), this.cfg.ackIntervalMs);

    sock.on("message", (data, isBinary) => this.onMessage(sock, data, isBinary));
    sock.on("close", () => {
      clearInterval(ackTimer);
      // A reconnecting master can briefly hold two sockets (new one connects
      // before the old half-open TCP times out). Only the CURRENT master going
      // away means the cluster is actually offline - a stale socket closing must
      // not knock the badge offline while a fresh link is up.
      if (this.master === sock) {
        this.master = null;
        this.hub.setClusterOnline(false);
        log.info("master disconnected");
      } else {
        log.info("stale master socket closed (newer link is live)");
      }
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
        let { ev, vit } = this.store.acks();
        // Detect a master spool reset (seq regression) and rebase our archive so
        // its fresh low-seq stream isn't swallowed as duplicates of a dead epoch.
        if (msg.evSeqMax < ev || msg.vitSeqMax < vit) {
          log.warn(
            `master seq regressed (ev ${msg.evSeqMax}<${ev}, vit ${msg.vitSeqMax}<${vit}) - ` +
              `master was reset; rebasing archive`,
          );
          this.store.resetArchive(msg.evSeqMax, msg.vitSeqMax);
          ({ ev, vit } = this.store.acks());
        }
        // Reply with what we already have so the master replays only the gap.
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
      case "log":
        this.hub.broadcastLog(msg); // ephemeral ticker line, not archived
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
