import * as THREE from 'three';
import { Body, Equator, Horizon, Observer, SiderealTime } from 'astronomy-engine';

// The location used by the original renderer (Bridge Street, Brooklyn).
export const SKY_LOCATION = Object.freeze({ latitude: 39.6913, longitude: -73.985 });

// Keep the original art pinned to the upstream revision this port is based on.
const UPSTREAM_ASSET_ROOT =
  'https://raw.githubusercontent.com/cthulahoops/vrc3d/8b057126f6eb8ba5e42e3660351970d08b0d2189/textures';

const vertexShader = /* glsl */ `
  varying vec3 ray_direction;

  void main() {
    ray_direction = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// Ported from sky.frag.glsl in cthulahoops/vrc3d. The scattering constants,
// celestial mapping, enlarged moon disc, ground color, and optional grid are
// deliberately retained so the result matches the original rather than a
// generic Three.js sky.
const fragmentShader = /* glsl */ `
  varying vec3 ray_direction;

  uniform sampler2D stars_array_sampler;
  uniform sampler2D moon_array_sampler;
  uniform mat4 celestial_matrix;
  uniform mat4 moon_matrix;
  uniform vec3 sun_position;
  uniform vec3 moon_position;
  uniform bool show_grid;
  uniform bool show_atmosphere;

  const float moon_radius = 0.03;
  const float PI = 3.1415926535;
  const int iSteps = 16;
  const int jSteps = 8;

  vec2 rsi(vec3 r0, vec3 rd, float sr) {
    float a = dot(rd, rd);
    float b = 2.0 * dot(rd, r0);
    float c = dot(r0, r0) - (sr * sr);
    float d = (b * b) - 4.0 * a * c;
    if (d < 0.0) return vec2(1e5, -1e5);
    return vec2((-b - sqrt(d)) / (2.0 * a), (-b + sqrt(d)) / (2.0 * a));
  }

  vec3 atmosphere(
    vec3 r, vec3 r0, vec3 pSun, float iSun, float rPlanet,
    float rAtmos, vec3 kRlh, float kMie, float shRlh, float shMie, float g
  ) {
    pSun = normalize(pSun);
    r = normalize(r);

    vec2 p = rsi(r0, r, rAtmos);
    if (p.x > p.y) return vec3(0.0);
    p.y = min(p.y, rsi(r0, r, rPlanet).x);
    float iStepSize = (p.y - p.x) / float(iSteps);
    float iTime = 0.0;
    vec3 totalRlh = vec3(0.0);
    vec3 totalMie = vec3(0.0);
    float iOdRlh = 0.0;
    float iOdMie = 0.0;

    float mu = dot(r, pSun);
    float mumu = mu * mu;
    float gg = g * g;
    float pRlh = 3.0 / (16.0 * PI) * (1.0 + mumu);
    float pMie = 3.0 / (8.0 * PI) * ((1.0 - gg) * (mumu + 1.0)) /
      (pow(1.0 + gg - 2.0 * mu * g, 1.5) * (2.0 + gg));

    for (int i = 0; i < iSteps; i++) {
      vec3 iPos = r0 + r * (iTime + iStepSize * 0.5);
      float iHeight = length(iPos) - rPlanet;
      float odStepRlh = exp(-iHeight / shRlh) * iStepSize;
      float odStepMie = exp(-iHeight / shMie) * iStepSize;
      iOdRlh += odStepRlh;
      iOdMie += odStepMie;

      float jStepSize = rsi(iPos, pSun, rAtmos).y / float(jSteps);
      float jTime = 0.0;
      float jOdRlh = 0.0;
      float jOdMie = 0.0;
      for (int j = 0; j < jSteps; j++) {
        vec3 jPos = iPos + pSun * (jTime + jStepSize * 0.5);
        float jHeight = length(jPos) - rPlanet;
        jOdRlh += exp(-jHeight / shRlh) * jStepSize;
        jOdMie += exp(-jHeight / shMie) * jStepSize;
        jTime += jStepSize;
      }

      vec3 attn = exp(-(kMie * (iOdMie + jOdMie) + kRlh * (iOdRlh + jOdRlh)));
      totalRlh += odStepRlh * attn;
      totalMie += odStepMie * attn;
      iTime += iStepSize;
    }

    return iSun * (3.0 * pRlh * kRlh * totalRlh + pMie * kMie * totalMie);
  }

  vec2 angular_position(vec4 position) {
    float altitude = 360.0 * atan(position.y / length(position.xz)) / (2.0 * PI);
    float azimuth = 90.0 + 360.0 * atan(position.z / position.x) / (2.0 * PI);
    if (position.x < 0.0) azimuth = 180.0 + azimuth;
    return vec2(azimuth, altitude);
  }

  float grid(vec4 position) {
    vec2 ap = angular_position(position);
    return 1.0 - step(0.1, mod(ap.y, 15.0)) * step(0.1, mod(ap.x, 15.0));
  }

  vec2 spherical_texture_coords(vec4 position) {
    vec2 ap = angular_position(position);
    return vec2(ap.x / 360.0, (90.0 + ap.y) / 180.0);
  }

  void main() {
    vec3 normal_position = normalize(ray_direction);

    if (normal_position.y < 0.0) {
      float d = length(normal_position.xz);
      gl_FragColor = vec4(mix(vec3(0.2, 0.3, 0.1), vec3(0.6), d / 2.0), 1.0);
      return;
    }

    vec4 celestial_position = celestial_matrix * vec4(normal_position, 1.0);
    vec4 starmap_color = texture2D(stars_array_sampler, spherical_texture_coords(celestial_position));
    float moon_distance = sqrt(1.0 - dot(normal_position, moon_position));

    vec3 background = vec3(0.0);
    if (moon_distance < moon_radius) {
      float moon_height = sqrt(moon_radius * moon_radius - moon_distance * moon_distance);
      vec3 moon_point = normal_position * (1.0 - moon_height);
      vec3 moon_normal = normalize(moon_point - moon_position);
      vec4 moon_surface_pos = moon_matrix * vec4(moon_normal, 1.0);
      vec4 moon_albedo = texture2D(
        moon_array_sampler,
        vec2(-1.0, 1.0) * spherical_texture_coords(moon_surface_pos)
      );
      background += moon_albedo.rgb *
        (clamp(4.0 * dot(moon_normal, sun_position), 0.0, 1.0) + vec3(0.04));
    } else {
      background += 0.7 * starmap_color.rgb;
    }

    vec3 atmosphere_color = atmosphere(
      normal_position,
      vec3(0.0, 6372e3, 0.0),
      sun_position,
      22.0,
      6371e3,
      6471e3,
      1.5 * vec3(5.5e-6, 13.0e-6, 22.4e-6),
      21e-6,
      8e3,
      1.2e3,
      0.95
    );
    atmosphere_color = show_atmosphere
      ? 1.0 - exp(-max(background, atmosphere_color))
      : background;

    if (show_grid) atmosphere_color += vec3(0.3) * grid(celestial_position);
    gl_FragColor = vec4(atmosphere_color, 1.0);
  }
`;

function horizontalPosition(horizontal, target = new THREE.Vector3()) {
  const altitude = THREE.MathUtils.degToRad(horizontal.altitude);
  const azimuth = THREE.MathUtils.degToRad(horizontal.azimuth);
  return target.set(
    Math.sin(azimuth) * Math.cos(altitude),
    Math.sin(altitude),
    -Math.cos(azimuth) * Math.cos(altitude),
  );
}

function observe(body, date, observer) {
  const equatorial = Equator(body, date, observer, true, true);
  // Skyfield's altaz() call in the original does not apply atmospheric
  // refraction unless pressure/temperature are supplied.
  return Horizon(date, observer, equatorial.ra, equatorial.dec);
}

function loadTexture(url) {
  return new THREE.TextureLoader().loadAsync(url).then(texture => {
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    return texture;
  });
}

export class Skybox {
  static async create(scene, options = {}) {
    const [starMap, moonMap] = await Promise.all([
      loadTexture(options.starMapUrl ?? `${UPSTREAM_ASSET_ROOT}/starmap.png`),
      loadTexture(options.moonMapUrl ?? `${UPSTREAM_ASSET_ROOT}/moon.png`),
    ]);
    return new Skybox(scene, { ...options, starMap, moonMap });
  }

  constructor(scene, {
    starMap,
    moonMap,
    showGrid = false,
    showAtmosphere = true,
    location = SKY_LOCATION,
    directionalLight = null,
    updateInterval = 500,
    date = new Date(),
  }) {
    this.scene = scene;
    this.observer = new Observer(location.latitude, location.longitude, 0);
    this.location = location;
    this.directionalLight = directionalLight;
    this.updateInterval = updateInterval;
    this.lastUpdate = -Infinity;

    this.uniforms = {
      stars_array_sampler: { value: starMap },
      moon_array_sampler: { value: moonMap },
      celestial_matrix: { value: new THREE.Matrix4() },
      moon_matrix: { value: new THREE.Matrix4() },
      sun_position: { value: new THREE.Vector3() },
      moon_position: { value: new THREE.Vector3() },
      show_grid: { value: showGrid },
      show_atmosphere: { value: showAtmosphere },
    };

    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader,
      fragmentShader,
      side: THREE.BackSide,
      depthTest: false,
      depthWrite: false,
      fog: false,
      toneMapped: false,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(50, 64, 32), this.material);
    this.mesh.name = 'Astronomical skybox';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -10_000;
    this.mesh.onBeforeRender = (_renderer, _scene, camera) => {
      this.mesh.position.copy(camera.position);
      this.mesh.updateMatrixWorld();
    };
    scene.add(this.mesh);
    this.update(date, true);
  }

  update(date = new Date(), force = false) {
    const timestamp = date.getTime();
    if (!force && timestamp - this.lastUpdate < this.updateInterval) return false;
    this.lastUpdate = timestamp;

    const sun = observe(Body.Sun, date, this.observer);
    const moon = observe(Body.Moon, date, this.observer);
    horizontalPosition(sun, this.uniforms.sun_position.value);
    horizontalPosition(moon, this.uniforms.moon_position.value);

    const latitudeTurn = THREE.MathUtils.degToRad(90 - this.location.latitude);
    const siderealTurn = THREE.MathUtils.degToRad(
      this.location.longitude + 15 * SiderealTime(date),
    );
    this.uniforms.celestial_matrix.value
      .makeRotationY(siderealTurn)
      .multiply(new THREE.Matrix4().makeRotationX(latitudeTurn));

    this.uniforms.moon_matrix.value
      .makeRotationX(-THREE.MathUtils.degToRad(moon.altitude))
      .multiply(new THREE.Matrix4().makeRotationY(THREE.MathUtils.degToRad(moon.azimuth)));

    if (this.directionalLight) {
      this.directionalLight.position.copy(this.uniforms.sun_position.value).multiplyScalar(20);
    }
    return true;
  }

  set showGrid(value) {
    this.uniforms.show_grid.value = value;
  }

  set showAtmosphere(value) {
    this.uniforms.show_atmosphere.value = value;
  }

  get sunDirection() {
    return this.uniforms.sun_position.value;
  }

  dispose() {
    this.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.uniforms.stars_array_sampler.value.dispose();
    this.uniforms.moon_array_sampler.value.dispose();
  }
}
