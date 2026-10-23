'use strict';
const fs = require('fs');
const https = require('https');
const targetDir = 'C:\\Users\\fsaad\\.openclaw\\workspace\\cat-playground\\_audit';
const cannonPath = targetDir + '\\cannon.min.js';
const report = targetDir + '\\REPORT.md';
const results = [];
function check(name, cond, detail) {
  const pass = !!cond;
  results.push({ name, pass, detail: detail || '' });
  console.log((pass ? 'PASS' : 'FAIL') + ' | ' + name + (detail ? ' | ' + detail : ''));
}
// Ensure cannon.min.js is present (download if missing)
function download(url, dest) {
  return new Promise(function (resolve, reject) {
    https.get(url, function (res) {
      var d = '';
      res.on('data', function (c) { d += c; });
      res.on('end', function () { fs.writeFileSync(dest, d); resolve(); });
    }).on('error', reject);
  });
}
(async function () {
  try {
    if (!fs.existsSync(cannonPath)) {
      await download('https://cdnjs.cloudflare.com/ajax/libs/cannon.js/0.6.2/cannon.min.js', cannonPath);
      console.log('downloaded cannon.min.js');
    }
  } catch (e) {
    console.log('download skipped/failed: ' + e.message);
  }
  // Load CANNON via require, then global, then function-wrapper fallback
  var C = null, loader = 'none';
  try { C = require(cannonPath); loader = 'require'; } catch (e) { loader = 'require-failed:' + e.message; }
  if (!C || !C.Plane) { try { C = global.CANNON; loader += '; global.CANNON'; } catch (e) { } }
  if (!C || !C.Plane) {
    try {
      var d = fs.readFileSync(cannonPath, 'utf8');
      var m = { exports: {} };
      new Function('module', 'exports', 'CANNON', 'THREE', d)(m, m.exports, global.CANNON, global.THREE);
      C = m.exports.CANNON || m.exports || global.CANNON;
      loader += '; function-wrapper';
    } catch (e) { loader += '; wrapper-failed:' + e.message; }
  }
  var normalOk = false, normalDetail = '', eulerOk = false, eulerDetail = '';
  if (C && C.Plane && C.Quaternion) {
    var p = new C.Plane();
    var n = p.normal;
    normalOk = (n.x === 0 && n.y === 0 && n.z === 1);
    normalDetail = '(' + n.x + ',' + n.y + ',' + n.z + ')';
    eulerOk = (typeof C.Quaternion.setFromEuler === 'function');
    eulerDetail = typeof C.Quaternion.setFromEuler;
  }
  check('new CANNON.Plane().normal === (0,0,1)', normalOk, normalDetail);
  check('CANNON.Quaternion.setFromEuler exists', eulerOk, eulerDetail);
  console.log('loader=' + loader);
  var pass = results.every(function (r) { return r.pass; });
  var md = '\n## Phase 3 — Cannon.js runtime sanity (stubbed-DOM not exercised; lib-level check only)\nloader: ' + loader + '\n| check | result | detail |\n|---|---|---|\n';
  results.forEach(function (r) { md += '| ' + r.name + ' | ' + (r.pass ? 'PASS' : 'FAIL') + ' | ' + r.detail.replace(/\|/g, '\\|') + ' |\n'; });
  md += (pass ? '\nCANNON lib-level sanity PASSED: Plane normal is (0,0,1), so the floor rotation fix is REQUIRED and setFromEuler is the correct remedy.\n' : '\nCANNON lib-level sanity did not fully pass.\n');
  fs.appendFileSync(report, md);
  process.exit(pass ? 0 : 1);
})();
