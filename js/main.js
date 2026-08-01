// Overhead 3D — hi-res 3D recreation of the ADS-B "Overhead" timelapse (Reston, VA)
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { buildMap } from './map.js';
import { Traffic } from './traffic.js';
import { LiveTraffic } from './live.js';
import { setTagsVisible } from './tags.js';
import { Hud } from './hud.js';

const START_MS = new Date(2026, 6, 30, 10, 57, 0).getTime(); // Thu Jul 30 2026, 10:57 AM
const SPEEDS = [15, 60, 240];
let speedIndex = 1; // 60x like the source video

// ---------- renderer / scene ----------
const container = document.getElementById('app');
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
container.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x04060a);
scene.fog = new THREE.FogExp2(0x04060a, 0.0016);

const camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.1, 600);

const CAMERA_PRESETS = {
  cinematic: { pos: new THREE.Vector3(0, 52, 62), target: new THREE.Vector3(0, 0, -4) },
  top: { pos: new THREE.Vector3(0, 105, 0.01), target: new THREE.Vector3(0, 0, 0) },
  low: { pos: new THREE.Vector3(0, 26, 92), target: new THREE.Vector3(0, 4, -6) },
};
camera.position.copy(CAMERA_PRESETS.cinematic.pos);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.copy(CAMERA_PRESETS.cinematic.target);

// optional ?view=cinematic|top|low
const initialView = new URLSearchParams(location.search).get('view');
if (initialView && CAMERA_PRESETS[initialView]) {
  camera.position.copy(CAMERA_PRESETS[initialView].pos);
  controls.target.copy(CAMERA_PRESETS[initialView].target);
}
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.maxDistance = 220;
controls.minDistance = 8;
controls.autoRotate = true;
controls.autoRotateSpeed = 0.12;
controls.update();

scene.add(new THREE.AmbientLight(0x445566, 0.8));
const dirLight = new THREE.DirectionalLight(0x8899bb, 0.5);
dirLight.position.set(40, 80, 20);
scene.add(dirLight);

buildMap(scene);
const traffic = new Traffic(scene);
const hud = new Hud(START_MS, SPEEDS[speedIndex]);

// ---------- post processing ----------
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth, window.innerHeight),
  0.9, // strength
  0.55, // radius
  0.62 // threshold
);
composer.addPass(bloom);
composer.addPass(new OutputPass());

// ---------- camera preset glide ----------
let glide = null;
function flyTo(preset) {
  glide = {
    t: 0,
    fromPos: camera.position.clone(),
    fromTarget: controls.target.clone(),
    toPos: preset.pos.clone(),
    toTarget: preset.target.clone(),
  };
}

// ---------- recording ----------
let recorder = null;
let recordedChunks = [];
const recordBtn = document.getElementById('btn-record');
function toggleRecord() {
  if (recorder) {
    recorder.stop();
    return;
  }
  const stream = renderer.domElement.captureStream(60);
  recorder = new MediaRecorder(stream, {
    mimeType: 'video/webm;codecs=vp9',
    videoBitsPerSecond: 40_000_000,
  });
  recordedChunks = [];
  recorder.ondataavailable = (e) => e.data.size && recordedChunks.push(e.data);
  recorder.onstop = () => {
    const blob = new Blob(recordedChunks, { type: 'video/webm' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'overhead-3d.webm';
    a.click();
    URL.revokeObjectURL(a.href);
    recorder = null;
    recordBtn.textContent = '● Record';
    recordBtn.classList.remove('recording');
  };
  recorder.start(250);
  recordBtn.textContent = '■ Stop';
  recordBtn.classList.add('recording');
}

// ---------- UI wiring ----------
let paused = false;
const pauseBtn = document.getElementById('btn-pause');
function setPaused(p) {
  paused = p;
  pauseBtn.textContent = paused ? '▶ Play' : '⏸ Pause';
}
pauseBtn.addEventListener('click', () => setPaused(!paused));
recordBtn.addEventListener('click', toggleRecord);

const speedBtns = [...document.querySelectorAll('[data-speed]')];
function setSpeedIndex(i) {
  speedIndex = i;
  hud.setSpeed(SPEEDS[speedIndex]);
  speedBtns.forEach((b) => b.classList.toggle('active', Number(b.dataset.speed) === SPEEDS[i]));
}
speedBtns.forEach((b) => b.addEventListener('click', () => setSpeedIndex(SPEEDS.indexOf(Number(b.dataset.speed)))));
setSpeedIndex(speedIndex);

// ---------- live / sim mode ----------
const subtitleEl = document.getElementById('hud-subtitle');
const modeBtn = document.getElementById('btn-mode');
let live = null;
let mode = 'sim';
function setMode(next) {
  mode = next;
  const isLive = mode === 'live';
  traffic.group.visible = !isLive;
  modeBtn.textContent = isLive ? '⇣ Go Sim' : '⇡ Go Live';
  modeBtn.classList.toggle('live', isLive);
  subtitleEl.textContent = isLive
    ? 'LIVE · 50 mi around Arlington, VA (22206) · airborne only · ADS-B airplanes.live'
    : '50 mi around Arlington, VA (22206) · airborne only';
  speedBtns.forEach((b) => (b.disabled = isLive));
  pauseBtn.disabled = isLive;
  if (isLive) {
    if (!live) live = new LiveTraffic(scene);
    live.group.visible = true;
    live.start();
  } else if (live) {
    live.stop();
    live.group.visible = false;
  }
}
modeBtn.addEventListener('click', () => setMode(mode === 'live' ? 'sim' : 'live'));
if (new URLSearchParams(location.search).get('mode') === 'live') setMode('live');

// ---------- flight tags toggle ----------
const tagsBtn = document.getElementById('btn-tags');
let tagsOn = true;
function toggleTags() {
  tagsOn = !tagsOn;
  setTagsVisible(tagsOn);
  tagsBtn.classList.toggle('active', tagsOn);
}
tagsBtn.addEventListener('click', toggleTags);

window.addEventListener('keydown', (e) => {
  if (e.code === 'Space') { e.preventDefault(); setPaused(!paused); }
  else if (e.key === '1') flyTo(CAMERA_PRESETS.cinematic);
  else if (e.key === '2') flyTo(CAMERA_PRESETS.top);
  else if (e.key === '3') flyTo(CAMERA_PRESETS.low);
  else if (e.key === 'r' || e.key === 'R') toggleRecord();
  else if (e.key === 'l' || e.key === 'L') setMode(mode === 'live' ? 'sim' : 'live');
  else if (e.key === 'f' || e.key === 'F') toggleTags();
  else if (e.key === '+' || e.key === '=') setSpeedIndex(Math.min(SPEEDS.length - 1, speedIndex + 1));
  else if (e.key === '-') setSpeedIndex(Math.max(0, speedIndex - 1));
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
});

// user interaction pauses the slow auto-orbit for a while
let orbitResumeAt = 0;
controls.addEventListener('start', () => { controls.autoRotate = false; });
controls.addEventListener('end', () => { orbitResumeAt = performance.now() + 6000; });

// ---------- main loop ----------
const clock = new THREE.Clock();
let simTime = 0;
let liveTime = 0;

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.1);
  liveTime += dt;

  if (!controls.autoRotate && orbitResumeAt && performance.now() > orbitResumeAt) {
    controls.autoRotate = true;
    orbitResumeAt = 0;
  }

  if (glide) {
    glide.t = Math.min(1, glide.t + dt / 1.4);
    const k = glide.t * glide.t * (3 - 2 * glide.t); // smoothstep
    camera.position.lerpVectors(glide.fromPos, glide.toPos, k);
    controls.target.lerpVectors(glide.fromTarget, glide.toTarget, k);
    if (glide.t >= 1) glide = null;
  }

  if (mode === 'live') {
    live.update(dt, liveTime, camera);
    hud.updateLive(live.count, live.feedOk);
  } else if (!paused) {
    const simDt = dt * hud.speed;
    simTime += simDt;
    hud.advance(dt);
    traffic.update(simDt, simTime, camera);
    hud.update(traffic.count);
  } else {
    traffic.update(0, simTime, camera); // keep trails oriented
    hud.update(traffic.count);
  }

  controls.update();
  composer.render();
}
animate();
