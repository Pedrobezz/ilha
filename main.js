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
      else if (m.t === 'ready') { placeWindow(); send('native', m); }
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
function claudeServer() {
  const http = require('http');
  const srv = http.createServer((req, res) => {
    const end = (code, msg = '') => { res.writeHead(code, { 'content-type': 'text/plain' }); res.end(msg); };
    if (req.method !== 'POST' || !['/claude', '/claude/status', '/claude/permission'].includes(req.url)) return end(404);
    const key = String(req.headers['x-ilha-key'] || '');
    const same = k => !!k && key.length === k.length && require('crypto').timingSafeEqual(Buffer.from(key), Buffer.from(k));
    if (!same(cfg.claudeKey)) return end(401);
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > 256e3) req.destroy(); else chunks.push(c); });
    req.on('end', () => {
      let j = {}; try { j = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch (_) {}
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
    }
  } catch (_) {}
}
const spent = t => t.in + t.out + t.cw; // tokens novos (sem contar leitura de cache)
function claudeSummary() {
  const s = claude.current && claude.sessions.get(claude.current);
  const working = [...claude.sessions.values()].filter(x => x.working);
  return {
    working: !!s?.working, project: s?.project || '', activity: s?.activity || '', startedAt: s?.startedAt || 0, endedAt: s?.endedAt || 0,
    tokensTask: s && s.taskBase ? spent(s.tokens) - s.taskBase.spent : 0, outTask: s && s.taskBase ? s.tokens.out - s.taskBase.out : 0,
    tokensSession: s ? spent(s.tokens) : 0, cacheSession: s ? s.tokens.cr : 0,
    limits: claude.limits, ctx: claude.ctx, model: claude.model, active: working.length, log: claude.log.slice(0, 12),
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
function btBatteryLoop() {
  const script = path.join(__dirname, 'btbattery.ps1').replace('app.asar', 'app.asar.unpacked');
  require('child_process').execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script], { windowsHide: true, timeout: 30000 }, (err, out) => {
    let list = []; try { list = JSON.parse(String(out).trim() || '[]'); if (!Array.isArray(list)) list = [list]; } catch (_) {}
    const sig = JSON.stringify(list);
    if (sig !== btLast) { btLast = sig; send('btbat', list); }
    setTimeout(btBatteryLoop, 45000);
  });
}

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
function takePrint() {
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
    const dir = path.join(app.getPath('pictures'), 'Ilha');
    try { fs.mkdirSync(dir, { recursive: true }); } catch (_) {}
    const d = new Date(), pad = n => String(n).padStart(2, '0');
    const file = path.join(dir, `Print ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}.${pad(d.getMinutes())}.${pad(d.getSeconds())}.png`);
    try { fs.writeFileSync(file, img.toPNG()); } catch (_) { return; }
    cfg.shelf = [...(cfg.shelf || []), file].slice(-40); saveCfg();
    send('printed', { path: file, shelf: cfg.shelf });
  }, 400);
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
  ipcMain.on('opensys', (_, what) => { const u = { wifi: 'ms-availablenetworks:', bt: 'ms-settings:bluetooth' }[what]; if (u) shell.openExternal(u); });
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
  // a chave também vai para ~/.ilha/claude-key, que o hook do Claude Code lê na hora de enviar.
  // (fora do %APPDATA% de propósito: apps empacotados, como o Claude para Windows, enxergam outra cópia do %APPDATA%)
  try {
    const dir = path.join(os.homedir(), '.ilha');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'claude-key'), cfg.claudeKey);
  } catch (_) {}
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
  globalShortcut.register('Control+Alt+P', () => takePrint());
  shEvents();
  globalShortcut.register('Control+Alt+Space', () => send('toggle'));
  screen.on('display-metrics-changed', placeWindow);
  screen.on('display-added', placeWindow);
  screen.on('display-removed', placeWindow);
});
app.on('second-instance', () => send('toggle'));
app.on('before-quit', () => { app.isQuitting = true; helperCmd('quit'); try { fs.writeFileSync(cfgFile(), JSON.stringify(cfg, null, 2)); } catch (_) {} });
app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', () => app.quit());
