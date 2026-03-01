'use client';

import React, { useEffect, useMemo, useRef } from 'react';

type Quality = 'auto' | 'low' | 'high';

type HomeHeroBackgroundProps = {
  className?: string;
  quality?: Quality;
};

function compileShader(
  gl: WebGLRenderingContext | WebGL2RenderingContext,
  type: number,
  source: string
) {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('Failed to create shader');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(shader) || 'Unknown shader error';
    gl.deleteShader(shader);
    throw new Error(info);
  }
  return shader;
}

function createProgram(
  gl: WebGLRenderingContext | WebGL2RenderingContext,
  vsSource: string,
  fsSource: string
) {
  const vs = compileShader(gl, gl.VERTEX_SHADER, vsSource);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, fsSource);
  const program = gl.createProgram();
  if (!program) throw new Error('Failed to create program');
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const info = gl.getProgramInfoLog(program) || 'Unknown link error';
    gl.deleteProgram(program);
    throw new Error(info);
  }
  return program;
}

function getDpr(quality: Quality) {
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
  if (quality === 'low') return Math.min(dpr, 1);
  if (quality === 'high') return Math.min(dpr, 2);

  // auto
  const deviceMemory = (navigator as any).deviceMemory as number | undefined;
  const hc = navigator.hardwareConcurrency || 4;
  const isLowEnd = (deviceMemory !== undefined && deviceMemory <= 4) || hc <= 4;
  return Math.min(dpr, isLowEnd ? 1.25 : 2);
}

export default function HomeHeroBackground({
  className = '',
  quality = 'auto',
}: HomeHeroBackgroundProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const pointer = useRef({ x: 0.0, y: 0.0 });
  const alive = useRef(true);
  const rafId = useRef<number | null>(null);

  const shaders = useMemo(() => {
    const commonFsBody = `
      // Hash / noise (inigo quilez style-ish)
      float hash21(vec2 p) {
        p = fract(p * vec2(123.34, 456.21));
        p += dot(p, p + 34.345);
        return fract(p.x * p.y);
      }

      vec2 hash22(vec2 p) {
        float n = hash21(p);
        return vec2(n, hash21(p + n));
      }

      float noise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        vec2 u = f*f*(3.0-2.0*f);
        float a = hash21(i + vec2(0.0,0.0));
        float b = hash21(i + vec2(1.0,0.0));
        float c = hash21(i + vec2(0.0,1.0));
        float d = hash21(i + vec2(1.0,1.0));
        return mix(mix(a,b,u.x), mix(c,d,u.x), u.y);
      }

      float fbm(vec2 p) {
        float v = 0.0;
        float a = 0.55;
        mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
        for (int i = 0; i < 6; i++) {
          v += a * noise(p);
          p = m * p;
          a *= 0.52;
        }
        return v;
      }

      vec3 palette(float t) {
        // deep cyan -> violet -> amber highlights
        vec3 a = vec3(0.08, 0.10, 0.13);
        vec3 b = vec3(0.45, 0.35, 0.65);
        vec3 c = vec3(1.0, 1.0, 1.0);
        vec3 d = vec3(0.08, 0.25, 0.45);
        return a + b * cos(6.28318 * (c * t + d));
      }

      float star(vec2 uv, float t) {
        vec2 g = floor(uv);
        vec2 f = fract(uv) - 0.5;
        float rnd = hash21(g);
        vec2 p = (hash22(g) - 0.5) * 0.8;
        float d = length(f - p);
        float s = smoothstep(0.06, 0.0, d);
        float tw = 0.6 + 0.4 * sin(t * (2.0 + rnd * 6.0) + rnd * 6.28318);
        return s * tw * smoothstep(0.96, 1.0, rnd);
      }

      vec3 shade(vec2 uv) {
        vec2 px = (uv * 2.0 - 1.0);
        px.x *= u_res.x / u_res.y;

        // Mouse parallax (subtle).
        vec2 par = u_ptr * vec2(0.10, 0.06);
        vec2 p = px + par;

        float t = u_time * 0.13;

        // Domain warp for “fluid” motion.
        vec2 q = vec2(fbm(p * 1.25 + vec2(0.0, t)), fbm(p * 1.25 + vec2(5.2, -t)));
        vec2 r = vec2(fbm(p * 2.2 + 2.0 * q + vec2(1.7, 9.2) + 0.6 * t),
                      fbm(p * 2.2 + 2.0 * q + vec2(8.3, 2.8) - 0.6 * t));

        float f = fbm(p * 2.6 + 2.4 * r);

        // Aurora ribbons (soft SDF-ish)
        float ribbon = 0.0;
        ribbon += smoothstep(0.35, 0.0, abs(sin(p.y * 1.35 + f * 3.4 + t * 2.2) * 0.55 + p.x * 0.16));
        ribbon += smoothstep(0.30, 0.0, abs(sin(p.y * 1.75 - f * 2.6 - t * 2.0) * 0.45 - p.x * 0.18));
        ribbon = pow(ribbon, 2.0);

        // Nebula density and color.
        float density = smoothstep(0.15, 0.85, f);
        vec3 col = palette(f * 0.85 + 0.15);
        col *= 0.65 + 0.65 * density;
        col += vec3(0.10, 0.55, 0.65) * ribbon * 0.75;
        col += vec3(0.72, 0.30, 0.92) * ribbon * 0.55;

        // Starfield layer
        float stars = 0.0;
        vec2 suv = (p * 0.55 + vec2(0.0, -t * 0.5)) * 24.0;
        stars += star(suv, u_time) * 0.85;
        stars += star(suv * 1.7 + 17.0, u_time * 0.8) * 0.55;
        col += vec3(0.9) * stars;

        // Vignette + subtle film grain
        float vign = smoothstep(1.25, 0.2, length(px));
        float grain = (hash21(uv * u_res + u_time * 60.0) - 0.5) * 0.06;
        col = col * vign + grain;

        // Slight tone mapping
        col = col / (col + vec3(1.05));
        col = pow(col, vec3(1.05));

        return col;
      }
    `;

    // WebGL1 (GLSL ES 1.00)
    const vs100 = `
      attribute vec2 a_pos;
      varying vec2 v_uv;
      void main() {
        v_uv = a_pos * 0.5 + 0.5;
        gl_Position = vec4(a_pos, 0.0, 1.0);
      }
    `;

    const fs100 = `
      precision highp float;
      varying vec2 v_uv;
      uniform vec2 u_res;
      uniform float u_time;
      uniform vec2 u_ptr; // normalized -1..1
      ${commonFsBody}
      void main() {
        vec3 col = shade(v_uv);
        gl_FragColor = vec4(col, 1.0);
      }
    `;

    // WebGL2 (GLSL ES 3.00)
    const vs300 = `#version 300 es
      precision highp float;
      in vec2 a_pos;
      out vec2 v_uv;
      void main() {
        v_uv = a_pos * 0.5 + 0.5;
        gl_Position = vec4(a_pos, 0.0, 1.0);
      }
    `;

    const fs300 = `#version 300 es
      precision highp float;
      in vec2 v_uv;
      out vec4 outColor;
      uniform vec2 u_res;
      uniform float u_time;
      uniform vec2 u_ptr; // normalized -1..1
      ${commonFsBody}
      void main() {
        vec3 col = shade(v_uv);
        outColor = vec4(col, 1.0);
      }
    `;

    return { vs100, fs100, vs300, fs300 };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const prefersReducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;

    // Try WebGL2 first, then WebGL1.
    const gl =
      (canvas.getContext('webgl2', {
        alpha: true,
        antialias: false,
        premultipliedAlpha: false,
        preserveDrawingBuffer: false,
        powerPreference: 'high-performance',
      }) as WebGL2RenderingContext | null) ||
      (canvas.getContext('webgl', {
        alpha: true,
        antialias: false,
        premultipliedAlpha: false,
        preserveDrawingBuffer: false,
        powerPreference: 'high-performance',
      }) as WebGLRenderingContext | null);

    if (!gl) return;

    const isWebGL2 =
      typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext;

    let program: WebGLProgram | null = null;
    let aPos = -1;
    let uRes: WebGLUniformLocation | null = null;
    let uTime: WebGLUniformLocation | null = null;
    let uPtr: WebGLUniformLocation | null = null;
    let buffer: WebGLBuffer | null = null;

    const cleanup = () => {
      alive.current = false;
      if (rafId.current) cancelAnimationFrame(rafId.current);
      rafId.current = null;
      if (buffer) gl.deleteBuffer(buffer);
      if (program) gl.deleteProgram(program);
    };

    try {
      program = createProgram(
        gl,
        isWebGL2 ? shaders.vs300 : shaders.vs100,
        isWebGL2 ? shaders.fs300 : shaders.fs100
      );
      gl.useProgram(program);

      // Fullscreen triangle positions.
      buffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);

      aPos = gl.getAttribLocation(program, 'a_pos');
      gl.enableVertexAttribArray(aPos);
      gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

      uRes = gl.getUniformLocation(program, 'u_res');
      uTime = gl.getUniformLocation(program, 'u_time');
      uPtr = gl.getUniformLocation(program, 'u_ptr');
    } catch (e) {
      // Shader compilation failed (e.g. older GPUs). Bail quietly.
      cleanup();
      return;
    }

    const dpr = getDpr(quality);

    const resize = () => {
      const { width, height } = canvas.getBoundingClientRect();
      const w = Math.max(1, Math.floor(width * dpr));
      const h = Math.max(1, Math.floor(height * dpr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
        gl.viewport(0, 0, w, h);
      }
      if (uRes) gl.uniform2f(uRes, canvas.width, canvas.height);
    };

    const onPointerMove = (ev: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      const x = (ev.clientX - rect.left) / Math.max(1, rect.width);
      const y = (ev.clientY - rect.top) / Math.max(1, rect.height);
      // Normalize to -1..1, with y up.
      pointer.current.x = (x - 0.5) * 2.0;
      pointer.current.y = (0.5 - y) * 2.0;
    };

    const onVisibility = () => {
      if (document.hidden && rafId.current) {
        cancelAnimationFrame(rafId.current);
        rafId.current = null;
      } else if (!document.hidden && !rafId.current && !prefersReducedMotion) {
        lastFrame = performance.now();
        rafId.current = requestAnimationFrame(tick);
      }
    };

    const ro = new ResizeObserver(() => resize());
    ro.observe(canvas);
    window.addEventListener('pointermove', onPointerMove, { passive: true });
    document.addEventListener('visibilitychange', onVisibility);

    // FPS budget (auto: 60 on strong devices, 30 on lower).
    const deviceMemory = (navigator as any).deviceMemory as number | undefined;
    const hc = navigator.hardwareConcurrency || 4;
    const isLowEnd = (deviceMemory !== undefined && deviceMemory <= 4) || hc <= 4;
    const targetFps = prefersReducedMotion ? 0 : isLowEnd ? 30 : 60;
    const minFrameMs = targetFps ? 1000 / targetFps : Infinity;

    resize();

    alive.current = true;
    const start = performance.now();
    let lastFrame = start;

    const draw = (now: number) => {
      if (!program) return;
      gl.useProgram(program);
      if (uTime) gl.uniform1f(uTime, (now - start) / 1000);
      if (uPtr) gl.uniform2f(uPtr, pointer.current.x, pointer.current.y);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };

    const tick = (now: number) => {
      if (!alive.current) return;
      rafId.current = requestAnimationFrame(tick);

      // throttle (esp. on laptop iGPU / low-end devices)
      if (now - lastFrame < minFrameMs) return;
      lastFrame = now;
      draw(now);
    };

    // Reduced motion: render a single still frame and stop.
    if (prefersReducedMotion) {
      draw(start);
    } else {
      rafId.current = requestAnimationFrame(tick);
    }

    return () => {
      ro.disconnect();
      window.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('visibilitychange', onVisibility);
      cleanup();
    };
  }, [quality, shaders.fs100, shaders.fs300, shaders.vs100, shaders.vs300]);

  return (
    <div className={className} aria-hidden="true">
      <canvas
        ref={canvasRef}
        className="h-full w-full"
        style={{
          // Helps Safari/iOS compositing.
          transform: 'translateZ(0)',
        }}
      />
      {/* Vignette + subtle highlight to “seat” content */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(80% 70% at 50% 35%, rgba(255,255,255,0.06) 0%, rgba(255,255,255,0.00) 55%), radial-gradient(120% 120% at 50% 100%, rgba(0,0,0,0.65) 0%, rgba(0,0,0,0.95) 55%, rgba(0,0,0,1.0) 100%)',
          mixBlendMode: 'overlay',
        }}
      />
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(120% 100% at 50% 50%, rgba(0,0,0,0.0) 0%, rgba(0,0,0,0.45) 70%, rgba(0,0,0,0.85) 100%)',
        }}
      />
    </div>
  );
}
