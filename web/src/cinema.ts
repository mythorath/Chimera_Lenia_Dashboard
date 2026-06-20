// cinema.ts - plays the GPU "dream" HLS stream (NVENC, from Selis) into a <video>.
// Uses hls.js where MSE is needed, or native HLS (Safari). Lazily attached the
// first time Cinema mode is shown; surfaces an offline note if no stream yet.
import Hls from "hls.js";

const SRC = "/cinema/stream.m3u8";

export class Cinema {
  private started = false;

  constructor(
    private video: HTMLVideoElement,
    private onState: (s: "live" | "offline" | "loading") => void,
  ) {}

  start(): void {
    if (this.started) {
      void this.video.play().catch(() => {});
      return;
    }
    this.started = true;
    this.onState("loading");

    if (Hls.isSupported()) {
      const hls = new Hls({ liveSyncDuration: 2, lowLatencyMode: true, backBufferLength: 10 });
      hls.loadSource(SRC);
      hls.attachMedia(this.video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        this.onState("live");
        void this.video.play().catch(() => {});
      });
      hls.on(Hls.Events.ERROR, (_e, data) => {
        if (data.fatal) {
          this.onState("offline");
          // retry network errors after a beat (stream may not be up yet)
          if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
            setTimeout(() => hls.loadSource(SRC), 3000);
          }
        }
      });
    } else if (this.video.canPlayType("application/vnd.apple.mpegurl")) {
      this.video.src = SRC;
      this.video.addEventListener("loadedmetadata", () => {
        this.onState("live");
        void this.video.play().catch(() => {});
      });
      this.video.addEventListener("error", () => this.onState("offline"));
    } else {
      this.onState("offline");
    }
  }

  stop(): void {
    this.video.pause();
  }
}
