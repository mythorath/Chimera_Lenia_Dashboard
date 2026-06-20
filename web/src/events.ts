// events.ts - the fossil-record / event feed (newest first).
import type { FossilEvent } from "./protocol";

const KIND_CLASS: Record<string, string> = {
  birth: "bankA",
  death: "bankB",
  colonize: "bankA",
  migration: "bankB",
  mutate: "",
  wildcard: "",
};

export class EventLog {
  constructor(
    private el: HTMLElement,
    private max = 150,
  ) {}

  seed(events: FossilEvent[]): void {
    this.el.innerHTML = "";
    // events arrive newest-first; append in that order
    for (const e of events) this.el.append(this.row(e));
  }

  add(e: FossilEvent): void {
    this.el.prepend(this.row(e));
    while (this.el.childNodes.length > this.max) this.el.lastChild?.remove();
  }

  // Ephemeral ticker line (narrator / system / birth / death text from the
  // master's live "log" feed). Lighter weight than a durable fossil row.
  addLog(type: string, text: string): void {
    const d = document.createElement("div");
    d.className = `ev ev-log ev-${type}`;
    d.innerHTML = `<span class="k">[live]</span> <span class="${KIND_CLASS[type] ?? ""}">${escapeHtml(
      type,
    )}</span> ${escapeHtml(text)}`;
    this.el.prepend(d);
    while (this.el.childNodes.length > this.max) this.el.lastChild?.remove();
  }

  private row(e: FossilEvent): HTMLElement {
    const d = document.createElement("div");
    d.className = `ev ev-${e.kind}`;
    const cls = KIND_CLASS[e.kind] ?? "";
    const text = e.text ?? `${e.kind} ${e.fromStrip}\u2192${e.toStrip}`;
    d.innerHTML = `<span class="k">[g${e.gen}]</span> <span class="${cls}">${e.kind}</span> ${escapeHtml(
      text,
    )}`;
    return d;
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>]/g, (c) => (c === "&" ? "&amp;" : c === "<" ? "&lt;" : "&gt;"));
}
