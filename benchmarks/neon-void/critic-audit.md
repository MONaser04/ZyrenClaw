# NEON VOID — Žyren Critic Quality Gate Audit Report

**Project:** D:\Games\Games_Projects\neon-void (index.html, style.css, game.js)
**Runtime:** node v24.17.0, Windows_NT, PowerShell
**Gate:** zero-trust deterministic runtime smoke test (no text-only approvals)
**Date:** 2026-10-23

## 1. Exec check results

| # | Check | Result | Evidence |
|---|-------|--------|----------|
| 1 | `node --check game.js` exits 0 | PASS | exit 0 |
| 2 | DOM: all 15 required ids present exactly once in index.html; every game.js getElementById ref matches | PASS | refs: game, hud, menu, pause, gameover, stat-score, stat-wave, stat-hearts, hud-combo, hud-combo-fill, hud-dash, hud-dash-fill, menu-best, go-score, go-wave, go-best |
| 2a | No querySelector in game.js (getElementById only) | PASS | — |
| 2b | file:// compatible: classic script tag, no modules, no external assets | PASS | `<script src="game.js">`, no `type="module"`, no http(s) |
| 3 | CSS: all classes used in HTML/JS defined in style.css | FAIL | `.final-stats` used at index.html:47, undefined in style.css (cosmetic) |
| 4 | Runtime boot throws TypeError (player null in updateHUD) | FAIL | `Cannot read properties of null (reading 'dashCd')` at game.js:956 — `requestAnimationFrame(loop)` never reached |
| 4.1 | State: MENU at boot (not auto-started); lives=3; wave=0 | PASS | headless vm run |
| 4.1 | DOM: menu shown; hud/pause/gameover hidden at boot | PASS | stub classList inspection |
| 4.2 | Start (Enter/click): MENU -> PLAYING, wave=1, player, 6 enemies (4+2N) | PASS | waveBannerText='WAVE 1', timer=1.6s |
| 4.3 | Bullet-enemy collision decrements HP; kill -> 18 particles; score; combo | PASS | chaser hp 1->0, particles=18, score=10 |
| 4.3 | Boss spawn: hp = 20+wave*6 (26 at wave 1); bullet decrements boss HP | PASS | hp 26 -> 25 |
| 4.3 | Boss death: shake=18, slowMo=0.25, slowMoTimer=0.08 (0.08s hitstop); decay works | PASS | shake 17.9 after 1 frame, timer decays |
| 4.4 | Lives 3->2->1->0; 1.2s invuln blocks immediate re-hit; blink | PASS | lives via HUD; invuln guard verified |
| 4.4 | 0 lives -> GAMEOVER; HUD hidden; gameover shown; go-score/wave/best | PASS | go-score='10', go-wave='1', go-best='10' |
| 4.4 | localStorage 'neonvoid.best' = '10'; R restarts to PLAYING wave=1 lives=3 | PASS | stub storage inspected |
| 4.5 | P pause toggles overlay; resume works; render callable while paused | PASS | screen transitions; draw() no throw |
| 4.5 | PAUSE FREEZES SIMULATION | FAIL | while paused: player dx=4.333, enemy dx=1.12, bullet dx=8.67 per frame (game.js:756 updateGame not screen-guarded) |
| 4.6 | Combo x2 within 2.5s; resets to x1 after window; reaches cap x8 | PASS | combo=8 verified |
| 4.7 | Dash SHIFT: 0.18s burst, 0.8s cooldown, vx=620; double-dash blocked | PASS | dashCd=0.8, second tryDash blocked |
| 4.8 | Fire ~8/s on LMB/SPACE | PASS | 9+8 shots in 2s simulated |
| 4.8 | Shot spread | FAIL (spec gap) | single projectile per shot, no spread |
| 4.9 | Boss every 5th wave: hp 50 at wave 5, hp 80 at wave 10; radial rings | PASS | hp=20+wave*6 verified |
| 4.9 | Wave 3: 10 enemies, chaser/weaver/dasher 4/3/3, no boss | PASS | — |
| 4.10 | Chaser homes; Weaver keep-distance ~250 repels | PASS | chaser vx=70; weaver vy=-85 at d=240 |
| 4.10 | Weaver slow orbs | FAIL (spec gap) | orbs spawn at d<650 but travel at 520 px/s, not slowed |
| 4.10 | Dasher 0.6s telegraph, 0.5s dash at 420 px/s | PASS | telegraph=0.6, dash vx=420 |
| 4.11 | Damage vignette 0.5 -> 0.475 decay | PASS | — |
| 4.11 | draw() callable headlessly | PASS | stub canvas context |
| 4.12 | M mute toggle | PASS | muted flag toggles |
| 4.13 | dt sanity: 60 frames @ dt=1/60 close ~70px (real-time speed, no 0.1 clamp) | PASS | closed=70.00 |
| 4.14 | Wave banner 1.6s non-blocking | FAIL | waveBannerTimer never decremented (game.js:299 sets 1.6, never decays) -> banner permanent |

## 2. DOM contract table

| id | count in index.html | referenced in game.js | status |
|---|---|---|---|
| game | 1 | yes | OK |
| hud | 1 | yes | OK |
| menu | 1 | yes | OK |
| pause | 1 | yes | OK |
| gameover | 1 | yes | OK |
| stat-score | 1 | yes | OK |
| stat-wave | 1 | yes | OK |
| stat-hearts | 1 | yes | OK |
| hud-combo | 1 | yes | OK |
| hud-combo-fill | 1 | yes | OK |
| hud-dash | 1 | yes | OK |
| hud-dash-fill | 1 | yes | OK |
| menu-best | 1 | yes | OK |
| go-score | 1 | yes | OK |
| go-wave | 1 | yes | OK |
| go-best | 1 | yes | OK |

All 15 required ids exist exactly once; no duplicates; no missing refs.

## 3. CSS cross-file check

Classes used in HTML/JS: hidden, hud-row, stat, hud-bottom, combo, combo-bar, combo-fill, dash, dash-bar, dash-fill, menu-panel, subtitle, controls, best, start-hint, final-stats.
Undefined in style.css: `.final-stats` (used at index.html:47 `<div class="final-stats">`) — cosmetic MINOR only.

## 4. Requirements checklist (owner spec, 100% coverage)

| Requirement | Status |
|---|---|
| 3 lives + 1.2s invuln blink | MET |
| Waves 4+2N spawns | MET |
| CHASER homes on player | MET |
| WEAVER keep-distance ~250 + orbs | PARTIAL (keep-distance MET; orbs not slowed) |
| DASHER telegraph-dash | MET |
| BOSS every 5th wave, hp 20+wave*6, radial rings | MET |
| Fire ~8/s with spread on LMB/SPACE | PARTIAL (rate MET; spread missing) |
| Dash SHIFT 0.8s cd / 0.18s burst / HUD bar | MET |
| Combo x1-x8, 2.5s window | MET |
| Wave banner 1.6s non-blocking | MISSING (timer never decays) |
| Particles ~18 on death | MET |
| Screen shake decay | MET |
| Damage vignette | MET |
| Boss-death hitstop 0.08s | MET |
| Score/wave/hearts HUD | MET |
| localStorage 'neonvoid.best' | MET |
| M mute / P pause / R restart | MET |
| canvas id 'game' | MET |
| file:// compatible (classic script, no modules, no external assets) | MET |

## 5. Defects

**BLOCKER-1** — game.js:956 (updateHUD, called during boot at end of file): `updateHUD()` runs while `player === null` → `TypeError: Cannot read properties of null (reading 'dashCd')` → `requestAnimationFrame(loop)` never executed → game unplayable (no render loop, no frame ever advances).
- Fix: guard `updateHUD` (`if (!player) return;`) or initialize the dash HUD text safely before the boot-time call.

**MINOR-2** — game.js:756 `updateGame`: entity updates (player drift, enemies, bullets, particles) run while PAUSED; pause does not freeze the simulation. Measured per-frame while paused: player +4.333px, enemy +1.12px, bullet +8.667px.
- Fix: guard `if (screen !== 'PLAYING') return;` at the top of `updateGame` (or wrap entity updates).

**MINOR-3** — game.js:299 `spawnWave` sets `waveBannerTimer = 1.6`, but `updateGame` (line 756) never decrements `waveBannerTimer` → wave banner displays permanently instead of 1.6s.
- Fix: decrement `waveBannerTimer` in `updateGame` and clamp at 0.

**MINOR-4** — index.html:47 uses class `final-stats`; undefined in style.css — cosmetic only.

**SPEC GAPS (informational)** — no shot spread on fire (spec: "spread on LMB or SPACE"); weaver orbs spawn but travel at full BULLET_SPEED (520 px/s), not slowed.

## Verdict

**REVISE** — BLOCKER-1 prevents the game from running; the render loop never starts. Fix BLOCKER-1 and MINOR-2/MINOR-3, then re-submit to the Coordinator Hub for `zyren-coder` remediation dispatch.

No project source files were modified by this gate; all checks executed headlessly via `exec` against the absolute target files. Temp harness was written to and removed from D:\Games\Games_Projects\.smoke (outside the project folder).
