// api.ts - browser connection to the Selis hub. Uses same-origin /ws (Vite
// proxies it to the Node server in dev, served directly in prod), auto-reconnects,
// and dispatches typed hub messages + binary field frames to callbacks.
import type { HubMessage } from "./protocol";

export interface HubHandlers {
  onField: (buf: Uint8Array) => void;
  onMessage: (msg: HubMessage) => void;
  onOpen: () => void;
  onClose: () => void;
}

export function connectHub(handlers: HubHandlers): void {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const url = `${proto}://${location.host}/ws`;

  const open = () => {
    const ws = new WebSocket(url);
    ws.binaryType = "arraybuffer";
    ws.onopen = () => handlers.onOpen();
    ws.onclose = () => {
      handlers.onClose();
      setTimeout(open, 1500);
    };
    ws.onerror = () => ws.close();
    ws.onmessage = (ev) => {
      if (ev.data instanceof ArrayBuffer) {
        handlers.onField(new Uint8Array(ev.data));
        return;
      }
      try {
        handlers.onMessage(JSON.parse(ev.data as string) as HubMessage);
      } catch {
        /* ignore malformed */
      }
    };
  };
  open();
}

export async function getJSON<T>(path: string): Promise<T> {
  const r = await fetch(path);
  if (!r.ok) throw new Error(`${path}: ${r.status}`);
  return (await r.json()) as T;
}

export async function postJSON<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`${path}: ${r.status}`);
  return (await r.json()) as T;
}
