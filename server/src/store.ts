// store.ts - durable archive (SQLite via better-sqlite3). Holds the fossil-record
// events (T2a), the vitals time-series (T2b), a derived organism catalogue, and
// the ack cursors sent back to the master. Inserts are idempotent on seq so a
// replay after reconnect is harmless.
import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { FossilEvent, VitalsSnap, StripFitness } from "./protocol";

export interface Acks {
  ev: number;
  vit: number;
}

export class Store {
  private db: Database.Database;

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("synchronous = NORMAL");
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS events (
        eseq        INTEGER PRIMARY KEY,
        gen         INTEGER NOT NULL,
        kind        TEXT    NOT NULL,
        from_strip  INTEGER, to_strip INTEGER,
        lineage_id  INTEGER, organism_id INTEGER,
        fitness     REAL,
        text        TEXT,
        rx_ts       INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_events_gen ON events(gen);
      CREATE INDEX IF NOT EXISTS idx_events_kind ON events(kind);

      CREATE TABLE IF NOT EXISTS vitals (
        vseq        INTEGER PRIMARY KEY,
        gen         INTEGER NOT NULL,
        mass REAL, activity REAL, entropy REAL,
        best_fitness REAL, best_strip INTEGER,
        coupling REAL, organisms_alive INTEGER,
        births INTEGER, deaths INTEGER, migrations INTEGER, seam_crossings INTEGER,
        online INTEGER,
        rx_ts       INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_vitals_rx ON vitals(rx_ts);

      CREATE TABLE IF NOT EXISTS organisms (
        organism_id INTEGER PRIMARY KEY,
        name TEXT, bank INTEGER,
        birth_gen INTEGER, death_gen INTEGER,
        last_fitness REAL, last_seen_ts INTEGER
      );

      CREATE TABLE IF NOT EXISTS ack_state (
        stream TEXT PRIMARY KEY,
        acked  INTEGER NOT NULL
      );
      INSERT OR IGNORE INTO ack_state(stream, acked) VALUES ('ev', 0), ('vit', 0);
    `);

    this.insEvent = this.db.prepare(`
      INSERT OR IGNORE INTO events
        (eseq, gen, kind, from_strip, to_strip, lineage_id, organism_id, fitness, text, rx_ts)
      VALUES (@eseq, @gen, @kind, @fromStrip, @toStrip, @lineageId, @organismId, @fitness, @text, @rxTs)
    `);
    this.insVitals = this.db.prepare(`
      INSERT OR IGNORE INTO vitals
        (vseq, gen, mass, activity, entropy, best_fitness, best_strip, coupling,
         organisms_alive, births, deaths, migrations, seam_crossings, online, rx_ts)
      VALUES (@vseq, @gen, @mass, @activity, @entropy, @bestFitness, @bestStrip, @coupling,
              @organisms, @births, @deaths, @migrations, @seamCrossings, @online, @rxTs)
    `);
    this.setAck = this.db.prepare(`UPDATE ack_state SET acked = @acked WHERE stream = @stream`);
  }

  private insEvent!: Database.Statement;
  private insVitals!: Database.Statement;
  private setAck!: Database.Statement;

  insertEvent(e: FossilEvent): void {
    this.insEvent.run({
      eseq: e.eseq,
      gen: e.gen,
      kind: e.kind,
      fromStrip: e.fromStrip,
      toStrip: e.toStrip,
      lineageId: e.lineageId,
      organismId: e.organismId,
      fitness: e.fitness,
      text: e.text ?? null,
      rxTs: Date.now(),
    });
    this.bumpAck("ev", e.eseq);
  }

  insertVitals(v: VitalsSnap): void {
    this.insVitals.run({
      vseq: v.vseq,
      gen: v.gen,
      mass: v.mass,
      activity: v.activity,
      entropy: v.entropy,
      bestFitness: v.bestFitness,
      bestStrip: v.bestStrip,
      coupling: v.coupling,
      organisms: v.organisms,
      births: v.births,
      deaths: v.deaths,
      migrations: v.migrations,
      seamCrossings: v.seamCrossings,
      online: v.online,
      rxTs: Date.now(),
    });
    this.bumpAck("vit", v.vseq);
  }

  // The highest *contiguous* seq is approximated by MAX(seq); since inserts are
  // idempotent and the master replays in order, MAX is a safe ack cursor.
  private bumpAck(stream: "ev" | "vit", seq: number): void {
    const cur = this.acks();
    const have = stream === "ev" ? cur.ev : cur.vit;
    if (seq > have) this.setAck.run({ stream, acked: seq });
  }

  // The master's durable spool was reset (e.g. a full environment reset with
  // clear-history, or a flash that wiped LittleFS): its seq counters restarted
  // below what we've archived. Our old archive belongs to a dead epoch and its
  // seqs now collide with the master's fresh ones (INSERT OR IGNORE would drop
  // every new event). Rebase: wipe the archive and re-anchor acks to what the
  // master currently holds so new low-seq events flow in cleanly.
  resetArchive(ev: number, vit: number): void {
    this.db.exec(`DELETE FROM events; DELETE FROM vitals; DELETE FROM organisms;`);
    this.setAck.run({ stream: "ev", acked: ev });
    this.setAck.run({ stream: "vit", acked: vit });
  }

  acks(): Acks {
    const rows = this.db.prepare(`SELECT stream, acked FROM ack_state`).all() as {
      stream: string;
      acked: number;
    }[];
    const out: Acks = { ev: 0, vit: 0 };
    for (const r of rows) {
      if (r.stream === "ev") out.ev = r.acked;
      else if (r.stream === "vit") out.vit = r.acked;
    }
    return out;
  }

  recentEvents(limit = 100): FossilEvent[] {
    const rows = this.db
      .prepare(`SELECT * FROM events ORDER BY eseq DESC LIMIT ?`)
      .all(limit) as Record<string, unknown>[];
    return rows.map(rowToEvent);
  }

  eventsRange(fromTs: number, toTs: number, kind?: string): FossilEvent[] {
    const rows = kind
      ? (this.db
          .prepare(`SELECT * FROM events WHERE rx_ts BETWEEN ? AND ? AND kind = ? ORDER BY eseq ASC`)
          .all(fromTs, toTs, kind) as Record<string, unknown>[])
      : (this.db
          .prepare(`SELECT * FROM events WHERE rx_ts BETWEEN ? AND ? ORDER BY eseq ASC`)
          .all(fromTs, toTs) as Record<string, unknown>[]);
    return rows.map(rowToEvent);
  }

  vitalsRange(fromTs: number, toTs: number): Record<string, unknown>[] {
    return this.db
      .prepare(`SELECT * FROM vitals WHERE rx_ts BETWEEN ? AND ? ORDER BY vseq ASC`)
      .all(fromTs, toTs) as Record<string, unknown>[];
  }

  organisms(): Record<string, unknown>[] {
    return this.db
      .prepare(`SELECT * FROM organisms ORDER BY last_seen_ts DESC`)
      .all() as Record<string, unknown>[];
  }

  // Latest per-strip fitness derived from the most recent vitals row's best
  // strip is not enough; the live per-strip bars come from the master live feed.
  // This helper just seeds empty bars for the initial snapshot.
  emptyStripFitness(): StripFitness[] {
    const out: StripFitness[] = [];
    for (let i = 0; i < 10; i++) out.push({ strip: i, bank: i < 5 ? 0 : 1, fitness: 0 });
    return out;
  }
}

function rowToEvent(r: Record<string, unknown>): FossilEvent {
  return {
    t: "event",
    eseq: r.eseq as number,
    gen: r.gen as number,
    kind: r.kind as FossilEvent["kind"],
    fromStrip: (r.from_strip as number) ?? -1,
    toStrip: (r.to_strip as number) ?? -1,
    lineageId: (r.lineage_id as number) ?? 0,
    organismId: (r.organism_id as number) ?? 0,
    fitness: (r.fitness as number) ?? 0,
    text: (r.text as string) ?? undefined,
  };
}
