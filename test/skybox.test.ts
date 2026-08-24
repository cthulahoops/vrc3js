import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { Skybox } from "../src/skybox.js";

function createSkybox(date: Date) {
  const scene = new THREE.Scene();
  const light = new THREE.DirectionalLight();
  scene.add(light);
  const skybox = new Skybox(scene, {
    starMap: new THREE.Texture(),
    moonMap: new THREE.Texture(),
    directionalLight: light,
    date,
  });
  return { light, skybox };
}

test("solar light and shadows are disabled below the Brooklyn horizon", () => {
  const { light, skybox } = createSkybox(new Date("2021-06-20T04:00:00Z"));
  assert.equal(light.visible, false);
  assert.ok(skybox.sunDirection.y < 0);
  skybox.dispose();
});

test("solar light remains active above the Brooklyn horizon", () => {
  const { light, skybox } = createSkybox(new Date("2021-06-20T16:00:00Z"));
  assert.equal(light.visible, true);
  assert.ok(skybox.sunDirection.y > 0);
  skybox.dispose();
});
