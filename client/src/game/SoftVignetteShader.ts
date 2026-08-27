// A gentler alternative to three.js's own examples/jsm/shaders/VignetteShader: that one mixes each
// corner pixel toward a flat (1-darkness) grey using a raw quadratic falloff (dot(uv,uv)), which
// both reads as a fairly abrupt-edged ring (no easing at either end of the transition) and can
// technically *lighten* a pixel that started out darker than that grey target. This instead
// multiplies the original color down toward black using smoothstep, which eases in and out (zero
// slope at both ends) for a softer-looking gradient, and is always monotonically darkening.
export const SoftVignetteShader = {
  name: "SoftVignetteShader",

  uniforms: {
    tDiffuse: { value: null },
    // Fraction of the corner distance (see fragment shader's `dist`) over which the darkening
    // ramps up - higher spreads the transition across more of the screen for a softer look.
    smoothness: { value: 0.65 },
    // How much a full-strength corner is multiplied down by (0 = no effect, 1 = pure black).
    darkness: { value: 0.25 },
  },

  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,

  fragmentShader: /* glsl */ `
    uniform float smoothness;
    uniform float darkness;
    uniform sampler2D tDiffuse;
    varying vec2 vUv;

    void main() {
      vec4 texel = texture2D(tDiffuse, vUv);
      // 0 at screen center, ~1.0 at the corners (the 1/sqrt(2) diagonal distance from center to a
      // corner in normalized 0..1 UV space, rescaled back up to 1.0 there).
      float dist = length(vUv - vec2(0.5)) * 1.4142135;
      float vignette = smoothstep(1.0 - smoothness, 1.0, dist);
      gl_FragColor = vec4(texel.rgb * (1.0 - vignette * darkness), texel.a);
    }`,
};
