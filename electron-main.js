'use strict';

const { app, BrowserWindow, shell, dialog } = require('electron');
const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const http = require('http');
const os = require('os');

const PORT = 3001;
let backendProcess = null;
let mainWindow = null;

// ── Find Node.js binary ──────────────────────────────────────────────────────
// macOS .app bundles don't inherit the user's PATH, so we search common locations.
function findNodeBinary() {
  const candidates = [
    '/opt/homebrew/bin/node',           // Apple Silicon Homebrew
    '/usr/local/bin/node',              // Intel Homebrew / classic installs
    '/opt/homebrew/opt/node/bin/node',
    '/usr/local/opt/node/bin/node',
    '/usr/bin/node',
  ];

  // NVM: pick the latest version
  const nvmDir = path.join(os.homedir(), '.nvm/versions/node');
  if (fs.existsSync(nvmDir)) {
    try {
      const versions = fs.readdirSync(nvmDir)
        .filter(v => v.startsWith('v'))
        .sort((a, b) => {
          const av = a.replace('v', '').split('.').map(Number);
          const bv = b.replace('v', '').split('.').map(Number);
          for (let i = 0; i < 3; i++) if (av[i] !== bv[i]) return bv[i] - av[i];
          return 0;
        });
      for (const v of versions) {
        const p = path.join(nvmDir, v, 'bin/node');
        if (fs.existsSync(p)) return p;
      }
    } catch { /* ignore */ }
  }

  // Volta
  const voltaNode = path.join(os.homedir(), '.volta/bin/node');
  if (fs.existsSync(voltaNode)) return voltaNode;

  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }

  return 'node'; // last resort: hope it's in PATH
}

// ── Wait for backend HTTP endpoint to be ready ───────────────────────────────
function waitForBackend(retries = 40) {
  return new Promise((resolve, reject) => {
    let attempts = 0;

    const check = () => {
      const req = http.get(`http://127.0.0.1:${PORT}/api/config/models`, (res) => {
        resolve();
      });
      req.on('error', () => retry());
      req.setTimeout(600, () => { req.destroy(); retry(); });
    };

    const retry = () => {
      attempts++;
      if (attempts >= retries) {
        reject(new Error(`Backend did not start after ${retries} attempts`));
      } else {
        setTimeout(check, 500);
      }
    };

    check();
  });
}

// ── Start the Fastify backend as a child process ─────────────────────────────
async function startBackend() {
  const isPackaged = app.isPackaged;

  const backendDir = isPackaged
    ? path.join(process.resourcesPath, 'orbit-backend')
    : path.join(__dirname, 'orbit-backend');

  const nodeBin = findNodeBinary();
  console.log(`[orbit] node binary: ${nodeBin}`);

  // Store DB and data in ~/Library/Application Support/Orbit (userData)
  const dataDir = path.join(app.getPath('userData'), 'data');
  fs.mkdirSync(dataDir, { recursive: true });

  // Default workspace folder lives in ~/orbit-workspace
  const workspaceRoot = path.join(os.homedir(), 'orbit-workspace');

  let spawnArgs;
  if (isPackaged) {
    // Production: run compiled JS
    const backendEntry = path.join(backendDir, 'dist', 'index.js');
    if (!fs.existsSync(backendEntry)) {
      throw new Error(`Backend entry not found: ${backendEntry}`);
    }
    spawnArgs = [nodeBin, [backendEntry]];
  } else {
    // Dev: use tsx to run TypeScript directly — no build step needed
    const tsxBin = path.join(backendDir, 'node_modules', '.bin', 'tsx');
    const srcEntry = path.join(backendDir, 'src', 'index.ts');
    if (!fs.existsSync(tsxBin)) {
      // Fallback: use compiled dist if tsx not available
      const backendEntry = path.join(backendDir, 'dist', 'index.js');
      if (!fs.existsSync(backendEntry)) {
        console.log('[orbit] dist not found — compiling backend...');
        execSync('npm run build', { cwd: backendDir, stdio: 'inherit' });
      }
      spawnArgs = [nodeBin, [backendEntry]];
    } else {
      spawnArgs = [nodeBin, [tsxBin, srcEntry]];
    }
  }

  backendProcess = spawn(spawnArgs[0], spawnArgs[1], {
    cwd: backendDir,
    env: {
      ...process.env,
      PORT: String(PORT),
      DB_PATH: path.join(dataDir, 'orbit.db'),
      WORKSPACE_ROOT: workspaceRoot,
      NODE_ENV: 'production',
    },
  });

  backendProcess.stdout?.on('data', (d) => process.stdout.write(`[backend] ${d}`));
  backendProcess.stderr?.on('data', (d) => process.stderr.write(`[backend] ${d}`));

  backendProcess.on('exit', (code, signal) => {
    console.log(`[orbit] backend exited (code=${code} signal=${signal})`);
  });

  console.log('[orbit] waiting for backend...');
  await waitForBackend();
  console.log('[orbit] backend ready ✓');
}

// ── Create main window ───────────────────────────────────────────────────────
async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 900,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    title: 'Orbit',
    backgroundColor: '#0e0e10',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false, // needed for file:// → localhost fetch
    },
  });

  const htmlPath = app.isPackaged
    ? path.join(process.resourcesPath, 'orbit.html')
    : path.join(__dirname, 'orbit.html');

  await mainWindow.loadFile(htmlPath);

  // Inject Electron-specific CSS:
  // 1. Push .sb-logo content right so it doesn't overlap the macOS traffic lights (~72px wide)
  // 2. Make the header bars draggable so the window can be moved
  // 3. Restore no-drag on all interactive elements inside those bars
  await mainWindow.webContents.insertCSS(`
    /* Traffic light clearance */
    .sb-logo {
      padding-left: 80px !important;
      -webkit-app-region: drag;
    }
    /* Main header drag strip */
    .mc-hdr, .ap-hdr {
      -webkit-app-region: drag;
    }
    /* No-drag for every interactive element */
    button, input, a, select, textarea, .pane-resizer,
    .logo-mark, .logo-text {
      -webkit-app-region: no-drag;
    }
  `);

  // Open <a target="_blank"> links in the system browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http')) shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

// ── App lifecycle ────────────────────────────────────────────────────────────
app.whenReady().then(async () => {
  try {
    await startBackend();
    await createWindow();
  } catch (err) {
    console.error('[orbit] startup failed:', err);
    dialog.showErrorBox('Orbit failed to start', String(err));
    app.quit();
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  if (backendProcess) {
    backendProcess.kill('SIGTERM');
    backendProcess = null;
  }
});
