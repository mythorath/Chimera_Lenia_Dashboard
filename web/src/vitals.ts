// vitals.ts - renders the world-vitals grid and the per-strip fitness landscape.
import type { LiveVitals, StripFitness } from "./protocol";
import { N_STRIPS } from "./protocol";

const VITAL_FIELDS: { id: string; label: string; fmt?: (v: LiveVitals) => string }[] = [
  { id: "gen", label: "gen", fmt: (v) => String(v.gen) },
  { id: "online", label: "nodes", fmt: (v) => `${v.online}/${N_STRIPS}` },
  { id: "mass", label: "mass", fmt: (v) => v.mass.toFixed(3) },
  { id: "entropy", label: "entropy", fmt: (v) => v.entropy.toFixed(3) },
  { id: "bestFitness", label: "best fit", fmt: (v) => v.bestFitness.toFixed(2) },
  { id: "coupling", label: "coupling", fmt: (v) => v.coupling.toFixed(2) },
  {
    id: "species",
    label: "predator",
    fmt: (v) =>
      v.mass1 !== undefined && v.mass > 1e-6
        ? `${Math.round((100 * v.mass1) / v.mass)}%`
        : "-",
  },
  { id: "organisms", label: "organisms", fmt: (v) => String(v.organisms) },
  { id: "births", label: "births", fmt: (v) => String(v.births) },
  { id: "migrations", label: "migrations", fmt: (v) => String(v.migrations) },
  { id: "seamCrossings", label: "seam xings", fmt: (v) => String(v.seamCrossings) },
];

export class VitalsView {
  private cells = new Map<string, HTMLElement>();

  constructor(
    private vitalsEl: HTMLElement,
    private barsEl: HTMLElement,
  ) {
    for (const f of VITAL_FIELDS) {
      const wrap = document.createElement("div");
      wrap.className = "stat";
      const b = document.createElement("b");
      b.textContent = "-";
      wrap.append(`${f.label} `, b);
      this.vitalsEl.append(wrap);
      this.cells.set(f.id, b);
    }
    this.buildBars();
  }

  private buildBars(): void {
    this.barsEl.innerHTML = "";
    for (let i = 0; i < N_STRIPS; i++) {
      const bankA = i < N_STRIPS / 2;
      const row = document.createElement("div");
      row.className = `bar ${bankA ? "bankA" : "bankB"}`;
      row.innerHTML =
        `<span class="lab ${bankA ? "bankA" : "bankB"}">${bankA ? "A" : "B"}${i % 5}</span>` +
        `<span class="track"><span class="fill" id="f${i}" style="width:0%"></span></span>`;
      this.barsEl.append(row);
    }
  }

  update(v: LiveVitals): void {
    for (const f of VITAL_FIELDS) {
      const el = this.cells.get(f.id);
      if (el && f.fmt) el.textContent = f.fmt(v);
    }
    if (v.strips) this.updateBars(v.strips);
  }

  updateBars(strips: StripFitness[]): void {
    let max = 0.001;
    for (const s of strips) max = Math.max(max, s.fitness || 0);
    for (const s of strips) {
      const f = document.getElementById(`f${s.strip}`);
      if (f) f.style.width = `${Math.min(100, (100 * (s.fitness || 0)) / max)}%`;
    }
  }
}
