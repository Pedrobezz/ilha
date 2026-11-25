// Ilha: processo principal (janela, hover, ajudante nativo, teste de internet, SmartHouse)
const { app, BrowserWindow, screen, ipcMain, Tray, Menu, nativeImage, globalShortcut, clipboard, Notification, shell, desktopCapturer } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');

const W = 900, H = 640; // tela transparente onde a ilha vive (inclui espaço para a sombra)

if (!app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }
app.setAppUserModelId('com.pedrobez.ilha');
// a ilha é uma janela transparente por cima de tudo: o Chromium não pode achar que ela está "coberta" e parar de desenhar
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');

// ---------- ajustes ----------
const cfgFile = () => path.join(app.getPath('userData'), 'ilha.json');
const DEFAULTS = { city: '', glass: 22, theme: 'grafite', hideOnMax: true, startup: false, smarthouse: '', notes: '', speedHistory: [], clips: [], shFav: [], monitor: 'primary', shelf: [], favs: [], outages: [], liveAlerts: true, islandStyle: 'notch', islandColor: 'black', islandAlpha: 100, favIcons: {}, icsUrl: '', musicPulse: true };
let cfg = { ...DEFAULTS };
function loadCfg() { try { cfg = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(cfgFile(), 'utf8')) }; } catch (_) {} }
let saveT = null;
function saveCfg() { clearTimeout(saveT); saveT = setTimeout(() => { try { fs.writeFileSync(cfgFile(), JSON.stringify(cfg, null, 2)); } catch (_) {} }, 300); }

let win, tray, helper;
const st = { covered: false, inside: false, ignoring: true, rect: { x: (W - 200) / 2, y: 0, w: 200, h: 34 }, pinned: false };
const send = (ch, data) => { if (win && !win.isDestroyed()) win.webContents.send(ch, data); };

// monitor da ilha: o principal, ou o monitor onde o mouse está
let curDisplay = null;
function targetDisplay() {
  return cfg.monitor === 'cursor' ? screen.getDisplayNearestPoint(screen.getCursorScreenPoint()) : screen.getPrimaryDisplay();
}
function placeWindow() {
  if (!win || win.isDestroyed()) return;
  const d = targetDisplay(), b = d.bounds;
  curDisplay = d.id;
  win.setBounds({ x: Math.round(b.x + (b.width - W) / 2), y: b.y, width: W, height: H });
  // o ajudante precisa saber em qual monitor olhar a janela maximizada (em pixels físicos)
  try { const p = screen.dipToScreenPoint({ x: Math.round(b.x + b.width / 2), y: b.y + 5 }); helperCmd(`mon ${Math.round(p.x)} ${Math.round(p.y)}`); } catch (_) {}
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
  // som do sistema (loopback) para a ilha pulsar com a música: só o áudio é usado, sem pedir permissão
  win.webContents.session.setDisplayMediaRequestHandler((req, cb) => {
    desktopCapturer.getSources({ types: ['screen'] }).then(src => cb({ video: src[0], audio: 'loopback' })).catch(() => cb({}));
  });
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
  // modo "monitor do mouse": quando o mouse muda de monitor (e a ilha está fechada), ela vai junto
  setInterval(() => {
    if (cfg.monitor !== 'cursor' || st.inside || !win || win.isDestroyed()) return;
    if (screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).id !== curDisplay) placeWindow();
  }, 400);
  // outras janelas "sempre por cima" podem passar na frente: reafirma de tempos em tempos
  setInterval(() => { if (win && !win.isDestroyed()) { win.setAlwaysOnTop(true, 'screen-saver'); if (!st.inside) win.moveTop(); } }, 2500);
}

// ---------- ajudante nativo (PowerShell + C#) ----------
const nativeLast = {}; // último valor de cada tipo, para a interface saber o estado ao (re)carregar
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
      if (['vol', 'av', 'media', 'radios', 'notifAccess'].includes(m.t)) nativeLast[m.t] = m;
      if (m.t === 'ocr') { ocrDone(m); continue; }
      if (m.t === 'fg') { st.covered = m.covered; send('covered', cfg.hideOnMax && m.covered); }
      else if (m.t === 'ready') { placeWindow(); helperCmd(`notifs ${cfg.winNotifs !== false ? 1 : 0}`); send('native', m); }
      else send('native', m);
    }
  });
  helper.on('exit', () => { helper = null; if (!app.isQuitting) setTimeout(startHelper, 3000); });
}
const helperCmd = c => { try { helper?.stdin.write(c + '\n'); } catch (_) {} };

// ---------- monitor de quedas da internet ----------
const conn = { online: true, fails: 0, since: Date.now() };
async function connLoop() {
  let ok = false;
  try { const r = await fetch('https://cp.cloudflare.com/generate_204', { signal: AbortSignal.timeout(3500), cache: 'no-store' }); ok = r.status === 204 || r.ok; } catch (_) {}
  if (!ok) {
    // confirma por outro caminho antes de declarar queda
    try { const r = await fetch('https://www.google.com/generate_204', { signal: AbortSignal.timeout(3500), cache: 'no-store' }); ok = r.status === 204 || r.ok; } catch (_) {}
  }
  if (ok) {
    conn.fails = 0;
    if (!conn.online) {
      const o = cfg.outages[0]; if (o && !o.end) o.end = Date.now();
      conn.online = true; conn.since = Date.now(); saveCfg();
      send('conn', { online: true, outages: cfg.outages, event: 'up', duration: o ? o.end - o.start : 0 });
    }
  } else if (++conn.fails >= 2 && conn.online) {
    conn.online = false; conn.since = Date.now();
    cfg.outages = [{ start: Date.now() - 5000, end: 0 }, ...cfg.outages].slice(0, 60); saveCfg();
    send('conn', { online: false, outages: cfg.outages, event: 'down' });
  }
  setTimeout(connLoop, conn.online ? 5000 : 2500);
}

// ---------- SmartHouse ao vivo: regras que dispararam e erros viram avisos na ilha ----------
let shStream = null;
async function shEvents() {
  shStream?.abort(); shStream = null;
  let t; try { t = shTarget(); } catch (_) { t = null; }
  if (!t) return setTimeout(shEvents, 30000);
  const ctrl = new AbortController(); shStream = ctrl;
  try {
    const r = await fetch(`${t.base}/api/events?k=${encodeURIComponent(t.key)}`, { signal: ctrl.signal, headers: { accept: 'text/event-stream' } });
    if (!r.ok) throw new Error(String(r.status));
    const rd = r.body.getReader(), dec = new TextDecoder(); let buf = '';
    for (;;) {
      const { done, value } = await rd.read(); if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const block = buf.slice(0, i); buf = buf.slice(i + 2);
        const ev = /^event: (.+)$/m.exec(block)?.[1], data = /^data: (.+)$/m.exec(block)?.[1];
        if (ev !== 'log' || !data) continue;
        let l; try { l = JSON.parse(data); } catch (_) { continue; }
        if (/^Regra /.test(l.msg) || l.level === 'error') send('shlog', l);
      }
    }
  } catch (_) {}
  if (shStream === ctrl) setTimeout(shEvents, 15000);
}

// ---------- avisos do Claude Code (hooks Stop / Notification) ----------
// Servidor só em 127.0.0.1, exige a chave no cabeçalho x-ilha-key (páginas da web não conseguem mandar esse cabeçalho sem CORS)
const CLAUDE_PORT = 47823;
// quando chegou o último sinal do Claude (com a chave certa / errada) e o último teste: ajuda a achar o problema
const claudeSig = { ok: 0, bad: 0, test: 0 };
function claudeServer() {
  const http = require('http');
  const srv = http.createServer((req, res) => {
    const end = (code, msg = '') => { res.writeHead(code, { 'content-type': 'text/plain' }); res.end(msg); };
    if (req.method !== 'POST' || !['/claude', '/claude/status', '/claude/permission'].includes(req.url)) return end(404);
    const key = String(req.headers['x-ilha-key'] || '');
    const same = k => !!k && key.length === k.length && require('crypto').timingSafeEqual(Buffer.from(key), Buffer.from(k));
    if (!same(cfg.claudeKey)) { claudeSig.bad = Date.now(); return end(401); }
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > 256e3) req.destroy(); else chunks.push(c); });
    req.on('end', () => {
      let j = {}; try { j = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch (_) {}
      if (j.hook_event_name === 'IlhaTeste') { claudeSig.test = Date.now(); return end(204); }
      claudeSig.ok = Date.now();
      if (req.url === '/claude/permission') return claudePermission(j, res);
      end(204);
      if (req.url === '/claude/status') return claudeStatus(j);
      const ev = String(j.hook_event_name || '');
      const project = j.cwd ? String(j.cwd).split(/[\\/]/).filter(Boolean).pop() || '' : '';
      claudeEvent(ev, j, project);
      if (ev === 'Stop' || ev === 'Notification') {
        send('claude', { event: ev, message: String(j.message || '').slice(0, 300), type: String(j.notification_type || ''), project, session: String(j.session_id || '').slice(0, 12) });
      }
    });
  });
  srv.on('error', () => {}); // porta ocupada: só não recebe avisos
  srv.listen(CLAUDE_PORT, '127.0.0.1');
}

// ---------- conectar ao Claude Code com um clique (hooks em ~/.claude/settings.json) ----------
// Dois jeitos de mandar o aviso, conforme o PC:
//  - "bash": curl pelo Git Bash (rápido; é onde o Claude Code costuma rodar os hooks no Windows)
//  - "ps": um script do PowerShell em ~/.ilha/hook.ps1, que funciona em qualquer shell (bash, PowerShell ou cmd)
const ILHA_DIR = path.join(os.homedir(), '.ilha');
const HOOK_PS1 = path.join(ILHA_DIR, 'hook.ps1');
const HOOK_PS1_SRC = `# Ilha: repassa o evento do Claude Code para a Ilha (http://127.0.0.1:${CLAUDE_PORT}). Gerado pela Ilha.
param([string]$Route = 'claude', [int]$Max = 2)
$ErrorActionPreference = 'SilentlyContinue'
try {
  [Console]::InputEncoding = [Text.Encoding]::UTF8
  $body = [Console]::In.ReadToEnd()
  $key = (Get-Content -Raw -LiteralPath (Join-Path $HOME '.ilha\\claude-key')).Trim()
  $req = [Net.HttpWebRequest]::Create("http://127.0.0.1:${CLAUDE_PORT}/" + $Route.TrimStart('/'))
  $req.Method = 'POST'; $req.ContentType = 'application/json'; $req.Proxy = $null; $req.Timeout = $Max * 1000
  $req.Headers.Add('x-ilha-key', $key)
  $bytes = [Text.Encoding]::UTF8.GetBytes($body); $req.ContentLength = $bytes.Length
  $s = $req.GetRequestStream(); $s.Write($bytes, 0, $bytes.Length); $s.Close()
  $res = $req.GetResponse(); $out = (New-Object IO.StreamReader($res.GetResponseStream())).ReadToEnd(); $res.Close()
  if ($out) { [Console]::OutputEncoding = [Text.Encoding]::UTF8; [Console]::Out.Write($out) }
} catch {}
exit 0
`;
function findGitBash() {
  const pf = process.env.ProgramFiles || 'C:\\Program Files', pf86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  const cands = [process.env.CLAUDE_CODE_GIT_BASH_PATH, path.join(pf, 'Git', 'bin', 'bash.exe'), path.join(pf86, 'Git', 'bin', 'bash.exe'), path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Git', 'bin', 'bash.exe')];
  for (const dir of String(process.env.PATH || '').split(';')) if (dir && fs.existsSync(path.join(dir, 'git.exe'))) cands.push(path.resolve(dir, '..', 'bin', 'bash.exe'));
  return cands.find(p => p && fs.existsSync(p)) || '';
}
const bashCmd = (route, maxTime, keepOutput) => `curl -s -m ${maxTime}${keepOutput ? '' : ' -o /dev/null'} -X POST -H "x-ilha-key: $(cat ~/.ilha/claude-key 2>/dev/null)" -H "content-type: application/json" --data-binary @- http://127.0.0.1:${CLAUDE_PORT}${route} 2>/dev/null || true`;
// a rota vai sem a barra inicial: o Git Bash transforma argumentos que começam com "/" em caminhos do Windows
const psCmd = (route, maxTime) => `powershell -NoProfile -ExecutionPolicy Bypass -File "${HOOK_PS1.replace(/\\/g, '/')}" ${route.replace(/^\//, '')} ${maxTime}`;
function ilhaHooks(style) {
  const c = style === 'ps' ? psCmd : bashCmd;
  return {
    hooks: {
      Stop: { command: c('/claude', 2), timeout: 5 },
      Notification: { command: c('/claude', 2), timeout: 5 },
      UserPromptSubmit: { command: c('/claude', 2), timeout: 5, async: true },
      PreToolUse: { command: c('/claude', 2), timeout: 5, async: true },
      PermissionRequest: { command: c('/claude/permission', 35, true), timeout: 40 },
    },
    status: style === 'ps' ? c('/claude/status', 2) : c('/claude/status', 2).replace(/ \|\| true$/, '; true'),
  };
}
const HOOK_EVENTS = Object.keys(ilhaHooks('bash').hooks);
const isIlhaCmd = c => { c = String(c || ''); return c.includes(`127.0.0.1:${CLAUDE_PORT}/claude`) || c.includes('.ilha/hook.ps1'); };
const cmdStyle = c => (String(c || '').includes('.ilha/hook.ps1') ? 'ps' : 'bash');
const claudeSettingsFile = () => path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'settings.json');
function readClaudeSettings() {
  const file = claudeSettingsFile();
  let text;
  try { text = fs.readFileSync(file, 'utf8').replace(/^﻿/, ''); } catch (e) { if (e.code === 'ENOENT') return { file, json: {}, exists: false, text: null }; throw new Error('Não consegui ler o settings.json do Claude Code.'); }
  if (!text.trim()) return { file, json: {}, exists: true, text };
  let json;
  try { json = JSON.parse(text); } catch (_) { throw new Error('O settings.json do Claude Code tem um erro de formatação. Corrija antes de conectar.'); }
  if (!json || typeof json !== 'object' || Array.isArray(json)) throw new Error('O settings.json do Claude Code não está no formato esperado.');
  return { file, json, exists: true, text };
}
// tira os hooks da Ilha e deixa os seus como estão
function stripIlhaHooks(json) {
  const h = json.hooks && typeof json.hooks === 'object' && !Array.isArray(json.hooks) ? json.hooks : {};
  for (const ev of Object.keys(h)) {
    if (!Array.isArray(h[ev])) continue;
    h[ev] = h[ev].map(g => (g && Array.isArray(g.hooks) ? { ...g, hooks: g.hooks.filter(x => !isIlhaCmd(x?.command)) } : g)).filter(g => !g || !Array.isArray(g.hooks) || g.hooks.length);
    if (!h[ev].length) delete h[ev];
  }
  return h;
}
function writeClaudeSettings(file, json, oldText) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (oldText != null) fs.writeFileSync(file + '.ilha-backup', oldText); // cópia de como estava, por segurança
  const tmp = file + '.ilha-tmp';
  fs.writeFileSync(tmp, JSON.stringify(json, null, 2) + '\n');
  fs.renameSync(tmp, file);
}
const ilhaStopCmd = json => (json.hooks?.Stop || []).flatMap(g => g?.hooks || []).find(x => isIlhaCmd(x?.command))?.command || '';
function claudeHooksStatus() {
  try {
    const { file, json, exists } = readClaudeSettings();
    const h = json.hooks || {};
    const have = HOOK_EVENTS.filter(ev => Array.isArray(h[ev]) && h[ev].some(g => (g?.hooks || []).some(x => isIlhaCmd(x?.command))));
    const sl = json.statusLine, stop = ilhaStopCmd(json);
    return {
      ok: true, file, exists, connected: have.length === HOOK_EVENTS.length, partial: have.length > 0 && have.length < HOOK_EVENTS.length,
      statusLine: !sl ? 'none' : isIlhaCmd(sl.command) ? 'ilha' : 'other', claudeDir: fs.existsSync(path.dirname(file)),
      style: stop ? cmdStyle(stop) : '', gitBash: !!findGitBash(), lastOk: claudeSig.ok, lastBad: claudeSig.bad,
    };
  } catch (e) { return { ok: false, error: e.message }; }
}
// style: 'bash' ou 'ps'. Por padrão, o modo PowerShell: funciona qualquer que seja o shell que o Claude usa
// (o modo bash quebra se o Claude rodar os hooks pelo PowerShell, que não entende "$(...)" nem "||")
function claudeConnect(style) {
  style = style === 'bash' ? 'bash' : 'ps';
  const { file, json, text } = readClaudeSettings();
  const h = stripIlhaHooks(json), set = ilhaHooks(style);
  for (const [ev, hook] of Object.entries(set.hooks)) (h[ev] = Array.isArray(h[ev]) ? h[ev] : []).push({ hooks: [{ type: 'command', ...hook }] });
  json.hooks = h;
  // a linha de status traz os limites do plano; se você já usa outra, ela fica como está
  if (!json.statusLine || isIlhaCmd(json.statusLine.command)) json.statusLine = { type: 'command', command: set.status };
  writeClaudeKey();
  writeClaudeSettings(file, json, text);
  return claudeHooksStatus();
}
// roda o hook "Stop" pelos shells que o Claude pode usar (Git Bash, se existir, e PowerShell) e confere se chegou na Ilha
async function runHookIn(exe, args) {
  const t0 = Date.now(); let ran = true, stderr = '';
  await new Promise(resolve => {
    let p; try { p = spawn(exe, args, { windowsHide: true, env: { ...process.env, HOME: process.env.HOME || os.homedir() } }); } catch (_) { ran = false; return resolve(); }
    const t = setTimeout(() => { try { p.kill(); } catch (_) {} resolve(); }, 9000);
    p.on('error', () => { ran = false; clearTimeout(t); resolve(); });
    p.stderr.on('data', d => { stderr += d; });
    p.on('exit', () => { clearTimeout(t); resolve(); });
    p.stdin.end(JSON.stringify({ hook_event_name: 'IlhaTeste' }));
  });
  await new Promise(r => setTimeout(r, 300));
  return { ran, reached: claudeSig.test >= t0, badKey: claudeSig.bad >= t0, stderr: stderr.trim().split('\n')[0]?.slice(0, 200) || '' };
}
async function claudeTest() {
  const st = claudeHooksStatus(); if (!st.ok) return st;
  writeClaudeKey();
  const { json } = readClaudeSettings();
  const cmd = ilhaStopCmd(json) || ilhaHooks('ps').hooks.Stop.command;
  const bash = findGitBash();
  const r = { bash: null, ps: null };
  if (bash) r.bash = await runHookIn(bash, ['-c', cmd]);
  r.ps = await runHookIn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', cmd]);
  const tried = [r.bash, r.ps].filter(Boolean);
  return { ...claudeHooksStatus(), test: {
    reached: tried.every(x => x.reached), bash: r.bash?.reached ?? null, ps: r.ps.reached,
    badKey: tried.some(x => x.badKey), stderr: tried.find(x => !x.reached && x.stderr)?.stderr || '',
  } };
}
function claudeDisconnect() {
  const { file, json, text, exists } = readClaudeSettings();
  if (!exists) return claudeHooksStatus();
  json.hooks = stripIlhaHooks(json);
  if (!Object.keys(json.hooks).length) delete json.hooks;
  if (json.statusLine && isIlhaCmd(json.statusLine.command)) delete json.statusLine;
  writeClaudeSettings(file, json, text);
  return claudeHooksStatus();
}
// a chave também vai para ~/.ilha/claude-key, que o hook do Claude Code lê na hora de enviar.
// (fora do %APPDATA% de propósito: apps empacotados, como o Claude para Windows, enxergam outra cópia do %APPDATA%)
function writeClaudeKey() {
  try {
    fs.mkdirSync(ILHA_DIR, { recursive: true });
    fs.writeFileSync(path.join(ILHA_DIR, 'claude-key'), cfg.claudeKey);
    // o script do modo PowerShell fica sempre atualizado com a versão da Ilha
    let cur = ''; try { cur = fs.readFileSync(HOOK_PS1, 'utf8'); } catch (_) {}
    if (cur !== '﻿' + HOOK_PS1_SRC) fs.writeFileSync(HOOK_PS1, '﻿' + HOOK_PS1_SRC);
  } catch (_) {}
}

// ---------- Permitir / Negar pela ilha (hook PermissionRequest) ----------
// O hook fica esperando a resposta. Sem resposta em 30 s (ou com avisos desligados), devolve vazio
// e o Claude mostra o pedido de permissão normal dele.
const perms = new Map();
function claudePermission(j, res) {
  const empty = () => { if (!res.writableEnded) { res.writeHead(204); res.end(); } };
  if (cfg.liveAlerts === false || !win || win.isDestroyed()) return empty();
  const id = require('crypto').randomBytes(6).toString('hex');
  const tool = String(j.tool_name || ''), inp = j.tool_input || {};
  let detail = '';
  if (inp.command) detail = String(inp.command);
  else if (inp.file_path) detail = String(inp.file_path);
  else if (inp.url) detail = String(inp.url);
  else { try { detail = JSON.stringify(inp); } catch (_) {} }
  const project = j.cwd ? base(j.cwd) : '';
  const timer = setTimeout(() => { perms.delete(id); empty(); send('claudePermClose', id); }, 30000);
  perms.set(id, { res, timer });
  res.on('close', () => { if (perms.has(id)) { clearTimeout(timer); perms.delete(id); send('claudePermClose', id); } });
  send('claudePerm', { id, tool, title: toolText(tool, inp), detail: detail.slice(0, 400), project });
}
function answerPermission(id, allow) {
  const p = perms.get(id); if (!p) return;
  clearTimeout(p.timer); perms.delete(id);
  const decision = allow ? { behavior: 'allow' } : { behavior: 'deny', message: 'Negado pela Ilha' };
  p.res.writeHead(200, { 'content-type': 'application/json' });
  p.res.end(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PermissionRequest', decision } }));
}

// ---------- resumo do dia do Claude ----------
const today = () => new Date().toLocaleDateString('sv-SE'); // AAAA-MM-DD no fuso local
function dayStats() {
  cfg.claudeDaily = cfg.claudeDaily || {};
  const d = today();
  if (!cfg.claudeDaily[d]) {
    cfg.claudeDaily[d] = { tasks: 0, ms: 0, tokens: 0, commits: 0, pushes: 0 };
    for (const k of Object.keys(cfg.claudeDaily).sort().slice(0, -14)) delete cfg.claudeDaily[k];
  }
  return cfg.claudeDaily[d];
}

// ---------- GitHub: avisa quando um teste (Actions) falha nos seus repositórios ----------
const GH = path.join(process.env.ProgramFiles || 'C:\\Program Files', 'GitHub CLI', 'gh.exe');
const gh = { runs: {}, list: [], ok: fs.existsSync(GH) };
function ghApi(route) {
  return new Promise(resolve => require('child_process').execFile(GH, ['api', route], { windowsHide: true, timeout: 20000 }, (err, out) => { try { resolve(err ? null : JSON.parse(out)); } catch (_) { resolve(null); } }));
}
async function ghLoop() {
  if (!gh.ok) return;
  const repos = await ghApi('/user/repos?sort=pushed&per_page=8');
  if (Array.isArray(repos)) {
    const recent = repos.filter(r => Date.now() - Date.parse(r.pushed_at) < 30 * 864e5);
    const list = [];
    for (const r of recent) {
      const runs = await ghApi(`/repos/${r.full_name}/actions/runs?per_page=1`);
      const run = runs?.workflow_runs?.[0]; if (!run) continue;
      const item = { repo: r.name, name: run.name, status: run.status, conclusion: run.conclusion, url: run.html_url, branch: run.head_branch, at: Date.parse(run.updated_at) };
      list.push(item);
      const prev = gh.runs[r.full_name];
      if (prev && prev.id !== run.id && run.conclusion === 'failure') send('ghfail', item);
      gh.runs[r.full_name] = { id: run.id };
    }
    gh.list = list; claudeSend();
  }
  setTimeout(ghLoop, 5 * 60e3);
}

// ---------- Claude ao vivo: o que está fazendo, há quanto tempo, tokens e limites ----------
const claude = { sessions: new Map(), limits: null, ctx: null, model: '', log: [], current: null };
const base = p => String(p || '').split(/[\\/]/).filter(Boolean).pop() || '';
function toolText(tool, inp = {}) {
  const t = String(tool || '');
  if (/^(Edit|Write|MultiEdit|NotebookEdit)$/.test(t)) return `Editando ${base(inp.file_path || inp.notebook_path)}`;
  if (t === 'Read') return `Lendo ${base(inp.file_path)}`;
  if (t === 'Bash' || t === 'PowerShell') return inp.description ? String(inp.description) : `Rodando ${String(inp.command || '').slice(0, 50)}`;
  if (t === 'Grep' || t === 'Glob') return `Procurando ${String(inp.pattern || '').slice(0, 40)}`;
  if (/^Web(Fetch|Search)$/.test(t)) return 'Pesquisando na web';
  if (t === 'Agent' || t === 'Task') return `Agente: ${String(inp.description || 'trabalhando').slice(0, 50)}`;
  if (t === 'Skill') return `Usando a skill ${String(inp.skill || '')}`;
  if (/^mcp__.*Browser|claude-in-chrome/i.test(t)) return 'Usando o navegador';
  if (/^mcp__.*computer-use/i.test(t)) return 'Controlando o computador';
  if (/^mcp__ccd_turn__/.test(t)) return 'Organizando as tarefas';
  if (/^mcp__/.test(t)) return `Usando ${t.split('__').slice(1).join(' · ').replace(/_/g, ' ')}`;
  return `Usando ${t}`;
}
// soma os tokens registrados no histórico da conversa (lê só o que foi acrescentado desde a última vez)
function readTranscript(s) {
  if (!s.transcript) return;
  try {
    const size = fs.statSync(s.transcript).size;
    if (size < s.offset) { s.offset = 0; s.seen.clear(); s.tokens = { in: 0, out: 0, cw: 0, cr: 0 }; }
    if (size === s.offset) return;
    const fd = fs.openSync(s.transcript, 'r');
    const len = Math.min(size - s.offset, 32e6), buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, s.offset); fs.closeSync(fd);
    const text = buf.toString('utf8'), lastNl = text.lastIndexOf('\n');
    if (lastNl < 0) return;
    s.offset += Buffer.byteLength(text.slice(0, lastNl + 1));
    for (const line of text.slice(0, lastNl).split('\n')) {
      if (!line.includes('"usage"')) continue;
      let o; try { o = JSON.parse(line); } catch (_) { continue; }
      const m = o.message, u = m?.usage; if (!u) continue;
      const id = m.id || o.uuid; if (s.seen.has(id)) continue; s.seen.add(id);
      s.tokens.in += u.input_tokens || 0; s.tokens.out += u.output_tokens || 0;
      s.tokens.cw += u.cache_creation_input_tokens || 0; s.tokens.cr += u.cache_read_input_tokens || 0;
      // contexto em uso = tudo o que a última resposta leu (entrada + cache)
      s.ctxTokens = (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0);
      if (m.model) s.model = String(m.model);
    }
  } catch (_) {}
}
const spent = t => t.in + t.out + t.cw;
// janela de contexto pelo modelo (Opus/Sonnet 5 e variantes [1m]: 1 milhão; outros: 200 mil)
const ctxWindow = m => /\[1m\]|opus-5|sonnet-5|fable/i.test(String(m || '')) ? 1e6 : 2e5;
function ctxFromTranscript(s) { if (!s?.ctxTokens) return null; const size = ctxWindow(s.model); return { p: Math.min(100, 100 * s.ctxTokens / size), size, est: true }; }
const prettyModel = m => { const x = /claude-([a-z]+)-(\d+)-(\d+)/.exec(String(m || '')); return x ? x[1][0].toUpperCase() + x[1].slice(1) + ' ' + x[2] + '.' + x[3] : ''; };
function claudeSummary() {
  const s = claude.current && claude.sessions.get(claude.current);
  const working = [...claude.sessions.values()].filter(x => x.working);
  return {
    working: !!s?.working, project: s?.project || '', activity: s?.activity || '', startedAt: s?.startedAt || 0, endedAt: s?.endedAt || 0,
    tokensTask: s && s.taskBase ? spent(s.tokens) - s.taskBase.spent : 0, outTask: s && s.taskBase ? s.tokens.out - s.taskBase.out : 0,
    tokensSession: s ? spent(s.tokens) : 0, cacheSession: s ? s.tokens.cr : 0,
    limits: claude.limits, ctx: claude.ctx || ctxFromTranscript(s), model: claude.model || prettyModel(s?.model), active: working.length, log: claude.log.slice(0, 12),
    today: dayStats(), gh: gh.list, ghOk: gh.ok,
  };
}
let claudeSendT = null;
function claudeSend() { clearTimeout(claudeSendT); claudeSendT = setTimeout(() => send('claudeState', claudeSummary()), 60); }
function claudeLog(text, project) { claude.log.unshift({ t: Date.now(), text, project }); claude.log.length = Math.min(claude.log.length, 40); }
function claudeEvent(ev, j, project) {
  const id = String(j.session_id || 'sessao');
  let s = claude.sessions.get(id);
  if (!s) { s = { id, project, working: false, startedAt: 0, endedAt: 0, activity: '', transcript: '', offset: 0, seen: new Set(), tokens: { in: 0, out: 0, cw: 0, cr: 0 }, taskBase: null, lastAt: 0 }; claude.sessions.set(id, s); }
  if (j.transcript_path) s.transcript = String(j.transcript_path);
  if (project) s.project = project;
  s.lastAt = Date.now(); claude.current = id;
  readTranscript(s);
  if (ev === 'UserPromptSubmit') {
    s.working = true; s.startedAt = Date.now(); s.endedAt = 0; s.activity = 'Pensando…';
    s.taskBase = { spent: spent(s.tokens), out: s.tokens.out };
    claudeLog('Nova tarefa' + (j.prompt ? `: ${String(j.prompt).replace(/\s+/g, ' ').slice(0, 70)}` : ''), s.project);
  } else if (ev === 'PreToolUse') {
    if (!s.working) { s.working = true; s.startedAt = s.startedAt && !s.endedAt ? s.startedAt : Date.now(); s.endedAt = 0; if (!s.taskBase) s.taskBase = { spent: spent(s.tokens), out: s.tokens.out }; }
    s.activity = toolText(j.tool_name, j.tool_input || {});
    claudeLog(s.activity, s.project);
    const cmd = String(j.tool_input?.command || '');
    if (/^(Bash|PowerShell)$/.test(j.tool_name) && /\bgit\b[^|;&]*\bcommit\b/.test(cmd)) { dayStats().commits++; saveCfg(); }
    if (/^(Bash|PowerShell)$/.test(j.tool_name) && /\bgit\b[^|;&]*\bpush\b/.test(cmd)) { dayStats().pushes++; saveCfg(); }
  } else if (ev === 'Notification') {
    if (/permission|approval/i.test(String(j.message || '')) || j.notification_type === 'permission_prompt') { s.activity = 'Esperando sua permissão'; claudeLog(s.activity, s.project); }
  } else if (ev === 'Stop') {
    const st = dayStats(); st.tasks++;
    if (s.startedAt && s.working) st.ms += Date.now() - s.startedAt;
    if (s.taskBase) st.tokens += Math.max(0, spent(s.tokens) - s.taskBase.spent);
    saveCfg();
    s.working = false; s.endedAt = Date.now(); s.activity = 'Terminou';
    claudeLog(`Terminou em ${Math.max(1, Math.round((s.endedAt - (s.startedAt || s.endedAt)) / 60000))} min`, s.project);
  }
  claudeSend();
}
function claudeStatus(j) {
  const rl = j.rate_limits || {};
  const lim = k => rl[k] && typeof rl[k].used_percentage === 'number' ? { p: rl[k].used_percentage, reset: rl[k].resets_at || 0 } : null;
  if (rl.five_hour || rl.seven_day) claude.limits = { five: lim('five_hour'), seven: lim('seven_day'), at: Date.now() };
  const cw = j.context_window;
  if (cw && typeof cw.used_percentage === 'number') claude.ctx = { p: cw.used_percentage, size: cw.context_window_size || 0 };
  if (j.model) claude.model = String(j.model.display_name || j.model.id || '');
  if (j.session_id && j.transcript_path) { const s = claude.sessions.get(String(j.session_id)); if (s && !s.transcript) s.transcript = String(j.transcript_path); }
  claudeSend();
}
// enquanto trabalha: atualiza os tokens e marca como parada a sessão sem sinal há 15 min (ex.: interrompida)
setInterval(() => {
  let changed = false;
  for (const s of claude.sessions.values()) {
    if (!s.working) continue;
    readTranscript(s); changed = true;
    if (Date.now() - s.lastAt > 15 * 60e3) { s.working = false; s.endedAt = s.lastAt; s.activity = 'Parado'; }
  }
  if (changed) claudeSend();
}, 3000);

// ---------- bateria dos aparelhos Bluetooth (fones, mouse, controle) ----------
let btLast = '';
// roda um script de bateria e devolve a lista [{ name, battery, charging, kind }]
function runBatteryScript(file, kind) {
  const script = path.join(__dirname, file).replace('app.asar', 'app.asar.unpacked');
  return new Promise(resolve => require('child_process').execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script], { windowsHide: true, timeout: 30000 }, (err, out) => {
    let list = []; try { list = JSON.parse(String(out).trim() || '[]'); if (!Array.isArray(list)) list = [list]; } catch (_) {}
    resolve(list.filter(d => d && typeof d.battery === 'number').map(d => ({ kind, ...d })));
  }));
}
// receptores próprios (Logitech LIGHTSPEED, HyperX): processo contínuo que confere a cada 2 s e avisa na hora
// quando algo muda (ex.: começou ou parou de carregar). Bluetooth (pelo Windows): a cada 25 s.
let hidList = [], btList = [], hidProc = null;
function pushBatteries() {
  const list = [...hidList, ...btList];
  const sig = JSON.stringify(list);
  if (sig !== btLast) { btLast = sig; send('btbat', list); }
}
function startHidBattery() {
  const script = path.join(__dirname, 'hidbattery.ps1').replace('app.asar', 'app.asar.unpacked');
  hidProc = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-Loop', '-ParentPid', String(process.pid)], { windowsHide: true });
  let buf = '';
  hidProc.stdout.setEncoding('utf8');
  hidProc.stdout.on('data', d => {
    buf += d; let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      try { const l = JSON.parse(line || '[]'); hidList = (Array.isArray(l) ? l : [l]).filter(x => x && typeof x.battery === 'number').map(x => ({ kind: 'hid', ...x })); pushBatteries(); } catch (_) {}
    }
  });
  hidProc.on('exit', () => { hidProc = null; if (!app.isQuitting) setTimeout(startHidBattery, 5000); });
}
async function btBatteryLoop() {
  if (!hidProc) startHidBattery();
  btList = await runBatteryScript('btbattery.ps1', 'bt');
  pushBatteries();
  setTimeout(btBatteryLoop, 25000);
}
// cores do papel de parede (para o tema "Papel de parede"): 3 tons para o degradê + 2 cores de destaque
ipcMain.handle('wallpaper', () => {
  const files = [path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Themes', 'TranscodedWallpaper')];
  for (const file of files) {
    try {
      const img = nativeImage.createFromBuffer(fs.readFileSync(file)); if (img.isEmpty()) continue;
      const sm = img.resize({ width: 48, quality: 'good' }), { width: w, height: h } = sm.getSize(), px = sm.toBitmap(); // BGRA
      const avg = (x0, x1) => { let r = 0, g = 0, b = 0, n = 0; for (let y = 0; y < h; y++) for (let x = Math.floor(x0 * w); x < Math.floor(x1 * w); x++) { const i = (y * w + x) * 4; b += px[i]; g += px[i + 1]; r += px[i + 2]; n++; } return [r / n, g / n, b / n]; };
      // cor mais viva da imagem para os botões
      let best = [10, 132, 255], bs = -1;
      for (let i = 0; i < px.length; i += 4) { const r = px[i + 2], g = px[i + 1], b = px[i], mx = Math.max(r, g, b), mn = Math.min(r, g, b), sc = (mx ? (mx - mn) / mx : 0) * mx; if (sc > bs) { bs = sc; best = [r, g, b]; } }
      const hex = c => '#' + c.map(v => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
      const vivid = (c, k = 1.25) => { const m = (c[0] + c[1] + c[2]) / 3; return c.map(v => m + (v - m) * k + 18); };
      const L = avg(0, .34), M = avg(.33, .67), Rr = avg(.66, 1);
      return [hex(vivid(L)), hex(vivid(M)), hex(vivid(Rr)), hex(vivid(best, 1.1)), hex(vivid(Rr, 1.4))];
    } catch (_) {}
  }
  return null;
});
ipcMain.handle('peripherals', () => { try { return JSON.parse(btLast || '[]'); } catch (_) { return []; } });

// ---------- downloads ao vivo (Chrome/Edge: .crdownload, Firefox: .part) ----------
const dl = { active: new Map(), watching: false, lastEvent: 0, timer: null };
const isTemp = n => /\.(crdownload|part|partial|download)$/i.test(n);
function dlScan() {
  const dir = app.getPath('downloads');
  let names = []; try { names = fs.readdirSync(dir); } catch (_) { return; }
  const now = Date.now(), seen = new Set();
  for (const n of names) {
    if (!isTemp(n)) continue;
    let st; try { st = fs.statSync(path.join(dir, n)); } catch (_) { continue; }
    seen.add(n);
    const cur = dl.active.get(n) || { name: n.replace(/\.(crdownload|part|partial|download)$/i, '').replace(/^Não confirmado \d+$/i, 'Baixando…').replace(/^Unconfirmed \d+$/i, 'Baixando…'), size: 0, speed: 0, at: now, start: now };
    const dt = (now - cur.at) / 1000;
    if (dt > 0) cur.speed = cur.speed * 0.5 + Math.max(0, (st.size - cur.size) / dt) * 0.5;
    cur.size = st.size; cur.at = now; dl.active.set(n, cur);
  }
  // sumiu o temporário: o download terminou (ou foi cancelado). Procura o arquivo final mais recente.
  for (const [n, cur] of dl.active) {
    if (seen.has(n)) continue;
    dl.active.delete(n);
    let best = null;
    for (const f of names) {
      if (isTemp(f)) continue;
      try { const st = fs.statSync(path.join(dir, f)); if (now - st.mtimeMs < 15000 && (!best || st.mtimeMs > best.t)) best = { f, t: st.mtimeMs, size: st.size }; } catch (_) {}
    }
    if (best && now - cur.start > 800) send('download', { done: { name: best.f, path: path.join(dir, best.f), size: best.size } });
  }
  send('download', { active: [...dl.active.values()].map(x => ({ name: x.name, size: x.size, speed: x.speed })) });
  if (dl.active.size || now - dl.lastEvent < 8000) dl.timer = setTimeout(dlScan, 1000); else dl.timer = null;
}
function dlWatch() {
  try {
    fs.watch(app.getPath('downloads'), () => { dl.lastEvent = Date.now(); if (!dl.timer) dl.timer = setTimeout(dlScan, 300); });
  } catch (_) {}
  dlScan();
}

// ---------- print de uma área da tela: usa a ferramenta de recorte do Windows e guarda na prateleira ----------
let printPoll = null;
// abre a ferramenta de recorte e chama onImage(img) quando o recorte chegar na área de transferência
function captureArea(onImage) {
  clearInterval(printPoll);
  const sig = img => { if (img.isEmpty()) return ''; const b = img.toBitmap(); return `${img.getSize().width}x${img.getSize().height}:${b.length}:${b.subarray(0, 64).toString('hex')}`; };
  const before = sig(clipboard.readImage());
  shell.openExternal('ms-screenclip:');
  const t0 = Date.now();
  printPoll = setInterval(() => {
    if (Date.now() - t0 > 90000) return clearInterval(printPoll);
    const img = clipboard.readImage(), s = sig(img);
    if (!s || s === before) return;
    clearInterval(printPoll);
    onImage(img);
  }, 400);
}
// copiar texto de um print: recorta, lê o texto com o OCR do Windows e copia
const ocrJobs = new Map();
function ocrFile(file, source) {
  const id = require('crypto').randomBytes(4).toString('hex');
  ocrJobs.set(id, { source, at: Date.now() });
  send('ocr', { state: 'reading' });
  helperCmd(`ocr ${id} ${Buffer.from(file, 'utf8').toString('base64')}`);
  setTimeout(() => { if (ocrJobs.delete(id)) send('ocr', { state: 'error', error: 'O leitor de texto demorou demais' }); }, 20000);
}
function ocrDone(m) {
  const job = ocrJobs.get(m.id); if (!job) return;
  ocrJobs.delete(m.id);
  const text = String(m.text || '').trim();
  if (!m.ok) return send('ocr', { state: 'error', error: m.error === 'noengine' ? 'O Windows não tem o leitor de texto instalado (Configurações → Idioma)' : 'Não consegui ler o texto da imagem' });
  if (!text) return send('ocr', { state: 'empty' });
  clipboard.writeText(text); // entra também no histórico da área de transferência
  send('ocr', { state: 'done', chars: text.length, lines: text.split('\n').length, preview: text.replace(/\s+/g, ' ').slice(0, 80) });
}
function ocrCapture() {
  captureArea(img => {
    const file = path.join(os.tmpdir(), `ilha-ocr-${Date.now()}.png`);
    try { fs.writeFileSync(file, img.toPNG()); } catch (_) { return send('ocr', { state: 'error', error: 'Não consegui salvar o recorte' }); }
    ocrFile(file, 'capture');
    setTimeout(() => { try { fs.unlinkSync(file); } catch (_) {} }, 30000);
  });
}
function takePrint() {
  captureArea(img => {
    const dir = path.join(app.getPath('pictures'), 'Ilha');
    try { fs.mkdirSync(dir, { recursive: true }); } catch (_) {}
    const d = new Date(), pad = n => String(n).padStart(2, '0');
    const file = path.join(dir, `Print ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}.${pad(d.getMinutes())}.${pad(d.getSeconds())}.png`);
    try { fs.writeFileSync(file, img.toPNG()); } catch (_) { return; }
    cfg.shelf = [...(cfg.shelf || []), file].slice(-40); saveCfg();
    send('printed', { path: file, shelf: cfg.shelf });
  });
}

// ---------- arquivos para a barra de comandos ----------
// O índice do Windows (Windows Search) pode estar desligado: a Ilha guarda sozinha os nomes dos arquivos
// das suas pastas (só nomes e caminhos, nunca o conteúdo) e procura nessa lista.
const fidx = { list: [], at: 0, building: null };
const SKIP_DIR = new Set(['node_modules', '.git', 'appdata', '$recycle.bin', '__pycache__', '.venv', 'venv', '.cache', '.next', '.nuxt', 'target', 'obj', '.gradle', '.idea', '.vs', 'site-packages', 'bower_components', '.npm', '.vscode', 'win-unpacked', '.android', '.m2']);
async function buildFileIndex() {
  if (fidx.building) return fidx.building;
  fidx.building = (async () => {
    const home = os.homedir(), roots = new Set();
    try { for (const e of await fs.promises.readdir(home, { withFileTypes: true })) if (e.isDirectory() && !/^[.$]/.test(e.name) && !SKIP_DIR.has(e.name.toLowerCase())) roots.add(path.join(home, e.name)); } catch (_) {}
    for (const k of ['desktop', 'documents', 'downloads', 'pictures', 'videos', 'music']) { try { roots.add(app.getPath(k)); } catch (_) {} }
    if (process.env.OneDrive) roots.add(process.env.OneDrive);
    const out = [], seen = new Set(), MAX = 120000;
    const walk = async (dir, depth) => {
      if (out.length >= MAX || depth > 7) return;
      let ents; try { ents = await fs.promises.readdir(dir, { withFileTypes: true }); } catch (_) { return; }
      for (const e of ents) {
        if (out.length >= MAX) return;
        if (/^[.~$]/.test(e.name) || /\.(tmp|crdownload|part|lnk~)$/i.test(e.name)) continue;
        const p = path.join(dir, e.name);
        if (e.isDirectory()) { if (SKIP_DIR.has(e.name.toLowerCase())) continue; out.push({ n: e.name, p, d: 1 }); await walk(p, depth + 1); }
        else if (e.isFile()) out.push({ n: e.name, p, d: 0 });
      }
    };
    for (const r of roots) { const k = r.toLowerCase(); if (seen.has(k)) continue; seen.add(k); await walk(r, 0); }
    fidx.list = out; fidx.at = Date.now(); fidx.building = null;
    return out;
  })();
  return fidx.building;
}
const fnorm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
async function recentFiles(limit = 12) {
  const dir = path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Recent');
  let ents = []; try { ents = await fs.promises.readdir(dir); } catch (_) { return []; }
  const lnks = [];
  for (const n of ents) { if (!/\.lnk$/i.test(n)) continue; try { lnks.push({ f: path.join(dir, n), t: (await fs.promises.stat(path.join(dir, n))).mtimeMs }); } catch (_) {} }
  lnks.sort((a, b) => b.t - a.t);
  const out = [];
  for (const l of lnks) {
    if (out.length >= limit) break;
    let target = ''; try { target = shell.readShortcutLink(l.f).target; } catch (_) {}
    if (!target || !fs.existsSync(target) || out.some(o => o.p === target)) continue;
    let d = 0; try { d = fs.statSync(target).isDirectory() ? 1 : 0; } catch (_) {}
    out.push({ n: path.basename(target), p: target, d, t: l.t });
  }
  return out;
}
async function searchFiles(q, limit = 8) {
  q = fnorm(q).trim(); if (q.length < 2) return [];
  if (!fidx.list.length || Date.now() - fidx.at > 15 * 60e3) { const b = buildFileIndex(); if (!fidx.list.length) await b; }
  const words = q.split(/\s+/).filter(Boolean), recent = new Map((await recentFiles(40)).map((r, i) => [r.p.toLowerCase(), 40 - i]));
  const scored = [];
  for (const f of fidx.list) {
    const n = fnorm(f.n);
    if (!words.every(w => n.includes(w))) continue;
    const base = n.replace(/\.[^.]+$/, '');
    let s = base === q ? 100 : base.startsWith(q) ? 85 : n.split(/[\s\-_.()]+/).some(w => w.startsWith(words[0])) ? 70 : 50;
    s += recent.get(f.p.toLowerCase()) || 0;          // abertos há pouco sobem
    s -= Math.min(15, f.p.split(/[\\/]/).length);     // mais perto da raiz sobe
    if (f.d) s -= 3;
    scored.push({ ...f, s });
  }
  scored.sort((a, b) => b.s - a.s);
  return scored.slice(0, limit);
}

// ---------- conversor de arquivos ----------
// Fotos: o próprio Chromium converte, numa janela escondida (a ilha não trava). HEIC e TIFF passam antes pelo leitor do Windows.
// PDF: juntar e fotos → PDF com a pdf-lib; PDF → imagens pelo leitor de PDF do Windows.
// Office → PDF: Microsoft Office em segundo plano, senão LibreOffice. Detecta na hora: instalou, já funciona.
const IMG_EXT = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.ico', '.avif', '.svg', '.heic', '.heif', '.tif', '.tiff', '.jfif'];
const VIA_WINDOWS = ['.heic', '.heif', '.tif', '.tiff'];
const OFFICE_KIND = { '.doc': 'word', '.docx': 'word', '.odt': 'word', '.rtf': 'word', '.xls': 'excel', '.xlsx': 'excel', '.ods': 'excel', '.csv': 'excel', '.ppt': 'ppt', '.pptx': 'ppt', '.odp': 'ppt' };
const MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.jfif': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif', '.bmp': 'image/bmp', '.ico': 'image/x-icon', '.avif': 'image/avif', '.svg': 'image/svg+xml' };
const conv = { win: null, jobs: new Map(), queue: [], busy: false, engines: null, enginesAt: 0 };
const CONV_PS1 = () => path.join(__dirname, 'convert.ps1').replace('app.asar', 'app.asar.unpacked');
function convWindow() {
  if (conv.win && !conv.win.isDestroyed()) return conv.ready;
  conv.win = new BrowserWindow({ show: false, width: 200, height: 200, skipTaskbar: true, webPreferences: { preload: path.join(__dirname, 'convert-preload.js'), contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
  conv.ready = new Promise(r => conv.win.webContents.once('did-finish-load', r));
  conv.win.loadFile(path.join(__dirname, 'renderer', 'convert.html'));
  conv.win.on('closed', () => { conv.win = null; });
  return conv.ready;
}
ipcMain.on('conv:result', (e, r) => {
  if (!conv.win || e.sender !== conv.win.webContents) return;
  const j = conv.jobs.get(r.id); if (!j) return;
  conv.jobs.delete(r.id); r.ok ? j.resolve(r) : j.reject(new Error(r.error || 'Falhou'));
});
async function imageJob(bytes, mime, fmt, opts = {}) {
  await convWindow();
  const id = require('crypto').randomBytes(6).toString('hex');
  return new Promise((resolve, reject) => {
    conv.jobs.set(id, { resolve, reject });
    conv.win.webContents.send('job', { id, bytes, mime, fmt, quality: opts.quality, maxSide: opts.maxSide });
    setTimeout(() => { if (conv.jobs.delete(id)) reject(new Error('Demorou demais')); }, 60000);
  });
}
// roda o convert.ps1 (um processo por conversão); onLine recebe as mensagens de progresso
function runConvPs(args, onLine, timeout = 180000) {
  return new Promise(resolve => {
    const p = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', CONV_PS1(), ...args], { windowsHide: true });
    let buf = '', last = { ok: false, error: 'Não respondeu' };
    const t = setTimeout(() => { try { p.kill(); } catch (_) {} }, timeout);
    p.stdout.setEncoding('utf8');
    p.stdout.on('data', d => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i).trim(); buf = buf.slice(i + 1); try { const m = JSON.parse(l); if ('ok' in m) last = m; else onLine?.(m); } catch (_) {} } });
    p.on('error', () => { clearTimeout(t); resolve({ ok: false, error: 'Não consegui abrir o PowerShell' }); });
    p.on('exit', () => { clearTimeout(t); resolve(last); });
  });
}
function findSoffice() {
  const pf = process.env.ProgramFiles || 'C:\\Program Files', pf86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  return [path.join(pf, 'LibreOffice', 'program', 'soffice.exe'), path.join(pf86, 'LibreOffice', 'program', 'soffice.exe')].find(p => fs.existsSync(p)) || '';
}
async function officeEngines(force) {
  if (!force && conv.engines && Date.now() - conv.enginesAt < 60000) return conv.engines;
  const ms = await runConvPs(['-Mode', 'engines'], null, 20000);
  conv.engines = { word: !!ms.word, excel: !!ms.excel, ppt: !!ms.ppt, libre: !!findSoffice() };
  conv.enginesAt = Date.now();
  return conv.engines;
}
// nome do arquivo novo ao lado do original, sem sobrescrever nada: "foto.png", "foto (1).png"…
function freeName(dir, base, ext) {
  let p = path.join(dir, base + ext), i = 1;
  while (fs.existsSync(p)) p = path.join(dir, `${base} (${i++})${ext}`);
  return p;
}
async function saveNear(src, base, ext, data) {
  for (const dir of [path.dirname(src), app.getPath('downloads')]) {
    const p = freeName(dir, base, ext);
    try { await fs.promises.writeFile(p, data); return p; } catch (_) {} // pasta sem permissão: vai para Downloads
  }
  throw new Error('Não consegui salvar o arquivo');
}
const stem = p => path.basename(p, path.extname(p));
// imagem → bytes de PNG/JPG prontos (passa pelo Windows se for HEIC/TIFF)
async function readImage(src) {
  const ext = path.extname(src).toLowerCase();
  if (!VIA_WINDOWS.includes(ext)) return { bytes: await fs.promises.readFile(src), mime: MIME[ext] || '' };
  const tmp = path.join(os.tmpdir(), `ilha-conv-${Date.now()}-${Math.random().toString(36).slice(2)}.png`);
  const r = await runConvPs(['-Mode', 'topng', '-Src', src, '-Dst', tmp], null, 60000);
  if (!r.ok) throw new Error(/HEIF|0x88982F50|componente/i.test(r.error || '') ? 'O Windows não abre esse formato (instale a Extensão de Imagem HEIF na Microsoft Store)' : 'O Windows não conseguiu abrir a imagem');
  const bytes = await fs.promises.readFile(tmp); fs.promises.unlink(tmp).catch(() => {});
  return { bytes, mime: 'image/png' };
}
const IMG_OUT = { png: '.png', jpg: '.jpg', webp: '.webp', ico: '.ico', bmp: '.bmp' };
async function convertOne(src, op, progress) {
  const ext = path.extname(src).toLowerCase();
  if (IMG_OUT[op]) {
    const { bytes, mime } = await readImage(src);
    const r = await imageJob(bytes, mime, op);
    return [await saveNear(src, stem(src), IMG_OUT[op], Buffer.from(r.data))];
  }
  if (op === 'compress') {
    const { bytes, mime } = await readImage(src);
    const r = await imageJob(bytes, mime, 'jpg', { quality: 0.8, maxSide: 2560 });
    // não ficou menor: não cria um arquivo à toa
    if (r.data.length >= fs.statSync(src).size * 0.95) { const e = new Error('Essa foto já está leve: diminuir não ajudaria'); e.info = true; throw e; }
    return [await saveNear(src, stem(src) + ' (menor)', '.jpg', Buffer.from(r.data))];
  }
  if (op === 'pdf2png') {
    const dir = freeName(path.dirname(src), stem(src) + ' (páginas)', '');
    try { fs.mkdirSync(dir, { recursive: true }); } catch (_) { throw new Error('Não consegui criar a pasta das páginas'); }
    const r = await runConvPs(['-Mode', 'pdf2png', '-Src', src, '-Dst', dir, '-Kind', stem(src) + ' - página'], m => progress?.(`página ${m.page} de ${m.total}`), 600000);
    if (!r.ok) { try { fs.rmdirSync(dir); } catch (_) {} throw new Error(/password|senha|protect/i.test(r.error || '') ? 'O PDF tem senha' : 'Não consegui ler o PDF'); }
    return [dir];
  }
  if (op === 'office2pdf' || op === 'pdf2docx') {
    const kind = op === 'pdf2docx' ? 'pdf2docx' : OFFICE_KIND[ext];
    if (!kind) throw new Error('Esse arquivo não é do Office');
    const eng = await officeEngines();
    const outExt = op === 'pdf2docx' ? '.docx' : '.pdf';
    const msApp = kind === 'pdf2docx' || kind === 'word' ? eng.word : kind === 'excel' ? eng.excel : eng.ppt;
    if (msApp && !(['.odt', '.ods', '.odp'].includes(ext) && eng.libre)) {
      const dst = freeName(path.dirname(src), stem(src), outExt);
      const r = await runConvPs(['-Mode', 'office', '-Src', src, '-Dst', dst, '-Kind', kind], null, 300000);
      if (!r.ok || !fs.existsSync(dst)) throw new Error('O Office não conseguiu converter este arquivo');
      return [dst];
    }
    if (op === 'office2pdf' && eng.libre) {
      // LibreOffice sem janela, com um perfil só da Ilha (não briga com o LibreOffice aberto)
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ilha-lo-'));
      const profile = 'file:///' + path.join(os.tmpdir(), 'ilha-lo-perfil').replace(/\\/g, '/');
      await new Promise(res => require('child_process').execFile(findSoffice(), ['--headless', '--norestore', '--nologo', `-env:UserInstallation=${profile}`, '--convert-to', 'pdf', '--outdir', tmpDir, src], { windowsHide: true, timeout: 300000 }, () => res()));
      const made = path.join(tmpDir, stem(src) + '.pdf');
      if (!fs.existsSync(made)) { fs.rmSync(tmpDir, { recursive: true, force: true }); throw new Error('O LibreOffice não conseguiu converter este arquivo'); }
      const dst = await saveNear(src, stem(src), '.pdf', await fs.promises.readFile(made));
      fs.rmSync(tmpDir, { recursive: true, force: true });
      return [dst];
    }
    const e = new Error(op === 'pdf2docx' ? 'Para PDF → Word é preciso ter o Microsoft Word' : 'Para converter Office em PDF, instale o LibreOffice (grátis) ou o Microsoft Office');
    e.needs = op === 'pdf2docx' ? 'word' : 'office'; throw e;
  }
  throw new Error('Conversão desconhecida');
}
// várias fotos → um PDF (uma por página A4, deitada ou em pé conforme a foto)
async function imagesToPdf(paths, progress) {
  const { PDFDocument } = require('pdf-lib');
  const doc = await PDFDocument.create();
  for (let i = 0; i < paths.length; i++) {
    progress?.(`foto ${i + 1} de ${paths.length}`);
    const { bytes, mime } = await readImage(paths[i]);
    const isJpg = mime === 'image/jpeg';
    const r = await imageJob(bytes, mime, isJpg ? 'jpg' : 'png', { quality: 0.92, maxSide: 3500 });
    const img = isJpg ? await doc.embedJpg(r.data) : await doc.embedPng(r.data);
    const land = img.width > img.height, [pw, ph] = land ? [841.89, 595.28] : [595.28, 841.89], m = 20;
    const k = Math.min((pw - 2 * m) / img.width, (ph - 2 * m) / img.height);
    const page = doc.addPage([pw, ph]);
    page.drawImage(img, { x: (pw - img.width * k) / 2, y: (ph - img.height * k) / 2, width: img.width * k, height: img.height * k });
  }
  const name = paths.length > 1 ? `${stem(paths[0])} e mais ${paths.length - 1}` : stem(paths[0]);
  return [await saveNear(paths[0], name, '.pdf', Buffer.from(await doc.save()))];
}
async function mergePdfs(paths, progress) {
  const { PDFDocument } = require('pdf-lib');
  const out = await PDFDocument.create();
  for (let i = 0; i < paths.length; i++) {
    progress?.(`PDF ${i + 1} de ${paths.length}`);
    let src; try { src = await PDFDocument.load(await fs.promises.readFile(paths[i]), { ignoreEncryption: true }); } catch (_) { throw new Error(`Não consegui abrir ${path.basename(paths[i])}`); }
    for (const p of await out.copyPages(src, src.getPageIndices())) out.addPage(p);
  }
  return [await saveNear(paths[0], `${stem(paths[0])} (juntado)`, '.pdf', Buffer.from(await out.save()))];
}
// fila: uma conversão por vez; a ilha mostra o progresso
async function convRun({ paths, op }) {
  paths = (paths || []).map(String).filter(p => fs.existsSync(p) && fs.statSync(p).isFile()).slice(0, 200);
  if (!paths.length) return send('conv', { state: 'done', outputs: [], errors: [{ name: '', error: 'Nenhum arquivo para converter' }] });
  conv.queue.push({ paths, op });
  if (conv.busy) return send('conv', { state: 'queued', waiting: conv.queue.length });
  conv.busy = true;
  while (conv.queue.length) {
    const job = conv.queue.shift(), outputs = [], errors = [];
    const total = job.op === 'img2pdf' || job.op === 'pdfmerge' ? 1 : job.paths.length;
    const tick = (done, detail) => send('conv', { state: 'progress', op: job.op, done, total, name: path.basename(job.paths[Math.min(done, job.paths.length - 1)]), detail });
    tick(0);
    const srcSize = p => { try { return fs.statSync(p).size; } catch (_) { return 0; } };
    const add = (src, list) => list.forEach(o => outputs.push({ path: o, name: path.basename(o), size: srcSize(o), srcSize: srcSize(src), dir: fs.statSync(o).isDirectory() }));
    try {
      if (job.op === 'img2pdf') add(job.paths[0], await imagesToPdf(job.paths, d => tick(0, d)));
      else if (job.op === 'pdfmerge') add(job.paths[0], await mergePdfs(job.paths, d => tick(0, d)));
      else for (let i = 0; i < job.paths.length; i++) {
        tick(i);
        try { add(job.paths[i], await convertOne(job.paths[i], job.op, d => tick(i, d))); }
        catch (e) { errors.push({ name: path.basename(job.paths[i]), error: e.message, needs: e.needs, info: e.info }); }
      }
    } catch (e) { errors.push({ name: path.basename(job.paths[0]), error: e.message, needs: e.needs }); }
    send('conv', { state: 'done', op: job.op, outputs, errors });
  }
  conv.busy = false;
}

// ---------- agenda (link iCal do Google Agenda ou do Outlook) ----------
const agenda = { events: [], alerted: new Set(), error: '' };
function icsParse(text, from, to) {
  const lines = text.replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '').split(/\r?\n/);
  const evs = []; let cur = null;
  for (const l of lines) {
    if (l === 'BEGIN:VEVENT') { cur = {}; continue; }
    if (l === 'END:VEVENT') { if (cur) evs.push(cur); cur = null; continue; }
    if (!cur) continue;
    const i = l.indexOf(':'); if (i < 0) continue;
    const [name, ...params] = l.slice(0, i).split(';'), val = l.slice(i + 1);
    const p = Object.fromEntries(params.map(x => x.split('=')));
    if (name === 'EXDATE') (cur.EXDATE = cur.EXDATE || []).push(...val.split(',').map(v => ({ v, p })));
    else cur[name] = { v: val, p };
  }
  const unesc = s => String(s || '').replace(/\\n/gi, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\');
  const parseDate = (d) => {
    if (!d) return null;
    const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?/.exec(d.v); if (!m) return null;
    const allDay = !m[4];
    const t = m[7] ? Date.UTC(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +m[6]) : new Date(+m[1], m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0)).getTime();
    return { t, allDay };
  };
  const link = e => (/(https:\/\/(?:meet\.google\.com|[\w.-]*zoom\.us|teams\.microsoft\.com|teams\.live\.com)\/[^\s"<>\\]+)/i.exec([e.URL?.v, e.LOCATION?.v, e.DESCRIPTION?.v].map(unesc).join(' ')) || [])[1] || '';
  const out = [];
  for (const e of evs) {
    if (e.STATUS?.v === 'CANCELLED' || e['RECURRENCE-ID']) continue;
    const s = parseDate(e.DTSTART); if (!s) continue;
    const en = parseDate(e.DTEND), dur = en ? en.t - s.t : (s.allDay ? 864e5 : 3600e3);
    const base = { title: unesc(e.SUMMARY?.v) || '(sem título)', where: unesc(e.LOCATION?.v), allDay: s.allDay, link: link(e) };
    const ex = new Set((e.EXDATE || []).map(x => parseDate(x)?.t));
    if (!e.RRULE) { if (s.t + dur >= from && s.t <= to) out.push({ ...base, start: s.t, end: s.t + dur }); continue; }
    const r = Object.fromEntries(e.RRULE.v.split(';').map(x => x.split('=')));
    const freq = r.FREQ, interval = +(r.INTERVAL || 1), count = r.COUNT ? +r.COUNT : Infinity, until = r.UNTIL ? parseDate({ v: r.UNTIL }).t : Infinity;
    const days = r.BYDAY ? r.BYDAY.split(',').map(x => ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'].indexOf(x.slice(-2))) : null;
    const d0 = new Date(s.t); let n = 0;
    for (let k = 0; k < 3700; k++) {
      const d = new Date(d0.getFullYear(), d0.getMonth(), d0.getDate() + k, d0.getHours(), d0.getMinutes(), d0.getSeconds());
      const t = d.getTime(); if (t > until || t > to) break;
      const weeks = Math.floor((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - Date.UTC(d0.getFullYear(), d0.getMonth(), d0.getDate() - d0.getDay())) / (7 * 864e5));
      const months = (d.getFullYear() - d0.getFullYear()) * 12 + d.getMonth() - d0.getMonth();
      let hit = false;
      if (freq === 'DAILY') hit = k % interval === 0;
      else if (freq === 'WEEKLY') hit = weeks % interval === 0 && (days ? days.includes(d.getDay()) : d.getDay() === d0.getDay());
      else if (freq === 'MONTHLY') hit = months % interval === 0 && d.getDate() === d0.getDate();
      else if (freq === 'YEARLY') hit = d.getMonth() === d0.getMonth() && d.getDate() === d0.getDate() && (d.getFullYear() - d0.getFullYear()) % interval === 0;
      if (!hit) continue;
      if (++n > count) break;
      if (ex.has(t)) continue;
      if (t + dur >= from) out.push({ ...base, start: t, end: t + dur });
    }
  }
  return out.sort((a, b) => a.start - b.start).slice(0, 60);
}
async function agendaLoop() {
  clearTimeout(agendaLoop.t);
  const url = String(cfg.icsUrl || '').trim().replace(/^webcal:/i, 'https:');
  if (!url) { agenda.events = []; agenda.error = ''; send('agenda', agenda); return; }
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const text = await r.text();
    if (!text.includes('BEGIN:VCALENDAR')) throw new Error('O link não é de uma agenda iCal');
    const now = Date.now();
    agenda.events = icsParse(text, now - 3600e3, now + 8 * 864e5); agenda.error = '';
  } catch (e) { agenda.error = e.message; }
  send('agenda', agenda);
  agendaLoop.t = setTimeout(agendaLoop, 10 * 60e3);
}
// aviso 10 minutos antes de cada compromisso
setInterval(() => {
  const now = Date.now();
  for (const e of agenda.events) {
    if (e.allDay) continue;
    const key = e.title + e.start;
    if (e.start - now <= 10 * 60e3 && e.start - now > -60e3 && !agenda.alerted.has(key)) { agenda.alerted.add(key); send('agendaAlert', e); }
  }
}, 20000);

// ---------- ícones dos sites favoritos ----------
async function siteIcon(url) {
  cfg.favIcons = cfg.favIcons || {};
  if (cfg.favIcons[url]) return cfg.favIcons[url];
  const get = async (u, accept) => { const r = await fetch(u, { signal: AbortSignal.timeout(6000), headers: { accept, 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Ilha/1.0' }, redirect: 'follow' }); if (!r.ok) throw new Error(String(r.status)); return r; };
  const toData = async r => {
    const type = (r.headers.get('content-type') || '').split(';')[0] || 'image/x-icon';
    if (!/^image\//.test(type)) throw new Error('não é imagem');
    const b = Buffer.from(await r.arrayBuffer()); if (!b.length || b.length > 600e3) throw new Error('tamanho');
    return `data:${type};base64,${b.toString('base64')}`;
  };
  const cands = [];
  try {
    const r = await get(url, 'text/html'); const html = (await r.text()).slice(0, 300e3), baseUrl = r.url;
    for (const m of html.matchAll(/<link\b[^>]*>/gi)) {
      const tag = m[0], rel = /rel=["']?([^"'>]+)/i.exec(tag)?.[1]?.toLowerCase() || '', href = /href=["']?([^"'\s>]+)/i.exec(tag)?.[1];
      if (!href || !/icon/.test(rel)) continue;
      const size = parseInt(/sizes=["']?(\d+)/i.exec(tag)?.[1] || (rel.includes('apple') ? '180' : '16'), 10);
      cands.push({ u: new URL(href.replace(/&amp;/g, '&'), baseUrl).href, size: rel.includes('mask') ? 0 : size });
    }
    cands.sort((a, b) => Math.abs(a.size - 96) - Math.abs(b.size - 96)); // perto de 96 px fica nítido sem pesar
    cands.push({ u: new URL('/favicon.ico', baseUrl).href });
  } catch (_) { try { cands.push({ u: new URL('/favicon.ico', url).href }); } catch (_) {} }
  for (const c of cands.slice(0, 5)) {
    try { const d = await toData(await get(c.u, 'image/*')); cfg.favIcons[url] = d; saveCfg(); return d; } catch (_) {}
  }
  return '';
}

// ---------- arquivos: ícones, abrir e arrastar para fora ----------
async function fileInfo(p) {
  let isDir = false, exists = true;
  try { isDir = fs.statSync(p).isDirectory(); } catch (_) { exists = false; }
  let icon = '';
  try { icon = (await app.getFileIcon(p, { size: 'large' })).toDataURL(); } catch (_) {}
  return { path: p, name: path.basename(p).replace(/\.lnk$/i, '') || p, isDir, exists, icon };
}

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

// ---------- atualização automática (GitHub Releases) ----------
// Procura 30 s depois de abrir e a cada 6 h. Baixa sozinha; instala ao reiniciar (pelo botão) ou ao sair.
const upd = { state: app.isPackaged ? 'idle' : 'dev', version: '', progress: 0, error: '', at: 0 };
let updater = null;
const updSend = () => send('update', upd);
function setupUpdater() {
  if (!app.isPackaged) return;
  try { ({ autoUpdater: updater } = require('electron-updater')); } catch (_) { upd.state = 'error'; upd.error = 'Atualizador indisponível'; return; }
  updater.autoDownload = true;
  updater.autoInstallOnAppQuit = true;
  updater.logger = null;
  let lastPct = -1;
  updater.on('checking-for-update', () => { if (upd.state !== 'ready') { upd.state = 'checking'; updSend(); } });
  updater.on('update-available', i => { upd.state = 'downloading'; upd.version = i.version; upd.progress = 0; updSend(); });
  updater.on('update-not-available', () => { upd.state = 'latest'; upd.at = Date.now(); updSend(); });
  updater.on('download-progress', p => { const pct = Math.floor(p.percent || 0); if (pct !== lastPct) { lastPct = pct; upd.progress = pct; updSend(); } });
  updater.on('update-downloaded', i => { upd.state = 'ready'; upd.version = i.version; upd.progress = 100; updSend(); });
  updater.on('error', e => { if (upd.state === 'ready') return; upd.state = 'error'; upd.error = String(e?.message || e).split('\n')[0].slice(0, 160); upd.at = Date.now(); updSend(); });
  const check = () => { if (upd.state !== 'ready' && upd.state !== 'downloading') updater.checkForUpdates().catch(() => {}); };
  setTimeout(check, 30000);
  setInterval(check, 6 * 3600e3);
  ipcMain.on('update:check', check);
}

// ---------- notificações do Windows: abrir o app que mandou ----------
function openApp(aumid) {
  aumid = String(aumid || '');
  if (!/^[^"\r\n<>|]{1,300}$/.test(aumid)) return;
  require('child_process').execFile('explorer.exe', ['shell:AppsFolder\\' + aumid], { windowsHide: true }, () => {});
}

// ---------- barra de comandos: apps do menu Iniciar, ícones e câmbio ----------
const apps = { list: null, at: 0, loading: null, icons: new Map() };
function lnkIndex() {
  // atalhos do menu Iniciar (para pegar os ícones dos apps comuns)
  const roots = [path.join(process.env.ProgramData || 'C:\\ProgramData', 'Microsoft', 'Windows', 'Start Menu', 'Programs'), path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs')];
  const map = new Map();
  const walk = (dir, depth) => {
    let ents = []; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
    for (const e of ents) {
      const p = path.join(dir, e.name);
      if (e.isDirectory() && depth < 3) walk(p, depth + 1);
      else if (/\.lnk$/i.test(e.name)) { const k = e.name.replace(/\.lnk$/i, '').toLowerCase(); if (!map.has(k)) map.set(k, p); }
    }
  };
  for (const r of roots) walk(r, 0);
  return map;
}
function loadApps() {
  if (apps.list && Date.now() - apps.at < 10 * 60e3) return Promise.resolve(apps.list);
  if (apps.loading) return apps.loading;
  apps.loading = new Promise(resolve => {
    require('child_process').execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '[Console]::OutputEncoding=[Text.Encoding]::UTF8; Get-StartApps | Select-Object Name,AppID | ConvertTo-Json -Compress'], { windowsHide: true, timeout: 20000, maxBuffer: 8e6 }, (err, out) => {
      let list = []; try { list = JSON.parse(String(out).trim() || '[]'); if (!Array.isArray(list)) list = [list]; } catch (_) {}
      const lnk = lnkIndex(), seen = new Set();
      apps.list = list.filter(a => a && a.Name && a.AppID && !/^(uninstall|desinstalar)\b/i.test(a.Name)).filter(a => { const k = a.Name.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; })
        .map(a => ({ name: String(a.Name), aumid: String(a.AppID), lnk: lnk.get(String(a.Name).toLowerCase()) || '' }));
      apps.at = Date.now(); apps.loading = null; resolve(apps.list);
    });
  });
  return apps.loading;
}
async function appIcon(a) {
  const key = a.lnk || a.aumid;
  if (apps.icons.has(key)) return apps.icons.get(key);
  let icon = '';
  try { if (a.lnk) icon = (await app.getFileIcon(a.lnk, { size: 'normal' })).toDataURL(); } catch (_) {}
  apps.icons.set(key, icon);
  return icon;
}
const fx = new Map(); // cotação por moeda de origem, guardada por 1 h
async function fxRate(from, to) {
  from = String(from).toUpperCase(); to = String(to).toUpperCase();
  if (!/^[A-Z]{3}$/.test(from) || !/^[A-Z]{3}$/.test(to)) throw new Error('moeda');
  if (from === to) return { rate: 1, date: '' };
  let c = fx.get(from);
  if (!c || Date.now() - c.at > 3600e3) {
    const r = await fetch(`https://api.frankfurter.dev/v1/latest?base=${from}`, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json();
    c = { at: Date.now(), rates: j.rates || {}, date: j.date || '' }; fx.set(from, c);
  }
  if (typeof c.rates[to] !== 'number') throw new Error('Moeda não encontrada');
  return { rate: c.rates[to], date: c.date };
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
    if ('monitor' in patch) placeWindow();
    if ('smarthouse' in patch) shEvents();
    if ('icsUrl' in patch) agendaLoop();
    if ('winNotifs' in patch) helperCmd(`notifs ${cfg.winNotifs !== false ? 1 : 0}`);
    return cfg;
  });
  // só repassa comandos conhecidos ao ajudante
  ipcMain.on('media', (_, c) => { if (/^(play|next|prev|mute|vup|vdown|setvol [01](\.\d+)?|seek \d+(\.\d+)?|radio (wifi|bt) (on|off)|radios|bright|setbright \d{1,3}|micmute)$/.test(String(c))) helperCmd(c); });
  ipcMain.handle('siteicon', (_, url) => /^https?:\/\//.test(String(url)) ? siteIcon(String(url)) : '');
  ipcMain.handle('claudeState', () => claudeSummary());
  ipcMain.on('permAnswer', (_, { id, allow }) => answerPermission(String(id), !!allow));
  ipcMain.on('print', () => takePrint());
  ipcMain.handle('agenda', () => agenda);
  // painéis do Windows: lista de redes Wi-Fi (o mesmo da barra de tarefas) e dispositivos Bluetooth
  ipcMain.on('opensys', (_, what) => { const u = { wifi: 'ms-availablenetworks:', bt: 'ms-settings:bluetooth', notifs: 'ms-settings:privacy-notifications' }[what]; if (u) shell.openExternal(u); });
  ipcMain.handle('fileinfo', (_, paths) => Promise.all((paths || []).slice(0, 50).map(p => fileInfo(String(p)))));
  ipcMain.on('openpath', (_, p) => { p = String(p); if (/^https?:\/\//.test(p)) shell.openExternal(p); else shell.openPath(p); });
  ipcMain.on('reveal', (_, p) => shell.showItemInFolder(String(p)));
  ipcMain.on('dragout', async (e, p) => {
    p = String(p); if (!fs.existsSync(p)) return;
    let icon; try { icon = await app.getFileIcon(p, { size: 'normal' }); } catch (_) { icon = nativeImage.createFromPath(path.join(__dirname, 'renderer', 'icon.png')); }
    e.sender.startDrag({ file: p, icon });
  });
  ipcMain.handle('conn', () => ({ online: conn.online, since: conn.since, outages: cfg.outages }));
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
  // atualização
  ipcMain.handle('update:get', () => upd);
  ipcMain.handle('native:last', () => Object.values(nativeLast));
  // conectar / desconectar o Claude Code
  ipcMain.handle('claudeHooks', async (_, action) => {
    try {
      if (action === 'connect') return claudeConnect();
      if (action === 'connect:ps') return claudeConnect('ps');
      if (action === 'connect:bash') return claudeConnect('bash');
      if (action === 'disconnect') return claudeDisconnect();
      if (action === 'test') return await claudeTest();
      return claudeHooksStatus();
    } catch (e) { return { ok: false, error: e.message }; }
  });
  ipcMain.on('update:install', () => { if (upd.state === 'ready' && updater) { app.isQuitting = true; updater.quitAndInstall(true, true); } });
  // notificações do Windows
  ipcMain.on('openapp', (_, aumid) => openApp(aumid));
  // barra de comandos
  ipcMain.handle('apps:list', async () => (await loadApps()).map(a => ({ name: a.name, aumid: a.aumid, hasIcon: !!a.lnk })));
  ipcMain.handle('apps:icon', async (_, aumid) => { const a = (apps.list || []).find(x => x.aumid === aumid); return a ? appIcon(a) : ''; });
  ipcMain.on('apps:launch', (_, aumid) => { if ((apps.list || []).some(x => x.aumid === aumid)) openApp(aumid); });
  ipcMain.handle('fx', (_, { from, to }) => fxRate(from, to));
  ipcMain.handle('files:search', (_, q) => searchFiles(String(q || '').slice(0, 120)));
  ipcMain.handle('files:recent', () => recentFiles(8));
  // conversor
  ipcMain.handle('conv:engines', () => officeEngines());
  ipcMain.on('conv:run', (_, req) => { const ops = ['png', 'jpg', 'webp', 'ico', 'bmp', 'compress', 'img2pdf', 'pdfmerge', 'pdf2png', 'office2pdf', 'pdf2docx']; if (req && ops.includes(req.op)) convRun(req); });
  ipcMain.handle('conv:pick', async () => {
    const { dialog } = require('electron');
    win.setAlwaysOnTop(false); // a janela de escolher arquivos aparece por cima
    const r = await dialog.showOpenDialog({ title: 'Escolha os arquivos para converter', properties: ['openFile', 'multiSelections'], filters: [{ name: 'Fotos, PDFs e documentos', extensions: [...IMG_EXT, '.pdf', ...Object.keys(OFFICE_KIND)].map(e => e.slice(1)) }, { name: 'Todos os arquivos', extensions: ['*'] }] });
    win.setAlwaysOnTop(true, 'screen-saver');
    return r.canceled ? [] : r.filePaths;
  });
  ipcMain.on('ocr:capture', () => ocrCapture());
  ipcMain.on('ocr:file', (_, p) => { p = String(p || ''); if (/\.(png|jpe?g|bmp|gif|tiff?)$/i.test(p) && fs.existsSync(p)) ocrFile(p, 'file'); });
  ipcMain.on('websearch', (_, q) => { q = String(q || '').slice(0, 500); if (q.trim()) shell.openExternal('https://www.google.com/search?q=' + encodeURIComponent(q)); });
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
  if (!cfg.claudeKey) { cfg.claudeKey = require('crypto').randomBytes(18).toString('base64url'); try { fs.writeFileSync(cfgFile(), JSON.stringify(cfg, null, 2)); } catch (_) {} }
  writeClaudeKey();
  // 1.8.2: quem conectou no modo antigo (curl pelo Git Bash) passa para o modo PowerShell, que funciona em qualquer PC.
  // Só mexe nos hooks da própria Ilha, uma vez, e guarda a cópia em settings.json.ilha-backup.
  if (!cfg.hooksPsMigrated) {
    try { const s = claudeHooksStatus(); if (s.ok && s.connected && s.style === 'bash') claudeConnect('ps'); } catch (_) {}
    cfg.hooksPsMigrated = true; saveCfg();
  }
  // versão instalada: regrava o "iniciar com o Windows" apontando para o .exe instalado
  if (app.isPackaged && cfg.startup) app.setLoginItemSettings({ openAtLogin: true });
  createWindow();
  setupIpc();
  trackCursor();
  startHelper();
  sysLoop();
  clipLoop();
  setupTray();
  connLoop();
  claudeServer();
  btBatteryLoop();
  dlWatch();
  agendaLoop();
  setTimeout(ghLoop, 15000);
  setupUpdater();
  setTimeout(loadApps, 20000); // a lista de apps fica pronta antes da primeira busca
  setTimeout(buildFileIndex, 45000); // e a lista de arquivos também (em segundo plano)
  setInterval(() => { if (Date.now() - fidx.at > 30 * 60e3) buildFileIndex(); }, 10 * 60e3);
  globalShortcut.register('Control+Alt+T', () => ocrCapture()); // copiar texto de um print
  globalShortcut.register('Control+Alt+P', () => takePrint());
  shEvents();
  globalShortcut.register('Control+Alt+Space', () => send('toggle'));
  screen.on('display-metrics-changed', placeWindow);
  screen.on('display-added', placeWindow);
  screen.on('display-removed', placeWindow);
});
app.on('second-instance', () => send('toggle'));
app.on('before-quit', () => { app.isQuitting = true; helperCmd('quit'); try { hidProc?.kill(); } catch (_) {} try { fs.writeFileSync(cfgFile(), JSON.stringify(cfg, null, 2)); } catch (_) {} });
app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', () => app.quit());
