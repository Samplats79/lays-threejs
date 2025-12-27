import "./style.css";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

const canvas = document.querySelector("#app");

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xffffff);

const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 200);
camera.position.set(0, 1.2, 3.2);

const renderer = new THREE.WebGLRenderer({ antialias: true, canvas });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;

const ambient = new THREE.AmbientLight(0xffffff, 0.9);
scene.add(ambient);

const dir = new THREE.DirectionalLight(0xffffff, 1.2);
dir.position.set(2, 3, 2);
scene.add(dir);

const dir2 = new THREE.DirectionalLight(0xffffff, 0.7);
dir2.position.set(-2, 2, -2);
scene.add(dir2);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.target.set(0, 1.0, 0);

const loader = new GLTFLoader();

let bagRoot = null;
let bagMesh = null;
let labelMesh = null;

const ui = {
  name: document.querySelector("#bagName"),
  color: document.querySelector("#bagColor"),
  font: document.querySelector("#bagFont"),
};

const colorMap = {
  yellow: new THREE.Color("#FFD000"),
  red: new THREE.Color("#E11D48"),
  blue: new THREE.Color("#2563EB"),
  green: new THREE.Color("#16A34A"),
};

function makeLabelTexture(text, fontStyle) {
  const c = document.createElement("canvas");
  c.width = 1024;
  c.height = 512;
  const ctx = c.getContext("2d");

  ctx.clearRect(0, 0, c.width, c.height);

  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.font = "700 56px Arial";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("LAYS", c.width / 2, 170);

  const t = (text || "").trim() ? text.trim() : "My Lays Bag";

  if (fontStyle === "italic") ctx.font = "italic 900 92px Arial";
  else if (fontStyle === "regular") ctx.font = "700 92px Arial";
  else ctx.font = "900 92px Arial";

  ctx.fillStyle = "rgba(0,0,0,0.75)";
  ctx.fillText(t, c.width / 2, 290);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

function applyBagColor(mesh, key) {
  const target = colorMap[key] || colorMap.yellow;

  mesh.traverse((child) => {
    if (!child.isMesh) return;
    const mat = child.material;
    if (!mat) return;

    if (Array.isArray(mat)) {
      mat.forEach((m) => {
        if (m && "color" in m) m.color = target.clone();
        if (m) m.needsUpdate = true;
      });
    } else {
      if ("color" in mat) mat.color = target.clone();
      mat.needsUpdate = true;
    }
  });
}

function ensureLabelOnBag() {
  if (!bagRoot || !bagMesh) return;

  if (!labelMesh) {
    const geo = new THREE.PlaneGeometry(1.35, 0.55);
    const tex = makeLabelTexture(ui.name.value, ui.font.value);

    const mat = new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      opacity: 1,
      side: THREE.DoubleSide,
      depthWrite: false,
    });

    labelMesh = new THREE.Mesh(geo, mat);
    labelMesh.renderOrder = 10;

    labelMesh.position.set(0, 1.0, 0.42);
    labelMesh.rotation.set(0, 0, 0);

    bagRoot.add(labelMesh);
  } else {
    labelMesh.material.map?.dispose?.();
    labelMesh.material.map = makeLabelTexture(ui.name.value, ui.font.value);
    labelMesh.material.needsUpdate = true;
  }
}

function findFirstMesh(obj) {
  let found = null;
  obj.traverse((child) => {
    if (!found && child.isMesh) found = child;
  });
  return found;
}

loader.load(
  "/models/chipsbag.glb",
  (gltf) => {
    bagRoot = gltf.scene;
    scene.add(bagRoot);

    bagMesh = findFirstMesh(bagRoot);

    const box = new THREE.Box3().setFromObject(bagRoot);
    const size = new THREE.Vector3();
    box.getSize(size);

    const center = new THREE.Vector3();
    box.getCenter(center);

    bagRoot.position.sub(center);

    const maxAxis = Math.max(size.x, size.y, size.z);
    const scale = 2.0 / maxAxis;
    bagRoot.scale.setScalar(scale);

    bagRoot.position.y += 0.9;

    controls.target.set(0, 0.9, 0);
    controls.update();

    if (bagMesh) {
      applyBagColor(bagRoot, ui.color.value);
      ensureLabelOnBag();
    }
  },
  undefined,
  (error) => {
    console.error("GLB load error:", error);
  }
);

ui.name.addEventListener("input", () => ensureLabelOnBag());
ui.font.addEventListener("change", () => ensureLabelOnBag());
ui.color.addEventListener("change", () => applyBagColor(bagRoot, ui.color.value));

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
