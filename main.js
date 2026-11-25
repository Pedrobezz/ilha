// Ilha: processo principal (janela, hover, ajudante nativo, teste de internet, SmartHouse)
const { app, BrowserWindow, screen, ipcMain, Tray, Menu, nativeImage, globalShortcut, clipboard, Notification, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');

const W = 900, H = 600; // tela transparente onde a ilha vive (inclui espaço para a sombra)

if (!app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }
app.setAppUserModelId('com.pedrobez.ilha');
// a ilha é uma janela transparente por cima de tudo: o Chromium não pode achar que ela está "coberta" e parar de desenhar
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');

// ---------- ajustes ----------
const cfgFile = () => path.join(app.getPath('userData'), 'ilha.json');
const DEFAULTS = { city: '', glass: 22, theme: 'grafite', hideOnMax: true, startup: false, smarthouse: '', notes: '', speedHistory: [], clips: [], shFav: [] };
let cfg = { ...DEFAULTS };
function loadCfg() { try { cfg = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(cfgFile(), 'utf8')) }; } catch (_) {} }
let saveT = null;
function saveCfg() { clearTimeout(saveT); saveT = setTimeout(() => { try { fs.writeFileSync(cfgFile(), JSON.stringify(cfg, null, 2)); } catch (_) {} }, 300); }

let win, tray, helper;
const st = { covered: false, inside: false, ignoring: true, rect: { x: (W - 200) / 2, y: 0, w: 200, h: 34 }, pinned: false };
const send = (ch, data) => { if (win && !win.isDestroyed()) win.webContents.send(ch, data); };

function placeWindow() {
  const b = screen.getPrimaryDisplay().bounds;
  win.setBounds({ x: Math.round(b.x + (b.width - W) / 2), y: b.y, width: W, height: H });
}

function createWindow() {
  win = new BrowserWindow({
    width: W, height: H, frame: false, transparent: true, resizable: false, movable: false,
    minimizable: false, maximizable: false, fullscreenable: false, skipTaskbar: true, hasShadow: false,
    alwaysOnTop: true, show: false, focusable: false, backgroundColor: '#00000000', title: 'Ilha',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, spellcheck: false },
  });
  placeWindow();
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { skipTransformProcessType: true });
  win.setIgnoreMouseEvents(true, { forward: true });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.once('ready-to-show', () => win.showInactive());
  win.on('blur', () => send('blur'));
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
}

// ---------- hover: o processo principal acompanha o mouse e decide quando a ilha recebe cliques ----------
function trackCursor() {
  setInterval(() => {
    if (!win || win.isDestroyed()) return;
    const p = screen.getCursorScreenPoint(), wb = win.getBounds(), r = st.rect;
    const pad = r.edge ? 0 : st.inside ? 4 : 2;
    const inside = p.x >= wb.x + r.x - pad && p.x <= wb.x + r.x + r.w + pad && p.y >= wb.y - 2 && p.y <= wb.y + r.y + r.h + pad;
    if (inside !== st.inside) { st.inside = inside; send('hover', inside); }
    // escondida (janela maximizada): a faixa da borda só "escuta" o mouse e deixa os cliques passarem
    // para o Chrome; a ilha só passa a receber cliques depois de abrir de fato
    const ignore = !(inside && !r.edge);
    if (ignore !== st.ignoring) { st.ignoring = ignore; win.setIgnoreMouseEvents(ignore, { forward: true }); }
  }, 30);
  // outras janelas "sempre por cima" podem passar na frente: reafirma de tempos em tempos
  setInterval(() => { if (win && !win.isDestroyed()) { win.setAlwaysOnTop(true, 'screen-saver'); if (!st.inside) win.moveTop(); } }, 2500);
}

// ---------- ajudante nativo (PowerShell + C#) ----------
function startHelper() {
  const script = path.join(__dirname, 'helper.ps1').replace('app.asar', 'app.asar.unpacked');
  helper = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-SelfPid', String(process.pid)], { windowsHide: true });
  let buf = '';
  helper.stdout.setEncoding('utf8');
  helper.stdout.on('data', d => {
    buf += d; let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (!line.startsWith('{')) continue;
      let m; try { m = JSON.parse(line); } catch (_) { continue; }
      if (m.t === 'fg') { st.covered = m.covered; send('covered', cfg.hideOnMax && m.covered); }
      else send('native', m);
    }
  });
  helper.on('exit', () => { helper = null; if (!app.isQuitting) setTimeout(startHelper, 3000); });
}
const helperCmd = c => { try { helper?.stdin.write(c + '\n'); } catch (_) {} };

// ---------- sistema (CPU e memória) ----------
let prevCpu = null;
function cpuSample() {
  const t = os.cpus().reduce((a, c) => { const tot = Object.values(c.times).reduce((x, y) => x + y, 0); a.idle += c.times.idle; a.total += tot; return a; }, { idle: 0, total: 0 });
  let pct = 0;
  if (prevCpu) { const dt = t.total - prevCpu.total, di = t.idle - prevCpu.idle; pct = dt > 0 ? Math.max(0, Math.min(100, 100 * (1 - di / dt))) : 0; }
  prevCpu = t;
  return pct;
}
function localIp() {
  for (const list of Object.values(os.networkInterfaces())) for (const n of list || []) if (n.family === 'IPv4' && !n.internal && !/^169\.254/.test(n.address)) return n.address;
  return '';
}
function sysLoop() {
  cpuSample();
  setInterval(() => {
    send('sys', { cpu: cpuSample(), memUsed: os.totalmem() - os.freemem(), memTotal: os.totalmem(), uptime: os.uptime(), ip: localIp(), host: os.hostname(), cpuName: os.cpus()[0]?.model?.trim() || '', cores: os.cpus().length });
  }, 1000);
}

// ---------- área de transferência ----------
let lastClip = '';
function clipLoop() {
  lastClip = clipboard.readText();
  setInterval(() => {
    const t = clipboard.readText();
    if (t === lastClip) return;
    lastClip = t;
    const v = t.trim();
    if (!v || v.length > 20000) return;
    cfg.clips = [{ text: t, at: Date.now() }, ...cfg.clips.filter(c => c.text !== t)].slice(0, 25);
    saveCfg(); send('clips', cfg.clips);
  }, 900);
}

// ---------- teste de internet (servidores da Cloudflare) ----------
const CF = 'https://speed.cloudflare.com';
let stCtrl = null;

// localização e provedor (ip-api) + servidor da Cloudflare mais próximo
let geoCache = null;
async function geo(signal) {
  if (geoCache && Date.now() - geoCache.at < 30 * 60e3) return geoCache;
  const out = { at: Date.now() };
  const sig = signal || AbortSignal.timeout(6000);
  await Promise.allSettled([
    fetch('http://ip-api.com/json/?fields=status,city,regionName,lat,lon,isp,org,query', { signal: sig }).then(r => r.json()).then(j => {
      if (j.status === 'success') Object.assign(out, { latitude: j.lat, longitude: j.lon, city: j.city, region: j.regionName, asOrganization: j.isp || j.org, clientIp: j.query });
    }),
    fetch(`${CF}/cdn-cgi/trace`, { signal: sig }).then(r => r.text()).then(t => {
      const m = Object.fromEntries(t.trim().split('\n').map(l => l.split('=')));
      out.colo = m.colo || ''; out.clientIp = out.clientIp || m.ip;
    }),
  ]);
  if (out.latitude) geoCache = out;
  return out;
}
const mbps = (bytes, ms) => (bytes * 8) / (ms / 1000) / 1e6;

async function measure(kind, outer) {
  const DUR = 9000, WORKERS = kind === 'down' ? 6 : 4;
  const ctrl = new AbortController();
  const stop = () => ctrl.abort();
  outer.addEventListener('abort', stop);
  const t0 = performance.now();
  let bytes = 0; const samples = [];
  const workers = Array.from({ length: WORKERS }, async () => {
    let size = kind === 'down' ? 50e6 : 512e3;
    while (!ctrl.signal.aborted) {
      try {
        if (kind === 'down') {
          const r = await fetch(`${CF}/__down?bytes=${size}&r=${Math.random()}`, { signal: ctrl.signal, cache: 'no-store' });
          if (r.status === 429) { await new Promise(s => setTimeout(s, 600)); continue; }
          const rd = r.body.getReader();
          for (;;) { const { done, value } = await rd.read(); if (done) break; bytes += value.byteLength; }
        } else {
          const body = Buffer.alloc(size, 97);
          const s0 = performance.now();
          const r = await fetch(`${CF}/__up?r=${Math.random()}`, { method: 'POST', body, signal: ctrl.signal, headers: { 'content-type': 'application/octet-stream' } });
          await r.arrayBuffer();
          bytes += size;
          if (performance.now() - s0 < 900 && size < 16e6) size *= 2;
        }
      } catch (_) { if (ctrl.signal.aborted) break; await new Promise(s => setTimeout(s, 300)); }
    }
  });
  await new Promise(res => {
    const iv = setInterval(() => {
      const now = performance.now();
      samples.push([now, bytes]);
      const ref = samples.find(s => now - s[0] <= 1500) || samples[0];
      const live = now - ref[0] > 0 ? mbps(bytes - ref[1], now - ref[0]) : 0;
      send('speedtest', { phase: kind, value: live, progress: Math.min(1, (now - t0) / DUR) });
      if (now - t0 >= DUR || outer.aborted) { clearInterval(iv); stop(); res(); }
    }, 200);
  });
  await Promise.allSettled(workers);
  outer.removeEventListener('abort', stop);
  if (outer.aborted) throw new Error('cancelado');
  // descarta a rampa inicial (primeiros 30%) e mede o resto
  const end = samples[samples.length - 1], start = samples.find(s => s[0] - t0 >= DUR * 0.3) || samples[0];
  return end && start && end[0] > start[0] ? mbps(end[1] - start[1], end[0] - start[0]) : 0;
}

async function speedtest() {
  if (stCtrl) return;
  stCtrl = new AbortController();
  const sig = stCtrl.signal;
  try {
    send('speedtest', { phase: 'start' });
    let meta = {};
    try { meta = await geo(sig); } catch (_) {}
    send('speedtest', { phase: 'meta', meta });
    const lat = [];
    for (let i = 0; i < 14 && !sig.aborted; i++) {
      const t = performance.now();
      const r = await fetch(`${CF}/__down?bytes=0&r=${Math.random()}`, { signal: sig, cache: 'no-store' });
      await r.arrayBuffer();
      if (i > 0) lat.push(performance.now() - t); // a 1ª inclui a conexão TLS
      send('speedtest', { phase: 'ping', value: lat.length ? Math.min(...lat) : 0, progress: i / 13 });
    }
    const sorted = [...lat].sort((a, b) => a - b);
    const ping = sorted[Math.floor(sorted.length / 2)] || 0;
    const jitter = lat.length > 1 ? lat.slice(1).reduce((a, v, i) => a + Math.abs(v - lat[i]), 0) / (lat.length - 1) : 0;
    send('speedtest', { phase: 'pingDone', ping, jitter });
    const down = await measure('down', sig);
    send('speedtest', { phase: 'downDone', down });
    const up = await measure('up', sig);
    const result = { at: Date.now(), ping, jitter, down, up, isp: meta.asOrganization || '', ip: meta.clientIp || '', city: meta.city || '', colo: meta.colo || '' };
    cfg.speedHistory = [result, ...cfg.speedHistory].slice(0, 12); saveCfg();
    send('speedtest', { phase: 'done', result, history: cfg.speedHistory });
  } catch (e) {
    send('speedtest', { phase: sig.aborted ? 'cancelled' : 'error', error: e.message });
  } finally { stCtrl = null; }
}

// ---------- SmartHouse (API do "acesso pelo celular", porta 8787) ----------
// SmartHouse instalado neste PC (a pasta de dados ainda se chama "Casa 3D" nas versões antigas)
function shLocal() {
  for (const dir of ['SmartHouse', 'Casa 3D', 'casa-3d']) {
    try {
      const s = JSON.parse(fs.readFileSync(path.join(app.getPath('appData'), dir, 'casa3d.json'), 'utf8')).settings?.mobile;
      if (s?.token) return { base: `http://127.0.0.1:${s.port || 8787}`, key: s.token, local: true, enabled: !!s.enabled };
    } catch (_) {}
  }
  return null;
}
function shTarget() {
  const raw = (cfg.smarthouse || '').trim();
  if (raw) {
    let u;
    try { u = new URL(/^https?:\/\//i.test(raw) ? raw : 'http://' + raw); } catch (_) { throw new Error('Endereço inválido. Ex.: 192.168.0.10:8787 ou o link do QR code.'); }
    if (!u.port && u.protocol === 'http:') u.port = '8787';
    const key = u.searchParams.get('k') || shLocal()?.key || '';
    if (!key) throw new Error('Faltou a chave: cole o link completo do QR code (termina com ?k=…).');
    return { base: u.origin, key };
  }
  return shLocal();
}
async function shCall({ method = 'GET', route, body }) {
  const t = shTarget();
  if (!t) throw new Error('NOCONFIG');
  let r;
  try {
    r = await fetch(`${t.base}/api/${route}`, { method, headers: { 'x-key': t.key, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(7000), cache: 'no-store' });
  } catch (_) {
    throw new Error(t.local && !t.enabled ? 'Ative o acesso pelo celular no SmartHouse (Ajustes → Celular).' : 'Não consegui falar com o SmartHouse. Ele está aberto e com o acesso pelo celular ativo?');
  }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `Erro ${r.status}`);
  return j;
}

// ---------- IPC ----------
function setupIpc() {
  ipcMain.on('rect', (_, r) => { st.rect = r; });
  // a janela não rouba o foco ao clicar; só vira "focável" quando a pessoa precisa digitar
  ipcMain.on('focus', (_, on) => {
    if (on) { win.setFocusable(true); st.ignoring = false; win.setIgnoreMouseEvents(false); win.focus(); }
    else { win.blur(); win.setFocusable(false); if (!st.inside) { st.ignoring = true; win.setIgnoreMouseEvents(true, { forward: true }); } }
  });
  ipcMain.handle('cfg:get', () => ({ ...cfg, platform: process.platform, version: app.getVersion(), covered: cfg.hideOnMax && st.covered, shDetected: (() => { try { return !!shTarget(); } catch (_) { return false; } })() }));
  ipcMain.handle('cfg:set', (_, patch) => {
    Object.assign(cfg, patch); saveCfg();
    if ('startup' in patch) app.setLoginItemSettings({ openAtLogin: !!patch.startup, args: app.isPackaged ? [] : [path.resolve(__dirname)] });
    if ('hideOnMax' in patch) send('covered', cfg.hideOnMax && st.covered);
    return cfg;
  });
  ipcMain.on('media', (_, c) => helperCmd(c));
  ipcMain.on('disk', () => helperCmd('disk'));
  ipcMain.on('speedtest:start', () => speedtest());
  ipcMain.on('speedtest:cancel', () => stCtrl?.abort());
  ipcMain.handle('sh', (_, req) => shCall(req));
  ipcMain.on('copy', (_, t) => { lastClip = t; clipboard.writeText(t); });
  ipcMain.on('clips:clear', () => { cfg.clips = []; saveCfg(); send('clips', []); });
  ipcMain.on('notify', (_, { title, body }) => { if (Notification.isSupported()) new Notification({ title, body, silent: true }).show(); });
  ipcMain.handle('meta', async () => { try { return await geo(); } catch (_) { return null; } });
  ipcMain.on('open', (_, url) => { if (/^https?:\/\//.test(url)) shell.openExternal(url); });
  ipcMain.on('quit', () => app.quit());
}

function setupTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, 'renderer', 'icon.png')).resize({ width: 16, height: 16 });
  tray = new Tray(icon);
  tray.setToolTip('Ilha');
  const menu = () => Menu.buildFromTemplate([
    { label: 'Abrir a Ilha  (Ctrl+Alt+Espaço)', click: () => send('toggle') },
    { type: 'separator' },
    { label: 'Esconder com janela maximizada', type: 'checkbox', checked: cfg.hideOnMax, click: m => { cfg.hideOnMax = m.checked; saveCfg(); send('covered', cfg.hideOnMax && st.covered); send('cfg', cfg); } },
    { label: 'Iniciar com o Windows', type: 'checkbox', checked: cfg.startup, click: m => { cfg.startup = m.checked; saveCfg(); app.setLoginItemSettings({ openAtLogin: m.checked, args: app.isPackaged ? [] : [path.resolve(__dirname)] }); send('cfg', cfg); } },
    { label: 'Recarregar', click: () => win.reload() },
    { type: 'separator' },
    { label: 'Sair', click: () => app.quit() },
  ]);
  tray.on('click', () => send('toggle'));
  tray.on('right-click', () => tray.popUpContextMenu(menu()));
}

app.whenReady().then(() => {
  loadCfg();
  createWindow();
  setupIpc();
  trackCursor();
  startHelper();
  sysLoop();
  clipLoop();
  setupTray();
  globalShortcut.register('Control+Alt+Space', () => send('toggle'));
  screen.on('display-metrics-changed', placeWindow);
  screen.on('display-added', placeWindow);
  screen.on('display-removed', placeWindow);
});
app.on('second-instance', () => send('toggle'));
app.on('before-quit', () => { app.isQuitting = true; helperCmd('quit'); try { fs.writeFileSync(cfgFile(), JSON.stringify(cfg, null, 2)); } catch (_) {} });
app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', () => app.quit());
