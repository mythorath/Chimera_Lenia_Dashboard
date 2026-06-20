#!/usr/bin/env python3
"""
GPU dream renderer for Chimera Lenia (RTX 3080 Ti).

Pulls live 2-channel cluster fields (prey + predator) from the Selis hub WS,
runs a dual-channel Lenia on CUDA for continuous motion, shades with the same
bank/species palette as the LIVE dashboard, composites seam/strips/bloom on GPU,
and encodes HLS via NVENC for the CINEMA tab.
"""
from __future__ import annotations

import argparse
import os
import subprocess
import threading
import time
from datetime import datetime

import numpy as np
import torch
import torch.nn.functional as F
from websockets.sync.client import connect

FIELD_MAGIC = 0xCA


# --------------------------------------------------------------------------- #
# cluster field receiver
# --------------------------------------------------------------------------- #
class FieldReceiver:
    """Latest cluster prey + predator planes (numpy H x W, uint8)."""

    def __init__(self, url: str, fh: int = 200, fw: int = 64):
        self.url = url
        self.prey = np.zeros((fh, fw), dtype=np.uint8)
        self.pred = np.zeros((fh, fw), dtype=np.uint8)
        self.lock = threading.Lock()
        self.last_ts = 0.0
        self.online = False
        self.frames = 0
        threading.Thread(target=self._run, daemon=True).start()

    def _run(self) -> None:
        while True:
            try:
                with connect(self.url, max_size=None, open_timeout=5) as ws:
                    print(f"[dream] field WS connected: {self.url}", flush=True)
                    for msg in ws:
                        if not isinstance(msg, (bytes, bytearray)):
                            continue
                        if len(msg) < 4 or msg[0] != FIELD_MAGIC:
                            continue
                        w, h, nch = msg[1], msg[2], msg[3]
                        plane = w * h
                        if len(msg) < 4 + plane:
                            continue
                        o0 = 4
                        prey = np.frombuffer(msg[o0 : o0 + plane], dtype=np.uint8).reshape(h, w)
                        if nch >= 2 and len(msg) >= 4 + plane * 2:
                            pred = np.frombuffer(
                                msg[o0 + plane : o0 + plane * 2], dtype=np.uint8
                            ).reshape(h, w)
                        else:
                            pred = np.zeros((h, w), dtype=np.uint8)
                        with self.lock:
                            self.prey = prey.copy()
                            self.pred = pred.copy()
                            self.last_ts = time.time()
                            self.online = True
                            self.frames += 1
            except Exception as e:  # noqa: BLE001
                self.online = False
                print(f"[dream] field WS reconnect ({e})", flush=True)
                time.sleep(2)

    def get(self) -> tuple[np.ndarray, np.ndarray]:
        with self.lock:
            return self.prey.copy(), self.pred.copy()


# --------------------------------------------------------------------------- #
# dual-channel Lenia on GPU
# --------------------------------------------------------------------------- #
class DualLenia:
    """Two coupled species fields stepped with FFT convolution on CUDA."""

    def __init__(self, h: int, w: int, R: float, mu: float, sigma: float, T: float, device: torch.device):
        self.h, self.w = h, w
        self.mu, self.sigma = mu, sigma
        self.T = T
        self.device = device
        seed = torch.rand(2, h, w, device=device)
        self.A = (seed < 0.22).float() * torch.rand(2, h, w, device=device)
        self.Kfft = self._ring_kernel(h, w, R).to(device)

    @staticmethod
    def _ring_kernel(h: int, w: int, R: float) -> torch.Tensor:
        ys = torch.arange(h, dtype=torch.float32).reshape(h, 1) - h // 2
        xs = torch.arange(w, dtype=torch.float32).reshape(1, w) - w // 2
        r = torch.sqrt(ys * ys + xs * xs) / R
        shell = torch.exp(-((r - 0.5) ** 2) / (2.0 * 0.15**2))
        shell = torch.where(r > 1.0, torch.zeros_like(shell), shell)
        shell = shell / shell.sum()
        return torch.fft.rfft2(torch.fft.ifftshift(shell))

    @staticmethod
    def _growth(u: torch.Tensor, mu: float, sigma: float) -> torch.Tensor:
        return 2.0 * torch.exp(-((u - mu) ** 2) / (2.0 * sigma * sigma)) - 1.0

    @staticmethod
    def _presence(other: torch.Tensor) -> torch.Tensor:
        return torch.exp(-((other - 0.20) ** 2) / (2.0 * 0.05**2))

    def step(
        self,
        force_prey: torch.Tensor,
        force_pred: torch.Tensor,
        blend: float,
    ) -> tuple[torch.Tensor, torch.Tensor]:
        inv_t = 1.0 / self.T
        w_prey, w_pred = -0.28, 0.34

        for ch in range(2):
            u = torch.fft.irfft2(torch.fft.rfft2(self.A[ch]) * self.Kfft, s=(self.h, self.w))
            self_g = self._growth(u, self.mu, self.sigma)
            other = self.A[1 - ch]
            cross = w_prey if ch == 0 else w_pred
            self.A[ch] = torch.clamp(self.A[ch] + inv_t * (self_g + cross * self._presence(other)), 0.0, 1.0)

        if blend > 0.0:
            b = blend
            self.A[0] = torch.lerp(self.A[0], force_prey, b * 0.42)
            self.A[1] = torch.lerp(self.A[1], force_pred, b * 0.42)
            self.A[0] = torch.maximum(self.A[0], force_prey * b * 0.72)
            self.A[1] = torch.maximum(self.A[1], force_pred * b * 0.72)

        return self.A[0], self.A[1]


# --------------------------------------------------------------------------- #
# GPU shade + composite (matches LIVE dashboard palette)
# --------------------------------------------------------------------------- #
class DreamRenderer:
    """Bank/species shading, motion trails, seam, strip grid, subtle bloom — all on GPU."""

    def __init__(self, h: int, w: int, device: torch.device, *, landscape: bool = True):
        self.h, self.w = h, w
        self.device = device
        self.landscape = landscape
        self.prev = torch.zeros(h, w, 3, device=device)
        self.decay = 0.87

        if landscape:
            # Bank A left, Bank B right (CINEMA widescreen layout)
            x = torch.linspace(0.0, 1.0, w, device=device).reshape(1, w).expand(h, w)
            self.bank_a = (x < 0.5).float().unsqueeze(-1)
        else:
            y = torch.linspace(0.0, 1.0, h, device=device).reshape(h, 1).expand(h, w)
            self.bank_a = (y < 0.5).float().unsqueeze(-1)

        # separable blur kernel for bloom
        rad = 4
        x = torch.arange(-rad, rad + 1, device=device, dtype=torch.float32)
        k1d = torch.exp(-(x**2) / (2.0 * 2.5**2))
        k1d = (k1d / k1d.sum()).reshape(1, 1, 1, -1)
        self.blur_h = k1d
        self.blur_v = k1d.transpose(-1, -2)

    @staticmethod
    def _aces(x: torch.Tensor) -> torch.Tensor:
        a, b, c, d, e = 2.51, 0.03, 2.43, 0.59, 0.14
        return torch.clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0)

    def _blur(self, img: torch.Tensor) -> torch.Tensor:
        t = img.permute(2, 0, 1).unsqueeze(0)
        t = F.conv2d(t, self.blur_h.expand(3, 1, 1, -1), padding=(0, self.blur_h.shape[-1] // 2), groups=3)
        t = F.conv2d(t, self.blur_v.expand(3, 1, -1, 1), padding=(self.blur_v.shape[-2] // 2, 0), groups=3)
        return t.squeeze(0).permute(1, 2, 0)

    def shade(self, prey: torch.Tensor, pred: torch.Tensor) -> torch.Tensor:
        """prey, pred: (H,W) float in [0,1] -> RGB (H,W,3)."""
        ba = self.bank_a
        bb = 1.0 - ba

        p_amt = torch.clamp((prey - 0.025) / 0.525, 0.0, 1.0)
        d_amt = torch.clamp((pred - 0.035) / 0.465, 0.0, 1.0)
        p_pow = torch.pow(p_amt, 0.65)
        d_pow = torch.pow(d_amt, 0.70)

        bg_a = torch.tensor([0.018, 0.032, 0.028], device=self.device)
        bg_b = torch.tensor([0.028, 0.018, 0.038], device=self.device)
        bg = bg_a * ba + bg_b * bb

        prey_lo_a = torch.tensor([0.06, 0.22, 0.18], device=self.device)
        prey_hi_a = torch.tensor([0.15, 0.82, 0.58], device=self.device)
        prey_lo_b = torch.tensor([0.18, 0.08, 0.28], device=self.device)
        prey_hi_b = torch.tensor([0.72, 0.28, 0.88], device=self.device)
        prey_lo = prey_lo_a * ba + prey_lo_b * bb
        prey_hi = prey_hi_a * ba + prey_hi_b * bb
        prey_col = prey_lo * (1.0 - p_pow.unsqueeze(-1)) + prey_hi * p_pow.unsqueeze(-1)

        pred_lo_a = torch.tensor([0.12, 0.05, 0.02], device=self.device)
        pred_hi_a = torch.tensor([0.95, 0.42, 0.08], device=self.device)
        pred_lo_b = torch.tensor([0.02, 0.10, 0.14], device=self.device)
        pred_hi_b = torch.tensor([0.12, 0.72, 0.92], device=self.device)
        pred_lo = pred_lo_a * ba + pred_lo_b * bb
        pred_hi = pred_hi_a * ba + pred_hi_b * bb
        pred_col = pred_lo * (1.0 - d_pow.unsqueeze(-1)) + pred_hi * d_pow.unsqueeze(-1)

        col = bg
        col = col * (1.0 - p_amt.unsqueeze(-1) * 0.92) + prey_col * (p_amt.unsqueeze(-1) * 0.92)
        col = col * (1.0 - d_amt.unsqueeze(-1) * 0.88) + pred_col * (d_amt.unsqueeze(-1) * 0.88)

        overlap = torch.minimum(p_amt, d_amt)
        both_a = torch.tensor([0.88, 0.62, 0.22], device=self.device)
        both_b = torch.tensor([0.55, 0.45, 0.95], device=self.device)
        both = both_a * ba + both_b * bb
        omask = torch.clamp((overlap - 0.08) / 0.5, 0.0, 1.0) * 0.55
        col = col * (1.0 - omask.unsqueeze(-1)) + both * omask.unsqueeze(-1)

        # motion trail (matches LIVE mix-based echo)
        live = torch.maximum(p_amt, d_amt)
        keep = 0.55 + 0.45 * live
        col = self.prev * self.decay * (1.0 - keep.unsqueeze(-1) * 0.45) + col * keep.unsqueeze(-1)
        self.prev = col.detach()

        return col

    def composite(self, rgb: torch.Tensor, t: float) -> torch.Tensor:
        H, W, _ = rgb.shape

        if self.landscape:
            # vertical seam between instinct (left) and memory (right)
            x = torch.linspace(0.0, 1.0, W, device=self.device).reshape(1, W).expand(H, W)
            seam_d = torch.abs(x - 0.5)
            seam = torch.clamp(1.0 - seam_d / 0.003, 0.0, 1.0)
            # 5 strip bands per bank — vertical dividers after panel CCW rotation
            x_local = torch.where(x < 0.5, x * 2.0, (x - 0.5) * 2.0)
            strip = x_local * 5.0
        else:
            y = torch.linspace(0.0, 1.0, H, device=self.device).reshape(H, 1).expand(H, W)
            seam_d = torch.abs(y - 0.5)
            seam = torch.clamp(1.0 - seam_d / 0.004, 0.0, 1.0)
            strip = y * 10.0

        seam_rgb = torch.tensor([0.95, 0.62, 0.18], device=self.device)
        rgb = rgb * (1.0 - seam.unsqueeze(-1) * 0.55) + seam_rgb * (seam.unsqueeze(-1) * 0.55)

        frac = strip - torch.floor(strip)
        edge = torch.clamp(1.0 - frac / 0.012, 0.0, 1.0) + torch.clamp((frac - 0.988) / 0.012, 0.0, 1.0)
        rgb = rgb * (1.0 - edge.unsqueeze(-1) * 0.10)

        # subtle bloom on bright cores only
        lum = rgb[..., 0] * 0.299 + rgb[..., 1] * 0.587 + rgb[..., 2] * 0.114
        bright = torch.clamp(lum - 0.55, min=0.0).unsqueeze(-1).expand_as(rgb)
        glow = self._blur(bright * rgb) * 0.22
        rgb = rgb + glow

        # light vignette
        v = torch.linspace(-1.0, 1.0, W, device=self.device)
        u = torch.linspace(-1.0, 1.0, H, device=self.device)
        qx = v.reshape(1, W).expand(H, W)
        qy = u.reshape(H, 1).expand(H, W)
        aspect = W / max(H, 1)
        dist = torch.sqrt((qx * aspect) ** 2 + qy**2)
        vig = torch.clamp((1.05 - dist) / 0.65, 0.82, 1.0)
        rgb = rgb * vig.unsqueeze(-1)

        rgb = self._aces(rgb * 1.06)
        _ = t  # reserved for future animated accents
        return rgb


# --------------------------------------------------------------------------- #
# ffmpeg NVENC -> HLS
# --------------------------------------------------------------------------- #
def start_ffmpeg(w: int, h: int, fps: int, bitrate: str, hls_dir: str, record_path: str | None):
    os.makedirs(hls_dir, exist_ok=True)
    playlist = os.path.join(hls_dir, "stream.m3u8")
    seg = os.path.join(hls_dir, "seg_%05d.ts")
    inp = [
        "ffmpeg", "-hide_banner", "-loglevel", "warning", "-y",
        "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{w}x{h}", "-r", str(fps), "-i", "-",
    ]
    venc = [
        "-c:v", "h264_nvenc", "-preset", "p4", "-tune", "hq",
        "-b:v", bitrate, "-maxrate", bitrate, "-bufsize", bitrate,
        "-pix_fmt", "yuv420p", "-g", str(fps * 2),
    ]
    hls = [
        "-f", "hls", "-hls_time", "1", "-hls_list_size", "8",
        "-hls_flags", "delete_segments+append_list+omit_endlist",
        "-hls_segment_filename", seg, playlist,
    ]
    if record_path:
        cmd = inp + venc + [
            "-f", "tee", "-map", "0:v",
            f"[f=hls:hls_time=1:hls_list_size=8:hls_flags=delete_segments+append_list+omit_endlist:"
            f"hls_segment_filename={seg}]{playlist}|"
            f"[f=mp4:movflags=+frag_keyframe+empty_moov+default_base_moof]{record_path}",
        ]
    else:
        cmd = inp + venc + hls
    print("[dream] ffmpeg:", " ".join(cmd), flush=True)
    return subprocess.Popen(cmd, stdin=subprocess.PIPE)


def cluster_to_landscape(
    prey: torch.Tensor,
    pred: torch.Tensor,
    out_h: int,
    out_w: int,
) -> tuple[torch.Tensor, torch.Tensor]:
    """
    Cluster portrait (200×64) -> widescreen dream frame.
    Bank A left, Bank B right; each panel rotated 90° CCW so strips read
    horizontally (matching the torus running left-right on screen).
    prey/pred shape: (200, 64)
    Output shape: (out_h, out_w)
    """
    half_w = out_w // 2
    # Before CCW rot each panel is (pre_h, pre_w); after rot becomes (out_h, half_w)
    pre_h, pre_w = half_w, out_h

    a_prey, b_prey = prey[:100], prey[100:]
    a_pred, b_pred = pred[:100], pred[100:]

    def up(ch: torch.Tensor) -> torch.Tensor:
        return F.interpolate(
            ch.reshape(1, 1, *ch.shape),
            size=(pre_h, pre_w),
            mode="bilinear",
            align_corners=False,
        ).reshape(pre_h, pre_w)

    def panel(ch: torch.Tensor) -> torch.Tensor:
        return torch.rot90(up(ch), k=1, dims=(0, 1))  # CCW 90°

    fp = torch.cat([panel(a_prey), panel(b_prey)], dim=1)
    fd = torch.cat([panel(a_pred), panel(b_pred)], dim=1)
    return fp, fd


# --------------------------------------------------------------------------- #
def main() -> None:
    ap = argparse.ArgumentParser(description="Chimera Lenia GPU dream renderer")
    ap.add_argument("--width", type=int, default=1920, help="output width (16:9 landscape)")
    ap.add_argument("--height", type=int, default=1080, help="output height (16:9 landscape)")
    ap.add_argument("--fps", type=int, default=30)
    ap.add_argument("--bitrate", default="16M")
    ap.add_argument("--hls-dir", default="/home/selis/Chimera_Lenia_Server/server/data/hls")
    ap.add_argument("--record-dir", default="/home/selis/Chimera_Lenia_Server/server/data/recordings")
    ap.add_argument("--record", action="store_true")
    ap.add_argument("--ws", default="ws://127.0.0.1:8080/ws")
    ap.add_argument("--R", type=float, default=20.0)
    ap.add_argument("--mu", type=float, default=0.15)
    ap.add_argument("--sigma", type=float, default=0.026)
    ap.add_argument("--T", type=float, default=5.5)
    ap.add_argument("--inj", type=float, default=0.78, help="cluster steering strength 0..1")
    ap.add_argument("--substeps", type=int, default=3)
    args = ap.parse_args()

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    gpu_name = torch.cuda.get_device_name(0) if device.type == "cuda" else "cpu"
    print(f"[dream] device={device} {gpu_name} {args.width}x{args.height}@{args.fps}", flush=True)

    H, W = args.height, args.width
    recv = FieldReceiver(args.ws)
    lenia = DualLenia(H, W, args.R, args.mu, args.sigma, args.T, device)
    renderer = DreamRenderer(H, W, device, landscape=True)

    record_path = None
    if args.record:
        os.makedirs(args.record_dir, exist_ok=True)
        stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
        record_path = os.path.join(args.record_dir, f"dream-{stamp}.mp4")
        print(f"[dream] recording -> {record_path}", flush=True)

    proc = start_ffmpeg(W, H, args.fps, args.bitrate, args.hls_dir, record_path)

    dt = 1.0 / args.fps
    next_t = time.perf_counter()
    frame = 0
    t0 = time.time()

    try:
        with torch.inference_mode():
            while True:
                prey_np, pred_np = recv.get()
                prey_t = torch.from_numpy(prey_np).to(device=device, dtype=torch.float32) / 255.0
                pred_t = torch.from_numpy(pred_np).to(device=device, dtype=torch.float32) / 255.0
                fp, fd = cluster_to_landscape(prey_t, pred_t, H, W)

                p, d = fp, fd
                for _ in range(args.substeps):
                    p, d = lenia.step(fp, fd, args.inj)

                t_sec = frame / args.fps
                rgb = renderer.shade(p, d)
                rgb = renderer.composite(rgb, t_sec)
                out = (rgb.clamp(0, 1) * 255.0).to(torch.uint8).contiguous().cpu().numpy()

                try:
                    proc.stdin.write(out.tobytes())
                except (BrokenPipeError, ValueError, OSError):
                    print("[dream] ffmpeg pipe closed, exiting", flush=True)
                    break

                frame += 1
                if frame % (args.fps * 5) == 0:
                    fps_eff = frame / (time.time() - t0)
                    print(
                        f"[dream] frame={frame} eff_fps={fps_eff:.1f} "
                        f"cluster={recv.online} ws_frames={recv.frames} "
                        f"prey={float(p.mean()):.3f} pred={float(d.mean()):.3f}",
                        flush=True,
                    )

                next_t += dt
                sleep = next_t - time.perf_counter()
                if sleep > 0:
                    time.sleep(sleep)
                else:
                    next_t = time.perf_counter()
    except KeyboardInterrupt:
        pass
    finally:
        if proc.stdin:
            proc.stdin.close()
        proc.wait()


if __name__ == "__main__":
    main()
