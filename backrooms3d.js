import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import naidanGlb from './naiwa/backrooms3d/naidan.glb';
import naishuGlb from './naiwa/backrooms3d/naishu.glb';

/* Level 0 is deliberately self-contained: the main match-3 game only opens/closes it. */
const screen = document.getElementById('backrooms-screen');
const canvas = document.getElementById('br-cv');
const mask = document.getElementById('br-mask');
const N = 21;
const EYE = 1.58;
const PLAYER_RADIUS = 0.22;
const GOAL = 3;
const ui = {
  hp: document.getElementById('br-hp'), milk: document.getElementById('br-milk'),
  rescued: document.getElementById('br-rescued'), objective: document.getElementById('br-objective'),
  clock: document.getElementById('br-clock'), toast: document.getElementById('br-toast'),
  title: document.getElementById('br-mask-title'), message: document.getElementById('br-msg'),
  start: document.getElementById('br-start-btn'), tip: document.getElementById('br-tip'),
};
const copy = {
  zh: {
    back:'返回大厅', hp:'生命', milk:'牛奶', rescued:'已救援', find:'寻找迷路的奶鼠',
    exit:'奶鼠已救齐，寻找绿色出口', intro:'救出 3 只迷路奶鼠，再找到出口。奶蛋看见你后会追一小段，趁它停下时绕开。',
    introButton:'进入 LEVEL 0', retry:'重新进入', resume:'继续探索',
    win:'出口找到了', winMsg:'你带着所有奶鼠逃出了 Level 0。',
    lose:'信号中断', loseMsg:'奶蛋抓住了你。再试一次。',
    pause:'信号暂停', pauseMsg:'深呼吸，走廊还在等你。',
    tip:'WASD 移动 · 鼠标上下左右观察 · 点击或空格泼牛奶 · Shift 奔跑',
    mobileTip:'左侧摇杆移动 · 右侧上下左右滑动观察 · 牛奶攻击 · ↟ 奔跑',
    save:'奶鼠救援成功：{n} / 3', ready:'出口已经开启', hit:'奶蛋被制服', spotted:'奶蛋发现你了！',
    loading:'正在准备奶蛋和奶鼠模型…', modelError:'角色模型加载失败，请重新打开游戏。',
    blocked:'前方有墙，牛奶没有命中', empty:'牛奶快用完了', webglError:'无法启动 3D 画面，请检查浏览器是否支持 WebGL。',
  },
  en: {
    back:'BACK TO LOBBY', hp:'HEALTH', milk:'MILK', rescued:'RESCUED', find:'FIND THE LOST MICE',
    exit:'ALL RESCUED · FIND THE GREEN EXIT', intro:'Rescue three lost mice, then find the exit. The egg chases briefly after spotting you; slip away when it stops.',
    introButton:'ENTER LEVEL 0', retry:'TRY AGAIN', resume:'RESUME',
    win:'EXIT FOUND', winMsg:'You brought every mouse out of Level 0.',
    lose:'SIGNAL LOST', loseMsg:'The egg caught you. Try again.',
    pause:'SIGNAL PAUSED', pauseMsg:'Take a breath. The corridors will wait.',
    tip:'WASD move · look around with the mouse · click/Space throw milk · Shift sprint',
    mobileTip:'Left stick move · swipe right to look around · milk to attack · ↟ sprint',
    save:'MOUSE RESCUED: {n} / 3', ready:'THE EXIT IS OPEN', hit:'EGG STOPPED', spotted:'THE EGG SAW YOU!',
    loading:'PREPARING THE EGG AND MOUSE MODELS…', modelError:'Character models failed to load. Please reopen the game.',
    blocked:'THE WALL BLOCKED YOUR SHOT', empty:'LOW ON MILK', webglError:'The 3D scene could not start. Check WebGL support in your browser.',
  },
};
const text = key => copy[document.documentElement.lang.startsWith('en') ? 'en' : 'zh'][key];

let renderer, scene, camera, world, grid, exit, exitLight, exitMaterial;
let friends = [], enemies = [], raf = 0, audio, hum, humGain;
let open = false, running = false, phase = 'intro', hadPointerLock = false;
let hp = 100, milk = 12, rescued = 0, elapsed = 0, shotFlash = 0, damageFlash = 0;
let yaw = 0, pitch = 0, px = 1, pz = 1, joyX = 0, joyY = 0, sprintTouch = false;
let lastTime = 0, stepClock = 0, toastTimer = 0, rng = Math.random;
let audioPrefs = {music:true,sfx:true};
let lastObjective = '';
let assetPromise, models, entryId = 0;
const keys = Object.create(null);

function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}
function pick(a) { return a[Math.floor(rng() * a.length)]; }
function inside(x, z) { return x >= 0 && z >= 0 && x < N && z < N; }
function floorAt(x, z) { return inside(x,z) && grid[z][x] === 0; }
function cellAt(x, z) { return floorAt(Math.floor(x + .5), Math.floor(z + .5)); }
function clearAt(x, z) {
  const r = PLAYER_RADIUS;
  return cellAt(x-r,z-r) && cellAt(x+r,z-r) && cellAt(x-r,z+r) && cellAt(x+r,z+r);
}
function distance(a,b) { return Math.hypot(a.x-b.x,a.z-b.z); }
function lineClear(x1,z1,x2,z2) {
  const n = Math.ceil(Math.hypot(x2-x1,z2-z1) * 9);
  for(let i=1;i<n;i++) {
    const t=i/n;
    if(!cellAt(x1+(x2-x1)*t,z1+(z2-z1)*t)) return false;
  }
  return true;
}
function neighbors(c,z) {
  return [[c+1,z],[c-1,z],[c,z+1],[c,z-1]].filter(([x,y])=>floorAt(x,y));
}
function distances(sx,sz) {
  const dist = Array.from({length:N},()=>Array(N).fill(-1));
  const q = [[sx,sz]]; dist[sz][sx]=0;
  for(let i=0;i<q.length;i++) {
    const [x,z]=q[i];
    for(const [nx,nz] of neighbors(x,z)) if(dist[nz][nx]<0) {
      dist[nz][nx]=dist[z][x]+1; q.push([nx,nz]);
    }
  }
  return dist;
}
function route(sx,sz,tx,tz) {
  if(sx===tx && sz===tz) return [];
  const prev = Array.from({length:N},()=>Array(N).fill(null));
  const q=[[sx,sz]]; prev[sz][sx]=[sx,sz];
  for(let i=0;i<q.length;i++) {
    const [x,z]=q[i];
    if(x===tx && z===tz) break;
    for(const [nx,nz] of neighbors(x,z)) if(!prev[nz][nx]) {
      prev[nz][nx]=[x,z]; q.push([nx,nz]);
    }
  }
  if(!prev[tz]?.[tx]) return [];
  const out=[]; let x=tx,z=tz;
  while(x!==sx || z!==sz) { out.push({x,z}); [x,z]=prev[z][x]; }
  return out.reverse();
}
function generateMap() {
  grid = Array.from({length:N},()=>Array(N).fill(1));
  const stack=[[1,1]]; grid[1][1]=0;
  while(stack.length) {
    const [x,z]=stack[stack.length-1];
    const dirs=[[2,0],[-2,0],[0,2],[0,-2]].filter(([dx,dz])=>{
      const nx=x+dx,nz=z+dz;
      return nx>0 && nz>0 && nx<N-1 && nz<N-1 && grid[nz][nx];
    });
    if(!dirs.length) { stack.pop(); continue; }
    const [dx,dz]=pick(dirs);
    grid[z+dz/2][x+dx/2]=0; grid[z+dz][x+dx]=0;
    stack.push([x+dx,z+dz]);
  }
  /* Add loops and open rooms without disconnecting the carved maze. */
  for(let z=2;z<N-2;z++) for(let x=2;x<N-2;x++) if(grid[z][x] && rng()<.18) {
    if((floorAt(x-1,z)&&floorAt(x+1,z)) || (floorAt(x,z-1)&&floorAt(x,z+1))) grid[z][x]=0;
  }
  for(let i=0;i<4;i++) {
    const cx=3+2*Math.floor(rng()*7), cz=3+2*Math.floor(rng()*7);
    for(let z=cz-1;z<=cz+1;z++) for(let x=cx-1;x<=cx+1;x++) grid[z][x]=0;
  }
  const d=distances(1,1), candidates=[];
  for(let z=1;z<N-1;z++) for(let x=1;x<N-1;x++) if(grid[z][x]===0 && d[z][x]>=0) candidates.push({x,z,d:d[z][x]});
  candidates.sort((a,b)=>b.d-a.d);
  exit=candidates[0];
  const selected=[];
  for(const c of candidates) {
    if(c.d<8 || distance(c,exit)<3 || selected.some(f=>distance(c,f)<4)) continue;
    selected.push(c); if(selected.length===GOAL) break;
  }
  if(selected.length<GOAL) {
    for(const c of candidates) if(!selected.some(f=>f.x===c.x&&f.z===c.z) && distance(c,exit)>2) {
      selected.push(c); if(selected.length===GOAL) break;
    }
  }
  const enemySpots=[];
  for(const c of candidates) if(c.d>5 && distance(c,{x:1,z:1})>5 && distance(c,exit)>2 && selected.every(f=>distance(c,f)>2)) {
    if(enemySpots.every(e=>distance(e,c)>5)) enemySpots.push(c);
    if(enemySpots.length===3) break;
  }
  return { selected, enemySpots };
}
function texture(kind,seed) {
  const c=document.createElement('canvas'); c.width=c.height=128;
  const g=c.getContext('2d'), noise=seeded(seed);
  g.fillStyle=kind==='wall'?'#a99b65':kind==='floor'?'#5d5840':'#a6a38a'; g.fillRect(0,0,128,128);
  for(let i=0;i<7500;i++) {
    const n=Math.floor(noise()*255), x=noise()*128, y=noise()*128;
    g.fillStyle=`rgba(${n},${n},${n},${kind==='floor'?.055:.035})`;
    g.fillRect(x,y,kind==='floor'?2:1,1);
  }
  if(kind==='wall') {
    g.fillStyle='rgba(72,62,35,.18)';
    for(let x=0;x<128;x+=31) g.fillRect(x,0,2,128);
    g.fillStyle='#766f4b'; g.fillRect(0,108,128,7);
    g.fillStyle='#d1c18a'; g.fillRect(0,106,128,2);
  } else if(kind==='ceiling') {
    g.strokeStyle='rgba(58,59,49,.35)'; g.lineWidth=2;
    g.strokeRect(0,0,127,127);
  } else {
    g.fillStyle='rgba(27,31,22,.12)';
    for(let y=0;y<128;y+=4) g.fillRect(0,y,128,1);
  }
  const t=new THREE.CanvasTexture(c); t.wrapS=t.wrapT=THREE.RepeatWrapping;
  t.colorSpace=THREE.SRGBColorSpace; t.anisotropy=2; return t;
}
function decodeGlb(base64) {
  const binary=atob(base64), bytes=new Uint8Array(binary.length);
  for(let i=0;i<binary.length;i++) bytes[i]=binary.charCodeAt(i);
  return bytes.buffer;
}
function parseModel(base64) {
  return new Promise((resolve,reject)=>new GLTFLoader().parse(decodeGlb(base64),'',gltf=>{
    const template=gltf.scene;
    template.rotation.x=Math.PI/2; // supplied sculpts use Z as the up axis
    template.updateMatrixWorld(true);
    const bounds=new THREE.Box3().setFromObject(template);
    const size=bounds.getSize(new THREE.Vector3());
    if(!Number.isFinite(size.y)||size.y<=0) {reject(new Error('invalid character bounds'));return;}
    const scale=.92/size.y;
    template.scale.multiplyScalar(scale);
    template.position.set(-(bounds.min.x+bounds.max.x)*.5*scale,-bounds.min.y*scale,-(bounds.min.z+bounds.max.z)*.5*scale);
    template.traverse(o=>{if(o.isMesh) o.userData.sharedAsset=true;});
    resolve(template);
  },reject));
}
function loadModels() {
  if(!assetPromise) assetPromise=Promise.all([parseModel(naidanGlb),parseModel(naishuGlb)])
    .then(([egg,mouse])=>{models={egg,mouse};return models;})
    .catch(err=>{assetPromise=null;throw err;});
  return assetPromise;
}
function character(kind) {
  const group=new THREE.Group();
  group.add(models[kind].clone(true));
  const ring=new THREE.Mesh(new THREE.RingGeometry(.32,.44,28),new THREE.MeshBasicMaterial({
    color:kind==='egg'?0xc94634:0x74efb4,transparent:true,opacity:kind==='egg'?.54:.7,side:THREE.DoubleSide,depthWrite:false,
  }));
  ring.rotation.x=-Math.PI/2;ring.position.y=.025;group.add(ring);
  return group;
}
function clearWorld() {
  if(!world) return;
  scene.remove(world);
  const geometries=new Set(), materials=new Set();
  world.traverse(o=>{ if(o.userData.sharedAsset) return; if(o.geometry) geometries.add(o.geometry); if(o.material) materials.add(o.material); });
  geometries.forEach(g=>g.dispose());
  materials.forEach(m=>{if(m.map)m.map.dispose();m.dispose();});
  world=null;
}
function buildWorld() {
  clearWorld();
  const data=generateMap();
  world=new THREE.Group(); scene.add(world);
  const wallTex=texture('wall',1234), floorTex=texture('floor',5678), ceilTex=texture('ceiling',9012);
  floorTex.repeat.set(N/3,N/3); ceilTex.repeat.set(N/3,N/3);
  const floor=new THREE.Mesh(new THREE.PlaneGeometry(N,N),new THREE.MeshLambertMaterial({map:floorTex,color:0xb9b091,side:THREE.DoubleSide}));
  floor.rotation.x=-Math.PI/2; floor.position.set((N-1)/2,0,(N-1)/2); world.add(floor);
  const ceiling=new THREE.Mesh(new THREE.PlaneGeometry(N,N),new THREE.MeshLambertMaterial({map:ceilTex,color:0xbcb8a6,side:THREE.DoubleSide}));
  ceiling.rotation.x=Math.PI/2; ceiling.position.set((N-1)/2,3,(N-1)/2); world.add(ceiling);
  const wallCells=[];
  for(let z=0;z<N;z++) for(let x=0;x<N;x++) if(grid[z][x]) wallCells.push([x,z]);
  const walls=new THREE.InstancedMesh(new THREE.BoxGeometry(1,3,1),new THREE.MeshLambertMaterial({map:wallTex,color:0xc6b67e}),wallCells.length);
  const dummy=new THREE.Object3D();
  wallCells.forEach(([x,z],i)=>{dummy.position.set(x,1.5,z);dummy.updateMatrix();walls.setMatrixAt(i,dummy.matrix);});
  walls.instanceMatrix.needsUpdate=true; world.add(walls);
  const panelMat=new THREE.MeshBasicMaterial({color:0xf6edc0});
  let fixtureCount=0, pointCount=0;
  for(let z=1;z<N-1;z++) for(let x=1;x<N-1;x++) if(!grid[z][x] && (x+z*3)%13===0 && fixtureCount<18) {
    const panel=new THREE.Mesh(new THREE.BoxGeometry(.72,.035,.2),panelMat);
    panel.position.set(x,2.958,z); world.add(panel); fixtureCount++;
    if(pointCount<5 && (x+z)%3===0) {
      const light=new THREE.PointLight(0xffe7ad,9,6,2);light.position.set(x,2.7,z);world.add(light);pointCount++;
    }
  }
  const portal=new THREE.Group();
  exitMaterial=new THREE.MeshBasicMaterial({color:0x9d874c,side:THREE.DoubleSide,transparent:true,opacity:.75});
  const plane=new THREE.Mesh(new THREE.PlaneGeometry(.95,1.72),exitMaterial);
  plane.position.y=.88; portal.add(plane);
  const arch=new THREE.Mesh(new THREE.TorusGeometry(.63,.055,6,32,Math.PI),new THREE.MeshBasicMaterial({color:0xd6c388}));
  arch.position.y=1.72; portal.add(arch);
  portal.position.set(exit.x,.02,exit.z); world.add(portal);
  exitLight=new THREE.PointLight(0xc7a970,3,4,2);exitLight.position.set(exit.x,1.45,exit.z);world.add(exitLight);
  friends=data.selected.map((p,i)=>{ const mesh=character('mouse');mesh.position.set(p.x,0,p.z);world.add(mesh);return {x:p.x,z:p.z,mesh,phase:i*2.1}; });
  enemies=data.enemySpots.map((p,i)=>{ const mesh=character('egg');mesh.position.set(p.x,0,p.z);world.add(mesh);return {x:p.x,z:p.z,mesh,hp:2,path:[],think:i*.22,attack:0,phase:i*1.8,state:'idle',chaseTime:0,chaseDistance:0,rest:0,lastSeen:null}; });
  px=1; pz=1;
  const first=neighbors(1,1)[0]; yaw=first?Math.atan2(-(first[0]-1),-(first[1]-1)):0; pitch=0;
  camera.position.set(px,EYE,pz); camera.rotation.set(pitch,yaw,0,'YXZ');
  scene.fog=new THREE.FogExp2(0x33311e,.058);
}
function init() {
  if(renderer) return true;
  try {
    renderer=new THREE.WebGLRenderer({canvas,antialias:false,powerPreference:'high-performance'});
    renderer.outputColorSpace=THREE.SRGBColorSpace;
    renderer.toneMapping=THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure=1.45;
    scene=new THREE.Scene();scene.background=new THREE.Color(0x35321f);
    scene.add(new THREE.HemisphereLight(0xd7cfa8,0x3c3928,1.5));
    camera=new THREE.PerspectiveCamera(88,1,.05,35);
    const torch=new THREE.SpotLight(0xfff1c8,26,10,.6,.65,1.6);
    torch.position.set(0,-.1,0); torch.target.position.set(0,-.06,-1);
    camera.add(torch,torch.target);scene.add(camera);
    resize(); return true;
  } catch(err) {
    console.error('[backrooms3d] WebGL initialization failed',err);
    ui.message.textContent=text('webglError'); return false;
  }
}
function resize() {
  if(!renderer) return;
  const w=Math.max(1,window.innerWidth),h=Math.max(1,window.innerHeight);
  const touch=matchMedia('(pointer:coarse)').matches;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,touch?1.15:1.5));
  renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();
}
function hud() {
  ui.hp.textContent=Math.max(0,Math.ceil(hp));ui.milk.textContent=milk;
  ui.rescued.textContent=`${rescued} / ${GOAL}`;
  objective();
  ui.clock.textContent=String(Math.floor(elapsed/60)).padStart(2,'0')+':'+String(Math.floor(elapsed%60)).padStart(2,'0');
}
function objective() {
  const targets=rescued===GOAL?[exit]:friends;
  const nearest=targets.length?Math.min(...targets.map(t=>Math.hypot(t.x-px,t.z-pz))):0;
  const label=`${text(rescued===GOAL?'exit':'find')} · ${Math.ceil(nearest)}m`;
  if(label!==lastObjective) {ui.objective.textContent=label;lastObjective=label;}
}
function notice(message) {
  ui.toast.textContent=message;ui.toast.classList.add('show');
  clearTimeout(toastTimer);toastTimer=setTimeout(()=>ui.toast.classList.remove('show'),2200);
}
function sync() {
  document.getElementById('br-back-label').textContent=text('back');
  document.getElementById('br-hp-label').textContent=text('hp');
  document.getElementById('br-milk-label').textContent=text('milk');
  document.getElementById('br-rescued-label').textContent=text('rescued');
  ui.title.textContent=phase==='intro'?(document.documentElement.lang.startsWith('en')?'NAIWA BACKROOMS':'蛙后室'):text(phase==='win'?'win':phase==='lose'?'lose':'pause');
  ui.message.textContent=text(phase==='intro'?'intro':phase==='win'?'winMsg':phase==='lose'?'loseMsg':'pauseMsg');
  ui.start.innerHTML=`${text(phase==='intro'?'introButton':phase==='paused'?'resume':'retry')} <span>→</span>`;
  ui.tip.textContent=text(matchMedia('(pointer:coarse)').matches?'mobileTip':'tip');
  hud();
}
function showMask(newPhase) { phase=newPhase;mask.classList.remove('hide');screen.classList.remove('playing');sync(); }
function audioStart() {
  try {
    if(!audio) {
      audio=new (window.AudioContext||window.webkitAudioContext)();
      hum=audio.createOscillator();hum.type='sawtooth';hum.frequency.value=57;
      const filter=audio.createBiquadFilter();filter.type='lowpass';filter.frequency.value=115;
      humGain=audio.createGain();humGain.gain.value=audioPrefs.music?.018:0;
      hum.connect(filter);filter.connect(humGain);humGain.connect(audio.destination);hum.start();
    }
    audio.resume();
  } catch(e) {}
}
function sound(freq,dur=.08,type='sine',vol=.08) {
  if(!audioPrefs.sfx || !audio || audio.state!=='running') return;
  const osc=audio.createOscillator(),gain=audio.createGain();
  osc.type=type;osc.frequency.setValueAtTime(freq,audio.currentTime);
  osc.frequency.exponentialRampToValueAtTime(Math.max(40,freq*.58),audio.currentTime+dur);
  gain.gain.setValueAtTime(vol,audio.currentTime);
  gain.gain.exponentialRampToValueAtTime(.001,audio.currentTime+dur);
  osc.connect(gain);gain.connect(audio.destination);osc.start();osc.stop(audio.currentTime+dur);
}
function lockPointer() {
  if(!canvas.requestPointerLock) return;
  try {
    const result=canvas.requestPointerLock();
    if(result && typeof result.catch==='function') result.catch(()=>{});
  } catch(e) {}
}
function start() {
  if(!init()) {ui.start.disabled=true;ui.message.textContent=text('webglError');return;}
  if(!world || !models) {ui.message.textContent=text('loading');return;}
  if(phase!=='paused' && phase!=='intro') {
    rng=seeded((Date.now()^Math.floor(Math.random()*0xffffffff))>>>0);
    buildWorld();hp=100;milk=12;rescued=0;elapsed=0;stepClock=0;
  }
  phase='play';running=true;screen.classList.add('playing');mask.classList.add('hide');
  hadPointerLock=false;
  lastTime=performance.now();audioStart();hud();
  if(!matchMedia('(pointer:coarse)').matches) lockPointer();
  if(!raf) raf=requestAnimationFrame(frame);
}
function pause() {
  if(!running) return;
  running=false;if(raf){cancelAnimationFrame(raf);raf=0;}
  showMask('paused');
  if(document.pointerLockElement===canvas) document.exitPointerLock();
  if(audio) audio.suspend();
}
function end(win) {
  running=false;if(raf){cancelAnimationFrame(raf);raf=0;}
  showMask(win?'win':'lose');
  if(document.pointerLockElement===canvas) document.exitPointerLock();
  sound(win?700:120,.45,'sawtooth',.12);
  if(audio) setTimeout(()=>{if(!running) audio.suspend();},500);
}
function shoot() {
  if(!running) return;
  if(milk<=0) {notice(text('empty'));sound(100,.05);return;}
  milk--;shotFlash=.12;sound(290,.14,'sawtooth',.11);hud();
  const fx=-Math.sin(yaw),fz=-Math.cos(yaw);
  let target=null,best=8,blocked=false;
  for(const e of enemies) {
    const dx=e.x-px,dz=e.z-pz,d=Math.hypot(dx,dz);
    if(d>7 || d<.1) continue;
    const dot=(dx*fx+dz*fz)/d;
    if(dot<Math.max(.94,1-.11/d)) continue;
    if(!lineClear(px,pz,e.x,e.z)) {blocked=true;continue;}
    if(d<best){best=d;target=e;}
  }
  if(target) {
    target.hp--;target.mesh.scale.setScalar(.8);sound(130,.12,'square',.09);
    if(target.hp<=0){world.remove(target.mesh);enemies.splice(enemies.indexOf(target),1);notice(text('hit'));}
  } else if(blocked) notice(text('blocked'));
}
function move(dt) {
  let forward=(keys.w||keys.ArrowUp?1:0)-(keys.s||keys.ArrowDown?1:0)-joyY;
  let strafe=(keys.d?1:0)-(keys.a?1:0)+joyX;
  if(keys.ArrowLeft) yaw+=dt*1.9;
  if(keys.ArrowRight) yaw-=dt*1.9;
  const len=Math.hypot(forward,strafe);
  if(len>1){forward/=len;strafe/=len;}
  const moving=len>.03,speed=(keys.Shift||sprintTouch?3.55:2.25);
  if(moving) {
    const dx=(-Math.sin(yaw)*forward+Math.cos(yaw)*strafe)*speed*dt;
    const dz=(-Math.cos(yaw)*forward-Math.sin(yaw)*strafe)*speed*dt;
    if(clearAt(px+dx,pz)) px+=dx;
    if(clearAt(px,pz+dz)) pz+=dz;
    stepClock+=dt*speed;
    if(stepClock>1.15){stepClock=0;sound(78,.045,'triangle',.018);}
  }
  camera.position.set(px,EYE+(moving?Math.sin(elapsed*speed*9)*.024:0),pz);
  camera.rotation.set(pitch,yaw,0,'YXZ');
  for(let i=friends.length-1;i>=0;i--) {
    const f=friends[i];
    f.mesh.position.y=.08+Math.sin(elapsed*2+f.phase)*.08;
    f.mesh.rotation.y=Math.sin(elapsed+f.phase)*.22;
    if(Math.hypot(f.x-px,f.z-pz)<.72) {
      world.remove(f.mesh);friends.splice(i,1);rescued++;milk=Math.min(18,milk+3);
      sound(620,.14);setTimeout(()=>sound(880,.14),90);
      notice(text('save').replace('{n}',rescued));hud();
      if(rescued===GOAL) {
        exitMaterial.color.setHex(0x3fffc1);exitMaterial.opacity=.85;
        exitLight.color.setHex(0x2dffc1);exitLight.intensity=10;
        notice(text('ready'));
      }
    }
  }
  if(rescued===GOAL && Math.hypot(exit.x-px,exit.z-pz)<.8) end(true);
}
function updateEnemies(dt) {
  for(const e of enemies) {
    e.think-=dt;e.attack-=dt;
    const dist=Math.hypot(e.x-px,e.z-pz);
    const seesPlayer=dist<5.2 && lineClear(e.x,e.z,px,pz);
    if(e.state==='rest') {
      e.rest-=dt;
      if(e.rest<=0 && dist>3.4) e.state='idle';
    } else if(e.state==='idle' && seesPlayer) {
      e.state='alert';e.think=.4;e.path=[];
      e.lastSeen={x:Math.round(px),z:Math.round(pz)};
      notice(text('spotted'));sound(190,.28,'sawtooth',.07);
    } else if(e.state==='alert' && e.think<=0) {
      e.state='chase';e.think=0;e.chaseTime=0;e.chaseDistance=0;
    }

    if(e.state==='chase') {
      e.chaseTime+=dt;
      if(seesPlayer) e.lastSeen={x:Math.round(px),z:Math.round(pz)};
      if(e.think<=0) {
        e.think=.42;
        const target=e.lastSeen;
        e.path=target?route(Math.round(e.x),Math.round(e.z),target.x,target.z):[];
      }
      const next=e.path[0];
      if(next) {
        const dx=next.x-e.x,dz=next.z-e.z,d=Math.hypot(dx,dz);
        if(d<.12) e.path.shift();
        else {
          const step=Math.min(d,dt*.82);
          const nx=e.x+dx/d*step,nz=e.z+dz/d*step;
          if(cellAt(nx,nz)) {e.x=nx;e.z=nz;e.chaseDistance+=step;}
        }
      }
      if(e.chaseTime>=4 || e.chaseDistance>=2.7 || (!seesPlayer && !e.path.length)) {
        e.state='rest';e.rest=3.5;e.path=[];
      }
    }
    e.mesh.position.set(e.x,.03+Math.sin(elapsed*2+e.phase)*.025,e.z);
    if(e.state==='alert' || e.state==='chase') e.mesh.rotation.y=Math.atan2(px-e.x,pz-e.z);
    const scale=e.mesh.scale.x+(1-e.mesh.scale.x)*Math.min(1,dt*6);
    e.mesh.scale.setScalar(scale);
    if(e.state==='chase' && Math.hypot(e.x-px,e.z-pz)<.68 && e.attack<=0) {
      e.attack=1.25;e.state='rest';e.rest=3.5;e.path=[];
      hp-=17;damageFlash=.35;sound(90,.3,'sawtooth',.13);hud();
      if(hp<=0){end(false);return;}
    }
  }
}
function frame(t) {
  raf=0;if(!running) return;
  const dt=Math.min(.05,(t-lastTime)/1000||0);lastTime=t;
  if(document.hidden){raf=requestAnimationFrame(frame);return;}
  elapsed+=dt;move(dt);
  if(!running) return;
  updateEnemies(dt);
  shotFlash=Math.max(0,shotFlash-dt);damageFlash=Math.max(0,damageFlash-dt);
  document.querySelector('.br-vignette').style.background=damageFlash>0
    ?`radial-gradient(ellipse at center,transparent 32%,rgba(130,15,12,${.5+damageFlash}) 100%)`
    :'radial-gradient(ellipse at center,transparent 40%,rgba(0,0,0,.54) 100%)';
  if(shotFlash>0) camera.children[0].intensity=38; else camera.children[0].intensity=26;
  ui.clock.textContent=String(Math.floor(elapsed/60)).padStart(2,'0')+':'+String(Math.floor(elapsed%60)).padStart(2,'0');
  objective();
  renderer.render(scene,camera);
  if(running) raf=requestAnimationFrame(frame);
}
function enter(preferences) {
  const currentEntry=++entryId;
  audioPrefs={music:preferences?.music!==false,sfx:preferences?.sfx!==false};
  if(humGain) humGain.gain.value=audioPrefs.music?.018:0;
  open=true;phase='intro';screen.classList.remove('playing');
  ui.start.disabled=false;
  if(!init()) {
    sync();ui.message.textContent=text('webglError');ui.start.disabled=true;
    mask.classList.remove('hide');return;
  }
  clearWorld();friends=[];enemies=[];exit=null;
  hp=100;milk=12;rescued=0;elapsed=0;
  sync();mask.classList.remove('hide');
  ui.message.textContent=text('loading');ui.start.disabled=true;
  loadModels().then(()=>{
    if(!open || currentEntry!==entryId) return;
    rng=seeded((Date.now()^Math.floor(Math.random()*0xffffffff))>>>0);
    buildWorld();sync();ui.start.disabled=false;renderer.render(scene,camera);
  }).catch(err=>{
    console.error('[backrooms3d] character model load failed',err);
    if(open && currentEntry===entryId) {ui.message.textContent=text('modelError');ui.start.disabled=true;}
  });
}
function leave() {
  entryId++;
  open=false;running=false;phase='intro';screen.classList.remove('playing');
  if(raf){cancelAnimationFrame(raf);raf=0;}
  if(document.pointerLockElement===canvas) document.exitPointerLock();
  if(audio) audio.suspend();
  clearWorld();
  Object.keys(keys).forEach(k=>delete keys[k]);joyX=joyY=0;sprintTouch=false;
}

/* Input listeners are attached once, so returning to the lobby cannot multiply controls. */
window.addEventListener('resize',resize);
document.addEventListener('visibilitychange',()=>{lastTime=performance.now();if(open&&running&&document.hidden) pause();});
document.addEventListener('pointerlockchange',()=>{
  if(document.pointerLockElement===canvas) hadPointerLock=true;
  else if(open&&running&&hadPointerLock) pause();
});
window.addEventListener('keydown',e=>{
  if(!open) return;
  const k=e.key.length===1?e.key.toLowerCase():e.key;
  keys[k]=true;
  if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight',' '].includes(k)) e.preventDefault();
  if(k==='Escape'&&running) pause();
  if((k===' '||k==='Enter')&&running&&!e.repeat) shoot();
});
window.addEventListener('keyup',e=>{const k=e.key.length===1?e.key.toLowerCase():e.key;keys[k]=false;});
canvas.addEventListener('pointerdown',e=>{
  if(!running) return;
  if(e.pointerType==='mouse') {
    if(document.pointerLockElement!==canvas) {
      lockPointer();
      canvas._look={id:e.pointerId,x:e.clientX,y:e.clientY};
    }
    shoot();
  } else if(e.clientX>window.innerWidth*.32) {
    try { canvas.setPointerCapture(e.pointerId); } catch(err) {}
    canvas._look={id:e.pointerId,x:e.clientX,y:e.clientY};
  }
});
canvas.addEventListener('pointermove',e=>{
  if(!running) return;
  if(document.pointerLockElement===canvas) {
    yaw-=e.movementX*.0027;
    pitch=Math.max(-1.18,Math.min(1.18,pitch-e.movementY*.0027));
  }
  else if(canvas._look?.id===e.pointerId) {
    const dx=e.clientX-canvas._look.x,dy=e.clientY-canvas._look.y;
    canvas._look.x=e.clientX;canvas._look.y=e.clientY;
    yaw-=dx*.0055;
    pitch=Math.max(-1.18,Math.min(1.18,pitch-dy*.0055));
  }
});
canvas.addEventListener('pointerup',e=>{if(canvas._look?.id===e.pointerId) canvas._look=null;});
canvas.addEventListener('pointercancel',()=>{canvas._look=null;});
const joystick=document.getElementById('br-j'),knob=document.getElementById('br-jk');
let joystickId=null;
function setStick(e) {
  const r=joystick.getBoundingClientRect(),cx=r.left+r.width/2,cy=r.top+r.height/2;
  let x=(e.clientX-cx)/50,y=(e.clientY-cy)/50;
  const len=Math.hypot(x,y);if(len>1){x/=len;y/=len;}
  joyX=x;joyY=y;knob.style.left=(50+x*35)+'%';knob.style.top=(50+y*35)+'%';
}
joystick.addEventListener('pointerdown',e=>{e.preventDefault();joystickId=e.pointerId;joystick.setPointerCapture(e.pointerId);setStick(e);});
joystick.addEventListener('pointermove',e=>{if(joystickId===e.pointerId)setStick(e);});
function releaseStick(e){if(joystickId!==e.pointerId)return;joystickId=null;joyX=joyY=0;knob.style.left='50%';knob.style.top='50%';}
joystick.addEventListener('pointerup',releaseStick);joystick.addEventListener('pointercancel',releaseStick);
document.getElementById('br-fire').addEventListener('pointerdown',e=>{e.preventDefault();shoot();});
const runButton=document.getElementById('br-run');
runButton.addEventListener('pointerdown',e=>{e.preventDefault();sprintTouch=true;runButton.setPointerCapture(e.pointerId);});
runButton.addEventListener('pointerup',()=>{sprintTouch=false;});
runButton.addEventListener('pointercancel',()=>{sprintTouch=false;});
ui.start.addEventListener('click',start);
window.Backrooms3D={open:enter,stop:leave,pause,debug:()=>({hp,milk,rescued,enemies:enemies.length,friends:friends.length,exit,px,pz,phase})};
