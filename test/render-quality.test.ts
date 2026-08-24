import assert from "node:assert/strict";
import test from "node:test";
import {
  applyRenderQuality,
  createAdaptivePixelRatio,
  getRenderQuality,
  nextPixelRatio,
} from "../src/renderQuality.js";

test("interactive quality caps DPR and halves each shadow-map dimension", () => {
  const ratios: number[] = [];
  const sizes: number[][] = [];
  const renderer = { setPixelRatio: (ratio: number) => ratios.push(ratio) };
  const sun = {
    shadow: { mapSize: { set: (...size: number[]) => sizes.push(size) } },
  };

  const quality = applyRenderQuality(renderer, sun, { devicePixelRatio: 3 });

  assert.deepEqual(quality, {
    maxPixelRatio: 1.5,
    minPixelRatio: 1,
    shadowMapSize: 1024,
    adaptive: true,
    pixelRatio: 1.5,
  });
  assert.deepEqual(ratios, [1.5]);
  assert.deepEqual(sizes, [[1024, 1024]]);
});

test("screenshot mode retains the high quality settings", () => {
  assert.deepEqual(getRenderQuality({ screenshotMode: true }), {
    maxPixelRatio: 2,
    minPixelRatio: 2,
    shadowMapSize: 2048,
    adaptive: false,
  });
});

test("pixel ratio adjustments use a dead band and respect limits", () => {
  const options = { maximumPixelRatio: 1.5, minimumPixelRatio: 1 };
  assert.equal(
    nextPixelRatio({ ...options, pixelRatio: 1.5, averageFrameMs: 24 }),
    1.25,
  );
  assert.equal(
    nextPixelRatio({ ...options, pixelRatio: 1, averageFrameMs: 24 }),
    1,
  );
  assert.equal(
    nextPixelRatio({ ...options, pixelRatio: 1.25, averageFrameMs: 17 }),
    1.25,
  );
  assert.equal(
    nextPixelRatio({ ...options, pixelRatio: 1.25, averageFrameMs: 12 }),
    1.5,
  );
});

test("adaptive controller responds only to sustained frame time", () => {
  const ratios: number[] = [];
  const controller = createAdaptivePixelRatio(
    { setPixelRatio: (ratio) => ratios.push(ratio) },
    {
      initialPixelRatio: 1.5,
      maximumPixelRatio: 1.5,
      sampleFrames: 4,
      settleFrames: 0,
    },
  );

  controller.reportFrame(0.024);
  controller.reportFrame(0.024);
  controller.reportFrame(0.024);
  assert.deepEqual(ratios, []);
  assert.equal(controller.reportFrame(0.024), 1.25);
  assert.deepEqual(ratios, [1.25]);

  // A tab suspension resets the window and cannot cause a quality change.
  controller.reportFrame(0.2);
  controller.reportFrame(0.012);
  controller.reportFrame(0.012);
  controller.reportFrame(0.012);
  assert.equal(controller.pixelRatio, 1.25);
  assert.equal(controller.reportFrame(0.012), 1.5);
  assert.deepEqual(ratios, [1.25, 1.5]);
});
