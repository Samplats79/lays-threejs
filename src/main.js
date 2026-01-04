import "./style.css";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

function normalizeBase(url) {
  return (url || "").trim().replace(/\/+$/, "");
}

const params = new URLSearchParams(window.location.search);
const tokenFromUrl = params.get("token");

if (tokenFromUrl) {
  localStorage.setItem("token", tokenFromUrl);
  params.delete("token");
  const newUrl =
    window.location.pathname +
    (params.toString() ? `?${params.toString()}` : "");
  window.history.replaceState({}, "", newUrl);
}

const canvasEl = document.querySelector("#app");

const scene = new THREE.Scene();
scene.background = null;

const camera = new THREE.PerspectiveCamera(
  45,
  window.innerWidth / window.innerHeight,
  0.1,
  200
);
camera.position.set(0, 1.2, 3.2);

const renderer = new THREE.WebGLRenderer({
  antialias: true,
  canvas: canvasEl,
  alpha: true,
});
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.setClearColor(0x000000, 0);

scene.add(new THREE.AmbientLight(0xffffff, 0.9));

const dir = new THREE.DirectionalLight(0xffffff, 1.2);
dir.position.set(2, 3, 2);
scene.add(dir);

const dir2 = new THREE.DirectionalLight(0xffffff, 0.7);
dir2.position.set(-2, 2, -2);
scene.add(dir2);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.target.set(0, 0.9, 0);

const loader = new GLTFLoader();

let bagRoot = null;
let decalMesh = null;

const colorMap = {
  yellow: "#FFD000",
  red: "#E11D48",
  blue: "#2563EB",
  green: "#16A34A",
};

function applyBagColor(hex) {
  if (!bagRoot) return;
  bagRoot.traverse((o) => {
    if (!o.isMesh) return;
    if (decalMesh && o === decalMesh) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      if (m?.color) m.color.set(hex);
    }
  });
}

loader.load("/models/chipsbag.glb", (gltf) => {
  bagRoot = gltf.scene;
  scene.add(bagRoot);

  const box = new THREE.Box3().setFromObject(bagRoot);
  const size = new THREE.Vector3();
  box.getSize(size);

  const center = new THREE.Vector3();
  box.getCenter(center);
  bagRoot.position.sub(center);

  const maxAxis = Math.max(size.x, size.y, size.z);
  bagRoot.scale.setScalar(2 / maxAxis);
  bagRoot.position.y = 0.9;

  controls.update();
});

document.getElementById("bagColor")?.addEventListener("change", (e) => {
  applyBagColor(colorMap[e.target.value]);
});

function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}
animate();

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
});
