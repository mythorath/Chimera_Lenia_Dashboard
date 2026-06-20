// protocol.ts - canonical wire protocol shared by ingest (master<->Selis) and
// the browser hub (Selis<->browser). Mirrors docs/cluster-telemetry-and-
// persistence.md §4. Little-endian, one WebSocket per role.

// ----- field geometry (downsampled stitched field) -----
export const FIELD_MAGIC = 0xca;
export const DS_W = 64; // columns
export const DS_H = 200; // rows (10 strips x 20)
export const N_STRIPS = 10;
export const SEAM_ROW = DS_H / 2; // Bank A rows 0..99, Bank B rows 100..199
export const FIELD_NCH = 2; // interacting species (channel-major planes per frame)

// Strip index (0..9) owning a stitched row.
export function stripOfRow(row: number): number {
  return Math.floor(row / (DS_H / N_STRIPS));
}

// ---------------------------------------------------------------------------
// Master -> Selis (text JSON envelopes; field frames are binary, see below)
// ---------------------------------------------------------------------------

export interface MasterHello {
  t: "hello";
  firmware?: string;
  nStrips?: number;
  dsW?: number;
  dsH?: number;
  evSeqMax: number; // highest event seq the master holds
  vitSeqMax: number; // highest vitals-snapshot seq the master holds
}

// T1 ephemeral live vitals (not individually archived). `strips` is an optional
// per-strip fitness/stat array for the dashboard's fitness landscape.
export interface LiveVitals {
  t: "vitals";
  gen: number;
  online: number;
  mass: number;
  activity: number;
  entropy: number;
  bestFitness: number;
  bestStrip: number;
  coupling: number;
  organisms: number;
  mass1?: number; // species-1 (predator) mass share -> dashboard species split
  births: number;
  deaths: number;
  migrations: number;
  seamCrossings: number;
  strips?: StripFitness[];
}

// T2b durable vitals snapshot (archived, replayed on reconnect).
export interface VitalsSnap {
  t: "snap";
  vseq: number;
  gen: number;
  mass: number;
  activity: number;
  entropy: number;
  bestFitness: number;
  bestStrip: number;
  coupling: number;
  organisms: number;
  births: number;
  deaths: number;
  migrations: number;
  seamCrossings: number;
  online: number;
}

export const EVENT_KINDS = [
  "birth",
  "death",
  "colonize",
  "migration",
  "mutate",
  "wildcard",
] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

// T2a durable fossil-record event (archived, replayed on reconnect).
export interface FossilEvent {
  t: "event";
  eseq: number;
  gen: number;
  kind: EventKind;
  fromStrip: number;
  toStrip: number;
  lineageId: number;
  organismId: number;
  fitness: number;
  text?: string;
}

export type MasterMessage = MasterHello | LiveVitals | VitalsSnap | FossilEvent;

// ---------------------------------------------------------------------------
// Selis -> Master (text JSON)
// ---------------------------------------------------------------------------

export interface SelisHello {
  t: "hello";
  ackEv: number; // "I already have events <= ackEv"
  ackVit: number; // "I already have vitals <= ackVit"
}

export interface SelisAck {
  t: "ack";
  ev: number;
  vit: number;
}

export type SelisMessage = SelisHello | SelisAck;

// ---------------------------------------------------------------------------
// Selis -> Browser (hub). Field frames forwarded as raw binary; rest is JSON.
// ---------------------------------------------------------------------------

export interface StripFitness {
  strip: number;
  bank: number;
  fitness: number;
}

export interface HubSnapshot {
  t: "snapshot";
  clusterOnline: boolean;
  vitals: LiveVitals | null;
  strips: StripFitness[];
  events: FossilEvent[]; // most-recent-first
}

export interface HubCluster {
  t: "cluster";
  online: boolean;
}

export type HubMessage = HubSnapshot | LiveVitals | FossilEvent | HubCluster;

// ---------------------------------------------------------------------------
// Binary field frame helpers: [0xCA][w][h][nch][w*h*nch bytes], channel-major.
// nch species planes are stored back-to-back (plane c = cells[c*w*h ...]).
// ---------------------------------------------------------------------------

export interface FieldFrame {
  w: number;
  h: number;
  nch: number;
  cells: Uint8Array; // length w*h*nch, channel-major
}

export function parseFieldFrame(buf: Uint8Array): FieldFrame | null {
  if (buf.length < 4 || buf[0] !== FIELD_MAGIC) return null;
  const w = buf[1];
  const h = buf[2];
  const nch = buf[3];
  if (nch < 1 || nch > 4) return null;
  if (buf.length < 4 + w * h * nch) return null;
  return { w, h, nch, cells: buf.subarray(4, 4 + w * h * nch) };
}

export function encodeFieldFrame(
  w: number,
  h: number,
  cells: Uint8Array,
  nch = FIELD_NCH,
): Uint8Array {
  const out = new Uint8Array(4 + w * h * nch);
  out[0] = FIELD_MAGIC;
  out[1] = w;
  out[2] = h;
  out[3] = nch;
  out.set(cells.subarray(0, w * h * nch), 4);
  return out;
}
