// mock-master.ts - a simulated ESP32 master for hardware-free development. It
// dials into the ingest socket exactly like the real firmware: runs the hello
// handshake, then streams a binary field frame + live vitals at ~5 Hz, periodic
// durable vitals snapshots, and occasional fossil-record events with monotonic
// seqs. Run: `npm run mock` (with the server already running).
import { WebSocket } from "ws";
import {
  DS_W,
  DS_H,
  N_STRIPS,
  FIELD_NCH,
  encodeFieldFrame,
  EVENT_KINDS,
  type SelisMessage,
  type LiveVitals,
  type VitalsSnap,
  type FossilEvent,
  type StripFitness,
} from "./protocol";
import { config } from "./config";
import { logger } from "./log";

const log = logger("mock");
const URL = `ws://localhost:${config.ingestPort}${config.ingestPath}`;

// monotonic durable seqs (a real master persists these across reboots)
let evSeq = 0;
let vitSeq = 0;
let gen = 0;

// counters that only grow, like the real world vitals
let births = 0;
let deaths = 0;
let migrations = 0;
let seamCrossings = 0;

// moving "organisms": gaussian blobs drifting on the torus. species 0 = prey,
// species 1 = predator (predators steer toward the nearest prey -> visible chase).
interface Blob {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  species: number;
}
const blobs: Blob[] = Array.from({ length: 8 }, (_, i) => ({
  x: Math.random() * DS_W,
  y: Math.random() * DS_H,
  vx: (Math.random() - 0.5) * 0.8,
  vy: (Math.random() - 0.5) * 1.2,
  r: 5 + Math.random() * 4,
  species: i < 5 ? 0 : 1, // 5 prey, 3 predators
}));

const PLANE = DS_W * DS_H;
const cells = new Uint8Array(PLANE * FIELD_NCH); // channel-major: [0..PLANE)=prey, [PLANE..)=predator

function nearestPrey(b: Blob): Blob | null {
  let best: Blob | null = null;
  let bd = 1e9;
  for (const p of blobs) {
    if (p.species !== 0) continue;
    const dy = ((p.y - b.y + DS_H * 1.5) % DS_H) - DS_H / 2;
    const dx = ((p.x - b.x + DS_W * 1.5) % DS_W) - DS_W / 2;
    const d = dx * dx + dy * dy;
    if (d < bd) ((bd = d), (best = p));
  }
  return best;
}

function stepField(): void {
  cells.fill(0);
  for (const b of blobs) {
    if (b.species === 1) {
      // predators chase the nearest prey (torus-aware steering)
      const prey = nearestPrey(b);
      if (prey) {
        const dy = ((prey.y - b.y + DS_H * 1.5) % DS_H) - DS_H / 2;
        const dx = ((prey.x - b.x + DS_W * 1.5) % DS_W) - DS_W / 2;
        const n = Math.hypot(dx, dy) || 1;
        b.vx += (dx / n) * 0.05;
        b.vy += (dy / n) * 0.05;
        b.vx = Math.max(-1.5, Math.min(1.5, b.vx));
        b.vy = Math.max(-1.5, Math.min(1.5, b.vy));
      }
    }
    b.x = (b.x + b.vx + DS_W) % DS_W;
    b.y = (b.y + b.vy + DS_H) % DS_H;
    const base = b.species * PLANE;
    const rr = b.r * b.r;
    const x0 = Math.floor(b.x - b.r), x1 = Math.ceil(b.x + b.r);
    const y0 = Math.floor(b.y - b.r), y1 = Math.ceil(b.y + b.r);
    for (let y = y0; y <= y1; y++) {
      const wy = (y + DS_H) % DS_H;
      for (let x = x0; x <= x1; x++) {
        const wx = (x + DS_W) % DS_W;
        const d2 = (x - b.x) * (x - b.x) + (y - b.y) * (y - b.y);
        if (d2 > rr) continue;
        const v = Math.exp(-d2 / (rr * 0.4)) * 255;
        const i = base + wy * DS_W + wx;
        cells[i] = Math.min(255, cells[i] + v);
      }
    }
  }
}

function stripStats(): StripFitness[] {
  const out: StripFitness[] = [];
  const rowsPer = DS_H / N_STRIPS;
  for (let s = 0; s < N_STRIPS; s++) {
    let sum = 0;
    for (let r = s * rowsPer; r < (s + 1) * rowsPer; r++)
      for (let c = 0; c < DS_W; c++) sum += cells[r * DS_W + c] + cells[PLANE + r * DS_W + c];
    const mass = sum / (rowsPer * DS_W * 255);
    out.push({ strip: s, bank: s < 5 ? 0 : 1, fitness: mass * (0.6 + Math.random() * 0.4) });
  }
  return out;
}

function worldMass(): number {
  let sum = 0;
  for (let i = 0; i < cells.length; i++) sum += cells[i];
  return sum / (PLANE * 255);
}

function worldMass1(): number {
  let sum = 0;
  for (let i = PLANE; i < cells.length; i++) sum += cells[i];
  return sum / (PLANE * 255);
}

function makeVitals(strips: StripFitness[]): LiveVitals {
  let best = -1,
    bestStrip = 0;
  for (const s of strips) if (s.fitness > best) ((best = s.fitness), (bestStrip = s.strip));
  return {
    t: "vitals",
    gen,
    online: N_STRIPS,
    mass: worldMass(),
    activity: 0.2 + Math.random() * 0.2,
    entropy: 0.4 + Math.random() * 0.3,
    bestFitness: best,
    bestStrip,
    coupling: 0.5 + 0.5 * Math.sin(gen / 200),
    organisms: blobs.length,
    mass1: worldMass1(),
    births,
    deaths,
    migrations,
    seamCrossings,
    strips,
  };
}

function connect(): void {
  log.info("dialing", URL);
  const ws = new WebSocket(URL);

  ws.on("open", () => {
    log.info("connected; sending hello");
    ws.send(
      JSON.stringify({
        t: "hello",
        firmware: "mock-0.1",
        nStrips: N_STRIPS,
        dsW: DS_W,
        dsH: DS_H,
        evSeqMax: evSeq,
        vitSeqMax: vitSeq,
      }),
    );
  });

  ws.on("message", (data) => {
    let msg: SelisMessage;
    try {
      msg = JSON.parse(data.toString()) as SelisMessage;
    } catch {
      return;
    }
    if (msg.t === "hello") {
      // Catch up our counters to what Selis already has (replay would go here).
      evSeq = Math.max(evSeq, msg.ackEv);
      vitSeq = Math.max(vitSeq, msg.ackVit);
      log.info(`server acks ev=${msg.ackEv} vit=${msg.ackVit}; starting stream`);
      startStreaming(ws);
    }
  });

  ws.on("close", () => {
    log.warn("disconnected; retrying in 2s");
    setTimeout(connect, 2000);
  });
  ws.on("error", (e) => log.error("socket error:", e.message));
}

function startStreaming(ws: WebSocket): void {
  // ~5 Hz: field frame + live vitals
  const fast = setInterval(() => {
    if (ws.readyState !== WebSocket.OPEN) return;
    gen++;
    stepField();
    ws.send(encodeFieldFrame(DS_W, DS_H, cells), { binary: true });
    const strips = stripStats();
    ws.send(JSON.stringify(makeVitals(strips)));
  }, 200);

  // every ~3s: durable vitals snapshot (T2b)
  const snap = setInterval(() => {
    if (ws.readyState !== WebSocket.OPEN) return;
    const strips = stripStats();
    const v = makeVitals(strips);
    const s: VitalsSnap = {
      t: "snap",
      vseq: ++vitSeq,
      gen,
      mass: v.mass,
      activity: v.activity,
      entropy: v.entropy,
      bestFitness: v.bestFitness,
      bestStrip: v.bestStrip,
      coupling: v.coupling,
      organisms: v.organisms,
      births,
      deaths,
      migrations,
      seamCrossings,
      online: N_STRIPS,
    };
    ws.send(JSON.stringify(s));
  }, 3000);

  // every ~5s: a fossil-record event (T2a)
  const evt = setInterval(() => {
    if (ws.readyState !== WebSocket.OPEN) return;
    const kind = EVENT_KINDS[Math.floor(Math.random() * EVENT_KINDS.length)];
    if (kind === "birth") births++;
    else if (kind === "death") deaths++;
    else if (kind === "migration") migrations++;
    if (kind === "migration" || kind === "colonize") seamCrossings++;
    const from = Math.floor(Math.random() * N_STRIPS);
    const e: FossilEvent = {
      t: "event",
      eseq: ++evSeq,
      gen,
      kind,
      fromStrip: from,
      toStrip: (from + 1) % N_STRIPS,
      lineageId: 100 + Math.floor(Math.random() * 20),
      organismId: 1000 + evSeq,
      fitness: Math.random(),
      text: `${kind} at strip ${from}`,
    };
    ws.send(JSON.stringify(e));
  }, 5000);

  ws.on("close", () => {
    clearInterval(fast);
    clearInterval(snap);
    clearInterval(evt);
  });
}

connect();
