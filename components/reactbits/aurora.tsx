"use client";

// React Bits — Aurora (https://reactbits.dev/backgrounds/aurora)
// Adapted to TypeScript. A WebGL (ogl) aurora band used behind the login page.
// With prefers-reduced-motion a single still frame is drawn (no animation loop).
// If WebGL is unavailable the CSS gradient behind it still shows.

import { useEffect, useRef } from "react";
import { Color, Mesh, Program, Renderer, Triangle } from "ogl";

const VERT = `#version 300 es
in vec2 position;
void main() {
  gl_Position = vec4(position, 0.0, 1.0);
}
`;

const FRAG = `#version 300 es
precision highp float;

uniform float uTime;
uniform float uAmplitude;
uniform vec3 uColorStops[3];
uniform vec2 uResolution;
uniform float uBlend;

out vec4 fragColor;

vec3 permute(vec3 x) {
  return mod(((x * 34.0) + 1.0) * x, 289.0);
}

float snoise(vec2 v) {
  const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
  vec2 i = floor(v + dot(v, C.yy));
  vec2 x0 = v - i + dot(i, C.xx);
  vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = mod(i, 289.0);
  vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
  vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0);
  m = m * m;
  m = m * m;
  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
  vec3 g;
  g.x = a0.x * x0.x + h.x * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}

vec3 colorRamp(float factor) {
  if (factor < 0.5) {
    return mix(uColorStops[0], uColorStops[1], factor / 0.5);
  }
  return mix(uColorStops[1], uColorStops[2], (factor - 0.5) / 0.5);
}

void main() {
  vec2 uv = gl_FragCoord.xy / uResolution;
  vec3 rampColor = colorRamp(uv.x);

  float height = snoise(vec2(uv.x * 2.0 + uTime * 0.1, uTime * 0.25)) * 0.5 * uAmplitude;
  height = exp(height);
  height = (uv.y * 2.0 - height + 0.2);
  float intensity = 0.6 * height;

  float midPoint = 0.20;
  float auroraAlpha = smoothstep(midPoint - uBlend * 0.5, midPoint + uBlend * 0.5, intensity);
  vec3 auroraColor = intensity * rampColor;

  fragColor = vec4(auroraColor * auroraAlpha, auroraAlpha);
}
`;

type AuroraProps = {
  colorStops?: [string, string, string];
  amplitude?: number;
  blend?: number;
  speed?: number;
  className?: string;
};

// PA ICT logo blues: navy, sky, azure.
const DEFAULT_STOPS: [string, string, string] = ["#0838a8", "#08b8f8", "#0888f8"];

export default function Aurora({
  colorStops = DEFAULT_STOPS,
  amplitude = 1.0,
  blend = 0.5,
  speed = 0.6,
  className,
}: AuroraProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const stopsKey = colorStops.join(",");

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let renderer: Renderer;
    try {
      renderer = new Renderer({ alpha: true, premultipliedAlpha: true, antialias: true });
    } catch {
      return; // No WebGL: keep the CSS fallback.
    }
    const gl = renderer.gl;
    gl.clearColor(0, 0, 0, 0);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.canvas.style.backgroundColor = "transparent";
    gl.canvas.style.width = "100%";
    gl.canvas.style.height = "100%";

    const geometry = new Triangle(gl);
    if (geometry.attributes.uv) {
      delete (geometry.attributes as Record<string, unknown>).uv;
    }

    const stops = stopsKey.split(",").map((hex) => {
      const c = new Color(hex);
      return [c.r, c.g, c.b];
    });

    const program = new Program(gl, {
      vertex: VERT,
      fragment: FRAG,
      uniforms: {
        uTime: { value: 0 },
        uAmplitude: { value: amplitude },
        uColorStops: { value: stops },
        uResolution: { value: [container.offsetWidth, container.offsetHeight] },
        uBlend: { value: blend },
      },
    });

    const mesh = new Mesh(gl, { geometry, program });
    container.appendChild(gl.canvas);

    const resize = () => {
      const width = container.offsetWidth;
      const height = container.offsetHeight;
      renderer.setSize(width, height);
      program.uniforms.uResolution.value = [width, height];
      if (reduceMotion) renderer.render({ scene: mesh });
    };
    window.addEventListener("resize", resize);
    resize();

    let frame = 0;
    if (reduceMotion) {
      program.uniforms.uTime.value = 12;
      renderer.render({ scene: mesh });
    } else {
      const update = (t: number) => {
        frame = requestAnimationFrame(update);
        program.uniforms.uTime.value = t * 0.001 * speed;
        renderer.render({ scene: mesh });
      };
      frame = requestAnimationFrame(update);
    }

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", resize);
      if (gl.canvas.parentNode === container) container.removeChild(gl.canvas);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    };
  }, [stopsKey, amplitude, blend, speed]);

  return <div ref={containerRef} className={className} aria-hidden />;
}
