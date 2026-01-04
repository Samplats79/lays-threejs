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
scene.background = new THREE.Color(0xffffff);

const camera = new THREE.PerspectiveCamera(
  45,
  window.innerWidth / window.innerHeight,
  0.1,
  200
);
camera.position.set(0, 1.2, 3.2);

const renderer = new THREE.WebGLRenderer({ antialias: true, canvas: canvasEl });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;

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

let baseCanvas = null;
let baseCtx = null;
let baseTexture = null;
let originalMapImage = null;

let decalFlipY = false;
let decalUVBounds = null;

const colorMap = {
  yellow: "#FFD000",
  red: "#E11D48",
  blue: "#2563EB",
  green: "#16A34A",
};

function isImageReady(img) {
  if (!img) return false;
  if (img instanceof HTMLCanvasElement) return true;
  if (img instanceof Image) return img.complete && img.naturalWidth > 0;
  if (img instanceof ImageBitmap) return true;
  return false;
}

function pickDecalMesh(root) {
  let best = null;
  let bestScore = -1;

  root.traverse((o) => {
    if (!o.isMesh) return;
    const mat = Array.isArray(o.material) ? o.material[0] : o.material;
    if (!mat || !mat.map) return;

    const name = (o.name || "").toLowerCase();
    const looks =
      name.includes("logo") ||
      name.includes("label") ||
      name.includes("decal") ||
      name.includes("text") ||
      name.includes("plane");

    if (!looks) return;

    const geo = o.geometry;
    if (!geo) return;
    if (!geo.boundingBox) geo.computeBoundingBox();
    const bb = geo.boundingBox;
    if (!bb) return;

    const s = new THREE.Vector3();
    bb.getSize(s);
    const score = s.x * s.y * s.z;

    if (score > bestScore) {
      bestScore = score;
      best = o;
    }
  });

  return best;
}

function getUVBounds(mesh) {
  const uv = mesh.geometry?.attributes?.uv;
  if (!uv) return null;

  let minU = Infinity,
    minV = Infinity,
    maxU = -Infinity,
    maxV = -Infinity;

  for (let i = 0; i < uv.count; i++) {
    const u = uv.getX(i);
    const v = uv.getY(i);
    if (u < minU) minU = u;
    if (v < minV) minV = v;
    if (u > maxU) maxU = u;
    if (v > maxV) maxV = v;
  }

  minU = Math.max(0, Math.min(1, minU));
  minV = Math.max(0, Math.min(1, minV));
  maxU = Math.max(0, Math.min(1, maxU));
  maxV = Math.max(0, Math.min(1, maxV));

  return { minU, minV, maxU, maxV };
}

function applyBagColor(hex) {
  if (!bagRoot) return;

  bagRoot.traverse((o) => {
    if (!o.isMesh) return;
    if (decalMesh && o === decalMesh) return;

    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      if (!m) continue;
      if (m.color) m.color.set(hex);
      m.needsUpdate = true;
    }
  });
}

function setupBaseCanvasFromDecal() {
  if (!decalMesh) return false;

  const mat = Array.isArray(decalMesh.material)
    ? decalMesh.material[0]
    : decalMesh.material;
  if (!mat || !mat.map) return false;

  const img = mat.map.image;
  if (!isImageReady(img)) return false;

  originalMapImage = img;
  decalFlipY = mat.map.flipY;
  decalUVBounds = getUVBounds(decalMesh);

  baseCanvas = document.createElement("canvas");
  baseCanvas.width = 2048;
  baseCanvas.height = 2048;

  baseCtx = baseCanvas.getContext("2d");
  baseCtx.clearRect(0, 0, baseCanvas.width, baseCanvas.height);
  baseCtx.drawImage(originalMapImage, 0, 0, baseCanvas.width, baseCanvas.height);

  baseTexture = new THREE.CanvasTexture(baseCanvas);
  baseTexture.colorSpace = THREE.SRGBColorSpace;
  baseTexture.flipY = decalFlipY;
  baseTexture.wrapS = THREE.ClampToEdgeWrapping;
  baseTexture.wrapT = THREE.ClampToEdgeWrapping;

  mat.map = baseTexture;
  mat.needsUpdate = true;

  return true;
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function redrawTextureOverlay() {
  const nameEl = document.getElementById("bagName");
  const colorEl = document.getElementById("bagColor");
  const fontEl = document.getElementById("bagFont");

  const name = (nameEl?.value || "").trim();
  const bagColor = colorEl?.value || "yellow";
  const font = fontEl?.value || "bold";

  applyBagColor(colorMap[bagColor] || "#FFD000");

  if (!decalMesh || !baseCanvas || !baseCtx || !originalMapImage || !decalUVBounds) return;

  baseCtx.clearRect(0, 0, baseCanvas.width, baseCanvas.height);
  baseCtx.drawImage(originalMapImage, 0, 0, baseCanvas.width, baseCanvas.height);

  if (!name) {
    baseTexture.needsUpdate = true;
    return;
  }

  const w = baseCanvas.width;
  const h = baseCanvas.height;

  const { minU, minV, maxU, maxV } = decalUVBounds;

  const yFromV = (v) => (decalFlipY ? (1 - v) * h : v * h);

  const left = Math.floor(minU * w);
  const right = Math.floor(maxU * w);

  const y1 = yFromV(minV);
  const y2 = yFromV(maxV);

  const top = Math.floor(Math.min(y1, y2));
  const bottom = Math.floor(Math.max(y1, y2));

  const rectW = Math.max(1, right - left);
  const rectH = Math.max(1, bottom - top);

  const fontStyle = font === "italic" ? "italic" : "normal";
  const fontWeight = font === "regular" ? "600" : "900";

  const paddingX = Math.floor(rectW * 0.08);
  const maxWidth = rectW - paddingX * 2;

  let fontSize = Math.floor(rectW * 0.18);

  baseCtx.textAlign = "center";
  baseCtx.textBaseline = "middle";
  baseCtx.fillStyle = "rgba(0,0,0,0.9)";
  baseCtx.shadowColor = "rgba(255,255,255,0.8)";
  baseCtx.shadowBlur = Math.floor(rectW * 0.02);

  function fitText(txt) {
    let s = fontSize;
    while (s > 18) {
      baseCtx.font = `${fontStyle} ${fontWeight} ${s}px system-ui, Arial`;
      if (baseCtx.measureText(txt).width <= maxWidth) return s;
      s -= 2;
    }
    return s;
  }

  fontSize = fitText(name);
  baseCtx.font = `${fontStyle} ${fontWeight} ${fontSize}px system-ui, Arial`;

  const x = left + rectW * 0.5;

  const textPosV = 0.93;
  const safeTop = 0.05;
  const safeBottom = 0.02;

  const safePos = clamp(textPosV, safeTop, 1 - safeBottom);
  const y = top + rectH * safePos;

  baseCtx.fillText(name, x, y);

  baseTexture.needsUpdate = true;
}

function apiBase() {
  return normalizeBase(import.meta.env.VITE_API_URL);
}

let currentStep = 1;
let isCamAnimating = false;

function getUI() {
  return {
    nameEl: document.getElementById("bagName"),
    colorEl: document.getElementById("bagColor"),
    fontEl: document.getElementById("bagFont"),
    saveBtn: document.getElementById("saveBagBtn"),
  };
}

function ensureWizardButtons() {
  if (document.getElementById("wizardNav")) return;

  const { saveBtn } = getUI();
  if (!saveBtn) return;

  const nav = document.createElement("div");
  nav.id = "wizardNav";
  nav.style.display = "flex";
  nav.style.gap = "10px";
  nav.style.marginTop = "10px";

  const back = document.createElement("button");
  back.id = "backStepBtn";
  back.type = "button";
  back.textContent = "Back";

  const next = document.createElement("button");
  next.id = "nextStepBtn";
  next.type = "button";
  next.textContent = "Next";

  saveBtn.parentNode.insertBefore(nav, saveBtn.nextSibling);
  nav.appendChild(back);
  nav.appendChild(next);

  back.addEventListener("click", () => setStep(currentStep - 1));
  next.addEventListener("click", () => setStep(currentStep + 1));
}

function setStep(step) {
  const maxStep = 4;
  currentStep = Math.max(1, Math.min(maxStep, step));

  const { nameEl, colorEl, fontEl, saveBtn } = getUI();
  const backBtn = document.getElementById("backStepBtn");
  const nextBtn = document.getElementById("nextStepBtn");

  if (nameEl) nameEl.disabled = currentStep !== 1;
  if (colorEl) colorEl.disabled = currentStep !== 2;
  if (fontEl) fontEl.disabled = currentStep !== 3;
  if (saveBtn) saveBtn.disabled = currentStep !== 4;

  if (backBtn) backBtn.disabled = currentStep === 1;
  if (nextBtn) nextBtn.disabled = currentStep === 4;

  if (currentStep === 1) animateCameraTo({ pos: new THREE.Vector3(0, 1.2, 3.2), target: new THREE.Vector3(0, 0.9, 0) });
  if (currentStep === 2) animateCameraTo({ pos: new THREE.Vector3(0, 1.05, 1.75), target: new THREE.Vector3(0, 0.9, 0) });
  if (currentStep === 3) animateCameraTo({ pos: new THREE.Vector3(0.35, 1.05, 1.75), target: new THREE.Vector3(0, 0.9, 0) });
  if (currentStep === 4) animateCameraTo({ pos: new THREE.Vector3(0, 1.15, 2.3), target: new THREE.Vector3(0, 0.9, 0) });

  redrawTextureOverlay();
}

function animateCameraTo({ pos, target }, duration = 650) {
  if (!pos || !target) return;
  isCamAnimating = true;
  controls.enabled = false;

  const startPos = camera.position.clone();
  const startTarget = controls.target.clone();

  const start = performance.now();

  function ease(t) {
    return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
  }

  function tick(now) {
    const t = Math.min(1, (now - start) / duration);
    const e = ease(t);

    camera.position.lerpVectors(startPos, pos, e);
    controls.target.lerpVectors(startTarget, target, e);

    controls.update();

    if (t < 1) {
      requestAnimationFrame(tick);
    } else {
      controls.enabled = true;
      isCamAnimating = false;
    }
  }

  requestAnimationFrame(tick);
}

function bindWizardUI() {
  const { nameEl, colorEl, fontEl } = getUI();

  const onName = () => {
    if (currentStep !== 1) return;
    redrawTextureOverlay();
  };

  const onColor = () => {
    if (currentStep !== 2) return;
    redrawTextureOverlay();
  };

  const onFont = () => {
    if (currentStep !== 3) return;
    redrawTextureOverlay();
  };

  nameEl?.addEventListener("input", onName);
  colorEl?.addEventListener("change", onColor);
  fontEl?.addEventListener("change", onFont);
}

loader.load(
  "/models/chipsbag.glb",
  (gltf) => {
    bagRoot = gltf.scene;
    scene.add(bagRoot);

    decalMesh = pickDecalMesh(bagRoot);

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

    ensureWizardButtons();
    bindWizardUI();

    const tryInit = () => {
      const ok = setupBaseCanvasFromDecal();
      redrawTextureOverlay();
      if (!ok) requestAnimationFrame(tryInit);
    };
    tryInit();

    setStep(1);
  },
  undefined,
  (error) => {
    console.error("GLB load error:", error);
  }
);

function animate() {
  requestAnimationFrame(animate);
  if (!isCamAnimating) controls.update();
  renderer.render(scene, camera);
}
animate();

document.getElementById("saveBagBtn")?.addEventListener("click", async () => {
  const token = localStorage.getItem("token");

  const name = (document.getElementById("bagName")?.value || "").trim();
  const bagColor = document.getElementById("bagColor")?.value || "yellow";
  const font = document.getElementById("bagFont")?.value || "bold";

  const base = apiBase();
  const url = base ? `${base}/bag` : "";

  if (!url) {
    alert("VITE_API_URL ontbreekt (Environment Variables).");
    return;
  }

  if (!token) {
    alert("Geen token. Log eerst in via Vue.");
    return;
  }

  if (!name) {
    alert("Geef eerst een naam aan je bag.");
    return;
  }

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + token,
      },
      body: JSON.stringify({
        name,
        image: "",
        bagColor,
        font,
        pattern: "plain",
        packaging: "classic",
        inspiration: "",
        keyFlavours: [],
        user: "anonymous",
      }),
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      alert(data?.message || `Save failed (${res.status})`);
      return;
    }

    alert("Saved!");
  } catch (e) {
    alert("Network error.");
  }
});

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
});
