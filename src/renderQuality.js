const INTERACTIVE_QUALITY = Object.freeze({
  maxPixelRatio: 1.5,
  minPixelRatio: 1,
  shadowMapSize: 1024,
  adaptive: true,
});

const SCREENSHOT_QUALITY = Object.freeze({
  maxPixelRatio: 2,
  minPixelRatio: 2,
  shadowMapSize: 2048,
  adaptive: false,
});

export function getRenderQuality({ screenshotMode = false } = {}) {
  return screenshotMode ? SCREENSHOT_QUALITY : INTERACTIVE_QUALITY;
}

/** Apply the expensive, resolution-dependent renderer settings in one place. */
export function applyRenderQuality(renderer, sun, {
  devicePixelRatio = globalThis.devicePixelRatio || 1,
  screenshotMode = false,
} = {}) {
  const quality = getRenderQuality({ screenshotMode });
  const pixelRatio = Math.min(devicePixelRatio, quality.maxPixelRatio);
  renderer.setPixelRatio(pixelRatio);
  sun.shadow.mapSize.set(quality.shadowMapSize, quality.shadowMapSize);
  return { ...quality, pixelRatio };
}

/**
 * Select the next DPR from a measured frame-time window. The dead band keeps
 * the canvas from repeatedly reallocating around the target frame time.
 */
export function nextPixelRatio({
  pixelRatio,
  averageFrameMs,
  maximumPixelRatio,
  minimumPixelRatio = 1,
  slowFrameMs = 21,
  fastFrameMs = 15,
  step = .25,
}) {
  if (averageFrameMs > slowFrameMs)
    return Math.max(minimumPixelRatio, pixelRatio - step);
  if (averageFrameMs < fastFrameMs)
    return Math.min(maximumPixelRatio, pixelRatio + step);
  return pixelRatio;
}

/**
 * Lightweight adaptive-resolution controller. Feed it the animation-loop
 * delta. It samples sustained performance and ignores pauses/background-tab
 * spikes, rather than reacting to individual slow frames.
 */
export function createAdaptivePixelRatio(renderer, {
  devicePixelRatio = globalThis.devicePixelRatio || 1,
  maximumPixelRatio = Math.min(devicePixelRatio, INTERACTIVE_QUALITY.maxPixelRatio),
  minimumPixelRatio = INTERACTIVE_QUALITY.minPixelRatio,
  initialPixelRatio = Math.min(devicePixelRatio, maximumPixelRatio),
  sampleFrames = 120,
  settleFrames = 120,
} = {}) {
  let pixelRatio = initialPixelRatio;
  let elapsedMs = 0;
  let frames = 0;
  let settling = 0;

  function resetSample() { elapsedMs = 0; frames = 0; }

  return {
    get pixelRatio() { return pixelRatio; },
    reportFrame(deltaSeconds) {
      const frameMs = deltaSeconds * 1000;
      // Long gaps represent a suspended tab, debugger, or asset stall rather
      // than the steady-state GPU load this controller is intended to tune.
      if (!Number.isFinite(frameMs) || frameMs <= 0 || frameMs > 100) {
        resetSample();
        return pixelRatio;
      }
      if (settling) { settling--; return pixelRatio; }
      elapsedMs += frameMs;
      frames++;
      if (frames < sampleFrames) return pixelRatio;

      const next = nextPixelRatio({
        pixelRatio,
        averageFrameMs: elapsedMs / frames,
        maximumPixelRatio,
        minimumPixelRatio,
      });
      resetSample();
      if (next !== pixelRatio) {
        pixelRatio = next;
        renderer.setPixelRatio(pixelRatio);
        settling = settleFrames;
      }
      return pixelRatio;
    },
  };
}
