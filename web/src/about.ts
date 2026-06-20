// about.ts - the in-app explainer. Returns the HTML body for the About overlay.
// Describes what the piece is, the hardware, what each view/metric shows, and how
// the autonomy + Selis architecture work. Kept here so the copy versions with code.

export function aboutHtml(): string {
  return /* html */ `
  <h2 class="about-title">CHIMERA&nbsp;LENIA</h2>
  <p class="lede">
    A self-evolving, self-narrating artificial-life sculpture. A continuous cellular
    automaton (Lenia) is spread across <b>eleven microcontrollers</b> wired into one
    organism. Two genetically and <i>physically</i> distinct biomes exchange migrants
    across a seam. The world tunes its own rules to stay alive and interesting,
    discovers its own creatures, and narrates them.
  </p>

  <section>
    <h3>What am I looking at?</h3>
    <p>
      The tall panel is the <b>world</b> &mdash; a continuous field of living matter on a
      torus, computed in real time by the cluster and streamed here. Bright shapes are
      coherent structures: drifting, pulsing, dividing, dying. This is not a video loop;
      every frame is the cluster's actual current state.
    </p>
    <div class="legend">
      <span><i class="sw a"></i> Bank A &mdash; top half (instinct)</span>
      <span><i class="sw b"></i> Bank B &mdash; bottom half (memory)</span>
      <span><i class="sw seam"></i> the seam &mdash; where the two biomes meet</span>
      <span><i class="sw pulse"></i> a ring pulse &mdash; a real birth / migration event</span>
    </div>
  </section>

  <section>
    <h3>Two hemispheres, one mind</h3>
    <p>
      The world is split into <b>10 horizontal strips</b>, one per slave node, wrapping
      around a torus. The strips form two banks that compute under <i>different number
      systems dictated by their actual silicon</i>:
    </p>
    <div class="cols">
      <div class="bankcard a">
        <h4>Bank A &middot; &ldquo;instinct&rdquo;</h4>
        <p>5&times; ESP32-C3 (RISC-V). <b>Fixed-point</b> Lenia with lookup-table growth.
        Blockier, quantized, fast &mdash; reflex without deliberation.</p>
      </div>
      <div class="bankcard b">
        <h4>Bank B &middot; &ldquo;memory&rdquo;</h4>
        <p>5&times; ESP32-S3 (Xtensa). <b>Float32</b> Lenia with a time-history buffer for
        temporal fitness. Smoother, slower, deliberate &mdash; it remembers.</p>
      </div>
    </div>
    <p>
      A <b>master</b> (ESP32) orchestrates everything over two I2C buses: it runs the
      generation barrier, routes the boundary rows (&ldquo;halos&rdquo;) between neighbors,
      and <b>transcodes organisms crossing the seam</b> from one number system to the
      other. The seam is literally a boundary between two ways of computing reality.
    </p>
  </section>

  <section>
    <h3>What is Lenia?</h3>
    <p>
      Lenia is a <b>continuous</b> generalization of Conway's Game of Life: instead of
      on/off cells and discrete steps, every cell holds a smooth value in [0,1] and
      updates by a smooth growth rule applied to a blurred neighborhood (a radial
      kernel). The result is fluid, organic, lifelike &mdash; gliders, rotors, and
      creatures that swim, pulse, and self-repair. Each strip carries a <b>genome</b>
      (kernel shape + growth parameters) that can mutate and spread.
    </p>
  </section>

  <section>
    <h3>The two views</h3>
    <div class="cols">
      <div>
        <h4>LIVE</h4>
        <p>The cluster's real field, rendered in your browser with motion <b>trails</b>
        (where life has recently been), <b>bloom</b> (energy glow), a shimmering seam,
        and <b>event rings</b> that fire exactly when the cluster reports a birth or
        migration. This is the ground truth.</p>
      </div>
      <div>
        <h4>CINEMA</h4>
        <p>A high-resolution <b>&ldquo;dream&rdquo;</b> rendered on a dedicated GPU
        (NVIDIA RTX 3080&nbsp;Ti). A full-resolution Lenia is continuously <i>steered by
        the cluster's coarse field</i> &mdash; the cluster is the soul, the GPU paints it
        in high fidelity &mdash; then hardware-encoded and streamed here. Same life, dreamt
        larger.</p>
      </div>
    </div>
  </section>

  <section>
    <h3>World vitals &mdash; what the numbers mean</h3>
    <dl class="defs">
      <dt>gen</dt><dd>generation count &mdash; how many update steps the world has taken.</dd>
      <dt>nodes</dt><dd>how many of the 10 strips are currently online and computing.</dd>
      <dt>mass</dt><dd>average amount of living matter (0 = empty, 1 = saturated).</dd>
      <dt>entropy</dt><dd>spatial disorder &mdash; low = uniform/frozen, high = noise, middle = interesting structure.</dd>
      <dt>best fit</dt><dd>the highest &ldquo;how interesting is my life&rdquo; score among the strips.</dd>
      <dt>coupling</dt><dd>how tightly the two hemispheres are exchanging data right now &mdash; the world breathes between integration and autonomy.</dd>
      <dt>organisms</dt><dd>distinct coherent creatures the system currently detects.</dd>
      <dt>births / migrations / seam&nbsp;xings</dt><dd>life events: new organisms, genomes colonizing neighbors, and structures crossing between the two banks.</dd>
    </dl>
  </section>

  <section>
    <h3>Fitness landscape</h3>
    <p>
      Each bar is one strip's <b>fitness</b> &mdash; a blend of persistence, motion, and
      structure. High-fitness strips <b>colonize</b> their neighbors (copying their genome
      and transplanting an organism); low-fitness strips get mutated rules or fresh noise.
      The two banks are two <b>islands</b> with different mutation rates, so they drift
      into genuinely distinct evolutionary lineages over hours.
    </p>
  </section>

  <section>
    <h3>Fossil record</h3>
    <p>
      An append-only log of the world's life events &mdash; births, deaths, colonizations,
      migrations, mutations, and rare &ldquo;wildcard&rdquo; reseeds. It is the world's
      evolutionary history, preserved even across power loss and replayed to this server
      when it reconnects. Colors mark the event kind.
    </p>
  </section>

  <section>
    <h3>How it stays alive on its own</h3>
    <p>Three controllers run on the master, escalating in timescale:</p>
    <ul>
      <li><b>Homeostasis</b> (fast) &mdash; watches the world's vital signs and nudges
      parameters toward the &ldquo;edge of chaos&rdquo; so it never dies or saturates.</li>
      <li><b>Evolution</b> (slow) &mdash; strips compete on fitness; winning rules spread
      and migrate across the seam. The world discovers its own most-interesting physics.</li>
      <li><b>Self-cataloguing</b> &mdash; it finds coherent moving structures, gives each a
      name, a birth time, and a tracked life, then narrates them.</li>
    </ul>
  </section>

  <section>
    <h3>Architecture &mdash; cluster &amp; server</h3>
    <p>
      The <b>cluster</b> (master + 10 nodes) is fully autonomous: it keeps living,
      evolving, and recording even with this server switched off, buffering its fossil
      record locally until it can reconnect. This server (&ldquo;Selis&rdquo;) is the
      <b>presentation and memory layer</b> &mdash; it ingests the cluster's telemetry,
      archives the durable record, renders the GPU dream, and serves this dashboard. The
      art never depends on the screen being on.
    </p>
  </section>

  <p class="foot">Two hemispheres, one mind &mdash; distributed continuous artificial life.</p>
  `;
}
