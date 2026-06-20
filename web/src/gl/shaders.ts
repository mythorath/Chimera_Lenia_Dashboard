// shaders.ts - GLSL ES 3.00 sources for the WebGL2 field renderer.
// Pipeline: scene (field -> bank-tinted species layers + light trails) ->
// bright-extract -> separable blur (subtle bloom) -> composite (seam, strips,
// event rings, light grade). Tuned for readable structure over glow.

export const VERT = /* glsl */ `#version 300 es
out vec2 vUv;
void main() {
  vec2 verts[3] = vec2[3](vec2(-1.0, -1.0), vec2(3.0, -1.0), vec2(-1.0, 3.0));
  vec2 p = verts[gl_VertexID];
  vUv = (p + 1.0) * 0.5;
  gl_Position = vec4(p, 0.0, 1.0);
}`;

export const FRAG_SCENE = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uField;   // RG8, 64x200 — R=prey, G=predator
uniform sampler2D uPrev;
uniform float uDecay;
uniform float uSeam;

void main() {
  vec2 fuv = vec2(vUv.x, 1.0 - vUv.y);
  vec2 fg = texture(uField, fuv).rg;
  float prey = clamp(fg.r, 0.0, 1.0);
  float pred = clamp(fg.g, 0.0, 1.0);
  bool bankA = fuv.y < uSeam;

  // Per-bank backdrop keeps empty space dark but readable
  vec3 bg = bankA ? vec3(0.018, 0.032, 0.028) : vec3(0.028, 0.018, 0.038);

  // Fixed prey ramps (no hue breathing — stable read)
  vec3 preyLo = bankA ? vec3(0.06, 0.22, 0.18) : vec3(0.18, 0.08, 0.28);
  vec3 preyHi = bankA ? vec3(0.15, 0.82, 0.58) : vec3(0.72, 0.28, 0.88);
  float pAmt = smoothstep(0.025, 0.55, prey);
  vec3 preyCol = mix(preyLo, preyHi, pow(pAmt, 0.65));

  // Predator accents — distinct hue from prey in each bank
  vec3 predLo = bankA ? vec3(0.12, 0.05, 0.02) : vec3(0.02, 0.10, 0.14);
  vec3 predHi = bankA ? vec3(0.95, 0.42, 0.08) : vec3(0.12, 0.72, 0.92);
  float dAmt = smoothstep(0.035, 0.50, pred);
  vec3 predCol = mix(predLo, predHi, pow(dAmt, 0.70));

  // Layer: backdrop -> prey -> predator (alpha-style, not additive blowout)
  vec3 col = bg;
  col = mix(col, preyCol, pAmt * 0.92);
  col = mix(col, predCol, dAmt * 0.88);

  // Overlap: warm/cool blend marker, not brighter white
  float overlap = min(pAmt, dAmt);
  if (overlap > 0.08) {
    vec3 both = bankA ? vec3(0.88, 0.62, 0.22) : vec3(0.55, 0.45, 0.95);
    col = mix(col, both, overlap * 0.55);
  }

  // Short motion echo — mix toward live signal instead of max() smear
  float decay = bankA ? uDecay : min(0.94, uDecay + 0.02);
  vec3 prev = texture(uPrev, vUv).rgb;
  float live = max(pAmt, dAmt);
  float keep = 0.55 + 0.45 * live;
  vec3 trail = mix(prev * decay, col, keep);

  outColor = vec4(trail, 1.0);
}`;

export const FRAG_BRIGHT = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 o;
uniform sampler2D uTex;
uniform float uThresh;
void main() {
  vec3 c = texture(uTex, vUv).rgb;
  float l = dot(c, vec3(0.299, 0.587, 0.114));
  o = vec4(c * smoothstep(uThresh, uThresh + 0.18, l), 1.0);
}`;

export const FRAG_BLUR = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 o;
uniform sampler2D uTex;
uniform vec2 uDir;
void main() {
  float w[5] = float[5](0.227027, 0.1945946, 0.1216216, 0.054054, 0.016216);
  vec3 c = texture(uTex, vUv).rgb * w[0];
  for (int i = 1; i < 5; i++) {
    vec2 off = uDir * float(i);
    c += texture(uTex, vUv + off).rgb * w[i];
    c += texture(uTex, vUv - off).rgb * w[i];
  }
  o = vec4(c, 1.0);
}`;

export const FRAG_COMPOSITE = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 o;
uniform sampler2D uScene;
uniform sampler2D uBloom;
uniform float uBloomI;
uniform float uSeam;
uniform vec2 uRes;
uniform float uPulseY[8];
uniform float uPulseA[8];
uniform float uPulseB[8];

vec3 aces(vec3 x) {
  const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

void main() {
  vec3 scene = texture(uScene, vUv).rgb;
  vec3 bloom = texture(uBloom, vUv).rgb;
  vec3 col = scene + bloom * uBloomI;

  float fv = 1.0 - vUv.y;

  // Bank seam — thin static marker, no shimmer
  float ds = abs(fv - uSeam);
  float seam = smoothstep(0.004, 0.0, ds);
  col = mix(col, vec3(0.95, 0.62, 0.18), seam * 0.55);

  // Strip dividers (10 strips) — faint grid for orientation
  float strip = fract(fv * 10.0);
  float edge = smoothstep(0.012, 0.0, strip) + smoothstep(0.988, 1.0, strip);
  col *= 1.0 - edge * 0.12;

  // Event pulses — thin rings, not glow blobs
  for (int i = 0; i < 8; i++) {
    float amp = uPulseA[i];
    if (amp <= 0.0) continue;
    float radius = (1.0 - amp) * 0.08;
    float d = abs(fv - uPulseY[i]);
    float ring = smoothstep(0.006, 0.0, abs(d - radius));
    vec3 pc = uPulseB[i] > 0.5 ? vec3(0.35, 0.95, 0.65) : vec3(0.95, 0.45, 0.85);
    col = mix(col, pc, ring * amp * 0.45);
  }

  col = aces(col * 1.05);

  // Light vignette only
  vec2 q = (vUv - 0.5) * vec2(uRes.x / max(uRes.y, 1.0), 1.0);
  float vig = smoothstep(1.0, 0.45, length(q));
  col *= mix(0.82, 1.0, vig);

  o = vec4(col, 1.0);
}`;
