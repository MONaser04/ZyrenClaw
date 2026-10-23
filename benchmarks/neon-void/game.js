/* NEON VOID — Tier 1 Walking Skeleton */
/* Single-file Canvas 2D arcade shooter. Runs via file:// with zero CORS. */

(function () {
  'use strict';

  // ---------- DOM ----------
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');

  const hudEl = document.getElementById('hud');
  const menuEl = document.getElementById('menu');
  const pauseEl = document.getElementById('pause');
  const gameoverEl = document.getElementById('gameover');

  const elScore = document.getElementById('stat-score');
  const elWave = document.getElementById('stat-wave');
  const elHearts = document.getElementById('stat-hearts');
  const elCombo = document.getElementById('hud-combo');
  const elComboFill = document.getElementById('hud-combo-fill');
  const elDash = document.getElementById('hud-dash');
  const elDashFill = document.getElementById('hud-dash-fill');
  const elMenuBest = document.getElementById('menu-best');
  const elGoScore = document.getElementById('go-score');
  const elGoWave = document.getElementById('go-wave');
  const elGoBest = document.getElementById('go-best');

  // ---------- Audio (WebAudio synthesized SFX) ----------
  let audioCtx = null;
  let muted = false;

  function ensureAudio() {
    if (!audioCtx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (Ctx) audioCtx = new Ctx();
    }
    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
  }

  function playShoot() {
    if (muted || !audioCtx) return;
    const t = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(880, t);
    osc.frequency.exponentialRampToValueAtTime(440, t + 0.06);
    gain.gain.setValueAtTime(0.12, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start(t);
    osc.stop(t + 0.06);
  }

  function playExplosion() {
    if (muted || !audioCtx) return;
    const t = audioCtx.currentTime;
    const len = audioCtx.sampleRate * 0.15;
    const buffer = audioCtx.createBuffer(1, len, audioCtx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < len; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    }
    const noise = audioCtx.createBufferSource();
    noise.buffer = buffer;
    const gain = audioCtx.createGain();
    gain.gain.setValueAtTime(0.3, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
    noise.connect(gain);
    gain.connect(audioCtx.destination);
    noise.start(t);
  }

  function playPlayerHit() {
    if (muted || !audioCtx) return;
    const t = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(130, t);
    osc.frequency.linearRampToValueAtTime(50, t + 0.18);
    gain.gain.setValueAtTime(0.3, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start(t);
    osc.stop(t + 0.18);
  }

  function playWaveStart() {
    if (muted || !audioCtx) return;
    const t = audioCtx.currentTime;
    const o1 = audioCtx.createOscillator();
    const o2 = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o1.type = 'square';
    o2.type = 'square';
    o1.frequency.setValueAtTime(440, t);
    o2.frequency.setValueAtTime(587.33, t);
    g.gain.setValueAtTime(0.15, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
    o1.connect(g);
    o2.connect(g);
    g.connect(audioCtx.destination);
    o1.start(t);
    o2.start(t);
    o1.stop(t + 0.4);
    o2.stop(t + 0.4);
  }

  function playBossSpawn() {
    if (muted || !audioCtx) return;
    const t = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(55, t);
    osc.frequency.linearRampToValueAtTime(130, t + 0.9);
    gain.gain.setValueAtTime(0.35, t);
    gain.gain.linearRampToValueAtTime(0, t + 0.9);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start(t);
    osc.stop(t + 0.9);
  }

  // ---------- Config ----------
  const C = {
    player: '#00ffff',
    chaser: '#ff0033',
    weaver: '#ff00ff',
    dasher: '#ffff00',
    boss: '#ff69b4',
    bullet: '#00ffff',
    grid: '#111122'
  };

  const PLAYER_R = 10;
  const PLAYER_SPEED = 260;
  const DASH_SPEED = 620;
  const DASH_DURATION = 0.18;
  const DASH_COOLDOWN = 0.8;
  const FIRE_RATE = 0.125;
  const BULLET_SPEED = 520;
  const BULLET_LIFE = 1.2;
  const INVULN_TIME = 1.2;
  const COMBO_WINDOW = 2.5;
  const COMBO_MAX = 8;
  const WEAVER_KEEP = 250;

  // ---------- State ----------
  let width = 0;
  let height = 0;
  let screen = 'MENU';
  let wave = 0;
  let score = 0;
  let best = 0;
  let lives = 3;
  let combo = 1;
  let comboTimer = 0;
  let lastKillTime = 0;

  let player = null;
  let bullets = [];
  let enemies = [];
  let particles = [];

  let shake = 0;
  let damageFlash = 0;
  let slowMo = 1;
  let slowMoTimer = 0;
  let muzzleFlash = 0;
  let muzzleX = 0;
  let muzzleY = 0;
  let muzzleA = 0;

  let fireTimer = 0;
  let fireHeld = false;
  let waveBannerTimer = 0;
  let waveBannerText = '';
  let waveTimer = 0;

  const keys = {};
  let aim = { x: 1, y: 0 };
  let moveDir = { x: 0, y: 0 };

  // ---------- Resize ----------
  function resize() {
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = width;
    canvas.height = height;
  }
  window.addEventListener('resize', resize);
  resize();

  // ---------- Entities ----------
  function spawnPlayer() {
    player = {
      x: width * 0.5,
      y: height * 0.82,
      vx: 0,
      vy: 0,
      angle: -Math.PI / 2,
      r: PLAYER_R,
      lives: 3,
      invuln: 0,
      dash: 0,
      dashCd: 0,
      dead: false
    };
  }

  function spawnBullet(x, y, angle, enemyBullet) {
    bullets.push({
      x: x,
      y: y,
      vx: Math.cos(angle) * BULLET_SPEED,
      vy: Math.sin(angle) * BULLET_SPEED,
      life: BULLET_LIFE,
      dead: false,
      r: 3,
      enemyBullet: !!enemyBullet,
      colour: enemyBullet ? '#ff00ff' : C.bullet
    });
  }

  function spawnEnemy(type) {
    const side = Math.floor(Math.random() * 4);
    let x, y;
    if (side === 0) {
      x = -40;
      y = Math.random() * height;
    } else if (side === 1) {
      x = width + 40;
      y = Math.random() * height;
    } else if (side === 2) {
      x = Math.random() * width;
      y = -40;
    } else {
      x = Math.random() * width;
      y = height + 40;
    }

    const hpScale = 1 + (wave - 1) * 0.25;
    let hp, speed, r, colour, typeName;
    if (type === 'chaser') {
      hp = 1 * hpScale;
      speed = 70;
      r = 9;
      colour = C.chaser;
      typeName = 'chaser';
    } else if (type === 'weaver') {
      hp = 1 * hpScale;
      speed = 90;
      r = 8;
      colour = C.weaver;
      typeName = 'weaver';
    } else if (type === 'dasher') {
      hp = 1 * hpScale;
      speed = 110;
      r = 9;
      colour = C.dasher;
      typeName = 'dasher';
    } else {
      hp = 20 + wave * 6;
      speed = 45;
      r = 34;
      colour = C.boss;
      typeName = 'boss';
    }

    enemies.push({
      x: x,
      y: y,
      vx: 0,
      vy: 0,
      r: r,
      hp: hp,
      maxHp: hp,
      speed: speed,
      colour: colour,
      type: typeName,
      dead: false,
      dashCd: 0,
      dash: 0,
      telegraph: 0,
      shootCd: Math.random() * 1.5,
      orbitAngle: Math.random() * Math.PI * 2,
      ringCd: 2 + Math.random() * 2
    });
  }

  function spawnWave(n) {
    wave = n;
    waveBannerText = 'WAVE ' + n;
    waveBannerTimer = 1.6;
    playWaveStart();
    const count = 4 + 2 * n;
    if (n % 5 === 0) {
      playBossSpawn();
      spawnEnemy('boss');
      for (let i = 0; i < count - 1; i++) spawnEnemy('chaser');
    } else {
      const types = ['chaser', 'weaver', 'dasher'];
      for (let i = 0; i < count; i++) spawnEnemy(types[i % types.length]);
    }
  }

  function startGame() {
    ensureAudio();
    screen = 'PLAYING';
    wave = 0;
    score = 0;
    lives = 3;
    combo = 1;
    comboTimer = 0;
    bullets = [];
    enemies = [];
    particles = [];
    shake = 0;
    damageFlash = 0;
    slowMo = 1;
    spawnPlayer();
    hudEl.classList.remove('hidden');
    menuEl.classList.add('hidden');
    pauseEl.classList.add('hidden');
    gameoverEl.classList.add('hidden');
    updateHUD();
    spawnWave(1);
  }

  function gameOver() {
    screen = 'GAMEOVER';
    if (score > best) {
      best = score;
      try {
        localStorage.setItem('neonvoid.best', String(best));
      } catch (e) {}
    }
    elGoScore.textContent = score;
    elGoWave.textContent = wave;
    elGoBest.textContent = best;
    gameoverEl.classList.remove('hidden');
    hudEl.classList.add('hidden');
  }

  function addParticles(x, y, colour, count) {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = Math.random() * 140 + 40;
      particles.push({
        x: x,
        y: y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 0.45 + Math.random() * 0.35,
        maxLife: 1,
        colour: colour,
        size: Math.random() * 3 + 1
      });
    }
  }

  function killEnemy(idx) {
    const e = enemies[idx];
    if (e.dead) return;
    e.dead = true;
    addParticles(e.x, e.y, e.colour, 18);
    playExplosion();

    let points = 10;
    if (e.type === 'boss') points = 500;
    else if (e.type === 'weaver') points = 20;
    else if (e.type === 'dasher') points = 15;

    const now = Date.now() / 1000;
    if (now - lastKillTime <= COMBO_WINDOW && combo < COMBO_MAX) {
      combo++;
    } else {
      combo = 1;
    }
    lastKillTime = now;
    comboTimer = COMBO_WINDOW;
    score += points * combo;

    if (e.type === 'boss') {
      shake = 18;
      slowMo = 0.25;
      slowMoTimer = 0.08;
    }
    updateHUD();
  }

  function playerHit() {
    if (!player || player.invuln > 0 || player.dash > 0) return;
    lives--;
    playPlayerHit();
    shake = 12;
    damageFlash = 0.5;
    player.invuln = INVULN_TIME;
    player.dash = 0;
    player.dashCd = DASH_COOLDOWN;
    updateHUD();
    if (lives <= 0) {
      player.dead = true;
      gameOver();
    }
  }

  // ---------- Input ----------
  function onKeyDown(e) {
    keys[e.code] = true;

    if (screen === 'MENU') {
      if (e.code === 'Enter') startGame();
      if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
      return;
    }
    if (screen === 'GAMEOVER') {
      if (e.code === 'KeyR') startGame();
      if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
      return;
    }
    if (screen === 'PAUSED') {
      if (e.code === 'KeyP') {
        screen = 'PLAYING';
        pauseEl.classList.add('hidden');
      }
      if (e.code === 'KeyM') muted = !muted;
      if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
      return;
    }
    // PLAYING
    if (e.code === 'KeyP') {
      screen = 'PAUSED';
      pauseEl.classList.remove('hidden');
      return;
    }
    if (e.code === 'Space') {
      fireHeld = true;
      fireTimer = 0;
      e.preventDefault();
    }
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
      tryDash();
      e.preventDefault();
    }
    if (e.code === 'KeyM') {
      muted = !muted;
    }
    if (e.code.startsWith('Arrow')) {
      e.preventDefault();
    }
  }

  function onKeyUp(e) {
    keys[e.code] = false;
    if (e.code === 'Space') fireHeld = false;
  }

  function tryDash() {
    if (!player || player.dash > 0 || player.dashCd > 0) return;
    const mx = moveDir.x;
    const my = moveDir.y;
    if (mx === 0 && my === 0) return;
    const len = Math.sqrt(mx * mx + my * my) || 1;
    player.vx = (mx / len) * DASH_SPEED;
    player.vy = (my / len) * DASH_SPEED;
    player.dash = DASH_DURATION;
    player.dashCd = DASH_COOLDOWN;
  }

  function onMouseMove(e) {
    if (!player) return;
    const dx = e.clientX - player.x;
    const dy = e.clientY - player.y;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    aim.x = dx / len;
    aim.y = dy / len;
    player.angle = Math.atan2(dy, dx);
  }

  function onMouseDown(e) {
    if (screen === 'MENU') {
      startGame();
      return;
    }
    if (screen === 'GAMEOVER') {
      startGame();
      return;
    }
    if (screen === 'PAUSED') {
      screen = 'PLAYING';
      pauseEl.classList.add('hidden');
      return;
    }
    if (screen === 'PLAYING' && e.button === 0) {
      fireHeld = true;
      fireTimer = 0;
    }
  }

  function onMouseUp(e) {
    if (e.button === 0) fireHeld = false;
  }

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  canvas.addEventListener('mousemove', onMouseMove);
  canvas.addEventListener('mousedown', onMouseDown);
  canvas.addEventListener('mouseup', onMouseUp);
  window.addEventListener('blur', function () {
    if (screen === 'PLAYING') {
      screen = 'PAUSED';
      pauseEl.classList.remove('hidden');
    }
  });

  // ---------- Update (fixed timestep) ----------
  const STEP = 1 / 60;
  const MAX_STEPS = 3;

  function updateInputMove(dt) {
    if (!player || screen !== 'PLAYING') return;
    let mx = 0;
    let my = 0;
    if (keys['KeyW'] || keys['ArrowUp']) my -= 1;
    if (keys['KeyS'] || keys['ArrowDown']) my += 1;
    if (keys['KeyA'] || keys['ArrowLeft']) mx -= 1;
    if (keys['KeyD'] || keys['ArrowRight']) mx += 1;
    moveDir = { x: mx, y: my };
    const len = Math.sqrt(mx * mx + my * my);
    if (len > 0) {
      mx /= len;
      my /= len;
      player.vx = mx * PLAYER_SPEED;
      player.vy = my * PLAYER_SPEED;
    } else {
      player.vx *= 0.82;
      player.vy *= 0.82;
    }
  }

  function updatePlayer(dt) {
    if (!player) return;
    if (player.dash > 0) {
      player.dash -= dt;
      if (player.dash < 0) player.dash = 0;
      if (Math.random() < 0.5) {
        particles.push({
          x: player.x - player.vx * 0.03,
          y: player.y - player.vy * 0.03,
          vx: -player.vx * 0.25 + (Math.random() - 0.5) * 20,
          vy: -player.vy * 0.25 + (Math.random() - 0.5) * 20,
          life: 0.15,
          maxLife: 0.15,
          colour: C.player,
          size: 2
        });
      }
    }
    if (player.invuln > 0) player.invuln -= dt;
    if (player.dashCd > 0) player.dashCd -= dt;

    player.x += player.vx * dt;
    player.y += player.vy * dt;

    if (player.x < player.r) player.x = player.r;
    if (player.x > width - player.r) player.x = width - player.r;
    if (player.y < player.r) player.y = player.r;
    if (player.y > height - player.r) player.y = height - player.r;
  }

  function updateBullets(dt) {
    for (let i = bullets.length - 1; i >= 0; i--) {
      const b = bullets[i];
      if (b.dead) continue;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.life -= dt;
      if (b.life <= 0) {
        b.dead = true;
        continue;
      }

      if (!b.enemyBullet) {
        for (let j = enemies.length - 1; j >= 0; j--) {
          const e = enemies[j];
          if (e.dead) continue;
          const dx = b.x - e.x;
          const dy = b.y - e.y;
          if (dx * dx + dy * dy < (b.r + e.r) * (b.r + e.r)) {
            b.dead = true;
            e.hp--;
            if (e.hp <= 0) killEnemy(j);
            break;
          }
        }
      } else if (player) {
        const dx = b.x - player.x;
        const dy = b.y - player.y;
        if (dx * dx + dy * dy < (b.r + player.r) * (b.r + player.r)) {
          b.dead = true;
          playerHit();
        }
      }
    }
    bullets = bullets.filter(function (b) {
      return !b.dead;
    });
  }

  function dist2(x1, y1, x2, y2) {
    return (x1 - x2) * (x1 - x2) + (y1 - y2) * (y1 - y2);
  }

  function updateEnemies(dt) {
    if (!player) return;
    for (let i = enemies.length - 1; i >= 0; i--) {
      const e = enemies[i];
      if (e.dead) continue;

      if (e.type === 'chaser') {
        const dx = player.x - e.x;
        const dy = player.y - e.y;
        const d = Math.sqrt(dx * dx + dy * dy) || 1;
        e.vx = (dx / d) * e.speed;
        e.vy = (dy / d) * e.speed;
      } else if (e.type === 'weaver') {
        const dx = player.x - e.x;
        const dy = player.y - e.y;
        const d = Math.sqrt(dx * dx + dy * dy) || 1;
        const dirX = d < WEAVER_KEEP ? -dx / d : dx / d;
        const dirY = d < WEAVER_KEEP ? -dy / d : dy / d;
        e.vx = dirX * e.speed;
        e.vy = dirY * e.speed;
        e.orbitAngle += dt * 1.2;
        e.vx += Math.cos(e.orbitAngle) * 40;
        e.vy += Math.sin(e.orbitAngle) * 40;
        e.shootCd -= dt;
        if (e.shootCd <= 0 && d < 650) {
          e.shootCd = 1.4 + Math.random() * 1.0;
          const a = Math.atan2(player.y - e.y, player.x - e.x);
          spawnBullet(e.x, e.y, a, true);
          const orb = bullets[bullets.length - 1];
          orb.vx = Math.cos(a) * 200;
          orb.vy = Math.sin(a) * 200;
        }
      } else if (e.type === 'dasher') {
        if (e.dash > 0) {
          e.dash -= dt;
          e.x += e.vx * dt;
          e.y += e.vy * dt;
          if (e.dash <= 0) {
            e.dash = 0;
            e.vx *= 0.25;
            e.vy *= 0.25;
            e.telegraph = 0;
          }
        } else if (e.dashCd > 0) {
          e.dashCd -= dt;
          const dx = player.x - e.x;
          const dy = player.y - e.y;
          const d = Math.sqrt(dx * dx + dy * dy) || 1;
          e.vx = (dx / d) * e.speed * 0.35;
          e.vy = (dy / d) * e.speed * 0.35;
          if (e.dashCd < 0.6) e.telegraph = 0.6;
          if (e.dashCd <= 0) {
            e.dashCd = 0;
            e.dash = 0.5;
            const a = Math.atan2(player.y - e.y, player.x - e.x);
            e.vx = Math.cos(a) * 420;
            e.vy = Math.sin(a) * 420;
            e.telegraph = 0;
          }
        } else {
          const dx = player.x - e.x;
          const dy = player.y - e.y;
          const d = Math.sqrt(dx * dx + dy * dy) || 1;
          e.vx = (dx / d) * e.speed * 0.35;
          e.vy = (dy / d) * e.speed * 0.35;
        }
      } else if (e.type === 'boss') {
        const dx = player.x - e.x;
        const dy = player.y - e.y;
        const d = Math.sqrt(dx * dx + dy * dy) || 1;
        e.vx = (dx / d) * e.speed * 0.5;
        e.vy = (dy / d) * e.speed * 0.5;
        e.ringCd -= dt;
        if (e.ringCd <= 0) {
          e.ringCd = 2.2;
          const count = 12;
          for (let k = 0; k < count; k++) {
            const a = (k / count) * Math.PI * 2;
            spawnBullet(e.x, e.y, a, true);
            const last = bullets[bullets.length - 1];
            last.vx = Math.cos(a) * 150;
            last.vy = Math.sin(a) * 150;
            last.life = 3;
            last.r = 5;
          }
        }
      }

      if (e.type !== 'dasher' || e.dash <= 0) {
        e.x += e.vx * dt;
        e.y += e.vy * dt;
      }

      if (e.x < -120 || e.x > width + 120 || e.y < -120 || e.y > height + 120) {
        e.dead = true;
      }

      if (dist2(player.x, player.y, e.x, e.y) < (player.r + e.r) * (player.r + e.r) && !e.dead) {
        if (e.type === 'dasher' && e.dash > 0) {
          playerHit();
          e.hp = 0;
          if (e.hp <= 0) killEnemy(i);
        } else if (e.type !== 'dasher') {
          playerHit();
        }
      }
    }
    enemies = enemies.filter(function (e) {
      return !e.dead;
    });
  }

  function updateParticles(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt;
      if (p.life <= 0) particles.splice(i, 1);
    }
  }

  function fireIfHeld(dt) {
    if (!player || screen !== 'PLAYING') return;
    if (!fireHeld) return;
    fireTimer -= dt;
    while (fireTimer <= 0) {
      if (!player) break;
      spawnBullet(player.x, player.y, player.angle + (Math.random() * 0.12 - 0.06), false);
      playShoot();
      muzzleFlash = 0.06;
      muzzleX = player.x + Math.cos(player.angle) * PLAYER_R;
      muzzleY = player.y + Math.sin(player.angle) * PLAYER_R;
      muzzleA = player.angle;
      fireTimer += FIRE_RATE;
    }
  }

  function updateGame(dt) {
    if (screen !== 'PLAYING') return;
    updateInputMove(dt);
    updatePlayer(dt);
    fireIfHeld(dt);
    updateBullets(dt);
    updateEnemies(dt);
    updateParticles(dt);

    if (screen === 'PLAYING' && enemies.length === 0) {
      waveTimer += dt;
      if (waveTimer > 1.0) {
        waveTimer = 0;
        spawnWave(wave + 1);
      }
    } else {
      waveTimer = 0;
    }

    if (waveBannerTimer > 0) {
      waveBannerTimer = Math.max(0, waveBannerTimer - dt);
    }

    if (shake > 0) {
      shake -= dt * 6;
      if (shake < 0) shake = 0;
    }
    if (damageFlash > 0) {
      damageFlash -= dt * 1.5;
      if (damageFlash < 0) damageFlash = 0;
    }
    if (slowMoTimer > 0) {
      slowMoTimer -= dt;
      if (slowMoTimer <= 0) {
        slowMo = 1;
        slowMoTimer = 0;
      }
    }
    muzzleFlash -= dt;
    if (muzzleFlash < 0) muzzleFlash = 0;
    comboTimer -= dt;
    if (comboTimer < 0) {
      comboTimer = 0;
      combo = 1;
      updateHUD();
    }
  }

  // ---------- Draw ----------
  function drawGrid() {
    ctx.save();
    ctx.strokeStyle = C.grid;
    ctx.lineWidth = 1;
    const gs = 40;
    const ox = (Date.now() * 8) % gs;
    ctx.beginPath();
    for (let x = -gs + ox; x < width; x += gs) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
    }
    for (let y = -gs + ox; y < height; y += gs) {
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
    }
    ctx.stroke();
    ctx.restore();
  }

  function drawVignette() {
    const g = ctx.createRadialGradient(width * 0.5, height * 0.5, width * 0.3, width * 0.5, height * 0.5, width * 0.9);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.8)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, width, height);
  }

  function drawShip(x, y, angle) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    const r = PLAYER_R;
    ctx.lineWidth = 2;
    ctx.strokeStyle = C.player;
    ctx.shadowBlur = 18;
    ctx.shadowColor = C.player;
    ctx.beginPath();
    ctx.moveTo(r, 0);
    ctx.lineTo(-r * 0.7, -r * 0.7);
    ctx.lineTo(-r * 0.35, 0);
    ctx.lineTo(-r * 0.7, r * 0.7);
    ctx.closePath();
    ctx.stroke();
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fill();
    ctx.restore();
  }

  function drawEntity(e) {
    ctx.save();
    ctx.translate(e.x, e.y);
    ctx.rotate(e.angle);
    ctx.lineWidth = 2;
    ctx.strokeStyle = e.colour;
    ctx.shadowBlur = 14;
    ctx.shadowColor = e.colour;
    ctx.beginPath();
    if (e.type === 'chaser' || e.type === 'dasher') {
      ctx.moveTo(e.r, 0);
      ctx.lineTo(-e.r * 0.7, -e.r * 0.7);
      ctx.lineTo(-e.r * 0.4, 0);
      ctx.lineTo(-e.r * 0.7, e.r * 0.7);
      ctx.closePath();
    } else if (e.type === 'weaver') {
      ctx.moveTo(e.r, 0);
      ctx.lineTo(-e.r * 0.5, -e.r * 0.86);
      ctx.lineTo(-e.r, 0);
      ctx.lineTo(-e.r * 0.5, e.r * 0.86);
      ctx.closePath();
    } else {
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2;
        if (k === 0) ctx.moveTo(Math.cos(a) * e.r, Math.sin(a) * e.r);
        else ctx.lineTo(Math.cos(a) * e.r, Math.sin(a) * e.r);
      }
      ctx.closePath();
    }
    ctx.stroke();
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fill();
    ctx.restore();

    if (e.type === 'boss') drawBossHP(e);
    if (e.telegraph > 0) {
      ctx.save();
      ctx.translate(e.x, e.y);
      ctx.strokeStyle = '#ffff00';
      ctx.lineWidth = 2;
      ctx.shadowBlur = 10;
      ctx.shadowColor = '#ffff00';
      ctx.beginPath();
      ctx.arc(0, 0, e.r + 10 + Math.sin(Date.now() * 0.02) * 3, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  function drawBossHP(e) {
    const bw = e.r * 2.2;
    const bh = 6;
    ctx.fillStyle = '#22001a';
    ctx.fillRect(e.x - bw / 2, e.y - e.r - 14, bw, bh);
    const pct = Math.max(0, e.hp / e.maxHp);
    ctx.fillStyle = e.colour;
    ctx.shadowBlur = 10;
    ctx.shadowColor = e.colour;
    ctx.fillRect(e.x - bw / 2, e.y - e.r - 14, bw * pct, bh);
    ctx.shadowBlur = 0;
  }

  function drawBullet(b) {
    ctx.save();
    ctx.translate(b.x, b.y);
    ctx.fillStyle = b.colour || C.bullet;
    ctx.shadowBlur = 10;
    ctx.shadowColor = b.colour || C.bullet;
    ctx.beginPath();
    ctx.arc(0, 0, b.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawParticle(p) {
    ctx.save();
    ctx.globalAlpha = Math.max(0, p.life / p.maxLife);
    ctx.fillStyle = p.colour;
    ctx.shadowBlur = 8;
    ctx.shadowColor = p.colour;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawMuzzleFlash() {
    if (muzzleFlash <= 0) return;
    ctx.save();
    ctx.translate(muzzleX, muzzleY);
    ctx.rotate(muzzleA);
    const g = ctx.createLinearGradient(-4, 0, 22, 0);
    g.addColorStop(0, 'rgba(255,255,255,0.95)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.shadowBlur = 16;
    ctx.shadowColor = C.player;
    ctx.fillRect(-5, -7, 24, 14);
    ctx.restore();
  }

  function updateHUD() {
    if (!player) return;
    elScore.textContent = 'SCORE ' + score;
    elWave.textContent = 'WAVE ' + wave;
    elHearts.textContent = 'HEARTS ' + lives;
    elCombo.textContent = 'COMBO x' + combo;
    elComboFill.style.width = Math.min(100, (comboTimer / COMBO_WINDOW) * 100) + '%';
    const ready = player && player.dashCd <= 0 && player.dash <= 0;
    elDash.textContent = ready ? 'DASH READY' : 'DASH ' + player.dashCd.toFixed(1) + 's';
    elDashFill.style.width = ready ? '100%' : Math.max(0, (1 - player.dashCd / DASH_COOLDOWN) * 100) + '%';
  }

  function draw() {
    ctx.fillStyle = '#050510';
    ctx.fillRect(0, 0, width, height);
    drawGrid();

    ctx.save();
    if (shake > 0) {
      ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
    }
    drawVignette();

    particles.forEach(drawParticle);
    if (
      player &&
      (player.invuln === 0 || Math.floor(Date.now() / 80) % 2 === 0)
    ) {
      drawShip(player.x, player.y, player.angle);
    }
    enemies.forEach(drawEntity);
    bullets.forEach(drawBullet);
    drawMuzzleFlash();

    ctx.restore();

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (damageFlash > 0) {
      ctx.save();
      ctx.globalAlpha = damageFlash * 0.5;
      ctx.fillStyle = '#ff003c';
      ctx.fillRect(0, 0, width, height);
      ctx.restore();
    }
    if (waveBannerTimer > 0) {
      const a = Math.min(1, waveBannerTimer / 1.6);
      ctx.save();
      ctx.globalAlpha = a;
      ctx.fillStyle = 'rgba(8, 8, 18, 0.85)';
      ctx.fillRect(width * 0.5 - 250, height * 0.5 - 34, 500, 68);
      ctx.fillStyle = C.player;
      ctx.font = 'bold 28px system-ui, -apple-system, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.shadowBlur = 14;
      ctx.shadowColor = C.player;
      ctx.fillText(waveBannerText, width * 0.5, height * 0.5);
      ctx.restore();
    }
  }

  // ---------- Loop ----------
  let lastTime = performance.now();
  let accumulator = 0;

  function loop(now) {
    const frameMs = now - lastTime;
    lastTime = now;
    let dt = frameMs / 1000;
    if (dt > 0.1) dt = 0.1;

    if (screen === 'PLAYING') {
      accumulator += dt * slowMo;
      const steps = Math.min(MAX_STEPS, Math.floor(accumulator / STEP));
      for (let s = 0; s < steps; s++) {
        updateGame(STEP);
      }
      accumulator -= steps * STEP;
    }

    draw();
    requestAnimationFrame(loop);
  }

  // ---------- Boot ----------
  try {
    const b = localStorage.getItem('neonvoid.best');
    if (b) best = parseInt(b, 10) || 0;
  } catch (e) {}
  elMenuBest.textContent = best;

  menuEl.classList.remove('hidden');
  hudEl.classList.add('hidden');
  pauseEl.classList.add('hidden');
  gameoverEl.classList.add('hidden');

  updateHUD();

  requestAnimationFrame(loop);

})();
