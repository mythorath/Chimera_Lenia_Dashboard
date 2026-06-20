// legend.ts - field visual guide for the LIVE / CINEMA map panel.

export function legendHtml(): string {
  return /* html */ `
  <h2 class="legend-title">Field guide</h2>
  <p class="legend-lede">
    The tall map is the living world &mdash; a torus of continuous Lenia matter split
    across two biomes. Colors show <b>who</b> is where and <b>what just happened</b>.
  </p>

  <section>
    <h3>Map layout</h3>
    <ul class="legend-list">
      <li><b>Top half</b> &mdash; Bank&nbsp;A (instinct): five ESP32-C3 strips, fixed-point physics.</li>
      <li><b>Bottom half</b> &mdash; Bank&nbsp;B (memory): five ESP32-S3 strips, float physics with history.</li>
      <li><b>Horizontal wrap</b> &mdash; left and right edges connect (torus).</li>
      <li><b>Thin strips</b> &mdash; each row band is one microcontroller&rsquo;s strip.</li>
    </ul>
  </section>

  <section>
    <h3>Species &amp; color</h3>
    <p class="legend-note">Two interacting species share the field. Brightness = how much life is in a cell.</p>
    <div class="field-legend-grid">
      <div class="field-legend-item">
        <i class="lg prey-a"></i>
        <span><b>Prey</b> in Bank&nbsp;A &mdash; teal / jade / gold palette</span>
      </div>
      <div class="field-legend-item">
        <i class="lg prey-b"></i>
        <span><b>Prey</b> in Bank&nbsp;B &mdash; violet / magenta / rose palette</span>
      </div>
      <div class="field-legend-item">
        <i class="lg pred-a"></i>
        <span><b>Predator</b> in Bank&nbsp;A &mdash; hot orange accent</span>
      </div>
      <div class="field-legend-item">
        <i class="lg pred-b"></i>
        <span><b>Predator</b> in Bank&nbsp;B &mdash; electric cyan accent</span>
      </div>
      <div class="field-legend-item">
        <i class="lg mix"></i>
        <span><b>Overlap</b> &mdash; prey + predator in the same place add together</span>
      </div>
    </div>
  </section>

  <section>
    <h3>Structure &amp; events <span class="legend-tag">LIVE view</span></h3>
    <div class="field-legend-grid">
      <div class="field-legend-item">
        <i class="lg trail-a"></i>
        <span><b>Motion echo</b> &mdash; faint afterglow where matter recently moved</span>
      </div>
      <div class="field-legend-item">
        <i class="lg seam"></i>
        <span><b>Seam</b> &mdash; amber line where instinct and memory banks meet</span>
      </div>
      <div class="field-legend-item">
        <i class="lg grid"></i>
        <span><b>Strip bands</b> &mdash; faint horizontal lines; each band is one ESP32 strip</span>
      </div>
      <div class="field-legend-item">
        <i class="lg pulse-a"></i>
        <span><b>Event ring (A)</b> &mdash; thin pulse on birth or migration in Bank&nbsp;A</span>
      </div>
      <div class="field-legend-item">
        <i class="lg pulse-b"></i>
        <span><b>Event ring (B)</b> &mdash; same for Bank&nbsp;B events</span>
      </div>
    </div>
  </section>

  <section>
    <h3>Cinema view</h3>
    <p>
      <b>CINEMA</b> fills the screen edge-to-edge (1920&times;1080) &mdash;
      instinct on the <b>left</b>, memory on the <b>right</b>, strips running horizontally.
    </p>
  </section>

  <section>
    <h3>Explore the map</h3>
    <ul class="legend-list compact">
      <li><b>Scroll</b> &mdash; zoom in/out (up to 8&times;)</li>
      <li><b>Drag</b> &mdash; pan when zoomed</li>
      <li><b>Double-click</b> or <b>reset view</b> &mdash; return to full torus</li>
    </ul>
  </section>
  `;
}
