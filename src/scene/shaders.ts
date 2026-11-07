/**
 * Os shaders do círculo e das partículas, sem depender de nada.
 *
 * O HUD (Core.tsx, Particles.tsx) e o app do iPhone (apps/mobile/src/Cena.tsx)
 * desenham a mesma coisa a partir daqui, então uma mudança na geometria do núcleo
 * chega aos dois. Por isso este arquivo não importa nada: o Metro o carrega por
 * fora do projeto mobile.
 */

export const coreVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

export const coreFragment = /* glsl */ `
  uniform vec3  uColor;
  uniform vec3  uHot;
  uniform float uLevel;
  uniform float uPhase;
  uniform float uOpen;
  uniform float uZoom;
  uniform float uIntensity;
  uniform float uStyle;

  varying vec2 vUv;

  // -- value noise + fbm ----------------------------------------------------
  vec2 hash(vec2 p) {
    p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
    return -1.0 + 2.0 * fract(sin(p) * 43758.5453123);
  }

  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(dot(hash(i + vec2(0.0, 0.0)), f - vec2(0.0, 0.0)),
          dot(hash(i + vec2(1.0, 0.0)), f - vec2(1.0, 0.0)), u.x),
      mix(dot(hash(i + vec2(0.0, 1.0)), f - vec2(0.0, 1.0)),
          dot(hash(i + vec2(1.0, 1.0)), f - vec2(1.0, 1.0)), u.x),
      u.y);
  }

  float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 5; i++) {
      v += a * noise(p);
      p *= 2.02;
      a *= 0.5;
    }
    return v;
  }

  // A soft complete circle at radius r0, w wide.
  float band(float r, float r0, float w) {
    return exp(-pow((r - r0) / w, 2.0));
  }

  #define TAU 6.28318530718

  void main() {
    // The shader field is scaled up so the ring sits in the middle of the
    // frame with dark margin around it — the reference disc, not something that
    // fills the screen edge to edge. Angle is scale-invariant, so the erosion
    // pattern is untouched.
    vec2 p = (vUv * 2.0 - 1.0) * uZoom;
    float r = length(p);
    float a = atan(p.y, p.x);

    // Sampling the turbulence on the unit circle rather than on p keeps it
    // continuous across the -pi/pi seam, which a plain atan lookup is not.
    vec2 ring = vec2(cos(a), sin(a));

    // -- the main ring ------------------------------------------------------
    // Its radius wanders on two scales, so the outline is never a clean
    // geometric circle — this dusty, breathing edge is the whole character of
    // the thing. The slow term drifts; the fine term shivers.
    float wob   = fbm(ring * 2.6 + vec2(uPhase * 0.22, 0.0)) * 0.055;
    float grain = fbm(ring * 9.0 - vec2(uPhase * 0.4, 0.0)) * 0.020;
    float R = 0.74 + wob + grain + uLevel * 0.03;

    // Erosion: the outer boundary is eaten away in patches, so the ring reads
    // as something luminous and unstable rather than as a drawn stroke.
    float erode = smoothstep(-0.25, 0.35, fbm(ring * 5.0 + vec2(uPhase * 0.5, 3.0)));

    // -- style ---------------------------------------------------------------
    // Weights on the terms that already exist rather than three shaders or
    // three meshes. Every k below is exactly 1.0 and the body fill is exactly
    // 0.0 at uStyle 0, so 'ring' is the authored look untouched, term for term.
    //
    // 'sphere' fills the interior and lets the outline go soft, which is the
    // whole difference between a body and a drawn circle. 'wire' does the
    // opposite: it keeps only the things that are genuinely lines — the
    // concentric hairlines and the polar weave — and drops the washes and the
    // glow that were filling the space between them.
    float wSphere = clamp(1.0 - abs(uStyle - 1.0), 0.0, 1.0);
    float wWire   = clamp(1.0 - abs(uStyle - 2.0), 0.0, 1.0);

    float kOutline = mix(1.0, 0.45, wSphere) * mix(1.0, 0.70, wWire);
    float kDust    = mix(1.0, 0.30, wSphere) * mix(1.0, 0.80, wWire);
    float kLines   = mix(1.0, 0.35, wSphere) * mix(1.0, 3.00, wWire);
    float kMesh    = mix(1.0, 0.60, wSphere) * mix(1.0, 2.60, wWire);
    float kWash    = mix(1.0, 1.60, wSphere) * mix(1.0, 0.00, wWire);
    float kGlow    = mix(1.0, 2.20, wSphere) * mix(1.0, 0.30, wWire);

    float outer = band(r, R, 0.030) * (0.45 + erode * 0.6);
    // A second, tighter pass just inside gives the ring an inner wall, which is
    // what makes it read as a tube seen slightly from the front.
    float wall  = band(r, R - 0.055, 0.020) * 0.5;
    // A fine bright filament riding the outer edge.
    float edge  = band(r, R + 0.004, 0.007) * (0.5 + uLevel * 0.45);

    // Dust: a scatter of bright motes clinging to the outer edge, densest right
    // at the rim and thinning outward, so the ring dissolves into grains rather
    // than ending at a line. This is the single most reference-accurate detail.
    float speck = fbm(ring * 46.0 + vec2(uPhase * 0.15, 11.0));
    speck = pow(max(speck, 0.0), 3.0);
    float dust = speck * band(r, R + 0.028, 0.055) * (1.4 + uLevel);

    // -- radar sweep --------------------------------------------------------
    // A soft luminous wedge travelling around the ring, leaving a fading wake
    // behind it — the one moving element the eye locks onto. Its wake also
    // rekindles the dust it passes, so the edge glitters in its path.
    float sweepA = mod(uPhase * 0.55, TAU);
    float dA = mod(a - sweepA + TAU + 3.14159, TAU) - 3.14159; // signed, wrapped
    // Both edges eased. A hard step on the leading edge cuts the wake off with
    // a visible radial seam, which reads as a rendering fault rather than as a
    // sweep — it was the one artefact in the whole ring.
    float wake = smoothstep(-2.6, -0.15, dA) * (1.0 - smoothstep(0.0, 0.22, dA));
    float radar = wake * band(r, R - 0.02, 0.075) * (0.55 + uLevel * 0.45);

    // -- concentric hairlines inside ---------------------------------------
    float lines =
        band(r, 0.615, 0.0035) * 0.45
      + band(r, 0.560, 0.0030) * 0.28
      + band(r, 0.470, 0.0035) * 0.36;

    // -- the textured core disc --------------------------------------------
    // Two counter-rotating polar meshes, dense enough to read as a woven
    // membrane rather than as stripes. The counter-rotation keeps it alive
    // without ever resolving into a direction the eye can follow.
    float m1 = (sin(a * 96.0 + uPhase * 0.6) * 0.5 + 0.5)
             * (sin(r * 210.0) * 0.5 + 0.5);
    float m2 = (sin(a * 60.0 - uPhase * 0.4) * 0.5 + 0.5)
             * (sin(r * 150.0 - uPhase) * 0.5 + 0.5);
    float mesh = mix(m1, m2, 0.5);
    float core = smoothstep(0.40, 0.36, r);
    float coreTex = core * (0.04 * kWash + mesh * 0.12 * kMesh) * (0.55 + uLevel * 0.9);
    // The disc's own soft rim.
    float coreEdge = band(r, 0.385, 0.010) * (0.55 + uLevel * 0.5);

    // A slow pulse rippling out through the core, the reactor's heartbeat.
    float pulse = band(r, fract(uPhase * 0.08) * 0.40, 0.020) * core * 0.45;

    // -- inner glow ---------------------------------------------------------
    float bloom = exp(-r * 3.4) * (0.16 + uLevel * 0.34);

    // The one term with no counterpart in the ring: a solid interior out to the
    // wandering rim, so the sphere is lit all the way across instead of being a
    // hoop with a textured disc floating in the middle of it.
    float bodyFill = wSphere * smoothstep(R + 0.02, R - 0.32, r)
                   * (0.10 + uLevel * 0.10);

    float v = (outer + wall + edge + coreEdge) * kOutline
            + dust * kDust
            + radar
            + lines * kLines
            + coreTex + pulse
            + bloom * kGlow
            + bodyFill;

    // The moving highlights run hot; the body of the ring keeps its hue.
    vec3 col = mix(uColor, uHot,
      clamp(edge * 1.3 + radar * 0.7 + pulse * 0.5 + dust * 0.4, 0.0, 1.0));

    // Radial reveal on power-up: the ring assembles from the centre outward.
    v *= smoothstep(0.0, 0.35, uOpen - r * 0.45);

    // Brightness authority for the whole orb, applied last so it scales the
    // finished image rather than any one term. 1.0 is the authored look.
    v *= uIntensity;

    gl_FragColor = vec4(col * v, v);
  }
`

export const particlesVertex = /* glsl */ `
  uniform float uTime;
  uniform float uLevel;
  uniform float uSize;
  uniform float uStandby;
  uniform float uRing;

  attribute float aSeed;
  attribute float aRadius;

  varying float vAlpha;

  void main() {
    float t = uTime * (0.06 + aSeed * 0.05);

    // Rotate each point about Y at its own rate — cheap parallax.
    float c = cos(t), s = sin(t);
    vec3 p = vec3(position.x * c - position.z * s, position.y, position.x * s + position.z * c);

    // Loudness pushes the shell out and adds a little jitter.
    float push = 1.0 + uLevel * 0.35 + sin(uTime * 2.0 + aSeed * 12.0) * 0.02;
    p *= push;

    // Em espera, cada ponto vai para um halo colado ao círculo, no plano dele, em
    // vez de uma casca: uma esfera vista de frente encheria o círculo por dentro.
    vec2 dir = p.xy / max(length(p.xy), 0.001);
    vec3 halo = vec3(dir * uRing * (1.08 + aRadius * 0.34 + aSeed * 0.05), (aSeed - 0.5) * 0.12);
    p = mix(p, halo, uStandby);

    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;

    // Fade the far side so the cloud reads as volumetric, and thin it out
    // toward the outer edge of the shell.
    //
    // The range is the actual geometry: the camera sits 6.2 out and the shell
    // spans 1.9 to 4.5, so view depth runs from about -1.7 at the front to
    // -10.7 at the back. The old window closed at -3.5, which put nine tenths
    // of the cloud at alpha zero while still shading and rasterising every one
    // of those points.
    vAlpha = smoothstep(-11.5, -2.5, mv.z)
           * (0.30 + uLevel * 0.35)
           * (1.0 - aRadius * 0.55)
           * mix(1.0, 0.55, uStandby);

    // Perspective-correct sizing. The constant is tuned for the default 6-unit
    // camera distance — bigger values make the cloud read as fog, not points.
    gl_PointSize = uSize * (1.0 + uLevel * 0.7) * (13.0 / -mv.z) * mix(1.0, 0.7, uStandby);
  }
`

/**
 * As mesmas partículas, compostas para uma tela em pé (apps/mobile/src/Cena.tsx).
 *
 * A casca esférica da web gira em torno de Y, o que numa tela larga vira um fundo
 * com profundidade. Num celular ela só cabe fora da tela, e o que sobra passa na
 * frente do círculo. Aqui cada ponto orbita no plano do círculo, a partir da borda
 * dele, e todo deslocamento é proporcional a uRing, então a tela define a escala.
 * `position` guarda a direção inicial em xy e a profundidade em z.
 */
export const particlesOrbitVertex = /* glsl */ `
  uniform float uTime;
  uniform float uLevel;
  uniform float uSize;
  uniform float uStandby;
  uniform float uRing;
  uniform float uSpin;
  uniform float uTall;

  attribute float aSeed;
  attribute float aRadius;

  varying float vAlpha;

  void main() {
    // Os de dentro correm mais, como numa órbita de verdade.
    float t = uSpin * (0.45 + aSeed * 0.55) * (1.25 - aRadius * 0.8);
    float c = cos(t), s = sin(t);
    vec2 dir = vec2(position.x * c - position.y * s, position.x * s + position.y * c);

    // A voz afasta os pontos do círculo e os faz tremer, cada um no seu ritmo.
    float tremor = sin(uTime * (3.0 + aSeed * 7.0) + aSeed * 40.0) * (0.012 + uLevel * 0.13);
    float deriva = sin(uTime * 0.5 + aSeed * 18.0) * 0.035;
    float raio = 1.13 + aRadius * 0.85 + deriva + tremor + uLevel * (0.14 + aRadius * 0.38);
    raio = mix(raio, 1.06 + aRadius * 0.22, uStandby);

    vec3 p = vec3(dir * raio * uRing, position.z);
    // Em pé sobra altura, e não largura: só a parte de fora se alonga, senão abriria
    // um vão entre o círculo e os pontos colados nele.
    p.y *= mix(mix(1.0, uTall, aRadius), 1.0, uStandby);

    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;

    vAlpha = (0.55 + uLevel * 0.45)
           * (1.0 - aRadius * 0.72)
           * mix(1.0, 0.85, uStandby);
    gl_PointSize = uSize * (1.0 + uLevel * 0.9) * (13.0 / -mv.z);
  }
`

export const particlesFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uIntensity;
  varying float vAlpha;

  void main() {
    // Round, soft-edged points.
    vec2 d = gl_PointCoord - 0.5;
    float r = length(d);
    if (r > 0.5) discard;
    float falloff = 1.0 - smoothstep(0.0, 0.5, r);
    // The dust belongs to the orb: turning the reactor down and leaving its own
    // atmosphere at full brightness reads as a bug, not as a dimmer.
    gl_FragColor = vec4(uColor, vAlpha * falloff * uIntensity);
  }
`
