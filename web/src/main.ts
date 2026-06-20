// main.ts - wires the dashboard together: connect to the Selis hub, render the
// field (WebGL2 with a 2D fallback), world vitals, fitness landscape, and the
// fossil-record event feed, and surface both connection states (browser<->server
// and cluster<->server).
import { FieldView } from "./field";
import { GLFieldRenderer } from "./gl/renderer";
import { VitalsView } from "./vitals";
import { EventLog } from "./events";
import { Cinema } from "./cinema";
import { aboutHtml } from "./about";
import { legendHtml } from "./legend";
import { connectHub, getJSON } from "./api";
import { StageViewport } from "./viewport";
import type { HubMessage, FossilEvent } from "./protocol";

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

// Prefer the WebGL2 renderer (trails + bloom); fall back to the plain 2D canvas.
const canvas = $<HTMLCanvasElement>("field");
let glRenderer: GLFieldRenderer | null = null;
let drawField: (buf: Uint8Array) => void = () => {};
try {
  const gl = new GLFieldRenderer(canvas);
  glRenderer = gl;
  drawField = (buf) => gl.ingestFrame(buf);
} catch (e) {
  console.warn("WebGL2 renderer unavailable, using 2D fallback:", e);
  const fv = new FieldView(canvas);
  drawField = (buf) => fv.drawFrame(buf);
}

const vitals = new VitalsView($("vitals"), $("bars"));
const log = new EventLog($("log"));

// ---- view toggle: LIVE (WebGL field) vs CINEMA (GPU dream HLS stream) ----
const video = $<HTMLVideoElement>("cinema");
const note = $("cinemaNote");
let cinemaState: "live" | "offline" | "loading" = "live";
const cinema = new Cinema(video, (s) => {
  cinemaState = s;
  const inCinema = document.body.classList.contains("view-cinema");
  note.hidden = !inCinema || s === "live";
  note.textContent =
    s === "loading" ? "connecting to dream stream\u2026" : "cinema stream offline \u2014 start the dream renderer on Selis";
});

const stageViewport = new StageViewport($("stageFrame"), $("stageViewport"), $("stageReset"));

function setView(v: "live" | "cinema"): void {
  const live = v === "live";
  document.body.classList.toggle("view-cinema", !live);
  canvas.hidden = !live;
  video.hidden = live;
  note.hidden = live || cinemaState === "live";
  if (live) cinema.stop();
  else cinema.start();
  stageViewport.reset();
  if (!live) {
    $("stageViewport").style.transform = "none";
  }
  for (const btn of document.querySelectorAll<HTMLButtonElement>("#viewToggle button")) {
    btn.classList.toggle("active", btn.dataset.view === v);
  }
}
for (const btn of document.querySelectorAll<HTMLButtonElement>("#viewToggle button")) {
  btn.addEventListener("click", () => setView(btn.dataset.view === "cinema" ? "cinema" : "live"));
}

// ---- Field legend + About overlays ----
const legend = $("legend");
legend.querySelector(".legend-body")!.innerHTML = legendHtml();
const showLegend = (show: boolean): void => {
  legend.hidden = !show;
};

const about = $("about");
about.querySelector(".about-body")!.innerHTML = aboutHtml();
const showAbout = (show: boolean): void => {
  about.hidden = !show;
};

$("legendBtn").addEventListener("click", () => showLegend(true));
legend.addEventListener("click", (e) => {
  const t = e.target as HTMLElement;
  if (t === legend || t.classList.contains("legend-close")) showLegend(false);
});
$("aboutBtn").addEventListener("click", () => showAbout(true));
about.addEventListener("click", (e) => {
  const t = e.target as HTMLElement;
  if (t === about || t.classList.contains("about-close")) showAbout(false);
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    showLegend(false);
    showAbout(false);
  }
});

const connBadge = $("conn");
const clusterBadge = $("cluster");

function setBadge(el: HTMLElement, ok: boolean, text: string): void {
  el.textContent = text;
  el.className = `badge ${ok ? "ok" : "no"}`;
}

function handleMessage(msg: HubMessage): void {
  switch (msg.t) {
    case "snapshot":
      setBadge(clusterBadge, msg.clusterOnline, `cluster: ${msg.clusterOnline ? "online" : "offline"}`);
      if (msg.vitals) vitals.update(msg.vitals);
      if (msg.strips?.length) vitals.updateBars(msg.strips);
      if (msg.events.length) log.seed(msg.events);
      break;
    case "vitals":
      vitals.update(msg);
      break;
    case "event":
      log.add(msg);
      glRenderer?.pulse(msg.fromStrip, msg.fromStrip < 5 ? 1 : 0);
      break;
    case "cluster":
      setBadge(clusterBadge, msg.online, `cluster: ${msg.online ? "online" : "offline"}`);
      break;
    default: {
      const _exhaustive: never = msg;
      void _exhaustive;
    }
  }
}

connectHub({
  onField: (buf) => drawField(buf),
  onMessage: handleMessage,
  onOpen: () => {
    setBadge(connBadge, true, "server: live");
    void getJSON<FossilEvent[]>("/api/events/recent?limit=80")
      .then((events) => {
        if (events.length) log.seed(events);
      })
      .catch(() => {});
  },
  onClose: () => {
    setBadge(connBadge, false, "server: reconnecting");
    setBadge(clusterBadge, false, "cluster: offline");
  },
});
