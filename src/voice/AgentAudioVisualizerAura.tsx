// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { useEffect, useRef } from 'react';
import type { CSSProperties, JSX } from 'react';

/**
 * Aura shader adapted from LiveKit Agents UI AgentAudioVisualizerAura.
 *
 * Original Aura shader:
 * - Developed for Unicorn Studio
 * - Licensed under the Polyform Non-Resale License 1.0.0
 * - Copyright 2026 UNCRN LLC
 *
 * This local adaptation removes LiveKit audio-track dependencies and accepts a
 * Deepgram-derived numeric volume prop instead.
 */

export type VoiceVisualState =
  | 'idle'
  | 'disconnected'
  | 'connecting'
  | 'listening'
  | 'thinking'
  | 'speaking'
  | 'muted'
  | 'error';

type AuraSize = 'icon' | 'sm' | 'md' | 'lg' | 'xl' | number;

type AuraTargets = {
  speed: number;
  scale: number;
  amplitude: number;
  frequency: number;
  brightness: number;
};

type AuraUniforms = {
  resolution: WebGLUniformLocation;
  time: WebGLUniformLocation;
  speed: WebGLUniformLocation;
  blur: WebGLUniformLocation;
  scale: WebGLUniformLocation;
  shape: WebGLUniformLocation;
  frequency: WebGLUniformLocation;
  amplitude: WebGLUniformLocation;
  bloom: WebGLUniformLocation;
  brightness: WebGLUniformLocation;
  spacing: WebGLUniformLocation;
  colorShift: WebGLUniformLocation;
  variance: WebGLUniformLocation;
  smoothing: WebGLUniformLocation;
  mode: WebGLUniformLocation;
  color: WebGLUniformLocation;
};

const DEFAULT_COLOR = '#2EC4B6';
const DEFAULT_TARGETS: AuraTargets = {
  speed: 10,
  scale: 0.2,
  amplitude: 2,
  frequency: 0.5,
  brightness: 1.5,
};

const AURA_SIZE: Record<Exclude<AuraSize, number>, number> = {
  icon: 24,
  sm: 56,
  md: 112,
  lg: 224,
  xl: 320,
};

const VERTEX_SHADER = `
attribute vec2 aPosition;

void main(void) {
  gl_Position = vec4(aPosition, 0.0, 1.0);
}
`;

const OFFICIAL_AURA_SHADER = `
const float TAU = 6.283185;

vec2 randFibo(vec2 p) {
  p = fract(p * vec2(443.897, 441.423));
  p += dot(p, p.yx + 19.19);
  return fract((p.xx + p.yx) * p.xy);
}

vec3 Tonemap(vec3 x) {
  x *= 4.0;
  return x / (1.0 + x);
}

float luma(vec3 color) {
  return dot(color, vec3(0.299, 0.587, 0.114));
}

vec3 rgb2hsv(vec3 c) {
  vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
  vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
  float d = q.x - min(q.w, q.y);
  float e = 1.0e-10;
  return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}

vec3 hsv2rgb(vec3 c) {
  vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
  vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

float sdCircle(vec2 st, float r) {
  return length(st) - r;
}

float sdLine(vec2 p, float r) {
  float halfLen = r * 2.0;
  vec2 a = vec2(-halfLen, 0.0);
  vec2 b = vec2(halfLen, 0.0);
  vec2 pa = p - a;
  vec2 ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h);
}

float getSdf(vec2 st) {
  if (uShape == 1.0) {
    return sdCircle(st, uScale);
  }
  if (uShape == 2.0) {
    return sdLine(st, uScale);
  }
  return sdCircle(st, uScale);
}

vec2 turb(vec2 pos, float t, float it) {
  mat2 rotation = mat2(0.6, -0.25, 0.25, 0.9);
  mat2 layerRotation = mat2(0.6, -0.8, 0.8, 0.6);

  float frequency = mix(2.0, 15.0, uFrequency);
  float amplitude = uAmplitude;
  float frequencyGrowth = 1.4;
  float animTime = t * 0.1 * uSpeed;

  const int LAYERS = 4;
  for (int i = 0; i < LAYERS; i++) {
    vec2 rotatedPos = pos * rotation;
    vec2 wave = sin(frequency * rotatedPos + float(i) * animTime + it);
    pos += (amplitude / frequency) * rotation[0] * wave;
    rotation *= layerRotation;
    amplitude *= mix(1.0, max(wave.x, wave.y), uVariance);
    frequency *= frequencyGrowth;
  }

  return pos;
}

const float ITERATIONS = 36.0;

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = fragCoord / iResolution.xy;

  vec3 pp = vec3(0.0);
  vec3 bloom = vec3(0.0);
  float t = iTime * 0.5;
  vec2 pos = uv - 0.5;

  vec2 prevPos = turb(pos, t, 0.0 - 1.0 / ITERATIONS);
  float spacing = mix(1.0, TAU, uSpacing);

  for (float i = 1.0; i < ITERATIONS + 1.0; i++) {
    float iter = i / ITERATIONS;
    vec2 st = turb(pos, t, iter * spacing);
    float d = abs(getSdf(st));
    float pd = distance(st, prevPos);
    prevPos = st;
    float dynamicBlur = exp2(pd * 2.0 * 1.4426950408889634) - 1.0;
    float ds = smoothstep(0.0, uBlur * 0.05 + max(dynamicBlur * uSmoothing, 0.001), d);

    vec3 color = uColor;
    if (uColorShift > 0.01) {
      vec3 hsv = rgb2hsv(color);
      hsv.x = fract(hsv.x + (1.0 - iter) * uColorShift * 0.3);
      color = hsv2rgb(hsv);
    }

    float invd = 1.0 / max(d + dynamicBlur, 0.001);
    pp += (ds - 1.0) * color;
    bloom += clamp(invd, 0.0, 250.0) * color;
  }

  pp *= 1.0 / ITERATIONS;

  vec3 color;
  if (uMode < 0.5) {
    bloom = bloom / (bloom + 2e4);
    color = (-pp + bloom * 3.0 * uBloom) * 1.2;
    color += (randFibo(fragCoord).x - 0.5) / 255.0;
    color = Tonemap(color);
    float alpha = luma(color) * uMix;
    fragColor = vec4(color * uMix, alpha);
  } else {
    color = -pp;
    color += (randFibo(fragCoord).x - 0.5) / 255.0;

    float brightness = length(color);
    vec3 direction = brightness > 0.0 ? color / brightness : color;
    float factor = 2.0;
    float mappedBrightness = (brightness * factor) / (1.0 + brightness * factor);
    color = direction * mappedBrightness;

    float gray = dot(color, vec3(0.2, 0.5, 0.1));
    float saturationBoost = 3.0;
    color = mix(vec3(gray), color, saturationBoost);
    color = clamp(color, 0.0, 1.0);

    float alpha = mappedBrightness * clamp(uMix, 1.0, 2.0);
    fragColor = vec4(color, alpha);
  }
}
`;

const FRAGMENT_SHADER = `
precision highp float;

uniform vec2 iResolution;
uniform float iTime;
uniform float uSpeed;
uniform float uBlur;
uniform float uScale;
uniform float uShape;
uniform float uFrequency;
uniform float uAmplitude;
uniform float uBloom;
uniform float uMix;
uniform float uSpacing;
uniform float uColorShift;
uniform float uVariance;
uniform float uSmoothing;
uniform float uMode;
uniform vec3 uColor;

${OFFICIAL_AURA_SHADER}

void main(void) {
  vec4 color = vec4(0.0, 0.0, 0.0, 0.0);
  mainImage(color, gl_FragCoord.xy);
  gl_FragColor = color;
}
`;

type AgentAudioVisualizerAuraProps = {
  size?: AuraSize;
  color?: `#${string}` | string;
  colorShift?: number;
  state?: VoiceVisualState;
  volume?: number;
  themeMode?: 'light' | 'dark' | string;
  className?: string;
};

function sizeToPixels(size: AuraSize): number {
  return typeof size === 'number' ? size : AURA_SIZE[size];
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function hexToRgb(hexColor: string): [number, number, number] {
  const rgbColor = hexColor.trim().match(/^#([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})$/);
  if (!rgbColor) {
    return [0.18, 0.77, 0.71];
  }
  const [, red = '2E', green = 'C4', blue = 'B6'] = rgbColor;
  return [Number.parseInt(red, 16) / 255, Number.parseInt(green, 16) / 255, Number.parseInt(blue, 16) / 255];
}

function createShader(gl: WebGLRenderingContext, type: number, source: string): WebGLShader | undefined {
  const shader = gl.createShader(type);
  if (!shader) {
    return undefined;
  }

  gl.shaderSource(shader, source);
  gl.compileShader(shader);

  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader);
    return undefined;
  }

  return shader;
}

function createProgram(gl: WebGLRenderingContext): WebGLProgram | undefined {
  const vertexShader = createShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
  const fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);

  if (!vertexShader || !fragmentShader) {
    return undefined;
  }

  const program = gl.createProgram();
  if (!program) {
    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);
    return undefined;
  }

  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  gl.deleteShader(vertexShader);
  gl.deleteShader(fragmentShader);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    gl.deleteProgram(program);
    return undefined;
  }

  return program;
}

function getUniforms(gl: WebGLRenderingContext, program: WebGLProgram): AuraUniforms | undefined {
  const resolution = gl.getUniformLocation(program, 'iResolution');
  const time = gl.getUniformLocation(program, 'iTime');
  const speed = gl.getUniformLocation(program, 'uSpeed');
  const blur = gl.getUniformLocation(program, 'uBlur');
  const scale = gl.getUniformLocation(program, 'uScale');
  const shape = gl.getUniformLocation(program, 'uShape');
  const frequency = gl.getUniformLocation(program, 'uFrequency');
  const amplitude = gl.getUniformLocation(program, 'uAmplitude');
  const bloom = gl.getUniformLocation(program, 'uBloom');
  const brightness = gl.getUniformLocation(program, 'uMix');
  const spacing = gl.getUniformLocation(program, 'uSpacing');
  const colorShift = gl.getUniformLocation(program, 'uColorShift');
  const variance = gl.getUniformLocation(program, 'uVariance');
  const smoothing = gl.getUniformLocation(program, 'uSmoothing');
  const mode = gl.getUniformLocation(program, 'uMode');
  const color = gl.getUniformLocation(program, 'uColor');

  if (
    !resolution ||
    !time ||
    !speed ||
    !blur ||
    !scale ||
    !shape ||
    !frequency ||
    !amplitude ||
    !bloom ||
    !brightness ||
    !spacing ||
    !colorShift ||
    !variance ||
    !smoothing ||
    !mode ||
    !color
  ) {
    return undefined;
  }

  return {
    resolution,
    time,
    speed,
    blur,
    scale,
    shape,
    frequency,
    amplitude,
    bloom,
    brightness,
    spacing,
    colorShift,
    variance,
    smoothing,
    mode,
    color,
  };
}

function targetsForState(state: VoiceVisualState, volume: number, elapsed: number, reducedMotion: boolean): AuraTargets {
  const pulse = reducedMotion ? 0 : (Math.sin(elapsed * 2.85) + 1) * 0.5;
  const quietPulse = reducedMotion ? 0 : (Math.sin(elapsed * 1.65) + 1) * 0.5;

  switch (state) {
    case 'listening':
      return {
        speed: 20,
        scale: 0.285 + volume * 0.035,
        amplitude: 1.0 + volume * 0.35,
        frequency: 0.7,
        brightness: 1.45 + quietPulse * 0.45 + volume * 0.25,
      };
    case 'thinking':
      return {
        speed: 30,
        scale: 0.29,
        amplitude: 0.5,
        frequency: 1.0,
        brightness: 0.65 + pulse * 1.55,
      };
    case 'connecting':
      return {
        speed: 24,
        scale: 0.27,
        amplitude: 0.62,
        frequency: 0.95,
        brightness: 0.75 + pulse * 1.0,
      };
    case 'speaking':
      return {
        speed: 70,
        scale: 0.21 + 0.19 * volume,
        amplitude: 0.72 + volume * 0.28,
        frequency: 1.25,
        brightness: 1.45 + volume * 0.35,
      };
    case 'idle':
    case 'disconnected':
    case 'muted':
    case 'error':
      return {
        speed: 10,
        scale: 0.21,
        amplitude: 1.05,
        frequency: 0.4,
        brightness: state === 'muted' ? 0.65 : 0.95,
      };
  }
}

function smoothValue(current: number, target: number, delta: number, rate = 8): number {
  return current + (target - current) * (1 - Math.exp(-rate * delta));
}

export function AgentAudioVisualizerAura({
  size = 'lg',
  color = DEFAULT_COLOR,
  colorShift = 0.05,
  state = 'connecting',
  volume = 0,
  themeMode = 'dark',
  className,
}: AgentAudioVisualizerAuraProps): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stateRef = useRef(state);
  const volumeRef = useRef(clamp01(volume));
  const colorRef = useRef(hexToRgb(color));
  const colorShiftRef = useRef(clamp01(colorShift));
  const themeModeRef = useRef(themeMode);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    volumeRef.current = clamp01(volume);
  }, [volume]);

  useEffect(() => {
    colorRef.current = hexToRgb(color);
  }, [color]);

  useEffect(() => {
    colorShiftRef.current = clamp01(colorShift);
  }, [colorShift]);

  useEffect(() => {
    themeModeRef.current = themeMode;
  }, [themeMode]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    const gl = canvas.getContext('webgl', {
      alpha: true,
      antialias: true,
      depth: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: false,
      stencil: false,
    });

    if (!gl) {
      return;
    }

    const program = createProgram(gl);
    if (!program) {
      return;
    }

    const uniforms = getUniforms(gl, program);
    const positionLocation = gl.getAttribLocation(program, 'aPosition');
    const positionBuffer = gl.createBuffer();

    if (!uniforms || positionLocation < 0 || !positionBuffer) {
      gl.deleteProgram(program);
      return;
    }

    const vertices = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]);
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
    gl.useProgram(program);
    gl.enableVertexAttribArray(positionLocation);
    gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    let reducedMotion = motionQuery.matches;
    const updateMotion = () => {
      reducedMotion = motionQuery.matches;
    };
    motionQuery.addEventListener('change', updateMotion);

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const width = Math.max(1, Math.floor(rect.width * dpr));
      const height = Math.max(1, Math.floor(rect.height * dpr));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
        gl.viewport(0, 0, width, height);
      }
    };

    window.addEventListener('resize', resize);
    resize();

    let animationFrame = 0;
    let lastTime = performance.now();
    const startTime = lastTime;
    const current = { ...DEFAULT_TARGETS };

    const render = (now: number) => {
      const elapsed = (now - startTime) / 1000;
      const delta = Math.min((now - lastTime) / 1000, 0.08);
      lastTime = now;
      resize();

      const visualVolume = reducedMotion ? volumeRef.current * 0.5 : volumeRef.current;
      const targets = targetsForState(stateRef.current, visualVolume, elapsed, reducedMotion);
      current.speed = smoothValue(current.speed, reducedMotion ? targets.speed * 0.2 : targets.speed, delta, 5);
      current.scale = smoothValue(current.scale, targets.scale, delta, 10);
      current.amplitude = smoothValue(current.amplitude, targets.amplitude, delta, 8);
      current.frequency = smoothValue(current.frequency, targets.frequency, delta, 8);
      current.brightness = smoothValue(current.brightness, targets.brightness, delta, 9);

      const [red, green, blue] = colorRef.current;
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(program);
      gl.uniform2f(uniforms.resolution, canvas.width, canvas.height);
      gl.uniform1f(uniforms.time, elapsed);
      gl.uniform1f(uniforms.speed, current.speed);
      gl.uniform1f(uniforms.blur, 0.2);
      gl.uniform1f(uniforms.scale, current.scale);
      gl.uniform1f(uniforms.shape, 1.0);
      gl.uniform1f(uniforms.frequency, current.frequency);
      gl.uniform1f(uniforms.amplitude, current.amplitude);
      gl.uniform1f(uniforms.bloom, 0.0);
      gl.uniform1f(uniforms.brightness, current.brightness);
      gl.uniform1f(uniforms.spacing, 0.5);
      gl.uniform1f(uniforms.colorShift, colorShiftRef.current);
      gl.uniform1f(uniforms.variance, 0.1);
      gl.uniform1f(uniforms.smoothing, 1.0);
      gl.uniform1f(uniforms.mode, themeModeRef.current === 'light' ? 1.0 : 0.0);
      gl.uniform3f(uniforms.color, red, green, blue);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

      animationFrame = window.requestAnimationFrame(render);
    };

    animationFrame = window.requestAnimationFrame(render);

    return () => {
      window.cancelAnimationFrame(animationFrame);
      window.removeEventListener('resize', resize);
      motionQuery.removeEventListener('change', updateMotion);
      gl.deleteBuffer(positionBuffer);
      gl.deleteProgram(program);
    };
  }, []);

  const pixelSize = sizeToPixels(size);
  const style: CSSProperties & {
    '--aura-size': string;
  } = {
    '--aura-size': `${pixelSize}px`,
  };

  return (
    <div
      className={['agent-audio-visualizer-aura', className].filter(Boolean).join(' ')}
      data-state={state}
      data-theme={themeMode}
      style={style}
      aria-hidden="true"
    >
      <canvas ref={canvasRef} className="agent-audio-visualizer-aura__canvas" />
    </div>
  );
}
