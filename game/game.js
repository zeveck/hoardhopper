// Hoard Hopper — a little dragon hops through scrolling caves gathering treasure
// for an ever-growing hoard. Plain canvas, no build step, relative asset paths.
'use strict';

const W = 960, H = 540, T = 48;          // logical size, tile size
const LAVA_Y = 492;                       // lava surface
const GRAV = 2300, JUMP_V = 830, FLAP_V = 720, RUN = 300, ACCEL = 2600;
const SPRITE = 0.8;                       // dragon draw scale (128px frames)

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
ctx.imageSmoothingEnabled = false;

// ---------- persistence (per-viewer convenience only) ----------
const SAVE_KEY = 'hoard-hopper-save-v1';
function loadSave() {
  try { const s = JSON.parse(localStorage.getItem(SAVE_KEY)); if (s && typeof s.hoard === 'number') return s; } catch (e) {}
  return { hoard: 0, level: 0, items: {} };
}
function writeSave() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (e) {} }
let save = loadSave();

// ---------- caves ----------
const CAVES = [
  { name: 'Ember Caverns',    bg: 'cave1', tile: 'rock1', music: 'music-cave1', tint: '#ff7a2a', edge: '#ffb347', fireballs: 1.0, stalactites: 0.0, movers: 0.0 },
  { name: 'Crystal Grotto',   bg: 'cave2', tile: 'rock2', music: 'music-cave2', tint: '#6fd6ff', edge: '#c9f1ff', fireballs: 0.2, stalactites: 0.35, movers: 0.12 },
  { name: 'Fungal Hollow',    bg: 'cave3', tile: 'rock3', music: 'music-cave3', tint: '#7dff8a', edge: '#c6ff9a', fireballs: 0.3, stalactites: 0.25, movers: 0.25 },
  { name: 'Dwarven Deep',     bg: 'cave4', tile: 'rock4', music: 'music-cave4', tint: '#ffd36a', edge: '#ffe9a8', fireballs: 0.8, stalactites: 0.35, movers: 0.3 },
];
const TREASURE = {
  coin:    { value: 10,  img: 'coin',    size: 26 },
  ruby:    { value: 50,  img: 'ruby',    size: 30 },
  emerald: { value: 75,  img: 'emerald', size: 30 },
  goblet:  { value: 150, img: 'goblet',  size: 38 },
  crown:   { value: 300, img: 'crown',   size: 42 },
  chest:   { value: 500, img: 'chest',   size: 48 },
};
const HOARD_STAGES = [
  { at: 0,     name: 'An Empty Lair' },
  { at: 1,     name: 'A Modest Stash' },
  { at: 2500,  name: 'A Respectable Heap' },
  { at: 7000,  name: 'A Glittering Mound' },
  { at: 15000, name: 'A Mountain of Gold' },
  { at: 30000, name: 'A Legendary Hoard' },
];
function hoardStage(v) { let s = 0; HOARD_STAGES.forEach((h, i) => { if (v >= h.at) s = i; }); return s; }

// ---------- assets ----------
const IMG = {}, SND = {};
const imageList = {
  cave1: 'assets/bg/cave1.jpg', cave2: 'assets/bg/cave2.jpg', cave3: 'assets/bg/cave3.jpg', cave4: 'assets/bg/cave4.jpg', lair: 'assets/bg/lair.jpg',
  rock1: 'assets/tiles/rock1.jpg', rock2: 'assets/tiles/rock2.jpg', rock3: 'assets/tiles/rock3.jpg', rock4: 'assets/tiles/rock4.jpg',
  coin: 'assets/items/coin.png', ruby: 'assets/items/ruby.png', emerald: 'assets/items/emerald.png', goblet: 'assets/items/goblet.png',
  crown: 'assets/items/crown.png', chest: 'assets/items/chest.png', spikes: 'assets/items/spikes.png', stalactite: 'assets/items/stalactite.png',
  hoard1: 'assets/sprites/hoard1.png', hoard2: 'assets/sprites/hoard2.png', hoard3: 'assets/sprites/hoard3.png', hoard4: 'assets/sprites/hoard4.png', hoard5: 'assets/sprites/hoard5.png',
};
for (let i = 0; i < 4; i++) { imageList['run' + i] = `assets/sprites/dragon/run-${i}.png`; imageList['fly' + i] = `assets/sprites/dragon/fly-${i}.png`; }
for (let i = 0; i < 2; i++) imageList['lounge' + i] = `assets/sprites/dragon/lounge-${i}.png`;
const soundList = ['music-cave1', 'music-cave2', 'music-cave3', 'music-cave4', 'music-lair', 'sfx-jump', 'sfx-flap', 'sfx-coin', 'sfx-gem',
  'sfx-hurt', 'sfx-lava', 'sfx-complete', 'sfx-stash', 'sfx-purr', 'dragon-roar'];

let loaded = 0, total = 0;
function loadImages() {
  return Promise.all(Object.entries(imageList).map(([k, src]) => new Promise(res => {
    total++; const im = new Image();
    im.onload = () => { IMG[k] = im; loaded++; res(); };
    im.onerror = () => { console.warn('missing image', src); loaded++; res(); };
    im.src = src;
  })));
}

// ---------- audio ----------
let actx = null, master, musicGain, sfxGain, musicSrc = null, musicName = null, muted = false;
function initAudio() {
  if (actx) return;
  try {
    actx = new (window.AudioContext || window.webkitAudioContext)();
    master = actx.createGain(); master.connect(actx.destination);
    musicGain = actx.createGain(); musicGain.gain.value = 0.45; musicGain.connect(master);
    sfxGain = actx.createGain(); sfxGain.gain.value = 0.8; sfxGain.connect(master);
    try { muted = localStorage.getItem('hoard-hopper-muted') === '1'; } catch (e) {}
    master.gain.value = muted ? 0 : 1;
    soundList.forEach(n => fetch(`assets/audio/${n}.mp3`).then(r => r.arrayBuffer()).then(b => actx.decodeAudioData(b))
      .then(buf => { SND[n] = buf; if (n === wantMusic) playMusic(n); }).catch(() => console.warn('missing sound', n)));
  } catch (e) { actx = null; }
}
let wantMusic = null;
function playMusic(name) {
  wantMusic = name;
  if (!actx || !SND[name] || musicName === name) return;
  if (musicSrc) { const old = musicSrc; try { old.gainNode.gain.linearRampToValueAtTime(0, actx.currentTime + 0.6); old.stop(actx.currentTime + 0.7); } catch (e) {} }
  const src = actx.createBufferSource(), g = actx.createGain();
  src.buffer = SND[name]; src.loop = true; src.connect(g); g.connect(musicGain);
  g.gain.setValueAtTime(0, actx.currentTime); g.gain.linearRampToValueAtTime(1, actx.currentTime + 0.8);
  src.gainNode = g; src.start(); musicSrc = src; musicName = name;
}
function sfx(name, vol = 1, rate = 1) {
  if (!actx || !SND[name]) return;
  const s = actx.createBufferSource(), g = actx.createGain();
  s.buffer = SND[name]; s.playbackRate.value = rate; g.gain.value = vol; s.connect(g); g.connect(sfxGain); s.start();
}
function toggleMute() {
  muted = !muted; if (master) master.gain.value = muted ? 0 : 1;
  try { localStorage.setItem('hoard-hopper-muted', muted ? '1' : '0'); } catch (e) {}
}

// ---------- input ----------
const keys = { left: false, right: false, jump: false };
let jumpPressed = false, anyPressed = false;
const KEYMAP = { ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right', ArrowUp: 'jump', KeyW: 'jump', Space: 'jump', KeyZ: 'jump' };
addEventListener('keydown', e => {
  initAudio(); if (actx && actx.state === 'suspended') actx.resume();
  const k = KEYMAP[e.code];
  if (k) { if (k === 'jump' && !keys.jump) jumpPressed = true; keys[k] = true; e.preventDefault(); }
  if (e.code === 'KeyM') toggleMute();
  if (e.code === 'Enter' || e.code === 'Space') anyPressed = true;
  if (e.code === 'KeyR' && e.shiftKey && scene === 'title') { save = { hoard: 0, level: 0, items: {} }; writeSave(); }
});
addEventListener('keyup', e => { const k = KEYMAP[e.code]; if (k) keys[k] = false; });
canvas.addEventListener('pointerdown', e => {
  initAudio(); if (actx && actx.state === 'suspended') actx.resume();
  anyPressed = true;
  const r = canvas.getBoundingClientRect(), x = (e.clientX - r.left) * W / r.width, y = (e.clientY - r.top) * H / r.height;
  if (x > W - 120 && y > H - 30) toggleMute();
});
if ('ontouchstart' in window || navigator.maxTouchPoints > 0) document.body.classList.add('touch');
document.querySelectorAll('#touch button').forEach(b => {
  const k = b.dataset.k;
  b.addEventListener('pointerdown', e => { e.preventDefault(); initAudio(); if (actx && actx.state === 'suspended') actx.resume(); if (k === 'jump') { jumpPressed = true; anyPressed = true; } keys[k] = true; });
  const up = e => { e.preventDefault(); keys[k] = false; };
  b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up); b.addEventListener('pointerleave', up);
});

// ---------- helpers ----------
function mulberry32(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const overlap = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
function text(str, x, y, size = 16, color = '#f6d58a', align = 'center', shadow = true) {
  ctx.font = `${size}px "Press Start 2P", monospace`; ctx.textAlign = align; ctx.textBaseline = 'middle';
  if (shadow) { ctx.fillStyle = 'rgba(0,0,0,.75)'; ctx.fillText(str, x + Math.max(2, size / 8), y + Math.max(2, size / 8)); }
  ctx.fillStyle = color; ctx.fillText(str, x, y);
}
function fmt(n) { return Math.round(n).toLocaleString('en-US'); }
const patterns = {};
function tilePattern(name) {
  if (patterns[name]) return patterns[name];
  const im = IMG[name]; if (!im) return '#5a4a40';
  const c = document.createElement('canvas'); c.width = c.height = T;
  const g = c.getContext('2d'); g.imageSmoothingEnabled = false; g.drawImage(im, 0, 0, T, T);
  return (patterns[name] = ctx.createPattern(c, 'repeat'));
}
// Body metrics of the dragon frames: where the feet are, measured from alpha.
const FRAME_INFO = {};
function measure(name) {
  const im = IMG[name]; if (!im) return { bottom: 112, top: 16, left: 8, right: 120 };
  const c = document.createElement('canvas'); c.width = im.width; c.height = im.height;
  const g = c.getContext('2d'); g.drawImage(im, 0, 0);
  const d = g.getImageData(0, 0, c.width, c.height).data; let top = c.height, bottom = 0, left = c.width, right = 0;
  for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) if (d[(y * c.width + x) * 4 + 3] > 40) {
    if (y < top) top = y; if (y > bottom) bottom = y; if (x < left) left = x; if (x > right) right = x;
  }
  return { top, bottom, left, right };
}
// Top of the hoard pile at its horizontal center, as a fraction of image height.
function pileTop(name) {
  const im = IMG[name]; if (!im) return 0.5;
  const c = document.createElement('canvas'); c.width = im.width; c.height = im.height;
  const g = c.getContext('2d'); g.drawImage(im, 0, 0);
  const x0 = Math.floor(im.width * 0.4), x1 = Math.floor(im.width * 0.6);
  const d = g.getImageData(x0, 0, x1 - x0, im.height).data;
  for (let y = 0; y < im.height; y++) { let n = 0; for (let x = 0; x < x1 - x0; x++) if (d[(y * (x1 - x0) + x) * 4 + 3] > 128) n++; if (n > (x1 - x0) * 0.25) return y / im.height; }
  return 0.5;
}

// ---------- particles & popups ----------
let particles = [], popups = [];
function burst(x, y, color, n = 10, speed = 180, life = 0.6, grav = 300) {
  for (let i = 0; i < n; i++) { const a = Math.random() * Math.PI * 2, s = speed * (0.3 + Math.random()); particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - speed * 0.3, life, max: life, color, grav, size: 2 + Math.random() * 3 }); }
}
function updateParticles(dt) {
  particles = particles.filter(p => (p.life -= dt) > 0);
  particles.forEach(p => { p.vy += p.grav * dt; p.x += p.vx * dt; p.y += p.vy * dt; });
  popups = popups.filter(p => (p.life -= dt) > 0);
  popups.forEach(p => { p.y -= 40 * dt; });
}
function drawParticles(ox) {
  particles.forEach(p => { ctx.globalAlpha = clamp(p.life / p.max, 0, 1); ctx.fillStyle = p.color; ctx.fillRect(Math.round(p.x - ox), Math.round(p.y), p.size, p.size); });
  ctx.globalAlpha = 1;
  popups.forEach(p => { ctx.globalAlpha = clamp(p.life / 0.4, 0, 1); text(p.str, p.x - ox, p.y, 12, p.color); });
  ctx.globalAlpha = 1;
}

// ---------- shared physics ----------
// One deterministic step used by the game, the level generator's jump checks
// and the test bot, so "reachable" always means reachable in the real game.
const PLAYER_W = 58, PLAYER_H = 44, BUCKET = 256;
function moverPos(p, t) {
  if (!p.mover) return p;
  const m = p.mover, a = t * m.speed + m.ph;
  return { x: p.baseX + (m.axis === 'x' ? Math.sin(a) * m.amp : 0), y: p.baseY + (m.axis === 'y' ? Math.sin(a) * m.amp : 0) };
}
function nearPlatforms(L, x) { return L.buckets.get(Math.floor(x / BUCKET)) || []; }
function indexPlatforms(L) {
  L.buckets = new Map();
  for (const p of L.platforms) {
    const amp = p.mover && p.mover.axis === 'x' ? p.mover.amp : 0;
    for (let b = Math.floor((p.baseX - amp - PLAYER_W) / BUCKET); b <= Math.floor((p.baseX + p.w + amp) / BUCKET); b++) {
      if (!L.buckets.has(b)) L.buckets.set(b, []); L.buckets.get(b).push(p);
    }
  }
}
// inp: { dir: -1|0|1, held: bool, press: bool }. Returns 'jump' | 'flap' | 'land' | null.
function physStep(P, inp, dt, L, t) {
  let ev = null;
  P.vx += clamp(inp.dir * RUN - P.vx, -ACCEL * dt, ACCEL * dt);
  if (inp.dir) P.face = inp.dir;
  if (inp.press) P.buffer = 0.12;
  P.buffer -= dt; P.coyote -= dt;
  if (P.buffer > 0) {
    if (P.onGround || P.coyote > 0) { P.vy = -JUMP_V; P.onGround = false; P.coyote = 0; P.buffer = 0; ev = 'jump'; }
    else if (P.canFlap) { P.vy = -FLAP_V; P.canFlap = false; P.buffer = 0; P.flapT = 0.45; ev = 'flap'; }
  }
  if (!inp.held && P.vy < -300) P.vy += GRAV * dt * 1.4;    // short hop on release
  P.vy = Math.min(P.vy + GRAV * dt, 1100);
  P.flapT -= dt;
  if (P.onGround && P.ground && P.ground.mover) { const a = moverPos(P.ground, t), b = moverPos(P.ground, t + dt); P.x += b.x - a.x; P.y += b.y - a.y; }
  P.x += P.vx * dt;
  const prevBottom = P.y + P.h;
  P.y += P.vy * dt;
  const wasGround = P.onGround; P.onGround = false; P.ground = null;
  if (P.vy >= 0) for (const p of nearPlatforms(L, P.x)) {
    const q = moverPos(p, t + dt), rise = p.mover ? Math.max(0, moverPos(p, t).y - q.y) : 0;
    if (P.x + P.w - 8 > q.x && P.x + 8 < q.x + p.w && prevBottom <= q.y + 2 + rise && P.y + P.h >= q.y) {
      P.y = q.y - P.h; P.vy = 0; P.onGround = true; P.ground = p; P.canFlap = true;
      if (!wasGround) ev = ev || 'land';
      break;
    }
  }
  if (wasGround && !P.onGround && P.vy >= 0) P.coyote = 0.09;
  if (P.y < -200) P.y = -200;
  return ev;
}
function camStep(cam, P, dt, L) {
  const ahead = P.x - (cam + W * 0.55);
  return Math.min(L.endX - W + 120, cam + L.speed * dt + Math.max(0, ahead) * 2.5 * dt);
}
// Fireballs are a pure function of time: each spout launches one every `every` seconds.
const FIRE_G = GRAV * 0.7;
function fireballsAt(L, t, x0 = -1e9, x1 = 1e9) {
  const out = [];
  for (const sp of L.spouts) {
    if (sp.x < x0 || sp.x > x1) continue;
    const flight = 2 * sp.v / FIRE_G, k1 = Math.floor((t - sp.phase) / sp.every);
    for (let k = k1; k >= 0 && t - (sp.phase + k * sp.every) < flight; k--) {
      const a = t - (sp.phase + k * sp.every); if (a < 0) continue;
      out.push({ x: sp.x, y: LAVA_Y - sp.v * a + 0.5 * FIRE_G * a * a, vy: -sp.v + FIRE_G * a });
    }
  }
  return out;
}
function hitbox(P) { return { x: P.x + 6, y: P.y + 6, w: P.w - 12, h: P.h - 8 }; }
function spikeBox(s) { return { x: s.x + 10, y: s.y + 10, w: s.w - 20, h: s.h - 10 }; }
// Static hazards at time t (stalactites are player-triggered and handled separately).
function hazardAt(P, L, t) {
  if (P.y + P.h > LAVA_Y + 10) return 'lava';
  const box = hitbox(P);
  for (const s of L.spikes) if (Math.abs(s.x - P.x) < 120 && overlap(box, spikeBox(s))) return 'spike';
  for (const f of fireballsAt(L, t, P.x - 60, P.x + 120)) if (overlap(box, { x: f.x - 12, y: f.y - 12, w: 24, h: 24 })) return 'fire';
  return null;
}

// ---------- level generation ----------
// Can a dragon standing near the right edge of `from` land on `to`? Tries the
// real physics with a few jump timings; flap only if allowed. `margin` is how
// much spare run-up / landing room the player gets, so jumps are never pixel-perfect.
function canReach(from, to, allowFlap, margin) {
  const L = { platforms: [from, to], spikes: [], spouts: [] }; indexPlatforms(L);
  const fp = moverPos(from, 0), tp = moverPos(to, 0);
  const flaps = allowFlap ? [-1, 24, 36, 48, 62, 80] : [-1];      // flap on this physics step (-1: never)
  for (const brake of [false, true]) for (const flapStep of flaps) {
    const P = { x: fp.x + from.w - PLAYER_W - margin, y: fp.y - PLAYER_H, w: PLAYER_W, h: PLAYER_H, vx: RUN, vy: 0, onGround: true, ground: from,
      canFlap: true, face: 1, coyote: 0, buffer: 0, flapT: 0 };
    for (let i = 0; i < 360; i++) {
      // with `brake`, stop steering once over the near part of the target, like a player would
      const dir = brake && P.x + P.w / 2 > tp.x + 40 ? 0 : 1;
      const ev = physStep(P, { dir, held: true, press: i === 0 || i === flapStep }, 1 / 120, L, 0);
      if (ev === 'land') {
        if (P.ground === to && P.x + P.w / 2 >= tp.x + margin * 0.5) return true;
        break;
      }
      if (P.y > LAVA_Y) break;
    }
  }
  return false;
}

// Treasure gets richer the deeper you go.
const LOOT = [
  { gem: 0.25, ledge: 0.16, rare: { goblet: 0.75, crown: 0.22, chest: 0.03 } },
  { gem: 0.32, ledge: 0.22, rare: { goblet: 0.55, crown: 0.35, chest: 0.10 } },
  { gem: 0.38, ledge: 0.27, rare: { goblet: 0.40, crown: 0.40, chest: 0.20 } },
  { gem: 0.45, ledge: 0.32, rare: { goblet: 0.25, crown: 0.40, chest: 0.35 } },
];
let level = null;
function genLevel(n) {
  const caveIdx = n % 4, loop = Math.floor(n / 4), cave = CAVES[caveIdx], loot = LOOT[caveIdx];
  const rnd = mulberry32(9001 + n * 7919);
  const r = (a, b) => a + (b - a) * rnd(), ri = (a, b) => Math.floor(r(a, b + 1));
  // 0 in the first cave, 1 by the second trip through the fourth
  const diff = Math.min(1, (caveIdx + loop * 2) / 5);
  const allowFlap = caveIdx > 0 || loop > 0;          // cave 1 never needs the flap
  const margin = 34 - diff * 14;                       // spare room on every required jump
  const L = { n, caveIdx, loop, cave, platforms: [], items: [], spikes: [], stalactites: [], spouts: [],
    speed: Math.min(200, 112 + caveIdx * 14 + loop * 20), length: 0, endX: 0, adjusted: 0 };
  const mk = (x, y, w, mover) => ({ x, y, w, h: 28 + (y > 360 ? 300 : 0), mover, baseX: x, baseY: y });
  const item = (type, x, y) => L.items.push({ type, x, y, t: rnd() * 6, got: false });
  const rare = () => { let roll = rnd(); for (const [k, p] of Object.entries(loot.rare)) { if ((roll -= p) < 0) return k; } return 'goblet'; };
  const start = mk(-200, 380, 14 * T + 200); L.platforms.push(start);
  let x = 14 * T, y = 380, prev = start;
  const target = 8000 + caveIdx * 900 + loop * 1500;
  while (x < target) {
    let gap = r(55, 115 + diff * 75);
    let ny = clamp(y + r(-(70 + diff * 50), 70 + diff * 40), 210, 440);
    const isMover = prev && !prev.mover && rnd() < cave.movers * (0.5 + diff) + loop * 0.06;
    const w = isMover ? 3 * T : ri(Math.max(2, 4 - Math.round(diff * 2)), 8 - Math.round(diff * 3)) * T;
    const mover = isMover ? (rnd() < 0.5 ? { axis: 'y', amp: r(40, 50 + diff * 35), speed: r(0.9, 1.2 + diff * 0.6), ph: rnd() * 6 }
                                        : { axis: 'x', amp: r(35, 45 + diff * 30), speed: r(0.9, 1.1 + diff * 0.5), ph: rnd() * 6 }) : null;
    // shrink the jump until the real physics says it is comfortably doable;
    // movers must be reachable at their nearest, middle and farthest points
    let p;
    for (let tries = 0; ; tries++) {
      p = mk(x + gap, ny, w, mover);
      const probes = mover ? [-1, 0, 1].map(s => ({ ...p, mover: null, x: p.x + (mover.axis === 'x' ? s * mover.amp * 0.8 : 0), baseX: p.x + (mover.axis === 'x' ? s * mover.amp * 0.8 : 0), y: ny + (mover.axis === 'y' ? s * mover.amp * 0.8 : 0) })) : [p];
      const fromProbe = prev.mover ? { ...prev, mover: null } : prev;
      const ok = mover ? probes.some(q => canReach(fromProbe, q, allowFlap, margin)) && canReach(fromProbe, probes[1], allowFlap, margin)
                       : canReach(fromProbe, p, allowFlap, margin);
      if (ok) break;
      if (tries > 14) { gap = 40; ny = y; p = mk(x + gap, ny, w, null); break; }
      L.adjusted++; gap = Math.max(40, gap - 18); ny = lerp(ny, y + 20, 0.3);
    }
    L.platforms.push(p);
    const px = p.x, py = p.y;
    // coin arc over the gap
    if (rnd() < 0.65) {
      const x0 = prev.x + prev.w - 10, x1 = px + 10, k = Math.max(3, Math.round((x1 - x0) / 34));
      for (let i = 0; i <= k; i++) { const t = i / k; item('coin', lerp(x0, x1, t), lerp(prev.baseY, py, t) - 60 - Math.sin(t * Math.PI) * 70); }
    }
    // spikes only on wide platforms, with room to land on either side
    let spiked = false;
    if (!mover && w >= 6 * T && rnd() < 0.35 + diff * 0.4) {
      const sx = px + Math.floor(w / T / 2) * T - T / 2; L.spikes.push({ x: sx, y: py - 26, w: T + 8, h: 26 }); spiked = true;
      for (let i = 0; i < 3; i++) item('coin', sx - 10 + i * 28, py - 110 - (i === 1 ? 20 : 0));
    }
    if (!spiked && rnd() < loot.gem) item(rnd() < 0.6 - caveIdx * 0.1 ? 'ruby' : 'emerald', px + w / 2, py - 34);
    else if (!spiked && rnd() < 0.5) for (let i = 0; i < Math.floor(w / T); i++) item('coin', px + T / 2 + i * T, py - 30);
    // optional high bonus ledge with a rare treasure (reachable with jump + flap)
    if (!mover && rnd() < loot.ledge && py > 300) {
      const lp = mk(px + r(0, Math.max(1, w - 2 * T)), py - r(140, 165), 2 * T, null);
      const fromHere = { ...p, w: lp.x - px + T };   // stand under it and jump straight up
      if (canReach(fromHere, lp, true, 10) || canReach(p, lp, true, 10)) { L.platforms.push(lp); item(rare(), lp.x + T, lp.y - 30); }
    }
    if (rnd() < cave.stalactites * (0.6 + diff) + loop * 0.08) L.stalactites.push({ x: px + r(T, Math.max(T + 1, w - T)), y: -10, vy: 0, state: 'hang', w: 30, h: 70 });
    // lava fireball spout in wider gaps, only where the previous ledge gives room to wait
    if (gap > 90 && prev.w >= 3 * T && rnd() < cave.fireballs * (0.3 + diff * 0.4) + loop * 0.08)
      L.spouts.push({ x: x + gap / 2, phase: r(0, 2), every: r(2.4, 3.4) - diff * 0.6, v: r(880, 1000) });
    prev = p; x = px + w; y = py;
  }
  const end = mk(x + 70, 380, 24 * T, null);
  if (!canReach(prev.mover ? { ...prev, mover: null } : prev, end, allowFlap, margin)) { end.baseY = end.y = clamp(y + 40, 260, 440); end.h = 330; }
  L.platforms.push(end);
  L.endX = end.x + 9 * T; L.length = L.endX;
  for (let i = 0; i < 6; i++) item('coin', end.x + 60 + i * 50, end.y - 40 - Math.sin(i / 5 * Math.PI) * 30);
  indexPlatforms(L);
  return L;
}

// ---------- player ----------
function newPlayer() {
  return { x: 140, y: 380 - PLAYER_H, w: PLAYER_W, h: PLAYER_H, vx: 0, vy: 0, onGround: true, ground: null, canFlap: true, face: 1, anim: 0,
    hearts: 3, invuln: 0, flapT: 0, coyote: 0, buffer: 0, dead: false };
}
let player = newPlayer(), camX = 0, bag = [], bagValue = 0, levelTime = 0, shake = 0;
let botInput = null;                       // set by the test bot to drive the dragon
const stats = { hurts: [] };

function startLevel(n) {
  level = genLevel(n); player = newPlayer(); camX = 0; bag = []; bagValue = 0; levelTime = 0; particles = []; popups = [];
  stats.hurts = [];
  scene = 'intro'; sceneT = 0; playMusic(level.cave.music);
}

function hurt(kind) {
  if (player.invuln > 0) { if (kind === 'lava') respawn(); return; }
  stats.hurts.push({ kind, x: Math.round(player.x), t: +levelTime.toFixed(2) });
  player.hearts--; player.invuln = 1.6; shake = 0.3;
  sfx(kind === 'lava' || kind === 'fire' ? 'sfx-lava' : 'sfx-hurt', 0.9);
  burst(player.x + player.w / 2, player.y + player.h / 2, kind === 'spike' ? '#ffffff' : '#ff8a1a', 16, 220);
  // drop a little treasure when hurt
  if (bag.length) { const lost = bag.splice(-Math.min(bag.length, 3)); lost.forEach(t => bagValue -= TREASURE[t].value); popups.push({ str: '-treasure!', x: player.x + 30, y: player.y - 10, life: 0.9, color: '#ff8080' }); }
  if (player.hearts <= 0) { player.dead = true; scene = 'fail'; sceneT = 0; return; }
  if (kind === 'lava') respawn(); else { player.vy = -560; player.onGround = false; }
}
function respawn() {
  // drop the dragon onto a solid, spike-free spot comfortably on screen
  const ok = p => !p.mover && p.y > 150 && p.x + p.w > camX + 200 && p.x < camX + W - 260;
  const p = level.platforms.find(ok) || level.platforms.find(p => !p.mover && p.x > camX + 100) || level.platforms[level.platforms.length - 1];
  let x = clamp(camX + 160, p.x + 10, p.x + p.w - PLAYER_W - 10);
  for (const s of level.spikes) if (x + PLAYER_W > s.x - 10 && x < s.x + s.w + 10) x = s.x + s.w + 12 + PLAYER_W < p.x + p.w ? s.x + s.w + 12 : Math.max(p.x + 4, s.x - PLAYER_W - 12);
  player.x = x; player.y = p.y - PLAYER_H - 140; player.vx = 0; player.vy = 0; player.canFlap = true; player.onGround = false; player.ground = null;
}

function updatePlayer(dt) {
  const P = player;
  const inp = botInput ? botInput(dt) : { dir: (keys.right ? 1 : 0) - (keys.left ? 1 : 0), held: keys.jump, press: jumpPressed };
  jumpPressed = false;
  const ev = physStep(P, inp, dt, level, levelTime);
  if (ev === 'jump') sfx('sfx-jump', 0.6);
  if (ev === 'flap') { sfx('sfx-flap', 0.8); burst(P.x + P.w / 2, P.y + P.h, '#ffd9a0', 8, 120, 0.4, 100); }
  if (ev === 'land') burst(P.x + P.w / 2, P.y + P.h, level.cave.edge, 5, 80, 0.3, 200);
  // the scrolling cave pushes from the left; the right edge holds you in
  if (P.x < camX + 4) P.x = camX + 4;
  if (P.x > camX + W - P.w - 4) P.x = camX + W - P.w - 4;
  P.invuln -= dt;
  P.anim += dt * (P.onGround ? Math.max(4, Math.abs(P.vx) / 26) : 12);
}

function updateLevel(dt) {
  const L = level;
  camX = camStep(camX, player, dt, L);
  updatePlayer(dt);
  levelTime += dt;
  for (const p of L.platforms) if (p.mover) { const q = moverPos(p, levelTime); p.x = q.x; p.y = q.y; }
  const P = player, box = hitbox(P);
  const hz = hazardAt(P, L, levelTime); if (hz) hurt(hz);
  for (const it of L.items) {
    if (it.got) continue; it.t += dt;
    const s = TREASURE[it.type].size;
    if (overlap(box, { x: it.x - s / 2, y: it.y - s / 2, w: s, h: s })) {
      it.got = true; bag.push(it.type); bagValue += TREASURE[it.type].value;
      sfx(it.type === 'coin' ? 'sfx-coin' : 'sfx-gem', it.type === 'coin' ? 0.5 : 0.8, it.type === 'coin' ? 0.95 + Math.random() * 0.15 : 1);
      burst(it.x, it.y, it.type === 'coin' ? '#ffe066' : it.type === 'ruby' ? '#ff4060' : it.type === 'emerald' ? '#40ff90' : '#fff3b0', it.type === 'coin' ? 6 : 16, 140, 0.5, 100);
      if (it.type !== 'coin') popups.push({ str: '+' + TREASURE[it.type].value, x: it.x, y: it.y - 20, life: 0.9, color: '#fff3b0' });
    }
  }
  for (const st of L.stalactites) {
    if (st.state === 'hang' && st.x - P.x < 170 && st.x - P.x > -10) { st.state = 'shake'; st.t = 0.45; }
    if (st.state === 'shake' && (st.t -= dt) <= 0) st.state = 'fall';
    if (st.state === 'fall') { st.vy += GRAV * 0.8 * dt; st.y += st.vy * dt; if (st.y > LAVA_Y) { st.state = 'gone'; burst(st.x, LAVA_Y, '#ff8a1a', 10, 160); } }
    if (st.state === 'fall' && overlap(box, { x: st.x - 10, y: st.y + st.h - 34, w: 20, h: 30 })) hurt('rock');
  }
  for (const f of fireballsAt(L, levelTime, camX - 50, camX + W + 50)) {
    if (Math.random() < 0.6) particles.push({ x: f.x + (Math.random() - .5) * 14, y: f.y, vx: 0, vy: 30, life: 0.35, max: 0.35, color: Math.random() < .5 ? '#ffd040' : '#ff6020', grav: -60, size: 3 });
  }
  if (Math.random() < dt * 8) particles.push({ x: camX + Math.random() * W, y: LAVA_Y + 4, vx: 0, vy: -60 - Math.random() * 60, life: 0.8, max: 0.8, color: '#ffb347', grav: 40, size: 2 });
  if (P.x + P.w > L.endX - 2 * T && scene === 'play') { scene = 'exit'; sceneT = 0; sfx('sfx-complete', 0.8); }
  shake = Math.max(0, shake - dt);
}

// ---------- drawing the cave ----------
function drawBackground(im, ox, factor, tint) {
  if (!im) { ctx.fillStyle = '#1a1010'; ctx.fillRect(0, 0, W, H); return; }
  // drawn taller than the screen so the painted cave floor sits below the lava
  const h = H * 1.3, w = im.width * (h / im.height);
  const base = Math.floor(ox * factor / w), x0 = base * w - ox * factor;
  // alternate mirrored copies so the panorama tiles without a seam
  for (let k = 0; x0 + k * w < W; k++) {
    const x = Math.floor(x0 + k * w);
    ctx.save();
    if ((base + k) % 2) { ctx.translate(x + w, 0); ctx.scale(-1, 1); ctx.drawImage(im, 0, 0, w + 1, h); }
    else ctx.drawImage(im, x, 0, w + 1, h);
    ctx.restore();
  }
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, 'rgba(0,0,0,.3)'); g.addColorStop(0.55, 'rgba(0,0,0,.2)'); g.addColorStop(1, 'rgba(20,2,0,.7)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
}
function drawPlatforms(ox) {
  const L = level, pat = tilePattern(L.cave.tile);
  for (const p of L.platforms) {
    const x = Math.round(p.x - ox); if (x > W || x + p.w < 0) continue;
    const y = Math.round(p.y), h = p.mover ? 26 : Math.min(p.h, LAVA_Y + 40 - y);
    ctx.save(); ctx.translate(x, y); ctx.fillStyle = pat; ctx.fillRect(0, 0, p.w, h); ctx.restore();
    const g = ctx.createLinearGradient(0, y, 0, y + h); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,.7)');
    ctx.fillStyle = g; ctx.fillRect(x, y, p.w, h);
    ctx.fillStyle = 'rgba(255,255,255,.08)'; ctx.fillRect(x, y, p.w, Math.min(h, 26));
    ctx.fillStyle = '#000'; ctx.fillRect(x - 2, y - 2, p.w + 4, 2); ctx.fillRect(x - 2, y, 2, h); ctx.fillRect(x + p.w, y, 2, h);
    if (h < 60) ctx.fillRect(x - 2, y + h, p.w + 4, 2);
    ctx.fillStyle = L.cave.edge; ctx.fillRect(x, y, p.w, 4);
    ctx.fillStyle = 'rgba(0,0,0,.5)'; ctx.fillRect(x, y + 4, p.w, 2);
    if (p.mover) { ctx.fillStyle = 'rgba(0,0,0,.6)'; ctx.fillRect(x, y + h - 3, p.w, 3); ctx.fillStyle = L.cave.tint; ctx.globalAlpha = .5 + .3 * Math.sin(levelTime * 4); ctx.fillRect(x + p.w / 2 - 6, y + 9, 12, 4); ctx.globalAlpha = 1; }
  }
}
function drawLava(ox, t) {
  const g = ctx.createLinearGradient(0, LAVA_Y - 30, 0, H);
  g.addColorStop(0, 'rgba(255,120,20,0)'); g.addColorStop(0.35, 'rgba(255,110,20,.35)'); g.addColorStop(1, 'rgba(255,80,0,.0)');
  ctx.fillStyle = g; ctx.fillRect(0, LAVA_Y - 60, W, 60);
  ctx.beginPath(); ctx.moveTo(0, H);
  for (let x = 0; x <= W; x += 8) ctx.lineTo(x, LAVA_Y + Math.sin((x + ox) * 0.03 + t * 2.4) * 4 + Math.sin((x + ox) * 0.071 - t * 1.7) * 2);
  ctx.lineTo(W, H); ctx.closePath();
  const lg = ctx.createLinearGradient(0, LAVA_Y, 0, H); lg.addColorStop(0, '#ffcf3a'); lg.addColorStop(0.15, '#ff7a12'); lg.addColorStop(1, '#8a1600');
  ctx.fillStyle = lg; ctx.fill();
  ctx.fillStyle = 'rgba(255,240,150,.55)';
  for (let i = 0; i < 14; i++) { const x = ((i * 137 - ox * 0.9 + t * 25 * (i % 3 + 1)) % (W + 40) + W + 40) % (W + 40) - 20; ctx.fillRect(x, LAVA_Y + 12 + (i * 23) % 30, 10 + (i % 4) * 6, 3); }
}
function drawItem(type, x, y, scale = 1, bob = 0) {
  const tr = TREASURE[type], im = IMG[tr.img], s = tr.size * scale;
  if (im) ctx.drawImage(im, Math.round(x - s / 2), Math.round(y - s / 2 + bob), s, s * (im.height / im.width));
  else { ctx.fillStyle = '#ffd040'; ctx.beginPath(); ctx.arc(x, y + bob, s / 2, 0, 7); ctx.fill(); }
}
function drawHazards(ox, t) {
  const L = level;
  for (const s of L.spikes) { const x = s.x - ox; if (x < -60 || x > W + 60) continue; if (IMG.spikes) ctx.drawImage(IMG.spikes, x - 4, s.y - 6, s.w + 8, s.h + 8 * (IMG.spikes.height / IMG.spikes.width)); else { ctx.fillStyle = '#ccc'; ctx.fillRect(x, s.y, s.w, s.h); } }
  for (const st of L.stalactites) {
    if (st.state === 'gone') continue; const x = st.x - ox + (st.state === 'shake' ? Math.sin(t * 80) * 2 : 0); if (x < -60 || x > W + 60) continue;
    if (IMG.stalactite) ctx.drawImage(IMG.stalactite, x - 22, st.y, 44, 80); else { ctx.fillStyle = '#887'; ctx.beginPath(); ctx.moveTo(x - 15, st.y); ctx.lineTo(x + 15, st.y); ctx.lineTo(x, st.y + 70); ctx.fill(); }
  }
  for (const f of fireballsAt(L, levelTime, ox - 50, ox + W + 50)) {
    const x = f.x - ox, r = 13 + Math.sin(t * 30) * 2;
    const g = ctx.createRadialGradient(x, f.y, 2, x, f.y, r * 1.8); g.addColorStop(0, '#fff6c0'); g.addColorStop(0.35, '#ffb020'); g.addColorStop(0.7, 'rgba(255,60,0,.8)'); g.addColorStop(1, 'rgba(255,0,0,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, f.y, r * 1.8, 0, 7); ctx.fill();
  }
}
function dragonFrame() {
  const P = player;
  if (!P.onGround) { if (P.flapT > 0 || P.vy < -200) return 'fly' + (Math.floor(P.anim) % 4); return P.vy < 0 ? 'fly1' : 'fly0'; }
  if (Math.abs(P.vx) < 20) return 'run1';
  return 'run' + (Math.floor(P.anim) % 4);
}
function drawDragon(name, feetX, feetY, face, scale = SPRITE, alpha = 1) {
  const im = IMG[name]; if (!im) { ctx.fillStyle = '#c33'; ctx.fillRect(feetX - 30, feetY - 44, 60, 44); return; }
  const info = FRAME_INFO[name] || (FRAME_INFO[name] = measure(name));
  const w = im.width * scale, h = im.height * scale;
  // run/lounge frames stand on their feet; fly frames center on the body
  const isFly = name.startsWith('fly');
  const cx = (FRAME_INFO.run1 ? (FRAME_INFO.run1.left + FRAME_INFO.run1.right) / 2 : im.width / 2) * scale;
  const yOff = isFly ? h / 2 + 26 * scale : info.bottom * scale;
  ctx.save(); ctx.globalAlpha = alpha; ctx.translate(Math.round(feetX), Math.round(feetY - yOff));
  if (face < 0) { ctx.scale(-1, 1); ctx.drawImage(im, -cx, 0, w, h); } else ctx.drawImage(im, -cx, 0, w, h);
  ctx.restore();
}
function drawHUD() {
  const L = level;
  for (let i = 0; i < 3; i++) drawHeart(20 + i * 34, 22, i < player.hearts);
  text(L.cave.name + (L.loop ? `  (Depth ${L.loop + 1})` : ''), W / 2, 22, 12, L.cave.edge);
  drawItem('coin', W - 190, 24, 0.9);
  text(fmt(bagValue), W - 170, 24, 14, '#ffe680', 'left');
  ctx.fillStyle = 'rgba(0,0,0,.5)'; ctx.fillRect(W / 2 - 150, 38, 300, 8);
  ctx.fillStyle = L.cave.edge; ctx.fillRect(W / 2 - 150, 38, 300 * clamp(player.x / L.endX, 0, 1), 8);
  drawMute();
}
function drawMute() { text(muted ? 'M: sound off' : 'M: mute', W - 10, H - 12, 8, 'rgba(246,213,138,.55)', 'right'); }
function drawHeart(x, y, full) {
  const px = [[0,1,1,0,1,1,0],[1,1,1,1,1,1,1],[1,1,1,1,1,1,1],[0,1,1,1,1,1,0],[0,0,1,1,1,0,0],[0,0,0,1,0,0,0]];
  for (let r = 0; r < 6; r++) for (let c = 0; c < 7; c++) if (px[r][c]) { ctx.fillStyle = full ? (r === 1 && c === 1 ? '#ffb0b0' : '#e8203a') : 'rgba(80,30,30,.8)'; ctx.fillRect(x + c * 4 - 14, y + r * 4 - 12, 4, 4); }
}
function drawLevel() {
  const t = levelTime, sx = shake > 0 ? (Math.random() - .5) * 10 : 0, sy = shake > 0 ? (Math.random() - .5) * 8 : 0;
  ctx.save(); ctx.translate(sx, sy);
  drawBackground(IMG[level.cave.bg], camX, 0.35);
  // the lair entrance at the end
  const ex = level.endX - camX;
  if (ex < W + 200) {
    const g = ctx.createRadialGradient(ex, 300, 10, ex, 300, 170); g.addColorStop(0, 'rgba(255,230,140,.95)'); g.addColorStop(0.5, 'rgba(255,170,60,.35)'); g.addColorStop(1, 'rgba(255,140,40,0)');
    ctx.fillStyle = g; ctx.fillRect(ex - 180, 120, 360, 280);
    ctx.fillStyle = '#120a06'; ctx.beginPath(); ctx.ellipse(ex, 330, 70, 110, 0, Math.PI, 0); ctx.fill();
    ctx.fillStyle = 'rgba(255,215,120,.85)'; ctx.beginPath(); ctx.ellipse(ex, 335, 52, 92, 0, Math.PI, 0); ctx.fill();
    text('LAIR', ex, 200, 14, '#fff0b0');
  }
  drawPlatforms(camX);
  for (const it of level.items) { if (it.got) continue; const x = it.x - camX; if (x < -40 || x > W + 40) continue; drawItem(it.type, x, it.y, 1, Math.sin(it.t * 3) * 3); if (it.type !== 'coin' && Math.sin(it.t * 5) > 0.95) burst(it.x, it.y - 10, '#ffffff', 1, 40, 0.4, 0); }
  drawHazards(camX, t);
  if (!(player.invuln > 0 && player.invuln < 5 && Math.floor(player.invuln * 12) % 2)) drawDragon(dragonFrame(), player.x + player.w / 2 - camX, player.y + player.h, player.face);
  drawParticles(camX);
  drawLava(camX, t);
  ctx.restore();
  drawHUD();
}

// ---------- lair ----------
let lair = null;
function enterLair() {
  scene = 'lair'; sceneT = 0; playMusic('music-lair');
  lair = { flying: [], queue: bag.slice(), startHoard: save.hoard, shown: save.hoard, stageBefore: hoardStage(save.hoard), phase: 'walk',
    dx: -60, purrT: 4, zz: [], sparkle: 0, levelGain: bagValue, banner: 0 };
  lair.queue.sort(() => Math.random() - 0.5);
  save.hoard += bagValue; bag.forEach(t => save.items[t] = (save.items[t] || 0) + 1); save.level = level.n + 1; writeSave();
}
function pileGeom(value) {
  const st = hoardStage(value); if (st === 0) return null;
  const name = 'hoard' + st, im = IMG[name];
  const next = HOARD_STAGES[st + 1], cur = HOARD_STAGES[st];
  // grow smoothly within a stage, and keep swelling beyond the last one
  const frac = next ? (value - cur.at) / (next.at - cur.at) : Math.min(1, (value - cur.at) / 70000);
  const w = st === 5 ? 600 + frac * 140 : [0, 170, 300, 400, 500][st] + frac * [0, 110, 90, 90, 90][st];
  const h = im ? w * im.height / im.width : w * 0.66;
  const top = im ? (pileTop(name) * h) : h * 0.3;
  return { name, im, w, h, x: W / 2 - w / 2 + 60, y: 512 - h, topY: 512 - h + top, st };
}
function updateLair(dt) {
  const Lr = lair; sceneT += dt;
  const pg = pileGeom(Math.max(1, Lr.shown)) || { x: W / 2, w: 0, topY: 500 };
  const pileCx = pg.x + pg.w / 2;
  if (Lr.phase === 'walk') { Lr.dx += 220 * dt; if (Lr.dx > pileCx - 200) { Lr.dx = pileCx - 200; Lr.phase = Lr.queue.length ? 'stash' : 'climb'; Lr.t = 0; } }
  else if (Lr.phase === 'stash') {
    Lr.t -= dt;
    if (Lr.t <= 0 && Lr.queue.length) {
      const n = Math.min(Lr.queue.length, Math.max(1, Math.ceil(Lr.queue.length / 60)));
      for (let i = 0; i < n; i++) { const tp = Lr.queue.pop(); Lr.flying.push({ type: tp, x: Lr.dx + 20, y: 440, tx: pileCx + (Math.random() - .5) * pg.w * 0.5, ty: pg.topY + 20 + Math.random() * 40, t: 0 }); }
      Lr.t = 0.06; sfx('sfx-coin', 0.25, 0.9 + Math.random() * 0.3);
    }
    if (!Lr.queue.length && !Lr.flying.length) { Lr.phase = 'climb'; Lr.t = 0; sfx('sfx-stash', 0.8); if (hoardStage(save.hoard) > Lr.stageBefore) { Lr.banner = 3.5; sfx('dragon-roar', 0.7); shake = 0.5; } }
  }
  else if (Lr.phase === 'climb') { Lr.t += dt; if (Lr.t > 0.9) { Lr.phase = 'rest'; Lr.t = 0; } }
  else if (Lr.phase === 'rest') { Lr.t += dt; if ((Lr.purrT -= dt) <= 0) { sfx('sfx-purr', 0.5); Lr.purrT = 9 + Math.random() * 6; } if (Math.random() < dt * 0.8) Lr.zz.push({ x: 0, y: 0, t: 0 }); }
  Lr.flying = Lr.flying.filter(f => { f.t += dt * 1.8; if (f.t >= 1) { Lr.shown += TREASURE[f.type].value; burst(f.x, f.y, '#ffe066', 4, 90, 0.4, 200); return false; } return true; });
  Lr.zz = Lr.zz.filter(z => (z.t += dt) < 2.5);
  if (Lr.banner > 0) Lr.banner -= dt;
  if (Math.random() < dt * (2 + hoardStage(Lr.shown) * 2) && pg.w) particles.push({ x: pg.x + pg.w * (0.15 + Math.random() * 0.7), y: pg.topY + Math.random() * (512 - pg.topY), vx: 0, vy: 0, life: 0.5, max: 0.5, color: '#fffbe0', grav: 0, size: 2 + Math.random() * 2 });
  updateParticles(dt); shake = Math.max(0, shake - dt);
  if (anyPressed && Lr.phase === 'rest' && Lr.t > 0.6) startLevel(save.level);
  else if (anyPressed && (Lr.phase === 'stash' || Lr.phase === 'walk')) { // fast-forward
    Lr.queue.forEach(tp => Lr.shown += TREASURE[tp].value); Lr.queue = []; Lr.flying.forEach(f => Lr.shown += TREASURE[f.type].value); Lr.flying = []; Lr.dx = pileCx - 200;
  }
}
function drawLair() {
  const Lr = lair, sx = shake > 0 ? (Math.random() - .5) * 10 : 0;
  ctx.save(); ctx.translate(sx, 0);
  if (IMG.lair) ctx.drawImage(IMG.lair, 0, 0, W, H); else { ctx.fillStyle = '#2a1a10'; ctx.fillRect(0, 0, W, H); }
  ctx.fillStyle = 'rgba(0,0,0,.2)'; ctx.fillRect(0, 0, W, H);
  const pg = pileGeom(Math.max(0, Lr.shown));
  if (pg) {
    const glow = ctx.createRadialGradient(pg.x + pg.w / 2, 480, 20, pg.x + pg.w / 2, 480, pg.w * 0.8);
    glow.addColorStop(0, `rgba(255,210,90,${0.25 + pg.st * 0.06})`); glow.addColorStop(1, 'rgba(255,200,80,0)');
    ctx.fillStyle = glow; ctx.fillRect(0, 0, W, H);
    if (pg.im) ctx.drawImage(pg.im, pg.x, pg.y, pg.w, pg.h);
  }
  for (const f of Lr.flying) { const t = f.t, x = lerp(f.x, f.tx, t), y = lerp(f.y, f.ty, t) - Math.sin(t * Math.PI) * 160; f.cx = x; f.cy = y; drawItem(f.type, x, y, 0.9); }
  // the dragon
  const topY = pg ? pg.topY + 10 : 500, pileCx = pg ? pg.x + pg.w / 2 : W / 2;
  if (Lr.phase === 'walk') drawDragon('run' + (Math.floor(sceneT * 10) % 4), Lr.dx, 505, 1);
  else if (Lr.phase === 'stash') drawDragon('run1', Lr.dx, 505, 1);
  else if (Lr.phase === 'climb') { const t = Lr.t / 0.9; drawDragon('fly' + (Math.floor(sceneT * 12) % 4), lerp(Lr.dx, pileCx, t), lerp(505, topY, t) - Math.sin(t * Math.PI) * 120, 1); }
  else {
    drawDragon('lounge' + (Math.floor(sceneT * 1.2) % 2), pileCx, topY, 1, SPRITE * 1.1);
    Lr.zz.forEach(z => { ctx.globalAlpha = 1 - z.t / 2.5; text('z', pileCx + 50 + z.t * 22 + Math.sin(z.t * 3) * 6, topY - 80 - z.t * 30, 10 + z.t * 6, '#e8f0ff'); ctx.globalAlpha = 1; });
  }
  drawParticles(0);
  ctx.restore();
  // UI
  const st = hoardStage(Lr.shown);
  ctx.fillStyle = 'rgba(10,5,2,.6)'; ctx.fillRect(0, 0, W, 64);
  text('THE HOARD', 20, 20, 12, '#ffcf6a', 'left');
  text(fmt(Lr.shown) + ' gold', 20, 44, 16, '#fff0a8', 'left');
  text(HOARD_STAGES[st].name, W - 20, 20, 12, '#ffcf6a', 'right');
  if (level) text(`+${fmt(Lr.levelGain)} from ${level.cave.name}`, W - 20, 44, 10, '#f6d58a', 'right');
  if (Lr.banner > 0) { ctx.globalAlpha = clamp(Lr.banner, 0, 1); text('YOUR HOARD GROWS!', W / 2, 120, 22, '#fff3b0'); text(HOARD_STAGES[st].name, W / 2, 156, 14, '#ffcf6a'); ctx.globalAlpha = 1; }
  if (Lr.phase === 'rest') {
    const next = CAVES[save.level % 4], depth = Math.floor(save.level / 4);
    ctx.globalAlpha = 0.6 + 0.4 * Math.sin(sceneT * 3);
    text(`Rest as long as you like.  Press SPACE / tap to venture into ${next.name}${depth ? ' (Depth ' + (depth + 1) + ')' : ''}`, W / 2, 530 - 6, 9, '#fff0c0');
    ctx.globalAlpha = 1;
  } else text('SPACE / tap to skip', W / 2, 524, 9, 'rgba(255,240,192,.6)');
  drawMute();
}

// ---------- scenes ----------
let scene = 'loading', sceneT = 0;
function drawTitle() {
  if (IMG.lair) ctx.drawImage(IMG.lair, 0, 0, W, H);
  ctx.fillStyle = 'rgba(0,0,0,.45)'; ctx.fillRect(0, 0, W, H);
  const pg = pileGeom(Math.max(save.hoard, 1)); if (pg && pg.im && save.hoard > 0) { ctx.globalAlpha = .9; ctx.drawImage(pg.im, pg.x, pg.y, pg.w, pg.h); ctx.globalAlpha = 1; }
  const bob = Math.sin(sceneT * 2.2) * 14;
  drawDragon('fly' + (Math.floor(sceneT * 9) % 4), W / 2, 300 + bob, 1, 1.4);
  text('HOARD HOPPER', W / 2, 90, 40, '#ffd34d');
  text('a little dragon with big ambitions', W / 2, 135, 11, '#f6d58a');
  ctx.globalAlpha = 0.55 + 0.45 * Math.sin(sceneT * 3.5);
  text(save.level > 0 ? 'Press SPACE / tap to continue' : 'Press SPACE / tap to start', W / 2, 410, 14, '#fff0c0');
  ctx.globalAlpha = 1;
  text('Arrows / WASD to move     SPACE / W / Up to jump, again in the air to flap', W / 2, 455, 9, '#e8d3a0');
  text('Grab treasure, dodge spikes, lava and falling rock. Don\'t fall behind!', W / 2, 478, 9, '#e8d3a0');
  if (save.hoard > 0) text(`Hoard: ${fmt(save.hoard)} gold   Next: ${CAVES[save.level % 4].name}   (Shift+R resets)`, W / 2, 512, 9, '#c9b98a');
  drawMute();
}
function drawIntro() {
  drawLevel();
  const a = clamp(1.6 - sceneT, 0, 1);
  ctx.fillStyle = `rgba(0,0,0,${0.5 * a + 0.2 * clamp(2.2 - sceneT, 0, 1)})`; ctx.fillRect(0, 0, W, H);
  ctx.globalAlpha = clamp(2.6 - sceneT, 0, 1);
  text(`Cave ${level.n + 1}`, W / 2, 200, 14, '#f6d58a');
  text(level.cave.name, W / 2, 240, 30, level.cave.edge);
  ctx.globalAlpha = 1;
}
function drawFail() {
  drawLevel();
  ctx.fillStyle = 'rgba(30,0,0,.6)'; ctx.fillRect(0, 0, W, H);
  text('OUCH!', W / 2, 200, 36, '#ff8a6a');
  text('The treasure you gathered tumbles into the lava...', W / 2, 250, 11, '#f6d58a');
  text('Your hoard back home is safe.', W / 2, 278, 11, '#f6d58a');
  if (sceneT > 0.8) { ctx.globalAlpha = 0.6 + 0.4 * Math.sin(sceneT * 4); text('SPACE / tap to try again', W / 2, 340, 14, '#fff0c0'); ctx.globalAlpha = 1; }
}

let last = performance.now(), acc = 0;
function frame(now) {
  let dt = Math.min(0.05, (now - last) / 1000); last = now;
  sceneT += dt;
  const press = anyPressed; anyPressed = false;
  if (scene === 'loading') {
    ctx.fillStyle = '#0b0708'; ctx.fillRect(0, 0, W, H);
    text('Loading the caves... ' + Math.round(100 * loaded / Math.max(1, total)) + '%', W / 2, H / 2, 14);
  } else if (scene === 'title') {
    drawTitle(); playMusic('music-lair');
    if (press) { sfx('dragon-roar', 0.6); startLevel(save.level); }
  } else if (scene === 'intro' || scene === 'play' || scene === 'exit') {
    acc += dt; const step = 1 / 120;
    while (acc >= step) {
      acc -= step;
      if (scene === 'intro') { levelTime += step; if (sceneT > 1.6) scene = 'play'; }
      else if (scene === 'play') updateLevel(step);
      else { // run into the lair
        levelTime += step; player.x += 260 * step; player.anim += step * 10; player.vy = 0;
        if (sceneT > 1.3) { enterLair(); break; }
      }
      updateParticles(step);
    }
    jumpPressed = scene === 'play' ? jumpPressed : false;
    if (scene === 'intro') drawIntro(); else if (scene !== 'lair') { drawLevel(); if (scene === 'exit') { ctx.fillStyle = `rgba(255,220,140,${clamp(sceneT / 1.3, 0, 1)})`; ctx.fillRect(0, 0, W, H); } }
  } else if (scene === 'fail') {
    updateParticles(dt); drawFail();
    if (press && sceneT > 0.8) startLevel(level.n);
  }
  if (scene === 'lair') { anyPressed = press; updateLair(dt); anyPressed = false; drawLair(); }
  requestAnimationFrame(frame);
}

// ---------- layout ----------
function fit() {
  const s = Math.min(innerWidth / W, innerHeight / H);
  canvas.style.width = Math.floor(W * s) + 'px'; canvas.style.height = Math.floor(H * s) + 'px';
}
addEventListener('resize', fit); fit();

loadImages().then(() => { (document.fonts ? document.fonts.ready : Promise.resolve()).then(() => { scene = 'title'; sceneT = 0; }); });
requestAnimationFrame(frame);
