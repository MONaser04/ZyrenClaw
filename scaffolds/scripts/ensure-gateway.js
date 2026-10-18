const http = require('http');
const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const openclawRoot = process.env.OPENCLAW_HOME || path.join(process.env.USERPROFILE || process.env.HOME || '.', '.openclaw');
const selfHealScript = path.join(openclawRoot, 'sqlite-self-heal.js');
const watchdogLog = path.join(openclawRoot, 'logs', 'watchdog.log');
const PORT = 18789;
const isQuiet = process.argv.includes('--quiet');

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  if (!isQuiet) console.log(line);
  try {
    fs.mkdirSync(path.dirname(watchdogLog), { recursive: true });
    fs.appendFileSync(watchdogLog, line + '\r\n', 'utf8');
  } catch (_) {}
}

function checkPortHttp(timeoutMs = 8000) {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${PORT}/`, { timeout: timeoutMs }, (res) => {
      res.resume();
      resolve(res.statusCode >= 200 && res.statusCode < 500);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function main() {
  if (await checkPortHttp(8000)) {
    log('ŽyrenClaw Gateway is already running and healthy on port ' + PORT);
    process.exit(0);
  }

  log('Gateway not responding. Running self-healing SQLite maintenance...');
  if (fs.existsSync(selfHealScript)) {
    try {
      execFileSync(process.execPath, [selfHealScript], { timeout: 15000, stdio: 'inherit' });
    } catch (e) {
      log('Self-heal warning: ' + e.message);
    }
  }

  log('Triggering background service launch...');
  try {
    execFileSync('schtasks.exe', ['/Run', '/TN', 'OpenClaw Gateway'], { timeout: 5000, windowsHide: true });
  } catch (e) {
    log('Service run command dispatched.');
  }

  process.exit(0);
}

main().catch((err) => {
  console.error('Fatal error in ensure-gateway:', err);
  process.exit(1);
});
