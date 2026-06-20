// renderer.ts - WebGL2 field renderer with decaying motion trails + bloom.
// Runs its own requestAnimationFrame loop so trails animate smoothly between
// the (slower) cluster field updates. setField() just refreshes the source
// texture; the loop handles decay/bloom/composite every frame.
import { VERT, FRAG_SCENE, FRAG_BRIGHT, FRAG_BLUR, FRAG_COMPOSITE } from "./shaders";

const TRAIL_W = 256;
const TRAIL_H = 800;
const BLOOM_W = 128;
const BLOOM_H = 400;

interface Target {
  tex: WebGLTexture;
  fbo: WebGLFramebuffer;
  w: number;
  h: number;
}

export class GLFieldRenderer {
  private gl: WebGL2RenderingContext;
  private progScene: WebGLProgram;
  private progBright: WebGLProgram;
  private progBlur: WebGLProgram;
  private progComposite: WebGLProgram;
  private vao: WebGLVertexArrayObject;

  private fieldTex: WebGLTexture;
  private fieldW = 64;
  private fieldH = 200;

  private trailA: Target;
  private trailB: Target;
  private bright: Target;
  private blurA: Target;
  private blurB: Target;

  private floatOk: boolean;
  private running = true;
  private decay = 0.86;
  private bloomI = 0.32;

  private pulses: { y: number; t0: number; bank: number }[] = [];
  private readonly PULSE_MS = 1500;

  constructor(private canvas: HTMLCanvasElement) {
    const gl = canvas.getContext("webgl2", { antialias: false, alpha: false });
    if (!gl) throw new Error("WebGL2 unavailable");
    this.gl = gl;

    this.floatOk = !!gl.getExtension("EXT_color_buffer_float");

    this.progScene = this.program(VERT, FRAG_SCENE);
    this.progBright = this.program(VERT, FRAG_BRIGHT);
    this.progBlur = this.program(VERT, FRAG_BLUR);
    this.progComposite = this.program(VERT, FRAG_COMPOSITE);
    this.vao = gl.createVertexArray()!; // empty VAO; geometry from gl_VertexID

    // RG8: R = species 0 (prey), G = species 1 (predator)
    this.fieldTex = this.makeTex(this.fieldW, this.fieldH, gl.RG8, gl.RG, gl.UNSIGNED_BYTE, gl.NEAREST);
    this.trailA = this.makeTarget(TRAIL_W, TRAIL_H);
    this.trailB = this.makeTarget(TRAIL_W, TRAIL_H);
    this.bright = this.makeTarget(BLOOM_W, BLOOM_H);
    this.blurA = this.makeTarget(BLOOM_W, BLOOM_H);
    this.blurB = this.makeTarget(BLOOM_W, BLOOM_H);

    this.clearTarget(this.trailA);
    this.clearTarget(this.trailB);

    this.resize();
    window.addEventListener("resize", () => this.resize());
    requestAnimationFrame(this.loop);
  }

  // ---- public API ----
  // Frame: [0xCA][w][h][nch][nch planes, channel-major]. Interleave the first
  // two species planes into RG for the texture (R=prey, G=predator).
  ingestFrame(buf: Uint8Array): void {
    if (buf.length < 4 || buf[0] !== 0xca) return;
    const w = buf[1];
    const h = buf[2];
    const nch = buf[3];
    const plane = w * h;
    if (buf.length < 4 + plane * nch) return;
    const rg = new Uint8Array(plane * 2);
    const o0 = 4;
    const o1 = 4 + plane;
    for (let i = 0; i < plane; i++) {
      rg[2 * i] = buf[o0 + i];
      rg[2 * i + 1] = nch >= 2 ? buf[o1 + i] : 0;
    }
    this.setField(rg, w, h);
  }

  // cells: interleaved RG, length 2*w*h.
  setField(cells: Uint8Array, w: number, h: number): void {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.fieldTex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    if (w !== this.fieldW || h !== this.fieldH) {
      this.fieldW = w;
      this.fieldH = h;
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG8, w, h, 0, gl.RG, gl.UNSIGNED_BYTE, cells);
    } else {
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, w, h, gl.RG, gl.UNSIGNED_BYTE, cells);
    }
  }

  setStyle(opts: { decay?: number; bloom?: number }): void {
    if (opts.decay !== undefined) this.decay = opts.decay;
    if (opts.bloom !== undefined) this.bloomI = opts.bloom;
  }

  // Emit an expanding ring at the strip an event originated from.
  pulse(strip: number, bank: number): void {
    const y = (strip + 0.5) / 10; // field-v center of the strip
    this.pulses.push({ y, t0: performance.now(), bank });
    if (this.pulses.length > 8) this.pulses.shift();
  }

  dispose(): void {
    this.running = false;
  }

  // ---- internals ----
  private resize(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = this.canvas.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width * dpr));
    const h = Math.max(1, Math.round(rect.height * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
  }

  private loop = (): void => {
    if (!this.running) return;
    this.render();
    requestAnimationFrame(this.loop);
  };

  private render(): void {
    const gl = this.gl;
    gl.bindVertexArray(this.vao);
    gl.disable(gl.BLEND);

    // 1) scene/trail: read field + prev trail (trailA) -> write trailB
    gl.useProgram(this.progScene);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.trailB.fbo);
    gl.viewport(0, 0, TRAIL_W, TRAIL_H);
    this.bindTex(this.progScene, "uField", 0, this.fieldTex);
    this.bindTex(this.progScene, "uPrev", 1, this.trailA.tex);
    gl.uniform1f(this.uloc(this.progScene, "uDecay"), this.decay);
    gl.uniform1f(this.uloc(this.progScene, "uSeam"), 0.5);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // 2) bright extract from trailB -> bright
    gl.useProgram(this.progBright);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.bright.fbo);
    gl.viewport(0, 0, BLOOM_W, BLOOM_H);
    this.bindTex(this.progBright, "uTex", 0, this.trailB.tex);
    gl.uniform1f(this.uloc(this.progBright, "uThresh"), 0.68);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // 3) blur ping-pong (2 passes)
    let src = this.bright;
    for (let i = 0; i < 2; i++) {
      this.blurPass(src, this.blurA, [1 / BLOOM_W, 0]);
      this.blurPass(this.blurA, this.blurB, [0, 1 / BLOOM_H]);
      src = this.blurB;
    }

    // 4) composite trailB + bloom -> screen
    gl.useProgram(this.progComposite);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    this.bindTex(this.progComposite, "uScene", 0, this.trailB.tex);
    this.bindTex(this.progComposite, "uBloom", 1, this.blurB.tex);
    gl.uniform1f(this.uloc(this.progComposite, "uBloomI"), this.bloomI);
    gl.uniform1f(this.uloc(this.progComposite, "uSeam"), 0.5);
    gl.uniform2f(this.uloc(this.progComposite, "uRes"), this.canvas.width, this.canvas.height);
    this.uploadPulses();
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // swap trail buffers
    const tmp = this.trailA;
    this.trailA = this.trailB;
    this.trailB = tmp;
  }

  private blurPass(src: Target, dst: Target, dir: [number, number]): void {
    const gl = this.gl;
    gl.useProgram(this.progBlur);
    gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fbo);
    gl.viewport(0, 0, dst.w, dst.h);
    this.bindTex(this.progBlur, "uTex", 0, src.tex);
    gl.uniform2f(this.uloc(this.progBlur, "uDir"), dir[0], dir[1]);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  private uploadPulses(): void {
    const gl = this.gl;
    const now = performance.now();
    this.pulses = this.pulses.filter((p) => now - p.t0 < this.PULSE_MS);
    const py = new Float32Array(8);
    const pa = new Float32Array(8);
    const pb = new Float32Array(8);
    for (let i = 0; i < this.pulses.length && i < 8; i++) {
      const p = this.pulses[i];
      py[i] = p.y;
      pa[i] = Math.max(0, 1 - (now - p.t0) / this.PULSE_MS);
      pb[i] = p.bank;
    }
    gl.uniform1fv(this.uloc(this.progComposite, "uPulseY"), py);
    gl.uniform1fv(this.uloc(this.progComposite, "uPulseA"), pa);
    gl.uniform1fv(this.uloc(this.progComposite, "uPulseB"), pb);
  }

  // ---- gl helpers ----
  private bindTex(prog: WebGLProgram, name: string, unit: number, tex: WebGLTexture): void {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(this.uloc(prog, name), unit);
  }

  private ulocCache = new Map<string, WebGLUniformLocation | null>();
  private uloc(prog: WebGLProgram, name: string): WebGLUniformLocation | null {
    const key = `${(prog as unknown as { __id?: number }).__id}:${name}`;
    let loc = this.ulocCache.get(key);
    if (loc === undefined) {
      loc = this.gl.getUniformLocation(prog, name);
      this.ulocCache.set(key, loc);
    }
    return loc;
  }

  private makeTex(
    w: number,
    h: number,
    internal: number,
    format: number,
    type: number,
    filter: number,
  ): WebGLTexture {
    const gl = this.gl;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, format, type, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tex;
  }

  private makeTarget(w: number, h: number): Target {
    const gl = this.gl;
    const internal = this.floatOk ? gl.RGBA16F : gl.RGBA8;
    const type = this.floatOk ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE;
    const tex = this.makeTex(w, h, internal, gl.RGBA, type, gl.LINEAR);
    const fbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { tex, fbo, w, h };
  }

  private clearTarget(t: Target): void {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
    gl.viewport(0, 0, t.w, t.h);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  private static nextId = 1;
  private program(vsrc: string, fsrc: string): WebGLProgram {
    const gl = this.gl;
    const vs = this.shader(gl.VERTEX_SHADER, vsrc);
    const fs = this.shader(gl.FRAGMENT_SHADER, fsrc);
    const p = gl.createProgram()!;
    gl.attachShader(p, vs);
    gl.attachShader(p, fs);
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      throw new Error("program link failed: " + gl.getProgramInfoLog(p));
    }
    (p as unknown as { __id: number }).__id = GLFieldRenderer.nextId++;
    return p;
  }

  private shader(type: number, src: string): WebGLShader {
    const gl = this.gl;
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      throw new Error("shader compile failed: " + gl.getShaderInfoLog(s) + "\n" + src);
    }
    return s;
  }
}
