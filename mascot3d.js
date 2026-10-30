import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import builtInModelBase64 from './naiwa/naiwa3d/naiwa_lite.glb';

let renderer, scene, camera, controls, frogGroup, placeholderGroup, mascotGroup;
let isInitialized = false;
let isAnimating = false;
let mascotModel = null;   // GLB 加载后替换占位几何体
let mixer = null;         // GLB 骨骼动画播放器（如果有的话）
let baseScale = 1;        // 外层交互组始终以 1 为基准，模型自身只缩放一次
let animationFrame = 0, lastAnimationTime = 0;
let jumpStart = -1000;

function initMascot3D() {
  const container = document.getElementById('mascot-3d-container');
  const canvas = document.getElementById('mascot-3d-canvas');
  const loading = document.getElementById('mascot-3d-loading');
  if (!container || !canvas) return;

  const w = container.clientWidth, h = container.clientHeight;

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0xbfeaff);

  camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 100);
  camera.position.set(0, 0.8, 2.6);
  camera.lookAt(0, 0.6, 0);   // 看向模型脸部高度

  renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(w, h, false);

  // 灯光：提亮版——主光 + 补光 + 轮廓光 + 半球环境光（用户反馈暗淡，整体提亮）
  const keyLight = new THREE.DirectionalLight(0xffffff, 2.0);
  keyLight.position.set(2, 3, 2);
  scene.add(keyLight);
  const fillLight = new THREE.DirectionalLight(0xffffff, 1.0);
  fillLight.position.set(-2, 1, 1.5);
  scene.add(fillLight);
  const rimLight = new THREE.DirectionalLight(0xffeecc, 0.6);
  rimLight.position.set(0, 1, -2);
  scene.add(rimLight);
  const hemiLight = new THREE.HemisphereLight(0xe6f4ff, 0xc8e6c9, 0.9);
  scene.add(hemiLight);

  // ---- 占位奶蛙：黄色椭球身体 + 黑眼睛（GLB 加载失败时的兜底） ----
  const bodyGeo = new THREE.SphereGeometry(1, 32, 32);
  bodyGeo.scale(0.75, 1.15, 0.55);
  const bodyMat = new THREE.MeshStandardMaterial({
    color: 0xffd54d, roughness: 0.72, metalness: 0.05,
  });
  const body = new THREE.Mesh(bodyGeo, bodyMat);

  const eyeGeo = new THREE.SphereGeometry(0.1, 16, 16);
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.3 });
  const leftEye = new THREE.Mesh(eyeGeo, eyeMat);
  leftEye.position.set(-0.32, 0.42, 0.5);
  const rightEye = new THREE.Mesh(eyeGeo, eyeMat);
  rightEye.position.set(0.32, 0.42, 0.5);

  const mouthGeo = new THREE.TorusGeometry(0.18, 0.035, 8, 16, Math.PI * 0.9);
  const mouthMat = new THREE.MeshStandardMaterial({ color: 0xd4a017, roughness: 0.6 });
  const mouth = new THREE.Mesh(mouthGeo, mouthMat);
  mouth.position.set(0, 0.12, 0.56);
  mouth.rotation.z = Math.PI;

  const limbGeo = new THREE.CapsuleGeometry(0.08, 0.28, 4, 12);
  const mkLimb = (x, y, z, rotZ) => {
    const m = new THREE.Mesh(limbGeo, bodyMat);
    m.position.set(x, y, z);
    m.rotation.z = rotZ;
    return m;
  };
  const armL = mkLimb(-0.68, 0.05, 0.15, 0.6);
  const armR = mkLimb(0.68, 0.05, 0.15, -0.6);
  const legL = mkLimb(-0.28, -0.95, 0.1, 0.15);
  const legR = mkLimb(0.28, -0.95, 0.1, -0.15);

  placeholderGroup = new THREE.Group();
  placeholderGroup.add(body, leftEye, rightEye, mouth, armL, armR, legL, legR);
  scene.add(placeholderGroup);
  frogGroup = placeholderGroup;   // 交互目标：先指向占位体，GLB 加载后替换

  // 控制器：拖拽旋转，禁止缩放/平移
  controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.06;
  controls.enableZoom = false;
  controls.enablePan = false;
  controls.autoRotate = true;
  controls.autoRotateSpeed = 1.5;

  // 点击交互：点中奶蛙 → 跳一下
  canvas.addEventListener('pointerdown', (e) => {
    if (!frogGroup) return;
    const rect = canvas.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    const y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(new THREE.Vector2(x, y), camera);
    const hits = raycaster.intersectObject(frogGroup, true);
    if (hits.length) {
      jumpStart = performance.now();
    }
  });

  // 模型内置在脚本里；解析完成前继续显示提示和占位体。
  loading.style.display = 'block';
  const overlay = document.getElementById('mascot-screen');
  overlay.classList.add('mascot-3d-loading');
  isInitialized = true;
  const resize = () => {
    const width = Math.max(1, container.clientWidth), height = Math.max(1, container.clientHeight);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
  };
  window.addEventListener('resize', resize);

  // 加载 GLB 模型替换占位几何体（轻度压缩版：1.39MB，11万三角形，平衡质量与加载速度）
  loadMascotModel('naiwa/naiwa3d/naiwa_lite.glb');
}

function animate() {
  if (!isAnimating) return;
  animationFrame = requestAnimationFrame(animate);
  const now = performance.now(), t = now * 0.001;
  const dt = lastAnimationTime ? Math.min(0.05, (now - lastAnimationTime) / 1000) : 0;
  lastAnimationTime = now;
  if (mixer) {
    mixer.update(dt);
  }
  if (frogGroup) {
    const jump = Math.max(0, 1 - (now - jumpStart) / 480);
    const lift = Math.sin(jump * Math.PI) * 0.16;
    frogGroup.scale.setScalar(baseScale * (1 + Math.sin(t * 2.2) * 0.008 + lift * 0.16));
    frogGroup.position.y = lift;
  }
  controls.update();
  renderer.render(scene, camera);
}

function startMascot3D() {
  if (!isInitialized) {
    try { initMascot3D(); }
    catch (err) {
      console.error('[mascot3d] WebGL initialization failed:', err);
      const overlay = document.getElementById('mascot-screen');
      overlay.classList.remove('mascot-3d-ready', 'mascot-3d-loading');
      document.getElementById('mascot-3d-loading').textContent = '当前浏览器无法显示 3D 模型';
      return;
    }
  }
  if (isAnimating) return;
  isAnimating = true;
  lastAnimationTime = 0;
  animate();
}

function stopMascot3D() {
  isAnimating = false;
  if (animationFrame) cancelAnimationFrame(animationFrame);
  animationFrame = 0;
}

/* 加载 GLB 模型替换占位几何体。
   自动 normalize：计算 bounding box，缩放到统一高度（~2 单位），居中到原点。 */
function loadMascotModel(glbUrl) {
  const loader = new GLTFLoader();
  const overlay = document.getElementById('mascot-screen');
  const loading = document.getElementById('mascot-3d-loading');
  const progress = document.getElementById('mascot-3d-progress-fill');
  const pct = document.getElementById('mascot-3d-progress-pct');

  const onLoaded = (gltf) => {
    const model = gltf.scene;
    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    if (!Number.isFinite(maxDim) || maxDim <= 0) { onError(new Error('模型尺寸无效')); return; }
    const scale = 1.9 / maxDim;
    model.scale.setScalar(scale);
    model.position.set(-center.x * scale, -center.y * scale, -center.z * scale);
    baseScale = 1;

    if (mascotGroup) scene.remove(mascotGroup);
    mascotGroup = new THREE.Group();
    mascotGroup.add(model);
    scene.remove(placeholderGroup);
    scene.add(mascotGroup);
    frogGroup = mascotGroup;
    mascotModel = model;
    mixer = null;
    if (gltf.animations?.length) {
      mixer = new THREE.AnimationMixer(model);
      mixer.clipAction(gltf.animations[0]).play();
    }
    progress.style.width = '100%';
    pct.textContent = '100%';
    overlay.classList.remove('mascot-3d-loading');
    overlay.classList.add('mascot-3d-ready', 'mascot-glb-loaded');
    loading.style.display = 'none';
  };

  const onError = (err) => {
    console.error('[mascot3d] GLB load failed:', err);
    overlay.classList.remove('mascot-3d-loading', 'mascot-3d-ready');
    loading.textContent = '3D 模型加载失败，已切换到备用形象';
    loading.style.display = 'block';
    loading.style.color = '#a15a35';
  };

  if (glbUrl === 'naiwa/naiwa3d/naiwa_lite.glb') {
    try {
      const binary = atob(builtInModelBase64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      loader.parse(bytes.buffer, '', onLoaded, onError);
    } catch (err) { onError(err); }
  } else {
    loader.load(glbUrl, onLoaded, (xhr) => {
      if (xhr.total > 0) {
        const value = Math.round(xhr.loaded / xhr.total * 100);
        progress.style.width = value + '%';
        pct.textContent = value + '%';
      }
    }, onError);
  }
}

window.startMascot3D = startMascot3D;
window.stopMascot3D = stopMascot3D;
window.loadMascotModel = loadMascotModel;
