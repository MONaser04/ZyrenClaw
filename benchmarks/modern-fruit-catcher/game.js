/*! Fruit Catcher — Game Logic (no dependencies, file:// friendly) */

(function () {
    'use strict';

    // ------------------------------------------------------------------
    // DOM refs
    // ------------------------------------------------------------------
    const canvas = document.getElementById('gameCanvas');
    const ctx = canvas.getContext('2d');

    const startScreen = document.getElementById('startScreen');
    const levelCompleteScreen = document.getElementById('levelCompleteScreen');
    const gameOverScreen = document.getElementById('gameOverScreen');
    const pauseScreen = document.getElementById('pauseScreen');
    const audioHint = document.getElementById('audioHint');

    const scoreDisplay = document.getElementById('scoreDisplay');
    const livesDisplay = document.getElementById('livesDisplay');
    const levelDisplay = document.getElementById('levelDisplay');
    const bestDisplay = document.getElementById('bestDisplay');

    const startBtn = document.getElementById('startBtn');
    const nextLevelBtn = document.getElementById('nextLevelBtn');
    const restartBtn = document.getElementById('restartBtn');
    const pauseBtn = document.getElementById('pauseBtn');
    const resumeBtn = document.getElementById('resumeBtn');

    const finalScoreDisplay = document.getElementById('finalScore');
    const finalLevelDisplay = document.getElementById('finalLevel');
    const finalBestDisplay = document.getElementById('finalBest');
    const newBestBadge = document.getElementById('newBestBadge');
    const lcScoreDisplay = document.getElementById('lcScore');
    const lcLivesDisplay = document.getElementById('lcLives');
    const levelMsgDisplay = document.getElementById('levelMsg');

    // ------------------------------------------------------------------
    // Persistence (localStorage high score)
    // ------------------------------------------------------------------
    const STORAGE_KEY = 'fruitcatcher_best_v1';
    let bestScore = 0;

    function loadBest() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            bestScore = raw ? parseInt(raw, 10) || 0 : 0;
        } catch (e) {
            bestScore = 0;
        }
    }

    function saveBest() {
        try {
            localStorage.setItem(STORAGE_KEY, String(bestScore));
        } catch (e) {
            // Storage unavailable; high score lives only this session.
        }
    }

    // ------------------------------------------------------------------
    // Audio (Web Audio API) — initialised on first user gesture
    // ------------------------------------------------------------------
    let audioCtx = null;
    let audioEnabled = false;

    function ensureAudio() {
        if (!audioCtx) {
            const Ctx = window.AudioContext || window.webkitAudioContext;
            if (Ctx) audioCtx = new Ctx();
        }
        audioEnabled = true;
        if (audioHint) audioHint.classList.add('hidden');
    }

    function playTone(type) {
        if (!audioEnabled || !audioCtx) return;
        const now = audioCtx.currentTime;

        const cfgs = {
            catch:   [{ f: 900, t: 'sine',   d: 0.08 }],
            miss:    [{ f: 150, t: 'sawtooth', d: 0.18 }],
            levelup: [
                { f: 520, t: 'square', d: 0.12, delay: 0.00 },
                { f: 780, t: 'square', d: 0.12, delay: 0.12 },
                { f: 1040, t: 'square', d: 0.25, delay: 0.24 }
            ],
            gameover: [
                { f: 180, t: 'sawtooth', d: 0.30, delay: 0.00 },
                { f: 130, t: 'sawtooth', d: 0.50, delay: 0.20 }
            ],
            powerup: [{ f: 1200, t: 'sine', d: 0.12 }],
            bomb: [{ f: 110, t: 'square', d: 0.25 }]
        };

        (cfgs[type] || cfgs.catch).forEach((c) => {
            const o = audioCtx.createOscillator();
            const g = audioCtx.createGain();
            o.type = c.t;
            o.frequency.setValueAtTime(c.f, now + (c.delay || 0));
            g.gain.setValueAtTime(0.06, now + (c.delay || 0));
            g.gain.exponentialRampToValueAtTime(0.001, now + (c.delay || 0) + c.d);
            o.connect(g);
            g.connect(audioCtx.destination);
            o.start(now + (c.delay || 0));
            o.stop(now + (c.delay || 0) + c.d + 0.02);
        });
    }

    // ------------------------------------------------------------------
    // Constants & config
    // ------------------------------------------------------------------
    const DESIGN_W = 800;
    const DESIGN_H = 600;
    const MAX_LIVES = 3;

    // Derived at resize
    let displayW = DESIGN_W;
    let displayH = DESIGN_H;
    let scale = 1;
    let offsetX = 0;
    let offsetY = 0;

    const BASKET_W = 120;
    const BASKET_H = 44;
    const BASKET_Y_OFFSET = 28;
    const FRUIT_R = 18;
    const PARTICLE_LIFE = 45;

    // Combo / streak system
    const COMBO_WINDOW = 90;      // frames the combo stays alive (~1.5s @ 60fps)
    let combo = 0;
    let comboTimer = 0;

    // Screen shake
    let shake = 0;
    function startShake(frames) {
        shake = Math.max(shake, frames);
    }

    // Fruit kind definitions
    const KINDS = {
        normal:   { color: '#34d399', glow: '#34d399', score: 10,  weight: 40, speedMult: 1.0  },
        apple:    { color: '#f87171', glow: '#f87171', score: 12,  weight: 20, speedMult: 1.05 },
        banana:   { color: '#fbbf24', glow: '#fbbf24', score: 14,  weight: 14, speedMult: 1.15 },
        orange:   { color: '#fb923c', glow: '#fb923c', score: 11,  weight: 12, speedMult: 1.0  },
        strawberry: { color: '#f472b6', glow: '#f472b6', score: 13, weight: 10, speedMult: 1.05 },
        watermelon: { color: '#22c55e', glow: '#22c55e', score: 16, weight: 8,  speedMult: 0.95 },
        pineapple:  { color: '#facc15', glow: '#facc15', score: 18, weight: 7,  speedMult: 0.9 },
        lemon:      { color: '#fde047', glow: '#fde047', score: 10,  weight: 11, speedMult: 1.1 },
        cherry:     { color: '#e11d48', glow: '#e11d48', score: 13, weight: 9,  speedMult: 1.05 },
        bonus:    { color: '#fbbf24', glow: '#fbbf24', score: 25,  weight: 5,  speedMult: 0.9,  special: 'multiplier' },
        life:     { color: '#22d3ee', glow: '#22d3ee', score: 0,   weight: 3,  speedMult: 0.85, special: 'extralife' },
        slow:     { color: '#818cf8', glow: '#818cf8', score: 0,   weight: 3,  speedMult: 0.8,  special: 'slowmo' },
        bomb:     { color: '#ef4444', glow: '#fca5a5', score: 0,   weight: 8,  speedMult: 1.25, trap: true },
        rotten:   { color: '#c084fc', glow: '#c084fc', score: 0,   weight: 7,  speedMult: 1.1,  trap: true }
    };

    const KIND_ORDER = Object.keys(KINDS);

    // Emoji map for falling objects (replaces colored-sphere drawing)
    const EMOJI_BY_KIND = {
        normal: '🍎',
        apple: '🍎',
        banana: '🍌',
        orange: '🍊',
        strawberry: '🍓',
        watermelon: '🍉',
        pineapple: '🍍',
        lemon: '🍋',
        cherry: '🍒',
        bonus: '💎',
        life: '❤️',
        slow: '⏱',
        bomb: '💣',
        rotten: '💀'
    };

    // ------------------------------------------------------------------
    // Game state
    // ------------------------------------------------------------------
    let state = 'START';        // START | PLAYING | LEVEL_COMPLETE | GAME_OVER
    let score = 0;
    let lives = MAX_LIVES;
    let level = 1;
    let paused = false;

    let basketX = DESIGN_W / 2;
    let targetBasketX = DESIGN_W / 2;
    let mouseX = DESIGN_W / 2;

    let fruits = [];
    let particles = [];
    let bombs = [];             // visual bomb fuse particles
    let slowmo = 0;             // remaining slow-mo frames
    let spawnTimer = 0;
    let spawnInterval = 900;    // ms
    let lastTime = null;
    let animId = null;

    let fruitsCaught = 0;
    let fruitsRequired = 6;
    let baseSpeed = 2.4;

    // ------------------------------------------------------------------
    // Resize handling (also keeps the ambient layer sized to the canvas)
    // ------------------------------------------------------------------
    function resize() {
        const rect = canvas.parentElement ? canvas.parentElement.getBoundingClientRect() : null;
        const maxW = (rect && rect.width) || window.innerWidth;
        const maxH = (rect && rect.height) || window.innerHeight;

        // Keep design aspect, cap height at ~80vh
        let w = DESIGN_W;
        let h = DESIGN_H;
        const availW = Math.min(maxW, 900);
        const availH = Math.min(maxH * 0.82, 700);

        const scaleW = availW / DESIGN_W;
        const scaleH = availH / DESIGN_H;
        scale = Math.min(scaleW, scaleH, 1);

        displayW = DESIGN_W * scale;
        displayH = DESIGN_H * scale;
        offsetX = (availW - displayW) / 2;
        offsetY = (availH - displayH) / 2;

        canvas.width = DESIGN_W;
        canvas.height = DESIGN_H;
        canvas.style.width = `${displayW}px`;
        canvas.style.height = `${displayH}px`;
        canvas.style.left = `${offsetX}px`;
        canvas.style.top = `${offsetY}px`;

        const ambient = document.getElementById('ambient');
        if (ambient) {
            // Farm scene fills the whole viewport so it peeks around the canvas edges.
            ambient.style.width = '100vw';
            ambient.style.height = '100vh';
            ambient.style.left = '0';
            ambient.style.top = '0';
        }
    }

    window.addEventListener('resize', resize);
    window.addEventListener('orientationchange', resize);

    // ------------------------------------------------------------------
    // Ambient background (subtle floating elements for depth)
    // ------------------------------------------------------------------
    function initAmbient() {
        const ambient = document.getElementById('ambient');
        if (!ambient) return;
        const count = 14;
        const hues = [45, 55, 105, 115]; // warm yellows / greens
        for (let i = 0; i < count; i++) {
            const el = document.createElement('div');
            el.className = 'ambient-floater';
            const size = rand(70, 170);
            el.style.width = `${size}px`;
            el.style.height = `${size}px`;
            el.style.left = `${rand(0, 100)}%`;
            el.style.top = `${rand(0, 100)}%`;
            const h = hues[Math.floor(Math.random() * hues.length)];
            el.style.background = `radial-gradient(circle at center, hsla(${h}, 55%, 55%, 0.3) 0%, hsla(${h}, 55%, 45%, 0) 70%)`;
            el.style.animationDuration = `${rand(7, 15)}s`;
            el.style.animationDelay = `${rand(0, 20)}s`;
            ambient.appendChild(el);
        }
    }

    // ------------------------------------------------------------------
    // Input
    // ------------------------------------------------------------------
    function getCanvasMouseX(clientX) {
        const bx = canvas.getBoundingClientRect();
        // Map client x into design coordinates
        const rel = (clientX - bx.left) / Math.max(bx.width, 1);
        return rel * DESIGN_W;
    }

    window.addEventListener('mousemove', (e) => {
        mouseX = Math.max(0, Math.min(DESIGN_W, getCanvasMouseX(e.clientX)));
        targetBasketX = mouseX;
    });

    window.addEventListener('touchmove', (e) => {
        e.preventDefault();
        if (e.touches.length) {
            mouseX = Math.max(0, Math.min(DESIGN_W, getCanvasMouseX(e.touches[0].clientX)));
            targetBasketX = mouseX;
        }
    }, { passive: false });

    // Keyboard fallback (accessibility) + pause (P / K)
    window.addEventListener('keydown', (e) => {
        if (e.key === 'p' || e.key === 'P' || e.key === 'k' || e.key === 'K') {
            if (state === 'PLAYING') togglePause();
            return;
        }
        if (state !== 'PLAYING') return;
        const step = 30;
        if (e.key === 'ArrowLeft') targetBasketX = Math.max(0, targetBasketX - step);
        if (e.key === 'ArrowRight') targetBasketX = Math.min(DESIGN_W, targetBasketX + step);
    });

    canvas.addEventListener('mousedown', ensureAudio);
    canvas.addEventListener('touchstart', (e) => { e.preventDefault(); ensureAudio(); }, { passive: false });

    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------
    function rand(min, max) {
        return Math.random() * (max - min) + min;
    }

    function pickKindForLevel(lvl) {
        // Weighted random; introduce new kinds as level rises
        const pool = [];
        KIND_ORDER.forEach((k) => {
            const w = KINDS[k].weight;
            const unlockLevel = k === 'bomb' || k === 'rotten' ? 2 : 1;
            const specialUnlock = k === 'bonus' || k === 'life' || k === 'slow' ? 3 : 1;
            const minLvl = Math.max(unlockLevel, specialUnlock);
            if (lvl >= minLvl) {
                for (let i = 0; i < w; i++) pool.push(k);
            }
        });
        if (!pool.length) pool.push('normal');
        return pool[Math.floor(Math.random() * pool.length)];
    }

    function spawnFruit(x, y) {
        const kindName = pickKindForLevel(level);
        const kind = KINDS[kindName];
        const r = FRUIT_R;
        const startX = x !== undefined ? Math.max(r, Math.min(DESIGN_W - r, x)) : Math.max(r, Math.min(DESIGN_W - r, rand(0, DESIGN_W)));
        const startY = y !== undefined ? y : -r - 10;
        const speed = baseSpeed * kind.speedMult * (1 + (level - 1) * 0.10) * (slowmo > 0 ? 0.45 : 1);
        const dir = Math.random() < 0.5 ? -1 : 1;
        const drift = rand(0.2, 1.4) * dir;

        fruits.push({
            x: startX, y: startY, r,
            kind, kindName,
            vx: drift,
            vy: speed,
            angle: rand(0, Math.PI * 2),
            spin: rand(-0.12, 0.12),
            caught: false,
            missed: false
        });
    }

    function shadeParticleColor(base) {
        const c = base.startsWith('#') ? base.slice(1) : base;
        const r = Math.min(255, Math.max(0, parseInt(c.substring(0, 2), 16) + rand(-50, 50)));
        const g = Math.min(255, Math.max(0, parseInt(c.substring(2, 4), 16) + rand(-50, 50)));
        const b = Math.min(255, Math.max(0, parseInt(c.substring(4, 6), 16) + rand(-50, 50)));
        return `rgb(${r},${g},${b})`;
    }

    function explode(x, y, color, count = 12) {
        for (let i = 0; i < count; i++) {
            const angle = rand(0, Math.PI * 2);
            const speed = rand(1.5, 7);
            const life = rand(20, PARTICLE_LIFE);
            particles.push({
                x, y,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed,
                life,
                maxLife: life,
                color: shadeParticleColor(color),
                size: rand(2, 7),
                rot: rand(0, Math.PI * 2),
                spin: rand(-0.25, 0.25)
            });
        }
    }

    function catchFruit(f) {
        if (f.caught || f.missed) return;
        f.caught = true;

        if (f.kindName === 'bomb' || f.kindName === 'rotten') {
            // Trap: lose a life, break combo, shake screen
            combo = 0;
            comboTimer = 0;
            loseLife();
            explode(f.x, f.y, f.kind.color, 16);
            playTone('bomb');
            startShake(12);
        } else if (f.kind.special === 'multiplier') {
            score += 50;
            playTone('powerup');
            showFloat(f.x, f.y, '×2', '#fff');
        } else if (f.kind.special === 'extralife') {
            lives = Math.min(MAX_LIVES, lives + 1);
            playTone('powerup');
            showFloat(f.x, f.y, '+1 LIFE', '#fff');
        } else if (f.kind.special === 'slowmo') {
            slowmo = 420; // ~7 seconds at 60fps
            playTone('powerup');
            showFloat(f.x, f.y, 'SLOW', '#fff');
        } else {
            const mult = Math.min(3, 1 + Math.floor(combo / 3));
            const points = Math.max(1, Math.floor(f.kind.score * mult));
            score += points;
            combo++;
            comboTimer = COMBO_WINDOW;
            playTone('catch');
            explode(f.x, f.y, f.kind.color, 10);
            showFloat(f.x, f.y - 16, `+${points}`, f.kind.color);
            if (combo >= 2) {
                showFloat(f.x, f.y - 42, `${combo}× COMBO!`, '#fff');
            }
        }

        fruitsCaught++;
        updateHUD();
    }

    function missFruit(f) {
        if (f.caught || f.missed) return;
        f.missed = true;
        combo = 0;
        comboTimer = 0;
        loseLife();
        playTone('miss');
        fruitsCaught++; // count toward level progress so misses don't stall forever
        updateHUD();
    }

    function loseLife() {
        lives = Math.max(0, lives - 1);
        updateHUD();
        if (lives <= 0) {
            endGame();
        }
    }

    function showFloat(x, y, text, color = '#fff') {
        particles.push({
            x, y, vx: 0, vy: -1.2, life: 50, maxLife: 50,
            color, size: 14, text, isText: true
        });
    }

    function updateHUD() {
        scoreDisplay.textContent = score;
        livesDisplay.textContent = lives;
        levelDisplay.textContent = level;
        bestDisplay.textContent = bestScore;
    }

    function setScreen(id) {
        [startScreen, levelCompleteScreen, gameOverScreen, pauseScreen].forEach((s) => {
            s.classList.remove('active');
            s.classList.add('hidden');
        });
        const target = document.getElementById(id);
        if (target) {
            target.classList.remove('hidden');
            target.classList.add('active');
        }
    }

    function togglePause() {
        if (state !== 'PLAYING') return;
        ensureAudio();
        paused = !paused;
        pauseBtn.setAttribute('aria-pressed', String(paused));
        if (paused) {
            setScreen('pauseScreen');
        } else {
            setScreen(null);
            lastTime = null; // prevents a dt spike after resume
        }
    }

    // ------------------------------------------------------------------
    // Game flow
    // ------------------------------------------------------------------
    function startGame() {
        score = 0;
        lives = MAX_LIVES;
        level = 1;
        combo = 0;
        comboTimer = 0;
        paused = false;
        shake = 0;
        pauseBtn.setAttribute('aria-pressed', 'false');
        fruits = [];
        particles = [];
        slowmo = 0;
        fruitsCaught = 0;
        fruitsRequired = 6;
        baseSpeed = 2.4;
        basketX = DESIGN_W / 2;
        targetBasketX = DESIGN_W / 2;
        spawnTimer = 0;
        spawnInterval = 900;
        updateHUD();
        state = 'PLAYING';
        setScreen(null);
        lastTime = null;
        requestAnimationFrame(loop);
    }

    function levelComplete() {
        state = 'LEVEL_COMPLETE';
        cancelAnimationFrame(animId);
        animId = null;
        lcScoreDisplay.textContent = score;
        lcLivesDisplay.textContent = lives;
        levelMsgDisplay.textContent = `Level ${level} cleared!`;
        setScreen('levelCompleteScreen');
        playTone('levelup');
    }

    function endGame() {
        state = 'GAME_OVER';
        cancelAnimationFrame(animId);
        animId = null;

        let newBest = false;
        if (score > bestScore) {
            bestScore = score;
            newBest = true;
            saveBest();
        }
        finalScoreDisplay.textContent = score;
        finalLevelDisplay.textContent = level;
        finalBestDisplay.textContent = bestScore;
        newBestBadge.hidden = !newBest;
        newBestBadge.setAttribute('aria-hidden', String(!newBest));
        setScreen('gameOverScreen');
        playTone('gameover');
        startShake(16);
    }

    function advanceLevel() {
        level++;
        baseSpeed += 0.4;
        fruitsRequired = Math.min(24, 6 + (level - 1) * 3);
        spawnInterval = Math.max(450, 900 - (level - 1) * 40);
        fruitsCaught = 0;
        combo = 0;
        comboTimer = 0;
        slowmo = 0;
        fruits = [];
        particles = [];
        updateHUD();
        state = 'PLAYING';
        setScreen(null);
        lastTime = performance.now();
        requestAnimationFrame(loop);
    }

    // ------------------------------------------------------------------
    // Core loop
    // ------------------------------------------------------------------
    function loop(timestamp) {
        if (!lastTime) lastTime = timestamp;
        const dt = Math.min(timestamp - lastTime, 40);
        lastTime = timestamp;

        if (state === 'PLAYING' && !paused) update(dt);

        draw();
        animId = requestAnimationFrame(loop);
    }

    function update(dt) {
        // Spawn
        spawnTimer += dt;
        if (spawnTimer >= spawnInterval) {
            spawnTimer = 0;
            const count = slowmo > 0 ? 1 : Math.min(1 + Math.floor((level - 1) / 2), 2);
            const spawnedX = [];
            const minSpacing = 150;
            const staggerY = 72; // px: simultaneous fruits enter the canvas slightly apart
            for (let i = 0; i < count; i++) {
                let x;
                let attempts = 0;
                do {
                    x = Math.max(FRUIT_R, Math.min(DESIGN_W - FRUIT_R, rand(0, DESIGN_W)));
                    attempts++;
                } while (attempts < 60 && spawnedX.some((px) => Math.abs(x - px) < minSpacing));
                spawnedX.push(x);
                spawnFruit(x, -FRUIT_R - 10 - i * staggerY);
            }
        }

        // Basket easing
        const ease = 0.18;
        basketX += (targetBasketX - basketX) * ease;
        const slowFactor = slowmo > 0 ? 0.45 : 1;

        // Combo decay
        if (comboTimer > 0) {
            comboTimer--;
            if (comboTimer <= 0) combo = 0;
        }

        // Update fruits
        for (let i = fruits.length - 1; i >= 0; i--) {
            const f = fruits[i];
            if (f.caught || f.missed) continue;

            f.x += f.vx;
            f.y += f.vy * slowFactor;
            f.angle += f.spin;

            // Bounce off side walls slightly
            if (f.x - f.r < 0 || f.x + f.r > DESIGN_W) {
                f.vx *= -0.8;
                f.x = Math.max(f.r, Math.min(DESIGN_W - f.r, f.x));
            }

            // Catch check vs basket
            const basketY = DESIGN_H - BASKET_Y_OFFSET - BASKET_H / 1.5;
            const basketTop = DESIGN_H - BASKET_Y_OFFSET;
            const basketBottom = DESIGN_H - BASKET_Y_OFFSET + BASKET_H * 0.55;

            if (
                f.y + f.r >= basketTop &&
                f.y - f.r <= basketBottom &&
                f.x + f.r > basketX - BASKET_W / 2 &&
                f.x - f.r < basketX + BASKET_W / 2 &&
                f.vy > 0
            ) {
                catchFruit(f);
                continue;
            }

            // Miss check (fell past bottom)
            if (f.y - f.r > DESIGN_H + 10) {
                missFruit(f);
                continue;
            }

            // Level complete check
            if (fruitsCaught >= fruitsRequired) {
                levelComplete();
                return;
            }
        }

        // Slow-mo timer
        if (slowmo > 0) {
            slowmo--;
            if (slowmo === 0) playTone('catch'); // subtle return-to-normal cue
        }

        // Particles
        for (let i = particles.length - 1; i >= 0; i--) {
            const p = particles[i];
            p.x += p.vx;
            p.y += p.vy;
            p.vy += 0.15; // gravity
            if (p.rot !== undefined) p.rot += p.spin;
            p.life--;
            if (p.life <= 0) particles.splice(i, 1);
        }
    }

    // ------------------------------------------------------------------
    // Drawing
    // ------------------------------------------------------------------
    function draw() {
        // Clear design canvas
        ctx.clearRect(0, 0, DESIGN_W, DESIGN_H);

        // Screen shake (decays over ~10-16 frames)
        ctx.save();
        let sx = 0;
        let sy = 0;
        if (shake > 0) {
            sx = rand(-shake * 1.5, shake * 1.5);
            sy = rand(-shake * 1.5, shake * 1.5);
            shake--;
        }
        ctx.translate(sx, sy);

        // Subtle floor gradient
        const floorGrad = ctx.createLinearGradient(0, DESIGN_H - 120, 0, DESIGN_H);
        floorGrad.addColorStop(0, 'rgba(255,255,255,0.10)');
        floorGrad.addColorStop(1, 'rgba(0,0,0,0.10)');
        ctx.fillStyle = floorGrad;
        ctx.fillRect(0, DESIGN_H - 140, DESIGN_W, 140);

        // Draw shadows under fruits
        fruits.forEach((f) => {
            if (f.caught || f.missed) return;
            const sy = Math.min(DESIGN_H - 44, f.y + f.r + 6);
            ctx.fillStyle = 'rgba(0,0,0,0.25)';
            ctx.beginPath();
            ctx.ellipse(f.x, sy, Math.min(f.r * 0.9, 14), 6, 0, 0, Math.PI * 2);
            ctx.fill();
        });

        // Draw fruits
        fruits.forEach((f) => {
            if (f.caught || f.missed) return;
            ctx.save();
            ctx.translate(f.x, f.y);

            const kind = KINDS[f.kindName];
            const isTrap = f.kind.trap;
            const emoji = EMOJI_BY_KIND[f.kindName] || '🍎';

            // Soft circular backdrop behind the emoji so it pops against any background
            const backdropR = f.r * 1.25;
            const backdrop = ctx.createRadialGradient(0, 0, 0, 0, 0, backdropR);
            backdrop.addColorStop(0, 'rgba(255, 255, 255, 0.5)');
            backdrop.addColorStop(0.5, 'rgba(255, 255, 255, 0.2)');
            backdrop.addColorStop(1, 'rgba(255, 255, 255, 0)');
            ctx.fillStyle = backdrop;
            ctx.beginPath();
            ctx.arc(0, 0, backdropR, 0, Math.PI * 2);
            ctx.fill();

            // Faint white outline/stroke for contrast over busy backgrounds
            ctx.font = `${f.r * 1.6}px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
            ctx.lineWidth = f.r * 0.12;
            ctx.lineJoin = 'round';
            ctx.strokeText(emoji, 0, 1);

            // Bright glow (stronger than before); traps stay bright and readable too
            ctx.shadowColor = kind.glow;
            ctx.shadowBlur = isTrap ? 22 : 28;

            // Spin traps and power-ups so danger/bonuses read clearly; keep regular
            // fruits upright so the emoji stays recognizable.
            if (isTrap || f.kind.special) {
                ctx.rotate(f.angle);
            }

            ctx.fillText(emoji, 0, 1);

            ctx.shadowBlur = 0;
            ctx.restore();
        });

        // Draw particles (with catch-feedback text and rotated bursts)
        particles.forEach((p) => {
            const a = p.life / p.maxLife;
            ctx.globalAlpha = a;
            ctx.fillStyle = p.color;
            ctx.save();
            ctx.translate(p.x, p.y);
            if (p.rot !== undefined) ctx.rotate(p.rot);
            if (p.isText) {
                ctx.font = `${p.size * a}px "Segoe UI", sans-serif`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(p.text, 0, 0);
            } else {
                ctx.beginPath();
                ctx.arc(0, 0, p.size * a, 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.restore();
            ctx.globalAlpha = 1;
        });

        // Draw basket
        const basketY = DESIGN_H - BASKET_Y_OFFSET - BASKET_H / 2;
        ctx.save();
        ctx.translate(basketX, DESIGN_H - BASKET_Y_OFFSET);
        ctx.shadowColor = 'rgba(34, 211, 238, 0.5)';
        ctx.shadowBlur = 12;

        // Basket body
        const grad = ctx.createLinearGradient(-BASKET_W / 2, -BASKET_H / 2, -BASKET_W / 2, BASKET_H / 2);
        grad.addColorStop(0, '#cbd5e1');
        grad.addColorStop(1, '#64748b');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.moveTo(-BASKET_W / 2 + 12, -BASKET_H / 2);
        ctx.lineTo(BASKET_W / 2 - 12, -BASKET_H / 2);
        ctx.lineTo(BASKET_W / 2 - 8, BASKET_H / 2);
        ctx.lineTo(-BASKET_W / 2 + 8, BASKET_H / 2);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = '#94a3b8';
        ctx.lineWidth = 3;
        ctx.stroke();

        // Handle / rim shine
        ctx.strokeStyle = 'rgba(255,255,255,0.55)';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(-BASKET_W / 2 + 14, -BASKET_H / 2 + 6);
        ctx.lineTo(BASKET_W / 2 - 14, -BASKET_H / 2 + 6);
        ctx.stroke();

        ctx.shadowBlur = 0;
        ctx.restore();

        // Slow-mo indicator
        if (slowmo > 0) {
            ctx.fillStyle = '#818cf8';
            ctx.globalAlpha = 0.35 + 0.15 * Math.sin(Date.now() / 150);
            ctx.fillRect(0, 0, DESIGN_W, 6);
            ctx.globalAlpha = 1;
            ctx.fillStyle = '#fff';
            ctx.font = '700 12px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('SLOW MOTION', DESIGN_W / 2, 20);
        }

        // Level progress bar (subtle, top)
        const progress = Math.min(fruitsCaught / fruitsRequired, 1);
        const barW = 260;
        const barH = 6;
        const bx = (DESIGN_W - barW) / 2;
        const by = 36;
        ctx.fillStyle = 'rgba(255,255,255,0.12)';
        ctx.fillRect(bx, by, barW, barH);
        ctx.fillStyle = 'var(--accent)'.replace('var(--accent)', '#22d3ee');
        ctx.globalAlpha = 0.85;
        ctx.fillRect(bx, by, barW * progress, barH);
        ctx.globalAlpha = 1;

        ctx.restore(); // matches the screen-shake save() at the top
    }

    // ------------------------------------------------------------------
    // UI wiring
    // ------------------------------------------------------------------
    startBtn.addEventListener('click', () => {
        ensureAudio();
        startGame();
    });

    nextLevelBtn.addEventListener('click', () => {
        ensureAudio();
        advanceLevel();
    });

    restartBtn.addEventListener('click', () => {
        ensureAudio();
        startGame();
    });

    pauseBtn.addEventListener('click', togglePause);

    resumeBtn.addEventListener('click', () => {
        togglePause();
    });

    // Initialise
    loadBest();
    resize();
    initAmbient();
    updateHUD();
    setScreen('startScreen');

    // Draw a single static frame so the canvas isn't blank before start
    draw();

})();
