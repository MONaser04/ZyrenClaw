'use strict';
const fs = require('fs');
const target = 'C:\\Users\\fsaad\\.openclaw\\workspace\\cat-playground\\index.html';
const report = 'C:\\Users\\fsaad\\.openclaw\\workspace\\cat-playground\\_audit\\REPORT.md';
const html = fs.readFileSync(target, 'utf8');
const results = [];
function check(name, cond, detail) {
  const pass = !!cond;
  results.push({ name, pass, detail: detail || '' });
  console.log((pass ? 'PASS' : 'FAIL') + ' | ' + name + (detail ? ' | ' + detail : ''));
}
function countOccurrences(haystack, needle) {
  let c = 0, pos = 0;
  while ((pos = haystack.indexOf(needle, pos)) !== -1) { c++; pos += needle.length; }
  return c;
}

// ---------- 1. script src tags & module ban ----------
const scriptSrcMatches = html.match(/<script\s+src=/gi) || [];
check('exactly two <script src> tags', scriptSrcMatches.length === 2, 'found ' + scriptSrcMatches.length);
const urls = [...html.matchAll(/<script\s+src="([^"]+)"/gi)].map(m => m[1]);
check('script src URL[0] = three.js CDN', urls[0] === 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js', urls[0]);
check('script src URL[1] = cannon.js CDN', urls[1] === 'https://cdnjs.cloudflare.com/ajax/libs/cannon.js/0.6.2/cannon.min.js', urls[1]);
check('no type="module" anywhere', !/type\s*=\s*["\']module["\']/i.test(html));

// ---------- 2. palette + header/subtext ----------
const paletteHexes = ['0xf6c9d4', '0xbfe3d0', '0xf7e3a1', '0xd8ccf0', '0xf5efe1'];
paletteHexes.forEach(h => check('palette hex ' + h, html.includes(h)));
const hexEntryCount = countOccurrences(html, 'hex: 0x');
check('PALETTE has 5 hex entries', hexEntryCount === 5, 'count=' + hexEntryCount);
check('PALETTE.forEach used to build swatches', /PALETTE\.forEach/.test(html) && /className\s*=\s*['\"]swatch['\"]/.test(html));
const h1 = html.match(/<h1>([\s\S]*?)<\/h1>/);
const h1text = h1 ? h1[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim() : null;
check('header text = Cuddly / Cats.', h1text === 'Cuddly / Cats.', JSON.stringify(h1text));
const headerP = html.match(/<h1>[\s\S]*?<\/h1>\s*<p>([\s\S]*?)<\/p>/);
const subtext = headerP ? headerP[1].replace(/\s+/g, ' ').trim() : null;
check('subtext = A playground of squishy, bouncy companions.', subtext === 'A playground of squishy, bouncy companions.', JSON.stringify(subtext));

// ---------- 3. controls + glassmorphism ----------
check('control id="gravity"', html.includes('id="gravity"'));
check('control id="bounciness"', html.includes('id="bounciness"'));
check('control id="pour"', html.includes('id="pour"'));
check('pour button text "Pour more cats"', html.includes('>Pour more cats<'));
check('glassmorphism: backdrop-filter blur saturate', /backdrop-filter:\s*blur\([^)]*\)\s*saturate\([^)]*\)/.test(html));

// ---------- 4. runtime core ----------
check('fixed step world.step(1 / 60, dt, 3)', html.includes('world.step(1 / 60, dt, 3)'));
check('resize sets camera.aspect', html.includes('camera.aspect = window.innerWidth / window.innerHeight'));
check('resize updateProjectionMatrix', html.includes('camera.updateProjectionMatrix()'));
check('resize renderer.setSize', html.includes('renderer.setSize(window.innerWidth, window.innerHeight)'));
check('THREE.Raycaster instantiated', /new THREE\.Raycaster\(\)/.test(html));
check('pointerdown listener registered', /addEventListener\s*\(\s*['"]pointerdown['"]/.test(html));
check('pointermove listener registered', /pointermove/.test(html));
check('pointerup listener registered', /pointerup/.test(html));
check('per-cat new CANNON.Body', /new CANNON\.Body\(/.test(html));
check('per-cat collide listener', /addEventListener\s*\(\s*['"]collide['"]/.test(html));
check('updateSquish sets scale from spring state', /cat\.group\.scale\.set\(s\.sx/.test(html));
check('squish spring decays target toward 1', /s\.tx = 1 \+ \(s\.tx - 1\) \* decay/.test(html));

// ---------- 5. CRITICAL regression anchors (exactly once each) ----------
const anchors = [
  ['floorBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0)', 'floorBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0)'],
  ['eyes set(-0.135, 0.07, 0.385)', 'set(-0.135, 0.07, 0.385)'],
  ['glints set(-0.158, 0.13, 0.415)', 'set(-0.158, 0.13, 0.415)'],
  ['nose set(0, 0.04, 0.42)', 'set(0, 0.04, 0.42)'],
  ['ears set(-0.17, 0.40, -0.05)', 'set(-0.17, 0.40, -0.05)'],
  ['containment b.position.y < -6', 'b.position.y < -6']
];
anchors.forEach(function (a) {
  const n = countOccurrences(html, a[1]);
  check('anchor exactly once: ' + a[0], n === 1, 'count=' + n);
});

// ---------- 6. no relative-path imports, no TODO/stub ----------
check('no href / link imports (only CDN scripts)', !/<\s*link\b|href\s*=/.test(html));
check('no relative-path script src', !/<\s*script\b[^>]*src\s*=\s*["\'](?!(https?:|\/\/))/i.test(html));
const stubMarkers = html.match(/\b(TODO|FIXME|XXX|TBD|tbd)\b/gi);
check('no TODO/stub markers', !stubMarkers || stubMarkers.length === 0, stubMarkers ? stubMarkers.join(', ') : 'none');

// ---------- summary + exit + append report ----------
const fails = results.filter(r => !r.pass);
console.log('\n=== PHASE 2 SUMMARY: ' + results.length + ' checks, ' + fails.length + ' failures ===');
fails.forEach(function (f) { console.log('  FAIL: ' + f.name + ' | ' + f.detail); });

let md = '\n## Phase 2 — Static contract asserts (exit code ' + (fails.length === 0 ? '0' : 'nonzero') + ')\n';
md += '| check | result | detail |\n|---|---|---|\n';
results.forEach(function (r) {
  md += '| ' + r.name + ' | ' + (r.pass ? 'PASS' : 'FAIL') + ' | ' + r.detail.replace(/\|/g, '\\|') + ' |\n';
});
md += (fails.length === 0 ? '\nAll Phase 2 static contract asserts PASSED.\n' : '\n' + fails.length + ' Phase 2 check(s) FAILED. See defects.\n');
fs.appendFileSync(report, md);
process.exit(fails.length === 0 ? 0 : 1);
