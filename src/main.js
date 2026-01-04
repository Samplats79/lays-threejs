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

function vueBase() {
  return normalizeBase(
    import.meta.env.VITE_VUE_URL || "https://lays-vue.onrender.com"
  );
}

document.getElementById("logoutBtn")?.addEventListener("click", () => {
  localStorage.removeItem("token");
  window.location.href = vueBase() + "/";
});

const IMAGE_KEY = "lays_bag_image";
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

let bagImageDataUrl = localStorage.getItem(IMAGE_KEY) || "";

function setImageError(msg) {
  const el = document.getElementById("imageError");
  if (el) el.textContent = msg || "";
}

function setPreview(src) {
  const img = document.getElementById("imagePreview");
  if (!img) return;

  if (!src) {
    img.removeAttribute("src");
    img.style.display = "none";
    return;
  }

  img.src = src;
  img.style.display = "block";
}

function bindImageUpload() {
  const input = document.getElementById("bagImage");
  const removeBtn = document.getElementById("removeImageBtn");

  setPreview(bagImageDataUrl);

  input?.addEventListener("change", () => {
    setImageError("");

    const file = input.files?.[0];
    if (!file) return;

    if (!file.type || !file.type.startsWith("image/")) {
      setImageError("Only image files allowed.");
      input.value = "";
      return;
    }

    if (file.size > MAX_IMAGE_BYTES) {
      setImageError("Image too large (max 2MB).");
      input.value = "";
      return;
    }

    const reader = new FileReader();

    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      if (!result.startsWith("data:image/")) {
        setImageError("Invalid image.");
        input.value = "";
        return;
      }

      bagImageDataUrl = result;
      localStorage.setItem(IMAGE_KEY, bagImageDataUrl);
      setPreview(bagImageDataUrl);

      redrawTextureOverlay();
    };

    reader.onerror = () => {
      setImageError("Could not read file.");
      input.value = "";
    };

    reader.readAsDataURL(file);
  });

  removeBtn?.addEventListener("click", () => {
    bagImageDataUrl = "";
    localStorage.removeItem(IMAGE_KEY);
    setPreview("");
    if (input) input.value = "";
    setImageError("");
    redrawTextureOverlay();
  });
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

const renderer = new THREE.WebGLRenderer({
  antialias: true,
  canvas: canvasEl,
  alpha: true,
  preserveDrawingBuffer: true,
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

controls.enablePan = false;
controls.enableZoom = false;
controls.enableRotate = false;

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

  if (
    !decalMesh ||
    !baseCanvas ||
    !baseCtx ||
    !originalMapImage ||
    !decalUVBounds
  )
    return;

  baseCtx.clearRect(0, 0, baseCanvas.width, baseCanvas.height);
  baseCtx.drawImage(originalMapImage, 0, 0, baseCanvas.width, baseCanvas.height);

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

  if (bagImageDataUrl) {
    const img = new Image();
    img.onload = () => {
      const maxImgW = Math.floor(rectW * 0.72);
      const maxImgH = Math.floor(rectH * 0.45);

      const iw = img.naturalWidth || 1;
      const ih = img.naturalHeight || 1;

      const scale = Math.min(maxImgW / iw, maxImgH / ih);
      const drawW = Math.floor(iw * scale);
      const drawH = Math.floor(ih * scale);

      const x = left + Math.floor((rectW - drawW) / 2);
      const y = top + Math.floor(rectH * 0.5);

      baseCtx.shadowColor = "rgba(0,0,0,0.15)";
      baseCtx.shadowBlur = Math.floor(rectW * 0.02);
      baseCtx.drawImage(img, x, y, drawW, drawH);

      drawNameText(name, font, left, top, rectW, rectH);
      baseTexture.needsUpdate = true;
    };
    img.src = bagImageDataUrl;
    return;
  }

  drawNameText(name, font, left, top, rectW, rectH);
  baseTexture.needsUpdate = true;
}

function drawNameText(name, font, left, top, rectW, rectH) {
  if (!name) return;

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

  const textPosV = bagImageDataUrl ? 0.82 : 0.93;
  const safeTop = 0.05;
  const safeBottom = 0.02;

  const safePos = clamp(textPosV, safeTop, 1 - safeBottom);
  const y = top + rectH * safePos;

  baseCtx.fillText(name, x, y);
}

function bindUI() {
  const nameEl = document.getElementById("bagName");
  const colorEl = document.getElementById("bagColor");
  const fontEl = document.getElementById("bagFont");

  const onChange = () => redrawTextureOverlay();

  nameEl?.addEventListener("input", onChange);
  colorEl?.addEventListener("change", onChange);
  fontEl?.addEventListener("change", onChange);

  bindImageUpload();
}

function setFrontView() {
  camera.position.set(0, 0.9, 3.1);
  controls.target.set(0, 0.9, 0);
  camera.lookAt(controls.target);
  controls.update();
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

    bagRoot.rotation.set(0, 0, 0);

    setFrontView();

    bindUI();

    const tryInit = () => {
      const ok = setupBaseCanvasFromDecal();
      redrawTextureOverlay();
      if (!ok) requestAnimationFrame(tryInit);
    };
    tryInit();
  },
  undefined,
  (error) => {
    console.error("GLB load error:", error);
  }
);

function animate() {
  requestAnimationFrame(animate);

  if (bagRoot) {
    bagRoot.rotation.x = 0;
    bagRoot.rotation.z = 0;
  }

  setFrontView();

  renderer.render(scene, camera);
}
animate();

function apiBase() {
  return normalizeBase(import.meta.env.VITE_API_URL);
}

function getObjectScreenRect(object3d) {
  if (!object3d) return null;

  const box = new THREE.Box3().setFromObject(object3d);
  if (!Number.isFinite(box.min.x) || !Number.isFinite(box.max.x)) return null;

  const corners = [
    new THREE.Vector3(box.min.x, box.min.y, box.min.z),
    new THREE.Vector3(box.min.x, box.min.y, box.max.z),
    new THREE.Vector3(box.min.x, box.max.y, box.min.z),
    new THREE.Vector3(box.min.x, box.max.y, box.max.z),
    new THREE.Vector3(box.max.x, box.min.y, box.min.z),
    new THREE.Vector3(box.max.x, box.min.y, box.max.z),
    new THREE.Vector3(box.max.x, box.max.y, box.min.z),
    new THREE.Vector3(box.max.x, box.max.y, box.max.z),
  ];

  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;

  const w = renderer.domElement.width || 1;
  const h = renderer.domElement.height || 1;

  for (const v of corners) {
    v.project(camera);

    const sx = (v.x * 0.5 + 0.5) * w;
    const sy = (-v.y * 0.5 + 0.5) * h;

    if (sx < minX) minX = sx;
    if (sy < minY) minY = sy;
    if (sx > maxX) maxX = sx;
    if (sy > maxY) maxY = sy;
  }

  const pad = Math.max(18, Math.round(Math.min(w, h) * 0.02));

  const x = Math.max(0, Math.floor(minX - pad));
  const y = Math.max(0, Math.floor(minY - pad));
  const x2 = Math.min(w, Math.ceil(maxX + pad));
  const y2 = Math.min(h, Math.ceil(maxY + pad));

  const cw = Math.max(1, x2 - x);
  const ch = Math.max(1, y2 - y);

  return { x, y, w: cw, h: ch };
}

function captureCanvasImage() {
  try {
    if (!bagRoot) return "";

    renderer.render(scene, camera);

    const srcCanvas = renderer.domElement;
    const rect = getObjectScreenRect(bagRoot);
    if (!rect) return "";

    const maxSide = 700;
    const scale = Math.min(1, maxSide / Math.max(rect.w, rect.h));

    const out = document.createElement("canvas");
    out.width = Math.max(1, Math.round(rect.w * scale));
    out.height = Math.max(1, Math.round(rect.h * scale));

    const ctx = out.getContext("2d");
    ctx.clearRect(0, 0, out.width, out.height);

    ctx.drawImage(
      srcCanvas,
      rect.x,
      rect.y,
      rect.w,
      rect.h,
      0,
      0,
      out.width,
      out.height
    );

    const webp = out.toDataURL("image/webp", 0.85);
    if (webp && webp.startsWith("data:image/webp")) return webp;

    return out.toDataURL("image/png");
  } catch {
    return "";
  }
}

document.getElementById("saveBagBtn")?.addEventListener("click", async () => {
  const token = localStorage.getItem("token");

  const name = (document.getElementById("bagName")?.value || "").trim();
  const bagColor = document.getElementById("bagColor")?.value || "yellow";
  const font = document.getElementById("bagFont")?.value || "bold";

  const screenshot = captureCanvasImage();

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

  if (!screenshot) {
    alert("Screenshot failed.");
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
        image: screenshot,
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
