// protocol.ts (browser) - mirror of the Selis->browser hub messages and the
// binary field-frame format. Kept in sync with server/src/protocol.ts.

export const FIELD_MAGIC = 0xca;
export const N_STRIPS = 10;

export interface StripFitness {
  strip: number;
  bank: number;
  fitness: number;
}

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
  mass1?: number; // species-1 (predator) mass share -> species split
  births: number;
  deaths: number;
  migrations: number;
  seamCrossings: number;
  strips?: StripFitness[];
}

export type EventKind = "birth" | "death" | "colonize" | "migration" | "mutate" | "wildcard";

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

export interface HubSnapshot {
  t: "snapshot";
  clusterOnline: boolean;
  vitals: LiveVitals | null;
  strips: StripFitness[];
  events: FossilEvent[];
}

export interface HubCluster {
  t: "cluster";
  online: boolean;
}

export type HubMessage = HubSnapshot | LiveVitals | FossilEvent | HubCluster;
