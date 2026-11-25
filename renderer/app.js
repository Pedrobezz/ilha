// Ilha · interface
const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const isl = $('#island');
const WIN_W = 900;
const SIZES = { home: [780, 318], net: [760, 352], sys: [760, 360], casa: [790, 384], tools: [760, 332], set: [700, 480] };
const COLLAPSED = [196, 32];
const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (_) { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} };
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

const S = {
  open: false, hover: false, focused: false, covered: false, tab: lsGet('tab', 'home'),
  cfg: {}, media: null, alert: null, size: COLLAPSED,
  speed: { running: false, phase: '', value: 0 },
  timer: { total: 25 * 60, left: 25 * 60, running: false, endAt: 0 },
  sh: null, shErr: '', battery: null,
};

/* =================== estado da ilha =================== */
function activity() {
  const t = S.timer;
  if (t.running || (t.left < t.total && t.left > 0)) return 'timer';
  if (S.speed.running) return 'speed';
  if (S.media?.has && S.media.playing) return 'media';
  return null;
}

function render() {
  let mode, size;
  if (S.alert) { mode = 'alerting'; size = [400, 84]; }
  else if (S.open) { mode = 'expanded'; size = SIZES[S.tab]; }
  else if (activity()) { mode = 'compact'; size = [activity() === 'speed' ? 290 : 270, 34]; }
  else { mode = 'collapsed'; size = COLLAPSED; }
  const hidden = S.covered && (mode === 'collapsed' || mode === 'compact');
  isl.className = mode + (hidden ? ' hidden-top' : '');
  isl.style.setProperty('--w', size[0] + 'px');
  isl.style.setProperty('--h', size[1] + 'px');
  S.size = size;
  // escondida: só a borda de cima da tela (1 px) abre a ilha, para não atrapalhar as abas do Chrome
  if (hidden) window.ilha.setRect({ x: (WIN_W - COLLAPSED[0]) / 2, y: 0, w: COLLAPSED[0], h: 1, edge: true });
  else window.ilha.setRect({ x: (WIN_W - size[0]) / 2, y: 0, w: size[0], h: size[1] });
  if (mode === 'compact') renderCompact();
}

let openT, closeT;
function open(focus) {
  clearTimeout(closeT);
  if (!S.open) { S.open = true; render(); onTabShown(); }
  if (focus && !S.focused) { S.focused = true; window.ilha.focus(true); }
}
function close() {
  clearTimeout(openT); clearTimeout(closeT);
  if (S.focused) { S.focused = false; document.activeElement?.blur(); window.ilha.focus(false); }
  if (S.open) { S.open = false; render(); }
}
window.ilha.onHover(h => {
  S.hover = h;
  clearTimeout(openT); clearTimeout(closeT);
  // escondida, precisa "encostar" um instante na borda: uma passada rápida para clicar numa aba não abre
  if (h) { if (S.alert) return; openT = setTimeout(() => open(), S.open ? 0 : isl.classList.contains('hidden-top') ? 260 : 70); }
  else if (S.open && !S.focused) closeT = setTimeout(close, 380);
});
window.ilha.onBlur(() => { if (S.focused) { S.focused = false; window.ilha.focus(false); } if (!S.hover) close(); });
window.ilha.onToggle(() => (S.open ? close() : open(true)));
window.ilha.onCovered(c => { S.covered = c; render(); });
window.ilha.onCfg(c => { S.cfg = { ...S.cfg, ...c }; fillSettings(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });

// campos de texto: a janela só pega o foco quando precisa digitar
document.addEventListener('mousedown', e => {
  const el = e.target.closest('input:not([type=checkbox]):not([type=range]), textarea');
  if (!el) return;
  if (!S.focused) { S.focused = true; window.ilha.focus(true); setTimeout(() => el.focus(), 40); }
});

/* =================== abas =================== */
function setTab(tab, instant) {
  S.tab = tab; lsSet('tab', tab);
  isl.dataset.tab = tab;
  $$('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
  $$('.page').forEach(p => p.classList.toggle('on', p.dataset.page === tab));
  movePill(instant);
  if (S.open) { render(); onTabShown(); }
}
function movePill(instant) {
  const b = $(`#tabs button[data-tab="${S.tab}"]`), pill = $('.tab-pill');
  if (!b) return;
  if (instant) pill.style.transition = 'none';
  pill.style.left = b.offsetLeft + 'px'; pill.style.width = b.offsetWidth + 'px';
  if (instant) requestAnimationFrame(() => (pill.style.transition = ''));
}
$$('#tabs button').forEach(b => b.addEventListener('click', () => setTab(b.dataset.tab)));
$$('[data-go]').forEach(b => b.addEventListener('click', () => { setTab(b.dataset.go); if (b.dataset.go === 'net' && !S.speed.running) window.ilha.speedStart(); }));
function onTabShown() {
  if (S.tab === 'casa') loadCasa();
  if (S.tab === 'sys') window.ilha.disk();
}

/* =================== aviso e alerta =================== */
let toastT;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.style.transform = `translate(-50%, ${S.size[1] + 12}px)`;
  t.classList.add('show');
  clearTimeout(toastT); toastT = setTimeout(() => { t.classList.remove('show'); t.style.transform = 'translate(-50%, -40px)'; }, 1600);
}
let alertT;
function showAlert(title, body, icon) {
  S.alert = { title, body };
  $('#alert .a-text b').textContent = title;
  $('#alert .a-text span').textContent = body;
  $('#alert .a-icon').innerHTML = icon;
  S.open = false; render();
  clearTimeout(alertT); alertT = setTimeout(dismissAlert, 12000);
}
function dismissAlert() { S.alert = null; render(); }
$('#alert .a-btn').addEventListener('click', dismissAlert);

function chime() {
  try {
    const ac = new AudioContext();
    [[880, 0], [1318.5, .16], [1760, .32]].forEach(([f, t]) => {
      const o = ac.createOscillator(), g = ac.createGain();
      o.type = 'sine'; o.frequency.value = f;
      g.gain.setValueAtTime(0, ac.currentTime + t);
      g.gain.linearRampToValueAtTime(.18, ac.currentTime + t + .02);
      g.gain.exponentialRampToValueAtTime(.001, ac.currentTime + t + .9);
      o.connect(g).connect(ac.destination); o.start(ac.currentTime + t); o.stop(ac.currentTime + t + 1);
    });
  } catch (_) {}
}

/* =================== relógio =================== */
function tickClock() {
  const d = new Date();
  const hm = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  $('#clock').textContent = hm;
  $('#bar-time').textContent = hm;
  $('#date').textContent = d.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
  const key = d.toDateString();
  if ($('#week').dataset.k !== key) {
    $('#week').dataset.k = key;
    const start = new Date(d); start.setDate(d.getDate() - d.getDay());
    $('#week').innerHTML = Array.from({ length: 7 }, (_, i) => {
      const x = new Date(start); x.setDate(start.getDate() + i);
      return `<div class="${i === d.getDay() ? 'today' : ''}">${'DSTQQSS'[i]}<b>${x.getDate()}</b></div>`;
    }).join('');
  }
}
setInterval(tickClock, 1000); tickClock();

/* =================== clima (Open-Meteo, sem cadastro) =================== */
const WX = {
  sun: '<svg viewBox="0 0 48 48"><circle cx="24" cy="24" r="8" fill="#ffd60a" stroke="#ffd60a"/><g stroke="#ffd60a"><path d="M24 6v4M24 38v4M6 24h4M38 24h4M11.3 11.3l2.8 2.8M33.9 33.9l2.8 2.8M11.3 36.7l2.8-2.8M33.9 14.1l2.8-2.8"/></g></svg>',
  moon: '<svg viewBox="0 0 48 48"><path d="M34 29.5A13 13 0 0 1 18.5 14a13 13 0 1 0 15.5 15.5z" fill="#ffe58f" stroke="#ffe58f"/></svg>',
  partly: '<svg viewBox="0 0 48 48"><circle cx="18" cy="17" r="7" fill="#ffd60a" stroke="#ffd60a"/><g stroke="#ffd60a"><path d="M18 4v3M7 8l2 2M4 17h3M29 8l-2 2"/></g><path d="M16 38h18a7 7 0 0 0 0-14 10 10 0 0 0-19 3 5.5 5.5 0 0 0 1 11z" fill="#e5e5ea" stroke="#e5e5ea"/></svg>',
  cloud: '<svg viewBox="0 0 48 48"><path d="M14 36h20a8 8 0 0 0 0-16 11 11 0 0 0-21 3.5A6.3 6.3 0 0 0 14 36z" fill="#d1d1d6" stroke="#d1d1d6"/></svg>',
  fog: '<svg viewBox="0 0 48 48"><g stroke="#c7c7cc" stroke-width="3"><path d="M8 18h32M12 25h26M8 32h32M14 39h20"/></g></svg>',
  rain: '<svg viewBox="0 0 48 48"><path d="M14 28h20a8 8 0 0 0 0-16 11 11 0 0 0-21 3.5A6.3 6.3 0 0 0 14 28z" fill="#d1d1d6" stroke="#d1d1d6"/><g stroke="#64d2ff" stroke-width="2.5"><path d="M16 33l-2 6M24 33l-2 6M32 33l-2 6"/></g></svg>',
  storm: '<svg viewBox="0 0 48 48"><path d="M14 28h20a8 8 0 0 0 0-16 11 11 0 0 0-21 3.5A6.3 6.3 0 0 0 14 28z" fill="#aeaeb2" stroke="#aeaeb2"/><path d="M25 30l-5 8h6l-4 8" stroke="#ffd60a" stroke-width="2.5"/></svg>',
  snow: '<svg viewBox="0 0 48 48"><path d="M14 28h20a8 8 0 0 0 0-16 11 11 0 0 0-21 3.5A6.3 6.3 0 0 0 14 28z" fill="#e5e5ea" stroke="#e5e5ea"/><g fill="#fff" stroke="none"><circle cx="16" cy="36" r="2"/><circle cx="24" cy="40" r="2"/><circle cx="32" cy="36" r="2"/></g></svg>',
};
function wxInfo(code, day) {
  if (code === 0) return [day ? 'sun' : 'moon', 'Céu limpo'];
  if (code === 1) return [day ? 'sun' : 'moon', 'Predominantemente limpo'];
  if (code === 2) return ['partly', 'Parcialmente nublado'];
  if (code === 3) return ['cloud', 'Nublado'];
  if (code === 45 || code === 48) return ['fog', 'Neblina'];
  if (code >= 51 && code <= 57) return ['rain', 'Garoa'];
  if (code >= 61 && code <= 67) return ['rain', 'Chuva'];
  if (code >= 71 && code <= 77) return ['snow', 'Neve'];
  if (code >= 80 && code <= 82) return ['rain', 'Pancadas de chuva'];
  if (code >= 85 && code <= 86) return ['snow', 'Neve'];
  if (code >= 95) return ['storm', 'Tempestade'];
  return ['cloud', '—'];
}
async function loadWeather(force) {
  const cached = lsGet('wx', null);
  if (!force && cached && Date.now() - cached.at < 15 * 60e3 && cached.city === (S.cfg.city || '')) return showWeather(cached);
  try {
    let lat, lon, name;
    if (S.cfg.city) {
      const g = await (await fetch(`https://geocoding-api.open-meteo.com/v1/search?count=1&language=pt&name=${encodeURIComponent(S.cfg.city)}`)).json();
      const r = g.results?.[0]; if (!r) throw new Error('Cidade não encontrada');
      lat = r.latitude; lon = r.longitude; name = r.name;
    } else {
      const m = await window.ilha.meta();
      if (!m?.latitude) throw new Error('sem localização');
      lat = m.latitude; lon = m.longitude; name = m.city || '';
    }
    const w = await (await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code,is_day,apparent_temperature,relative_humidity_2m&daily=temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=1`)).json();
    const data = { at: Date.now(), city: S.cfg.city || '', name, t: w.current.temperature_2m, code: w.current.weather_code, day: w.current.is_day, feels: w.current.apparent_temperature, hum: w.current.relative_humidity_2m, max: w.daily.temperature_2m_max[0], min: w.daily.temperature_2m_min[0] };
    lsSet('wx', data); showWeather(data);
  } catch (e) {
    $('#weather .w-desc').textContent = e.message === 'Cidade não encontrada' ? e.message : 'Clima indisponível';
  }
}
function showWeather(d) {
  const [ic, label] = wxInfo(d.code, d.day);
  $('#weather .w-icon').innerHTML = WX[ic];
  $('#weather .w-temp').textContent = Math.round(d.t) + '°';
  $('#weather .w-desc').textContent = label;
  $('#weather').title = `Sensação de ${Math.round(d.feels)}° · umidade ${d.hum}%`;
  $('#weather .w-city').textContent = d.name;
  $('#weather .w-mm').textContent = `↑${Math.round(d.max)}° ↓${Math.round(d.min)}°`;
}
setInterval(() => loadWeather(), 15 * 60e3);

/* =================== mídia =================== */
const fmtT = s => { s = Math.max(0, Math.round(s || 0)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const APPS = { spotify: 'Spotify', chrome: 'Google Chrome', msedge: 'Microsoft Edge', firefox: 'Firefox', zunemusic: 'Media Player', 'microsoft.zunemusic': 'Media Player', vlc: 'VLC', opera: 'Opera', brave: 'Brave', discord: 'Discord' };
function appName(id) {
  const k = String(id || '').toLowerCase();
  for (const [key, v] of Object.entries(APPS)) if (k.includes(key)) return v;
  return String(id || '').replace(/\.exe$/i, '').split(/[!_]/)[0];
}
function setMedia(m) {
  const prevKey = S.media ? S.media.title + S.media.artist : '';
  S.media = m.has ? { ...m, at: Date.now() } : null;
  const card = $('#media');
  card.classList.toggle('playing', !!S.media?.playing);
  $('#media .eq').classList.toggle('on', !!S.media?.playing);
  if (!S.media) {
    $('.m-title').textContent = 'Nada tocando'; $('.m-artist').textContent = 'Abra uma música ou vídeo'; $('.m-app').textContent = '';
    $('.m-art').classList.remove('has'); card.style.removeProperty('--art-bg');
  } else {
    $('.m-title').textContent = m.title || 'Sem título';
    $('.m-artist').textContent = m.artist || m.album || '—';
    $('.m-app').textContent = appName(m.app);
    if (prevKey !== m.title + m.artist || m.art) {
      const img = $('.m-art img');
      if (m.art) { img.src = m.art; $('.m-art').classList.add('has'); card.style.setProperty('--art-bg', `url("${m.art}")`); }
      else { $('.m-art').classList.remove('has'); card.style.removeProperty('--art-bg'); }
    }
  }
  tickMedia(); render();
}
function mediaPos() {
  const m = S.media; if (!m) return 0;
  return clamp(m.pos + (m.playing ? (Date.now() - m.at) / 1000 : 0), 0, m.end || 1e9);
}
function tickMedia() {
  const m = S.media;
  const pos = mediaPos(), end = m?.end || 0;
  $('.m-pos').textContent = fmtT(pos); $('.m-end').textContent = end ? '-' + fmtT(end - pos) : '0:00';
  $('.track i').style.width = end ? (100 * pos / end) + '%' : '0%';
}
setInterval(tickMedia, 1000);
$$('[data-m]').forEach(b => b.addEventListener('click', () => {
  const c = b.dataset.m;
  window.ilha.media(c);
  if (c === 'play' && S.media) { S.media.pos = mediaPos(); S.media.at = Date.now(); S.media.playing = !S.media.playing; setMedia({ ...S.media, has: true }); }
}));

/* =================== atividade compacta =================== */
const IC = {
  timer: '<svg viewBox="0 0 24 24"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2.5M9.5 2.5h5"/></svg>',
  gauge: '<svg viewBox="0 0 24 24"><path d="M12 13.5 16.5 9"/><path d="M3.5 17a9 9 0 1 1 17 0"/></svg>',
  note: '<svg viewBox="0 0 24 24"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>',
};
function renderCompact() {
  const a = activity(), L = $('#compact .c-left'), R = $('#compact .c-right');
  if (a === 'timer') {
    if (L.dataset.k !== 'timer') { L.innerHTML = `<span class="c-ico" style="background:rgba(255,159,10,.22);color:#ff9f0a">${IC.timer}</span><span style="color:#ff9f0a">${S.timer.running ? 'Foco' : 'Pausado'}</span>`; L.dataset.k = 'timer'; }
    L.lastChild.textContent = S.timer.running ? 'Foco' : 'Pausado';
    R.innerHTML = `<b style="color:#ff9f0a">${fmtT(S.timer.left)}</b>`;
  } else if (a === 'speed') {
    if (L.dataset.k !== 'speed') { L.innerHTML = `<span class="c-ico" style="background:rgba(10,132,255,.25);color:#64d2ff">${IC.gauge}</span><span style="color:#64d2ff"></span>`; L.dataset.k = 'speed'; }
    L.lastChild.textContent = { ping: 'Ping', down: 'Download', up: 'Upload' }[S.speed.phase] || 'Testando';
    R.innerHTML = S.speed.phase === 'ping' ? `<b>${Math.round(S.speed.value)}</b><span style="color:var(--t3)">ms</span>` : `<b>${fmtNum(S.speed.value)}</b><span style="color:var(--t3)">Mbps</span>`;
  } else if (a === 'media') {
    const art = S.media.art;
    const k = 'media' + (art ? art.length : 0) + S.media.title;
    if (L.dataset.k !== k) { L.innerHTML = art ? `<img src="${art}" alt="">` : `<span class="c-ico" style="background:rgba(255,55,95,.22);color:#ff6482">${IC.note}</span>`; L.dataset.k = k; }
    if (R.dataset.k !== 'eq') { R.innerHTML = '<div class="eq on"><i></i><i></i><i></i><i></i></div>'; R.dataset.k = 'eq'; }
    return;
  }
  R.dataset.k = '';
}

/* =================== sistema =================== */
const hist = { cpu: [], mem: [], down: [], up: [] };
const push = (a, v) => { a.push(v); if (a.length > 60) a.shift(); };
function spark(id, data, max) {
  const n = 60, m = max || Math.max(1, ...data);
  const pts = data.map((v, i) => [((n - data.length + i) / (n - 1)) * 100, 32 - (v / m) * 29]);
  if (pts.length < 2) return;
  const d = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(2) + ' ' + p[1].toFixed(2)).join(' ');
  $('#' + id).setAttribute('d', d);
  const f = $('#' + id + '-f'); if (f) f.setAttribute('d', `${d} L100 34 L${pts[0][0].toFixed(2)} 34 Z`);
}
function setRing(id, pct, label) {
  const r = $('#' + id);
  r.querySelector('.v').style.strokeDashoffset = 113.1 * (1 - clamp(pct, 0, 100) / 100);
  r.querySelector('b').textContent = label ?? Math.round(pct) + '%';
}
const fmtBytes = b => { const u = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0; while (b >= 1024 && i < u.length - 1) { b /= 1024; i++; } return (b >= 100 || i === 0 ? Math.round(b) : b.toFixed(1)).toString().replace('.', ',') + ' ' + u[i]; };
const fmtRate = bps => { if (bps < 1024 * 1024) return [Math.round(bps / 1024), 'KB/s']; return [(bps / 1048576).toFixed(1).replace('.', ','), 'MB/s']; };
const fmtNum = v => (v >= 100 ? Math.round(v) : v >= 10 ? v.toFixed(1) : v.toFixed(2)).toString().replace('.', ',');
function fmtUptime(s) { const d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60); return d ? `${d}d ${h}h` : h ? `${h}h ${m}min` : `${m} min`; }

window.ilha.onSys(s => {
  const memPct = 100 * s.memUsed / s.memTotal;
  push(hist.cpu, s.cpu); push(hist.mem, memPct);
  setRing('ring-cpu', s.cpu); setRing('ring-mem', memPct);
  if (!S.open || S.tab !== 'sys') return;
  $('#s-cpu').textContent = Math.round(s.cpu) + '%';
  $('#s-mem').textContent = Math.round(memPct) + '%';
  $('#s-cpuname').textContent = s.cpuName;
  $('#s-memtxt').textContent = `${fmtBytes(s.memUsed)} de ${fmtBytes(s.memTotal)}`;
  $('#s-host').textContent = s.host; $('#s-ip').textContent = s.ip || '–'; $('#s-up').textContent = fmtUptime(s.uptime); $('#s-cores').textContent = s.cores;
  spark('sp-cpu', hist.cpu, 100); spark('sp-mem', hist.mem, 100);
});
window.ilha.onNative(m => {
  if (m.t === 'media') setMedia(m);
  else if (m.t === 'net') {
    push(hist.down, m.down); push(hist.up, m.up);
    const [d, du] = fmtRate(m.down), [u, uu] = fmtRate(m.up);
    $('#h-down').textContent = d; $('#h-down-u').textContent = du; $('#h-up').textContent = u; $('#h-up-u').textContent = uu;
    if (S.open && S.tab === 'sys') {
      $('#s-net').textContent = `${d} ${du}`; $('#s-nettxt').textContent = `↓ ${d} ${du} · ↑ ${u} ${uu}`;
      const mx = Math.max(1, ...hist.down, ...hist.up);
      spark('sp-net', hist.down, mx); spark('sp-netu', hist.up, mx);
    }
  } else if (m.t === 'disk') {
    $('#disks').innerHTML = (m.drives || []).slice(0, 3).map(d => `<div class="disk"><div><b>Disco ${esc(d.name)}:</b><span>${fmtBytes(d.total - d.used)} livres</span></div><div class="bar-t"><i style="width:${(100 * d.used / d.total).toFixed(1)}%"></i></div></div>`).join('');
  }
});
async function initBattery() {
  try {
    const b = await navigator.getBattery();
    const upd = () => {
      const has = !(b.charging && b.level === 1 && b.chargingTime === 0) || b.dischargingTime !== Infinity;
      S.battery = has ? { level: b.level, charging: b.charging } : null;
      const p = Math.round(b.level * 100);
      if (S.battery) {
        setRing('ring-bat', p, p + '%');
        $('#s-bat').textContent = p + '%';
        $('#s-batfill').style.width = p + '%';
        $('#s-batfill').style.background = p <= 20 && !b.charging ? 'var(--red)' : 'var(--green)';
        $('#s-battxt').textContent = b.charging ? (b.chargingTime && isFinite(b.chargingTime) ? `Carregando · cheia em ${fmtUptime(b.chargingTime)}` : 'Carregando') : (isFinite(b.dischargingTime) ? `Restam ${fmtUptime(b.dischargingTime)}` : 'Na bateria');
        $('#bar-status').innerHTML = `<span class="bat-mini">${b.charging ? '⚡' : ''}${p}%</span>`;
      } else {
        setRing('ring-bat', 100, '∞'); $('#ring-bat span').textContent = 'Tomada';
        $('#s-bat').textContent = 'Tomada'; $('#s-batfill').style.width = '100%'; $('#s-batfill').style.background = 'linear-gradient(90deg, rgba(48,209,88,.55), rgba(48,209,88,.85))';
        $('#s-battxt').textContent = 'Ligado na energia (PC de mesa)';
        $('#bar-status').innerHTML = '<svg viewBox="0 0 24 24"><path d="M2 8.5a15 15 0 0 1 20 0M5.5 12.5a10 10 0 0 1 13 0M9 16.3a5 5 0 0 1 6 0"/><circle cx="12" cy="19.5" r=".8" fill="currentColor"/></svg>';
      }
    };
    ['levelchange', 'chargingchange', 'dischargingtimechange'].forEach(e => b.addEventListener(e, upd));
    upd();
  } catch (_) {}
}

/* =================== teste de internet =================== */
const TICKS = [0, 5, 10, 25, 50, 100, 250, 500, 1000];
const gFrac = v => {
  if (v <= 0) return 0;
  for (let i = 1; i < TICKS.length; i++) if (v <= TICKS[i]) return (i - 1 + (v - TICKS[i - 1]) / (TICKS[i] - TICKS[i - 1])) / (TICKS.length - 1);
  return 1;
};
(function drawTicks() {
  const g = $('.g-ticks'); let h = '';
  TICKS.forEach((v, i) => {
    const a = (135 + 270 * i / (TICKS.length - 1)) * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
    h += `<line x1="${100 + 68 * c}" y1="${100 + 68 * s}" x2="${100 + 72 * c}" y2="${100 + 72 * s}"/>`;
    h += `<text x="${100 + 59 * c}" y="${100 + 59 * s + 3}">${v}</text>`;
  });
  g.innerHTML = h;
  $$('.gauge path').forEach(p => p.setAttribute('pathLength', '100'));
})();
let gShown = 0, gTarget = 0, numShown = 0, numTarget = 0, rafOn = false;
function gaugeLoop() {
  gShown += (gTarget - gShown) * .18; numShown += (numTarget - numShown) * .2;
  const dash = `${(gShown * 100).toFixed(2)} 101`;
  $('.gauge').classList.toggle('zero', gShown < .004);
  $('.g-val').style.strokeDasharray = dash; $('.g-glow').style.strokeDasharray = dash;
  $('#g-num').textContent = S.speed.phase === 'ping' || S.speed.phase === 'pingDone' ? Math.round(numShown) : fmtNum(numShown);
  if (Math.abs(gTarget - gShown) > .001 || Math.abs(numTarget - numShown) > .01) requestAnimationFrame(gaugeLoop);
  else rafOn = false;
}
function setGauge(frac, num) { gTarget = frac; numTarget = num; if (!rafOn) { rafOn = true; requestAnimationFrame(gaugeLoop); } }
function stCard(id, val, active) {
  const c = $('#' + id), b = c.querySelector('b');
  if (val != null) { b.textContent = val; b.classList.toggle('ph', val === '–'); }
  if (active != null) c.classList.toggle('active', active);
}
$$('.st-card b').forEach(b => b.classList.add('ph'));

$('#st-btn').addEventListener('click', () => (S.speed.running ? window.ilha.speedCancel() : window.ilha.speedStart()));
window.ilha.onSpeed(e => {
  const sp = S.speed; sp.phase = e.phase;
  const btn = $('#st-btn');
  switch (e.phase) {
    case 'start':
      sp.running = true; btn.classList.add('running'); btn.firstChild.textContent = 'Cancelar';
      ['st-ping', 'st-jit', 'st-down', 'st-up'].forEach(id => stCard(id, '–', false));
      $('.gauge').classList.remove('up'); $('#g-phase').textContent = 'Conectando'; $('#g-unit').textContent = 'ms'; setGauge(0, 0);
      break;
    case 'meta': {
      const m = e.meta || {};
      if (m.asOrganization) $('#isp span').textContent = `${m.asOrganization} · ${m.city || ''}${m.colo ? ' · servidor ' + m.colo : ''}`;
      break;
    }
    case 'ping': sp.value = e.value; $('#g-phase').textContent = 'Ping'; $('#g-unit').textContent = 'ms'; stCard('st-ping', Math.round(e.value), true); setGauge(0, e.value); break;
    case 'pingDone': stCard('st-ping', Math.round(e.ping), false); stCard('st-jit', Math.round(e.jitter)); break;
    case 'down': sp.value = e.value; $('#g-phase').textContent = 'Download'; $('#g-unit').textContent = 'Mbps'; stCard('st-down', fmtNum(e.value), true); setGauge(gFrac(e.value), e.value); break;
    case 'downDone': stCard('st-down', fmtNum(e.down), false); setGauge(0, 0); $('.gauge').classList.add('up'); break;
    case 'up': sp.value = e.value; $('#g-phase').textContent = 'Upload'; stCard('st-up', fmtNum(e.value), true); setGauge(gFrac(e.value), e.value); break;
    case 'done': {
      const r = e.result;
      sp.running = false; btn.classList.remove('running'); btn.firstChild.textContent = 'Testar de novo';
      stCard('st-up', fmtNum(r.up), false); $('.gauge').classList.remove('up');
      $('#g-phase').textContent = 'Download'; $('#g-unit').textContent = 'Mbps'; sp.phase = 'done'; setGauge(gFrac(r.down), r.down);
      renderHistory(e.history);
      if (!S.open) showAlert('Teste concluído', `↓ ${fmtNum(r.down)} Mbps · ↑ ${fmtNum(r.up)} Mbps · ${Math.round(r.ping)} ms`, `<span style="color:#64d2ff">${IC.gauge}</span>`);
      break;
    }
    case 'error': case 'cancelled':
      sp.running = false; btn.classList.remove('running'); btn.firstChild.textContent = 'Iniciar';
      $('.gauge').classList.remove('up'); setGauge(0, 0);
      ['st-ping', 'st-jit', 'st-down', 'st-up'].forEach(id => stCard(id, null, false));
      $('#g-phase').textContent = e.phase === 'error' ? 'Sem conexão' : 'Cancelado';
      if (e.phase === 'error') $('#isp span').textContent = 'Não foi possível alcançar o servidor de teste.';
      break;
  }
  render();
});
function renderHistory(h) {
  h = h || [];
  if (!h.length) { $('#hist').innerHTML = ''; return; }
  const max = Math.max(...h.map(x => x.down), 1);
  $('#hist').innerHTML = '<div class="hist-h">Histórico</div>' + h.slice(0, 5).map(x => {
    const d = new Date(x.at);
    return `<div class="hist-row"><span>${d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span><div class="hb"><i style="width:${(100 * x.down / max).toFixed(0)}%"></i></div><span>↓ <b>${fmtNum(x.down)}</b></span><span>↑ <b>${fmtNum(x.up)}</b></span><span><b>${Math.round(x.ping)}</b> ms</span></div>`;
  }).join('');
}

/* =================== casa (SmartHouse) =================== */
const DIC = {
  plug: '<svg viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="5"/><path d="M10 10v2M14 10v2M12 15v.5"/></svg>',
  switch: '<svg viewBox="0 0 24 24"><path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3.6 10.8c.6.5 1 1.2 1 2V16h5.2v-.2c0-.8.4-1.5 1-2A6 6 0 0 0 12 3z"/></svg>',
  ac: '<svg viewBox="0 0 24 24"><path d="M12 2v20M4.9 6l14.2 12M4.9 18 19.1 6M9.5 4 12 6.5 14.5 4M9.5 20l2.5-2.5 2.5 2.5"/></svg>',
  tv: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="12" rx="2"/><path d="M8 21h8"/></svg>',
  light: '<svg viewBox="0 0 24 24"><path d="M8 3h8l3 8H5z"/><path d="M12 11v8M8 21h8"/></svg>',
  scene: '<svg viewBox="0 0 24 24"><path d="M12 3l1.9 5.6L19.5 10l-5.6 1.9L12 17.5l-1.9-5.6L4.5 10l5.6-1.4z"/></svg>',
};
const AC_MODE = { COOL: 'Refrigerar', HEAT: 'Aquecer', AUTO: 'Automático', AIR_DRY: 'Desumidificar', FAN: 'Ventilar', cool: 'Refrigerar', heat: 'Aquecer', auto: 'Automático', dry: 'Desumidificar', fan: 'Ventilar' };
let casaT = null, casaBusy = false;
async function loadCasa() {
  clearTimeout(casaT);
  if (casaBusy) return;
  casaBusy = true;
  try {
    const a = await window.ilha.sh({ route: 'all' });
    S.sh = a; S.shErr = '';
    renderCasa();
  } catch (e) {
    const msg = String(e.message || e).replace(/^Error invoking remote method 'sh': (Error: )?/, '');
    S.shErr = msg;
    if (msg === 'NOCONFIG' || !S.sh) { $('#casa-setup').classList.add('show'); $('#casa-main').classList.remove('show'); $('#sh-err').textContent = msg === 'NOCONFIG' ? '' : msg; }
    else { $('.casa-stat').classList.add('err'); $('#sh-count').textContent = 'sem conexão'; }
  } finally { casaBusy = false; }
  if (S.open && S.tab === 'casa') casaT = setTimeout(loadCasa, 4000);
}
function devState(d) {
  const s = d.state || {};
  if (d.online === false) return 'Offline';
  if (d.type === 'ac') return s.on ? `${AC_MODE[s.mode] || 'Ligado'}${typeof s.current === 'number' ? ` · ${Math.round(s.current)}° agora` : ''}` : 'Desligado';
  if (s.channels?.length > 1) { const n = s.channels.filter(c => c.on).length; return n ? `${n} de ${s.channels.length} ligadas` : 'Desligado'; }
  if (s.on && typeof s.power === 'number' && s.power > 0) return `${Math.round(s.power)} W`;
  return s.on ? 'Ligado' : 'Desligado';
}
function renderCasa() {
  $('#casa-setup').classList.remove('show'); $('#casa-main').classList.add('show'); $('.casa-stat').classList.remove('err');
  const devs = (S.sh.devices || []).filter(d => ['plug', 'switch', 'ac', 'tv', 'light'].includes(d.type));
  const watts = devs.reduce((a, d) => a + (d.state?.on && typeof d.state.power === 'number' ? d.state.power : 0), 0);
  const onN = devs.filter(d => d.state?.on && d.online !== false).length;
  $('#sh-power').textContent = `${Math.round(watts)} W`;
  $('#sh-count').textContent = `${onN} ligado${onN === 1 ? '' : 's'}`;
  $('#sh-scenes').innerHTML = (S.sh.scenes || []).map(s => `<button class="scene" data-scene="${esc(s.id)}">${DIC.scene}${esc(s.name)}</button>`).join('');
  if (!devs.length) { $('#sh-devs').innerHTML = '<div class="empty">Nenhum aparelho encontrado no SmartHouse.</div>'; return; }
  devs.sort((a, b) => String(a.room || '').localeCompare(String(b.room || '')) || a.name.localeCompare(b.name));
  $('#sh-devs').innerHTML = devs.map(d => {
    const s = d.state || {}, on = !!s.on && d.online !== false;
    const extra = d.type === 'ac'
      ? `<div class="ac-ctl"><button data-temp="-1">−</button><b>${s.target ?? '–'}°</b><button data-temp="1">+</button></div>`
      : s.channels?.length > 1 ? `<div class="gangs">${s.channels.map(c => `<i class="${c.on ? 'on' : ''}" data-ch="${esc(c.code)}" title="${esc(c.name || c.code)}"></i>`).join('')}</div>` : '';
    return `<div role="button" class="dev t-${esc(d.type)} ${on ? 'on' : ''} ${d.online === false ? 'off-line' : ''}" data-id="${esc(d.id)}"><span class="d-ico">${DIC[d.type] || DIC.plug}</span>${extra}<div><div class="d-name">${esc(d.name)}</div><div class="d-st">${esc(devState(d))}</div></div></div>`;
  }).join('');
}
async function shCmd(id, cmd) {
  try { await window.ilha.sh({ method: 'POST', route: 'command', body: { id, cmd } }); }
  catch (e) { toast(String(e.message).replace(/^Error invoking remote method 'sh': (Error: )?/, '')); }
  setTimeout(loadCasa, 400);
}
$('#sh-devs').addEventListener('click', e => {
  const tile = e.target.closest('.dev'); if (!tile || tile.classList.contains('off-line')) return;
  const d = S.sh?.devices.find(x => x.id === tile.dataset.id); if (!d) return;
  const t = e.target.closest('[data-temp]'), ch = e.target.closest('[data-ch]');
  if (t) { const v = clamp((d.state.target || 24) + Number(t.dataset.temp), 16, 30); d.state.target = v; renderCasa(); return shCmd(d.id, { action: 'temp', value: v }); }
  if (ch) { const c = d.state.channels.find(x => x.code === ch.dataset.ch); c.on = !c.on; d.state.on = d.state.channels.some(x => x.on); renderCasa(); return shCmd(d.id, { action: 'channel', code: c.code, value: c.on }); }
  d.state.on = !d.state.on; if (d.state.channels) d.state.channels.forEach(c => (c.on = d.state.on));
  renderCasa();
  shCmd(d.id, { action: 'power', value: d.state.on });
});
$('#sh-scenes').addEventListener('click', async e => {
  const b = e.target.closest('[data-scene]'); if (!b) return;
  b.classList.add('ran'); setTimeout(() => b.classList.remove('ran'), 900);
  try { await window.ilha.sh({ method: 'POST', route: 'scene', body: { id: b.dataset.scene } }); toast(`Cena “${b.textContent}” ativada`); }
  catch (err) { toast('Não consegui ativar a cena'); }
  setTimeout(loadCasa, 600);
});
$('#sh-save').addEventListener('click', async () => {
  const v = $('#sh-link').value.trim();
  if (!v) { $('#sh-err').textContent = 'Cole o link do QR code ou o endereço (ex.: 192.168.0.10:8787).'; return; }
  S.cfg = await window.ilha.setCfg({ smarthouse: v }); $('#set-sh').value = v; S.sh = null;
  $('#sh-err').textContent = 'Conectando…';
  loadCasa();
});

/* =================== foco (timer) =================== */
const T = S.timer, RING = 326.7;
function renderTimer() {
  $('#t-time').textContent = fmtT(T.left);
  $('#t-arc').style.strokeDashoffset = RING * (1 - T.left / T.total);
  $('#t-label').textContent = T.running ? 'Focando' : T.left < T.total ? 'Pausado' : T.total === 1500 ? 'Pomodoro' : `${T.total / 60} minutos`;
  const go = $('#t-go'); go.classList.toggle('run', T.running); go.firstChild.textContent = T.running ? 'Pausar' : T.left < T.total ? 'Continuar' : 'Iniciar';
}
function timerTick() {
  if (!T.running) return;
  T.left = Math.max(0, Math.ceil((T.endAt - Date.now()) / 1000));
  if (T.left === 0) {
    T.running = false; T.left = T.total;
    chime();
    window.ilha.notify('Tempo esgotado', 'Seu timer de foco terminou.');
    showAlert('Tempo esgotado', `${T.total / 60} min de foco concluídos. Hora de uma pausa!`, IC.timer);
  }
  renderTimer();
  if (!S.open) render();
}
setInterval(timerTick, 250);
$$('.t-presets button').forEach(b => b.addEventListener('click', () => {
  if (T.running) return;
  $$('.t-presets button').forEach(x => x.classList.toggle('on', x === b));
  T.total = T.left = Number(b.dataset.min) * 60; renderTimer();
}));
$('#t-go').addEventListener('click', () => {
  if (T.running) { T.running = false; }
  else { T.running = true; T.endAt = Date.now() + T.left * 1000; }
  renderTimer();
});
$('#t-reset').addEventListener('click', () => { T.running = false; T.left = T.total; renderTimer(); });

/* =================== área de transferência e notas =================== */
function ago(t) { const s = (Date.now() - t) / 1000; if (s < 60) return 'agora'; if (s < 3600) return `há ${Math.floor(s / 60)} min`; if (s < 86400) return `há ${Math.floor(s / 3600)} h`; return new Date(t).toLocaleDateString('pt-BR'); }
let clips = [];
function renderClips(list) {
  clips = list || [];
  $('#clips').innerHTML = clips.length ? clips.map((c, i) => `<button class="clip" data-i="${i}">${esc(c.text.trim().replace(/\s+/g, ' ').slice(0, 140))}<small>${ago(c.at)}</small></button>`).join('')
    : '<div class="empty" style="padding:20px 0">O que você copiar aparece aqui</div>';
}
$('#clips').addEventListener('click', e => { const b = e.target.closest('.clip'); if (!b) return; window.ilha.copy(clips[b.dataset.i].text); toast('Copiado'); });
$('#clip-clear').addEventListener('click', () => window.ilha.clearClips());
window.ilha.onClips(renderClips);
let notesT;
$('#notes').addEventListener('input', () => {
  $('#notes-saved').textContent = '';
  clearTimeout(notesT); notesT = setTimeout(async () => { await window.ilha.setCfg({ notes: $('#notes').value }); $('#notes-saved').textContent = 'Salvo'; }, 500);
});

/* =================== ajustes =================== */
function fillSettings() {
  $('#set-city').value = S.cfg.city || '';
  $('#set-hide').checked = !!S.cfg.hideOnMax;
  $('#set-start').checked = !!S.cfg.startup;
  $('#set-sh').value = S.cfg.smarthouse || '';
  $('#set-glass').value = S.cfg.glass ?? 22;
  applyGlass(S.cfg.glass ?? 22);
  applyTheme(S.cfg.theme || 'grafite');
}
// transparência do vidro: 0% = quase sólido, 70% = bem transparente
function applyGlass(t) {
  t = clamp(Number(t) || 0, 0, 70);
  isl.style.setProperty('--alpha', (1 - t / 100).toFixed(3));
  const s = $('#set-glass');
  s.style.setProperty('--p', (100 * t / 70) + '%');
  $('#set-glass-v').textContent = Math.round(t) + '%';
}
// temas: degradê no vidro + cor dos botões
const THEMES = {
  grafite: { name: 'Grafite', g: null, a: ['#0a84ff', '#5e5ce6'] },
  'por-do-sol': { name: 'Pôr do sol', g: 'linear-gradient(120deg, #e8794a 0%, #b0688f 50%, #4a6ae8 100%)', a: ['#ff9f0a', '#5e5ce6'] },
  aurora: { name: 'Aurora', g: 'linear-gradient(120deg, #1fa67a 0%, #3a7bd5 55%, #8e44ad 100%)', a: ['#30d158', '#5e5ce6'] },
  oceano: { name: 'Oceano', g: 'linear-gradient(120deg, #0f4c81 0%, #1e88c7 50%, #2ec4b6 100%)', a: ['#64d2ff', '#0a84ff'] },
  rosa: { name: 'Rosa', g: 'linear-gradient(120deg, #ff375f 0%, #c94ba8 50%, #7b4dd6 100%)', a: ['#ff375f', '#bf5af2'] },
  lava: { name: 'Lava', g: 'linear-gradient(120deg, #c0392b 0%, #e2603a 50%, #f5a524 100%)', a: ['#ff453a', '#ff9f0a'] },
  lavanda: { name: 'Lavanda', g: 'linear-gradient(120deg, #6d5bd0 0%, #a17fe0 50%, #e68ec9 100%)', a: ['#bf5af2', '#ff6ec7'] },
  floresta: { name: 'Floresta', g: 'linear-gradient(120deg, #1d6f42 0%, #2f8f6b 50%, #4a9fb5 100%)', a: ['#30d158', '#30b0c7'] },
};
function applyTheme(id) {
  const t = THEMES[id] || THEMES.grafite;
  isl.style.setProperty('--theme', t.g || 'none');
  isl.style.setProperty('--acc1', t.a[0]); isl.style.setProperty('--acc2', t.a[1]);
  isl.style.setProperty('--accg', t.a[0] + 'b3');
  $$('#set-theme .sw').forEach(s => s.classList.toggle('on', s.dataset.theme === id));
}
$('#set-theme').innerHTML = Object.entries(THEMES).map(([id, t]) =>
  `<button class="sw" data-theme="${id}" title="${t.name}" style="background:${t.g || 'linear-gradient(135deg, #48484a, #1c1c1e)'}"></button>`).join('');
$('#set-theme').addEventListener('click', async e => {
  const b = e.target.closest('.sw'); if (!b) return;
  applyTheme(b.dataset.theme);
  S.cfg = await window.ilha.setCfg({ theme: b.dataset.theme });
  toast(`Tema ${THEMES[b.dataset.theme].name}`);
});
$('#set-glass').addEventListener('input', e => applyGlass(e.target.value));
$('#set-glass').addEventListener('change', async e => { S.cfg = await window.ilha.setCfg({ glass: Number(e.target.value) }); });
const onEnter = (el, fn) => { el.addEventListener('change', fn); el.addEventListener('keydown', e => { if (e.key === 'Enter') el.blur(); }); };
onEnter($('#set-city'), async () => { S.cfg = await window.ilha.setCfg({ city: $('#set-city').value.trim() }); loadWeather(true); toast('Cidade atualizada'); });
onEnter($('#set-sh'), async () => { S.cfg = await window.ilha.setCfg({ smarthouse: $('#set-sh').value.trim() }); S.sh = null; toast('Link do SmartHouse salvo'); });
$('#set-hide').addEventListener('change', async e => { S.cfg = await window.ilha.setCfg({ hideOnMax: e.target.checked }); });
$('#set-start').addEventListener('change', async e => { S.cfg = await window.ilha.setCfg({ startup: e.target.checked }); toast(e.target.checked ? 'Vai abrir com o Windows' : 'Não abre mais com o Windows'); });
$('#set-quit').addEventListener('click', () => window.ilha.quit());

/* =================== início =================== */
(async function init() {
  S.cfg = await window.ilha.getCfg();
  S.covered = !!S.cfg.covered;
  $('#ver').textContent = S.cfg.version;
  $('#notes').value = S.cfg.notes || '';
  fillSettings();
  renderClips(S.cfg.clips);
  renderHistory(S.cfg.speedHistory);
  setGauge(0, 0);
  if (S.cfg.speedHistory?.[0]) {
    const r = S.cfg.speedHistory[0];
    stCard('st-ping', Math.round(r.ping)); stCard('st-jit', Math.round(r.jitter)); stCard('st-down', fmtNum(r.down)); stCard('st-up', fmtNum(r.up));
    if (r.isp) $('#isp span').textContent = `${r.isp} · ${r.city}${r.colo ? ' · servidor ' + r.colo : ''}`;
    S.speed.phase = 'done'; $('#g-phase').textContent = 'Último teste'; setGauge(gFrac(r.down), r.down);
  }
  renderTimer();
  setTab(SIZES[S.tab] ? S.tab : 'home', true);
  render();
  initBattery();
  loadWeather();
  document.fonts?.ready.then(() => movePill(true));
})();
