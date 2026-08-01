// One progressive, isolated enhancement for the hero Aegis Instrument.
// The SVG/CSS policy rings remain the complete semantic and visual fallback.

const mount = document.querySelector('#magicRingsMount');
const surface = document.querySelector('#heroFlow');
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const finePointer = window.matchMedia('(pointer: fine)');
const lowPower = window.innerWidth < 768
  || !finePointer.matches
  || reducedMotion.matches
  || navigator.connection?.saveData
  || (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 2);

if (mount && surface && !lowPower) {
  const canvas = document.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  const gl = canvas.getContext('webgl', {
    alpha: true,
    antialias: false,
    depth: false,
    powerPreference: 'low-power',
    preserveDrawingBuffer: false,
  });

  if (!gl) {
    mount.dataset.rendererState = 'fallback';
  } else {
    const vertexSource = `
      attribute vec2 aPosition;
      void main() { gl_Position = vec4(aPosition, 0.0, 1.0); }
    `;
    const fragmentSource = `
      precision mediump float;
      uniform vec2 uResolution;
      uniform float uTime;
      uniform float uState;
      uniform float uFailLayer;

      float ring(vec2 point, float radius, float width) {
        float distanceToRing = abs(length(point) - radius);
        return 1.0 - smoothstep(width, width + 0.008, distanceToRing);
      }

      vec3 layerColour(float layer, float intensity) {
        vec3 structural = vec3(0.21, 0.62, 0.86);
        vec3 approved = vec3(0.20, 0.78, 0.55);
        vec3 pending = vec3(0.93, 0.66, 0.22);
        vec3 blocked = vec3(0.95, 0.25, 0.34);
        if (uState == 2.0) return approved * intensity;
        if (uState == 3.0) return pending * intensity;
        if (uState >= 4.0 && abs(layer - uFailLayer) < 0.1) return blocked * intensity;
        if (uState == 6.0) return blocked * intensity * 0.72;
        return structural * intensity;
      }

      void main() {
        vec2 point = (gl_FragCoord.xy - 0.5 * uResolution.xy) / min(uResolution.x, uResolution.y);
        float pulse = uState == 1.0 ? 0.74 + 0.26 * sin(uTime * 8.0) : 0.88;
        float identity = ring(point, 0.18, 0.0045);
        float intent = ring(point, 0.29, 0.0045);
        float limits = ring(point, 0.40, 0.0045);
        float risk = ring(point, 0.51, 0.0045);
        vec3 colour = layerColour(1.0, identity * pulse)
          + layerColour(2.0, intent * pulse)
          + layerColour(3.0, limits * pulse)
          + layerColour(4.0, risk * pulse);
        float alpha = max(colour.r, max(colour.g, colour.b)) * 0.54;
        gl_FragColor = vec4(colour, alpha);
      }
    `;

    const compile = (type, source) => {
      const shader = gl.createShader(type);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
      return shader;
    };

    let program;
    let buffer;
    let resizeObserver;
    let intersectionObserver;
    let mutationObserver;
    let frame = 0;
    let visible = false;
    let disposed = false;
    let animationUntil = 0;

    try {
      const vertex = compile(gl.VERTEX_SHADER, vertexSource);
      const fragment = compile(gl.FRAGMENT_SHADER, fragmentSource);
      program = gl.createProgram();
      gl.attachShader(program, vertex);
      gl.attachShader(program, fragment);
      gl.linkProgram(program);
      gl.deleteShader(vertex);
      gl.deleteShader(fragment);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));

      buffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
      gl.useProgram(program);
      const position = gl.getAttribLocation(program, 'aPosition');
      gl.enableVertexAttribArray(position);
      gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

      const resolution = gl.getUniformLocation(program, 'uResolution');
      const time = gl.getUniformLocation(program, 'uTime');
      const state = gl.getUniformLocation(program, 'uState');
      const failLayer = gl.getUniformLocation(program, 'uFailLayer');
      const stateCode = { idle: 0, running: 1, approved: 2, pending: 3, blocked: 4, invalidated: 5, frozen: 6 };
      const layerCode = { identity: 1, intent: 2, limits: 3, risk: 4, none: 0 };

      const resize = () => {
        const bounds = mount.getBoundingClientRect();
        const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
        canvas.width = Math.max(1, Math.round(bounds.width * dpr));
        canvas.height = Math.max(1, Math.round(bounds.height * dpr));
        gl.viewport(0, 0, canvas.width, canvas.height);
      };

      const render = now => {
        frame = 0;
        if (disposed || !visible || document.hidden) return;
        gl.useProgram(program);
        gl.uniform2f(resolution, canvas.width, canvas.height);
        gl.uniform1f(time, now * 0.001);
        gl.uniform1f(state, stateCode[surface.dataset.flow] ?? 0);
        gl.uniform1f(failLayer, layerCode[surface.dataset.failLayer] ?? 0);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
        if (now < animationUntil) frame = requestAnimationFrame(render);
      };

      const requestRender = duration => {
        if (!visible || disposed) return;
        cancelAnimationFrame(frame);
        animationUntil = performance.now() + duration;
        frame = requestAnimationFrame(render);
      };

      const syncState = () => {
        const duration = surface.dataset.flow === 'idle' ? 0 : surface.dataset.flow === 'pending' ? 120 : 720;
        requestRender(duration);
      };

      const dispose = () => {
        if (disposed) return;
        disposed = true;
        cancelAnimationFrame(frame);
        resizeObserver?.disconnect();
        intersectionObserver?.disconnect();
        mutationObserver?.disconnect();
        gl.deleteBuffer(buffer);
        gl.deleteProgram(program);
        canvas.remove();
        mount.dataset.rendererState = 'disposed';
      };

      canvas.addEventListener('webglcontextlost', event => {
        event.preventDefault();
        mount.dataset.rendererState = 'fallback';
        dispose();
      }, { once: true });
      mount.append(canvas);
      mount.dataset.rendererState = 'active';
      resizeObserver = new ResizeObserver(() => { resize(); requestRender(0); });
      resizeObserver.observe(mount);
      intersectionObserver = new IntersectionObserver(entries => {
        visible = entries.some(entry => entry.isIntersecting);
        if (visible) requestRender(0);
        else cancelAnimationFrame(frame);
      }, { threshold: 0.08 });
      intersectionObserver.observe(surface);
      mutationObserver = new MutationObserver(syncState);
      mutationObserver.observe(surface, { attributes: true, attributeFilter: ['data-flow', 'data-fail-layer'] });
      document.addEventListener('visibilitychange', () => visible && requestRender(0));
      window.addEventListener('pagehide', dispose, { once: true });
      resize();
      window.__AEGIS_RINGS__ = Object.freeze({ sceneCount: 1, status: () => mount.dataset.rendererState, dispose });
    } catch (error) {
      console.warn('Aegis ring enhancement unavailable; retaining SVG instrument.', error);
      if (program) gl.deleteProgram(program);
      if (buffer) gl.deleteBuffer(buffer);
      canvas.remove();
      mount.dataset.rendererState = 'fallback';
    }
  }
}
