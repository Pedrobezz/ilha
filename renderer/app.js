// Ilha · interface
const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const isl = $('#island');
const WIN_W = 900;
const SIZES = { home: [790, 330], net: [770, 352], sys: [770, 360], casa: [800, 384], tools: [770, 332], files: [790, 340], claude: [800, 372], set: [860, 540] };
const FLOAT_GAP = 8; // distância do topo no estilo flutuante
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
  if (S.notice && S.notice.until > Date.now()) return 'notice';
  if (S.volFlash && S.volFlash.until > Date.now()) return 'vol';
  if (t.running || (t.left < t.total && t.left > 0)) return 'timer';
  if (S.claude?.working) return 'claude';
  if (S.dl?.length) return 'download';
  if (S.speed.running) return 'speed';
  if (S.media?.has && S.media.playing) return 'media';
  return null;
}

function render() {
  let mode, size;
  if (S.alert) { mode = 'alerting'; size = S.alert.size || [400, 84]; }
  else if (S.open) { mode = 'expanded'; size = SIZES[S.tab]; }
  else if (activity()) { const a = activity(); mode = 'compact'; size = [a === 'notice' ? 400 : a === 'claude' ? 380 : a === 'download' ? 340 : a === 'vol' ? 300 : a === 'speed' ? 290 : 270, 34]; }
  else { mode = 'collapsed'; size = COLLAPSED; }
  // avisos rápidos e o volume aparecem mesmo com janela maximizada
  const transient = mode === 'compact' && ['notice', 'vol'].includes(activity());
  const hidden = S.covered && (mode === 'collapsed' || mode === 'compact') && !transient;
  const float = S.cfg.islandStyle === 'float';
  isl.className = mode + (hidden ? ' hidden-top' : '') + (float ? ' float' : '') + (S.cfg.islandColor === 'theme' ? ' themed' : '');
  isl.style.setProperty('--w', size[0] + 'px');
  isl.style.setProperty('--h', size[1] + 'px');
  S.size = size;
  // escondida: só a borda de cima da tela (1 px) abre a ilha, para não atrapalhar as abas do Chrome
  if (hidden) window.ilha.setRect({ x: (WIN_W - COLLAPSED[0]) / 2, y: 0, w: COLLAPSED[0], h: 1, edge: true });
  // flutuante: a área do mouse inclui o espacinho entre a ilha e o topo
  else window.ilha.setRect({ x: (WIN_W - size[0]) / 2, y: 0, w: size[0], h: size[1] + (float ? FLOAT_GAP : 0) });
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
  if (!e.target.closest('#forecast, #weather')) $('#forecast')?.classList.remove('show');
  if (!e.target.closest('#agenda, #next-ev')) $('#agenda')?.classList.remove('show');
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
  // os nomes das abas abrem/fecham animados: a pílula acompanha durante a animação
  if (!instant) { const t0 = performance.now(); (function follow() { movePill(true); if (performance.now() - t0 < 520) requestAnimationFrame(follow); })(); }
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
  if (S.tab === 'claude') renderClaude();
  if (S.tab === 'home') askBright();
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
// alerta grande: título, texto, detalhe (em fonte de código) e botões. Cada botão fecha o alerta e roda sua ação.
function showAlert(title, body, icon, opts = {}) {
  S.alert = { title, body, id: opts.id || null, size: opts.size || [opts.code ? 520 : opts.buttons?.length > 1 ? 470 : 400, opts.code ? 104 : 84] };
  $('#alert .a-text b').textContent = title;
  const span = $('#alert .a-text span');
  span.textContent = body;
  if (opts.code) { const c = document.createElement('code'); c.textContent = opts.code; c.title = opts.code; span.appendChild(c); }
  $('#alert .a-icon').innerHTML = icon;
  const box = $('#alert .a-btns'); box.innerHTML = '';
  for (const b of opts.buttons || [{ label: 'OK', cls: 'primary' }]) {
    const el = document.createElement('button');
    el.textContent = b.label; el.className = b.cls || '';
    el.addEventListener('click', () => { dismissAlert(); b.fn?.(); });
    box.appendChild(el);
  }
  S.open = false; render();
  clearTimeout(alertT); alertT = setTimeout(() => { opts.onTimeout?.(); dismissAlert(); }, opts.ms || 12000);
}
function dismissAlert() { clearTimeout(alertT); S.alert = null; render(); }

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
    const w = await (await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code,is_day,apparent_temperature,relative_humidity_2m&hourly=temperature_2m,weather_code,is_day,precipitation_probability&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto&forecast_days=7`)).json();
    // próximas 12 horas a partir de agora
    const nowH = w.current.time.slice(0, 13);
    const h0 = Math.max(0, w.hourly.time.findIndex(t => t.slice(0, 13) === nowH));
    const hours = w.hourly.time.slice(h0, h0 + 12).map((t, i) => ({ t, temp: w.hourly.temperature_2m[h0 + i], code: w.hourly.weather_code[h0 + i], day: w.hourly.is_day[h0 + i], rain: w.hourly.precipitation_probability?.[h0 + i] ?? 0 }));
    const days = w.daily.time.map((t, i) => ({ t, code: w.daily.weather_code[i], max: w.daily.temperature_2m_max[i], min: w.daily.temperature_2m_min[i], rain: w.daily.precipitation_probability_max?.[i] ?? 0 }));
    const data = { at: Date.now(), city: S.cfg.city || '', name, t: w.current.temperature_2m, code: w.current.weather_code, day: w.current.is_day, feels: w.current.apparent_temperature, hum: w.current.relative_humidity_2m, max: w.daily.temperature_2m_max[0], min: w.daily.temperature_2m_min[0], hours, days };
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
  S.wx = d; renderForecast();
}
setInterval(() => loadWeather(), 15 * 60e3);

// previsão: próximas horas + 7 dias (abre ao clicar no clima)
function renderForecast() {
  const d = S.wx; if (!d?.hours) return;
  $('#fc-city').textContent = d.name || 'Previsão';
  $('#fc-now').textContent = `${Math.round(d.t)}° agora · sensação ${Math.round(d.feels)}° · umidade ${d.hum}%`;
  $('#fc-hours').innerHTML = d.hours.map((h, i) => `<div class="fc-hour"><span>${i ? h.t.slice(11, 13) + 'h' : 'Agora'}</span>${WX[wxInfo(h.code, h.day)[0]]}<b>${Math.round(h.temp)}°</b><em>${h.rain >= 20 ? h.rain + '%' : ''}</em></div>`).join('');
  const lo = Math.min(...d.days.map(x => x.min)), hi = Math.max(...d.days.map(x => x.max));
  $('#fc-days').innerHTML = d.days.map((x, i) => {
    const name = i === 0 ? 'Hoje' : new Date(x.t + 'T12:00').toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '');
    return `<div class="fc-day" title="${esc(wxInfo(x.code, 1)[1])}"><span>${name[0].toUpperCase() + name.slice(1)}</span>${WX[wxInfo(x.code, 1)[0]]}<b>${Math.round(x.max)}°</b><small>${Math.round(x.min)}°</small><span class="rain">${x.rain >= 20 ? '💧' + x.rain + '%' : '&nbsp;'}</span></div>`;
  }).join('');
}
$('#weather').addEventListener('click', () => { if (S.wx?.hours) $('#forecast').classList.add('show'); });
$('#fc-close').addEventListener('click', () => $('#forecast').classList.remove('show'));

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
  if (m.art && m.art !== S.lastArt) { S.lastArt = m.art; artColor(m.art); }
  tickMedia(); render(); syncPulse();
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
// clicar na barra pula para aquele ponto
$('.track').addEventListener('click', e => {
  const m = S.media; if (!m?.end) return;
  const r = e.currentTarget.getBoundingClientRect(), f = clamp((e.clientX - r.left) / r.width, 0, 1), sec = Math.round(f * m.end);
  window.ilha.media('seek ' + sec);
  m.pos = sec; m.at = Date.now(); tickMedia();
});

/* =================== volume =================== */
let volLocalAt = 0;
function showVol(level, muted) {
  const p = Math.round(level * 100);
  $('#vol').value = p; $('#vol').style.setProperty('--p', p + '%');
  $('#vol-v').textContent = muted ? 'Mudo' : p + '%';
  $('.m-vol').classList.toggle('muted', muted || p === 0);
  $('.m-vol').classList.toggle('low', p < 40);
}
$('#vol').addEventListener('input', e => {
  volLocalAt = Date.now();
  const v = Number(e.target.value) / 100;
  showVol(v, false);
  window.ilha.media('setvol ' + v.toFixed(2));
});
$('#vol-mute').addEventListener('click', () => { volLocalAt = Date.now(); window.ilha.media('mute'); });
function onVol(m) {
  S.vol = m;
  const external = Date.now() - volLocalAt > 700; // não foi o slider da própria ilha
  if (external || m.muted !== S.volMuted) showVol(m.level, m.muted);
  // mudou por fora (teclas de volume): a ilha mostra o indicador estilo iPhone
  if (!m.first && external && !S.open) {
    S.volFlash = { until: Date.now() + 1600 };
    render(); clearTimeout(onVol.t); onVol.t = setTimeout(render, 1650);
  }
  S.volMuted = m.muted;
  if (activity() === 'vol') renderCompact();
}

/* =================== avisos ao vivo =================== */
const NOTE_IC = {
  bolt: '<svg viewBox="0 0 24 24"><path d="M13 2 4 14h7l-1 8 9-12h-7z" fill="currentColor"/></svg>',
  battery: '<svg viewBox="0 0 24 24"><rect x="2.5" y="7" width="17" height="10" rx="2.5"/><path d="M22 10.5v3"/><rect x="5" y="9.5" width="4" height="5" rx="1" fill="currentColor"/></svg>',
  wifi: '<svg viewBox="0 0 24 24"><path d="M2 8.5a15 15 0 0 1 20 0M5.5 12.5a10 10 0 0 1 13 0M9 16.3a5 5 0 0 1 6 0"/><circle cx="12" cy="19.5" r=".8" fill="currentColor"/></svg>',
  wifiOff: '<svg viewBox="0 0 24 24"><path d="M2 8.5a15 15 0 0 1 20 0M5.5 12.5a10 10 0 0 1 13 0M9 16.3a5 5 0 0 1 6 0M3 3l18 18"/></svg>',
  home: '<svg viewBox="0 0 24 24"><path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"/></svg>',
};
function notice(icon, color, title, text, ms = 3600) {
  if (S.cfg.liveAlerts === false) return;
  S.notice = { icon, color, title, text, until: Date.now() + ms };
  $('#compact .c-left').dataset.k = '';
  if (!S.open) { render(); clearTimeout(notice.t); notice.t = setTimeout(render, ms + 50); }
}

/* =================== atividade compacta =================== */
const IC = {
  timer: '<svg viewBox="0 0 24 24"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2.5M9.5 2.5h5"/></svg>',
  gauge: '<svg viewBox="0 0 24 24"><path d="M12 13.5 16.5 9"/><path d="M3.5 17a9 9 0 1 1 17 0"/></svg>',
  note: '<svg viewBox="0 0 24 24"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>',
};
function renderCompact() {
  const a = activity(), L = $('#compact .c-left'), R = $('#compact .c-right');
  if (a === 'notice') {
    const n = S.notice;
    L.innerHTML = `<span class="c-ico" style="background:${n.color}33;color:${n.color}">${NOTE_IC[n.icon] || ''}</span><span style="color:${n.color}">${esc(n.title)}</span>`;
    L.dataset.k = 'notice'; R.innerHTML = `<span class="c-note">${esc(n.text)}</span>`; R.dataset.k = '';
    return;
  }
  if (a === 'vol') {
    const v = S.vol || { level: 0, muted: false }, p = Math.round(v.level * 100);
    const ic = v.muted || !p ? '<svg viewBox="0 0 24 24"><path d="M11 5 6 9H3v6h3l5 4z" fill="currentColor"/><path d="M16 9.5l5 5M21 9.5l-5 5"/></svg>'
      : `<svg viewBox="0 0 24 24"><path d="M11 5 6 9H3v6h3l5 4z" fill="currentColor"/><path d="M15.5 9.5a3.5 3.5 0 0 1 0 5"/>${p >= 40 ? '<path d="M18.5 6.5a8 8 0 0 1 0 11"/>' : ''}</svg>`;
    L.innerHTML = `<span class="c-ico" style="color:#fff">${ic}</span>`; L.dataset.k = 'vol';
    R.innerHTML = `<div class="vbar"><i style="width:${v.muted ? 0 : p}%"></i></div><b style="width:30px;text-align:right">${v.muted ? '0' : p}</b>`; R.dataset.k = '';
    return;
  }
  if (a === 'claude') {
    const c = S.claude;
    if (L.dataset.k !== 'claude') { L.innerHTML = `<span class="c-ico" style="background:rgba(217,119,87,.25);color:#d97757">${NOTE_IC.claude}</span><span class="c-note" style="color:var(--t1);max-width:250px"></span>`; L.dataset.k = 'claude'; }
    L.lastChild.textContent = c.activity || 'Trabalhando';
    R.innerHTML = `<b style="color:#d97757">${fmtT((Date.now() - c.startedAt) / 1000)}</b>`; R.dataset.k = '';
    return;
  }
  if (a === 'download') return renderDownload(L, R);
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
  else if (m.t === 'vol') onVol(m);
  else if (m.t === 'radios') onRadios(m);
  else if (m.t === 'av') onAv(m);
  else if (m.t === 'bright') onBright(m);
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
    // avisos: carregador conectado/desconectado e bateria fraca
    let lowWarned = false;
    b.addEventListener('chargingchange', () => {
      if (!S.battery) return;
      const p = Math.round(b.level * 100);
      if (b.charging) { lowWarned = false; notice('bolt', '#30d158', 'Carregando', `${p}% de bateria`); }
      else notice('battery', '#ffffff', 'Na bateria', `${p}% restante`);
    });
    b.addEventListener('levelchange', () => {
      const p = Math.round(b.level * 100);
      if (S.battery && !b.charging && p <= 20 && !lowWarned) { lowWarned = true; notice('battery', '#ff453a', 'Bateria fraca', `${p}% · conecte o carregador`, 6000); }
    });
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
// histórico de testes e de quedas da internet (alternáveis)
S.histView = 'tests';
const fmtDur = ms => { const s = Math.round(ms / 1000); if (s < 60) return `${s} s`; const m = Math.round(s / 60); return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`; };
const fmtWhen = t => { const d = new Date(t); return `${d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`; };
function renderHistory(h) {
  if (h) S.speedHist = h;
  h = S.speedHist || [];
  const c = S.conn || { online: true, since: Date.now(), outages: [] };
  const outs = c.outages || [];
  const today = outs.filter(o => o.start > Date.now() - 864e5);
  const head = `<div class="hist-tabs"><button data-hv="tests" class="${S.histView === 'tests' ? 'on' : ''}">Histórico</button><button data-hv="outs" class="${S.histView === 'outs' ? 'on' : ''}">Quedas${today.length ? ` · ${today.length}` : ''}</button>
    <span class="conn-st"><i class="conn-dot ${c.online ? '' : 'off'}"></i>${c.online ? `Online há ${fmtDur(Date.now() - c.since)}` : `Sem internet há ${fmtDur(Date.now() - c.since)}`}</span></div>`;
  let body;
  if (S.histView === 'outs') {
    body = outs.length ? outs.slice(0, 5).map(o => `<div class="out-row ${o.end ? '' : 'now'}"><span>${fmtWhen(o.start)}</span><b>${o.end ? 'fora por ' + fmtDur(o.end - o.start) : 'fora agora'}</b></div>`).join('')
      : '<div class="out-empty">Nenhuma queda registrada. A Ilha verifica a conexão a cada 5 segundos.</div>';
  } else {
    const max = Math.max(...h.map(x => x.down), 1);
    body = h.length ? h.slice(0, 4).map(x => `<div class="hist-row"><span>${fmtWhen(x.at)}</span><div class="hb"><i style="width:${(100 * x.down / max).toFixed(0)}%"></i></div><span>↓ <b>${fmtNum(x.down)}</b></span><span>↑ <b>${fmtNum(x.up)}</b></span><span><b>${Math.round(x.ping)}</b> ms</span></div>`).join('')
      : '<div class="out-empty">Nenhum teste ainda. Clique em Iniciar.</div>';
  }
  $('#hist').innerHTML = head + body;
}
$('#hist').addEventListener('click', e => { const b = e.target.closest('[data-hv]'); if (b) { S.histView = b.dataset.hv; renderHistory(); } });
window.ilha.onConn(c => {
  const prev = S.conn;
  S.conn = { ...(prev || {}), online: c.online, since: Date.now(), outages: c.outages };
  renderHistory();
  if (c.event === 'down') notice('wifiOff', '#ff453a', 'Sem internet', 'A conexão caiu', 6000);
  if (c.event === 'up') notice('wifi', '#30d158', 'Internet voltou', `ficou fora por ${fmtDur(c.duration || 0)}`, 4500);
});
setInterval(() => { if (S.open && S.tab === 'net') renderHistory(); }, 30000);

// avisos do Claude Code: terminou, pediu permissão ou está esperando você
NOTE_IC.claude = '<svg viewBox="0 0 24 24"><path d="M12 2.5v19M2.5 12h19M5.3 5.3l13.4 13.4M18.7 5.3 5.3 18.7" stroke-width="2.6"/></svg>';
const CLAUDE_C = '#d97757';
function claudeMsg(m) {
  const tool = /permission to use (.+)$/i.exec(m)?.[1];
  if (tool) return `Quer permissão para usar ${tool}`;
  if (/waiting for your input/i.test(m)) return 'Está esperando sua resposta';
  if (/needs your (attention|approval)/i.test(m)) return 'Precisa da sua atenção';
  return m || 'Precisa de você';
}
window.ilha.onClaude(c => {
  if (S.cfg.liveAlerts === false) return;
  const where = c.project ? ` · ${c.project}` : '';
  if (c.event === 'Stop') { notice('claude', CLAUDE_C, 'Claude', `Terminou${where}`, 5000); softChime(); return; }
  const perm = c.type === 'permission_prompt' || /permission|approval/i.test(c.message);
  if (perm) {
    chime();
    showAlert('Claude precisa de você', `${claudeMsg(c.message)}${where}`, `<span style="color:${CLAUDE_C}">${NOTE_IC.claude}</span>`);
  } else notice('claude', CLAUDE_C, 'Claude', `${claudeMsg(c.message)}${where}`, 6000);
});
// Wi-Fi e Bluetooth (botões redondos estilo Central de Controle)
function onRadios(m) {
  S.radios = m;
  for (const [id, r] of [['q-wifi', m.wifi], ['q-bt', m.bt]]) {
    const b = $('#' + id);
    b.classList.remove('busy');
    b.classList.toggle('na', !r.has); b.classList.toggle('on', !!r.on);
    b.title = (id === 'q-wifi' ? 'Wi-Fi' : 'Bluetooth') + (!r.has ? ' (não encontrado)' : r.on ? ' ligado' : ' desligado');
  }
  $('#ql-wifi').textContent = (m.wifi.on && m.ssid ? m.ssid : 'Wi-Fi') + ' ›';
  $('#ql-wifi').title = m.wifi.on && m.ssid ? `Conectado a ${m.ssid} · clique para ver as redes` : 'Ver as redes Wi-Fi';
}
// o nome embaixo (ou botão direito no círculo) abre as conexões do Windows: lista de redes ou dispositivos Bluetooth
for (const kind of ['wifi', 'bt']) {
  const openList = e => { e.preventDefault(); window.ilha.openSys(kind); close(); };
  $('#ql-' + kind).addEventListener('click', openList);
  $('#q-' + kind).addEventListener('contextmenu', openList);
}
for (const [id, kind, name] of [['q-wifi', 'wifi', 'Wi-Fi'], ['q-bt', 'bt', 'Bluetooth']]) {
  $('#' + id).addEventListener('click', () => {
    const r = S.radios?.[kind]; if (!r?.has) return;
    $('#' + id).classList.add('busy');
    window.ilha.media(`radio ${kind} ${r.on ? 'off' : 'on'}`);
    toast(`${name} ${r.on ? 'desligado' : 'ligado'}`);
  });
}

// Claude ao vivo: estado, tempo, tokens, limites do plano e atividade
const fmtTok = n => n >= 1e6 ? (n / 1e6).toFixed(1).replace('.', ',') + ' mi' : n >= 1e3 ? (n / 1e3).toFixed(n >= 1e4 ? 0 : 1).replace('.', ',') + ' mil' : String(Math.round(n || 0));
const fmtDurS = ms => { const s = Math.max(0, Math.round(ms / 1000)); if (s < 60) return `${s} s`; const m = Math.floor(s / 60); return m < 60 ? `${m} min ${String(s % 60).padStart(2, '0')} s` : `${Math.floor(m / 60)} h ${m % 60} min`; };
function resetIn(ts) {
  if (!ts) return '';
  const ms = ts * 1000 - Date.now(); if (ms <= 0) return 'renova agora';
  const h = Math.floor(ms / 3600e3), m = Math.round(ms % 3600e3 / 60e3);
  return h >= 24 ? `renova em ${Math.floor(h / 24)}d ${h % 24}h` : h ? `renova em ${h}h ${m}min` : `renova em ${m} min`;
}
function clRing(id, p, sub) {
  const r = $('#' + id);
  r.querySelector('.v').style.strokeDashoffset = 113.1 * (1 - clamp(p ?? 0, 0, 100) / 100);
  r.querySelector('b').textContent = p == null ? '–' : Math.round(p) + '%';
  r.querySelector('small').textContent = sub || '';
}
function renderClaude() {
  const c = S.claude; if (!c) return;
  const card = $('#cl-now');
  card.classList.toggle('working', !!c.working);
  $('#cl-state').textContent = c.working ? 'Claude está trabalhando' : c.endedAt ? 'Claude terminou' : 'Claude';
  $('#cl-project').textContent = c.project ? `Projeto ${c.project}${c.active > 1 ? ` · ${c.active} sessões ativas` : ''}` : 'Sem atividade ainda';
  $('#cl-badge').textContent = c.working ? 'ao vivo' : 'parado';
  $('#cl-activity').textContent = c.working ? (c.activity || 'Trabalhando…') : c.endedAt ? `Última tarefa terminou ${ago(c.endedAt)}.` : 'Quando você pedir algo ao Claude Code, aparece aqui o que ele está fazendo.';
  $('#cl-time').textContent = c.startedAt ? fmtDurS((c.working ? Date.now() : c.endedAt) - c.startedAt) : '–';
  $('#cl-ttask').textContent = c.startedAt ? fmtTok(c.tokensTask) : '–';
  $('#cl-tsess').textContent = c.tokensSession ? fmtTok(c.tokensSession) : '–';
  $('#cl-tsess').title = c.cacheSession ? `${fmtTok(c.cacheSession)} lidos do cache (não contam aqui)` : '';
  const L = c.limits;
  clRing('cl-five', L?.five?.p, resetIn(L?.five?.reset));
  clRing('cl-seven', L?.seven?.p, resetIn(L?.seven?.reset));
  clRing('cl-ctx', c.ctx?.p, c.ctx?.size ? `de ${fmtTok(c.ctx.size)}` : '');
  $('#cl-model').textContent = c.model || '';
  $('#cl-hint').textContent = L ? `Atualizado ${ago(L.at)}` : 'Os limites chegam a cada resposta do Claude Code.';
  renderClaudeExtras(c);
  $('#cl-log').innerHTML = (c.log || []).length ? c.log.map(l => `<div class="cl-item"><em>${new Date(l.t).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</em><span title="${esc(l.project)}">${esc(l.text)}</span></div>`).join('')
    : '<div class="out-empty">Nada ainda.</div>';
}
window.ilha.onClaudeState(c => {
  const was = S.claude?.working;
  S.claude = c;
  if (S.open && S.tab === 'claude') renderClaude();
  if (!S.open && (was !== c.working || c.working)) render();
});
setInterval(() => {
  if (!S.claude?.working) return;
  if (S.open && S.tab === 'claude') renderClaude();
  else if (!S.open && activity() === 'claude') renderCompact();
}, 1000);

function softChime() {
  try {
    const ac = new AudioContext(), o = ac.createOscillator(), g = ac.createGain();
    o.type = 'sine'; o.frequency.value = 1046.5;
    g.gain.setValueAtTime(0, ac.currentTime); g.gain.linearRampToValueAtTime(.08, ac.currentTime + .02); g.gain.exponentialRampToValueAtTime(.001, ac.currentTime + .6);
    o.connect(g).connect(ac.destination); o.start(); o.stop(ac.currentTime + .65);
  } catch (_) {}
}

// SmartHouse ao vivo: regras que dispararam
window.ilha.onShLog(l => {
  const m = /^Regra "?(.+?)"? disparou/.exec(l.msg || '');
  if (m) notice('home', '#ff9f0a', 'Casa', `Regra “${m[1]}” disparou`, 4500);
  else if (l.level === 'error') notice('home', '#ff453a', 'Casa', l.msg, 5000);
});

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
    renderCasa(); loadEnergy();
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
  // favoritos primeiro, depois por cômodo e nome
  const fav = new Set(S.cfg.shFav || []);
  devs.sort((a, b) => (fav.has(b.id) - fav.has(a.id)) || String(a.room || '').localeCompare(String(b.room || '')) || a.name.localeCompare(b.name));
  const STAR = '<svg viewBox="0 0 24 24"><path d="M12 3l2.6 5.6 6 .7-4.5 4.1 1.2 6L12 16.6 6.7 19.4l1.2-6L3.4 9.3l6-.7z" fill="currentColor"/></svg>';
  $('#sh-devs').innerHTML = devs.map(d => {
    const s = d.state || {}, on = !!s.on && d.online !== false;
    const extra = d.type === 'ac'
      ? `<div class="ac-ctl"><button data-temp="-1">−</button><b>${s.target ?? '–'}°</b><button data-temp="1">+</button></div>`
      : s.channels?.length > 1 ? `<div class="gangs">${s.channels.map(c => `<i class="${c.on ? 'on' : ''}" data-ch="${esc(c.code)}" title="${esc(c.name || c.code)}"></i>`).join('')}</div>` : '';
    return `<div role="button" class="dev t-${esc(d.type)} ${on ? 'on' : ''} ${d.online === false ? 'off-line' : ''}" data-id="${esc(d.id)}"><span class="d-ico">${DIC[d.type] || DIC.plug}</span>${extra}<span class="star ${fav.has(d.id) ? 'on' : ''}" data-star title="${fav.has(d.id) ? 'Tirar dos favoritos' : 'Favoritar'}">${STAR}</span><div><div class="d-name">${esc(d.name)}</div><div class="d-st">${esc(devState(d))}</div></div></div>`;
  }).join('');
  renderEnergy();
}

// consumo das últimas 24 h (soma de todos os aparelhos que medem energia), em blocos de 30 min
let energyAt = 0;
async function loadEnergy() {
  if (Date.now() - energyAt < 120e3 || !S.sh) return;
  energyAt = Date.now();
  const ids = (S.sh.devices || []).filter(d => d.caps?.metering || typeof d.state?.power === 'number').map(d => d.id).slice(0, 30);
  const since = Date.now() - 24 * 3600e3, B = 48, buckets = new Array(B).fill(0);
  await Promise.all(ids.map(async id => {
    try {
      const pts = await window.ilha.sh({ route: 'energy?id=' + encodeURIComponent(id) });
      const sum = new Array(B).fill(0), n = new Array(B).fill(0);
      for (const [t, w] of pts || []) { if (t < since) continue; const i = Math.min(B - 1, Math.floor((t - since) / (1800e3))); sum[i] += w; n[i]++; }
      for (let i = 0; i < B; i++) if (n[i]) buckets[i] += sum[i] / n[i];
    } catch (_) {}
  }));
  S.energy = buckets; renderEnergy();
}
function renderEnergy() {
  const b = S.energy; let svg = $('#e-spark');
  if (!b || !b.some(v => v > 0)) { svg?.remove(); return; }
  if (!svg) { $('#sh-power').insertAdjacentHTML('afterend', '<svg class="e-spark" id="e-spark" viewBox="0 0 100 22" preserveAspectRatio="none"><path class="f"/><path class="l"/></svg>'); svg = $('#e-spark'); }
  const mx = Math.max(...b, 1), pts = b.map((v, i) => `${(i / (b.length - 1) * 100).toFixed(1)} ${(20 - v / mx * 18).toFixed(1)}`);
  const d = 'M' + pts.join(' L');
  svg.querySelector('.l').setAttribute('d', d); svg.querySelector('.f').setAttribute('d', d + ' L100 22 L0 22 Z');
  const kwh = b.reduce((a, v) => a + v * 0.5, 0) / 1000;
  let tt = svg.querySelector('title');
  if (!tt) { tt = document.createElementNS('http://www.w3.org/2000/svg', 'title'); svg.appendChild(tt); }
  tt.textContent = `Consumo nas últimas 24 h · ${kwh.toFixed(1).replace('.', ',')} kWh`;
}
async function shCmd(id, cmd) {
  try { await window.ilha.sh({ method: 'POST', route: 'command', body: { id, cmd } }); }
  catch (e) { toast(String(e.message).replace(/^Error invoking remote method 'sh': (Error: )?/, '')); }
  setTimeout(loadCasa, 400);
}
$('#sh-devs').addEventListener('click', e => {
  const tile = e.target.closest('.dev'); if (!tile) return;
  if (e.target.closest('[data-star]')) {
    const id = tile.dataset.id, f = new Set(S.cfg.shFav || []);
    f.has(id) ? f.delete(id) : f.add(id);
    S.cfg.shFav = [...f]; window.ilha.setCfg({ shFav: S.cfg.shFav }); renderCasa();
    return;
  }
  if (tile.classList.contains('off-line')) return;
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
  $('#set-alerts').checked = S.cfg.liveAlerts !== false;
  $$('#set-monitor button').forEach(b => b.classList.toggle('on', b.dataset.v === (S.cfg.monitor || 'primary')));
  $$('#set-style button').forEach(b => b.classList.toggle('on', b.dataset.v === (S.cfg.islandStyle || 'notch')));
  $$('#set-icolor button').forEach(b => b.classList.toggle('on', b.dataset.v === (S.cfg.islandColor || 'black')));
  $('#set-ialpha').value = S.cfg.islandAlpha ?? 100; applyIAlpha(S.cfg.islandAlpha ?? 100);
  $('#set-ics').value = S.cfg.icsUrl || '';
  $('#set-pulse').checked = S.cfg.musicPulse !== false;
}
// estilo da ilha fechada: notch ou flutuante, preta ou do tema, e a opacidade
function applyIAlpha(v) {
  v = clamp(Number(v) || 100, 30, 100);
  isl.style.setProperty('--calpha', (v / 100).toFixed(2));
  $('#set-ialpha').style.setProperty('--p', ((v - 30) / 70 * 100) + '%');
  $('#set-ialpha-v').textContent = Math.round(v) + '%';
}
for (const [id, key, msg] of [['set-style', 'islandStyle', { notch: 'Ilha colada no topo (notch)', float: 'Ilha flutuante' }], ['set-icolor', 'islandColor', { black: 'Ilha fechada preta', theme: 'Ilha fechada com o tema' }]]) {
  $('#' + id).addEventListener('click', async e => {
    const b = e.target.closest('button'); if (!b) return;
    S.cfg = await window.ilha.setCfg({ [key]: b.dataset.v }); fillSettings(); render(); toast(msg[b.dataset.v]);
  });
}
$('#set-ialpha').addEventListener('input', e => applyIAlpha(e.target.value));
$('#set-ialpha').addEventListener('change', async e => { S.cfg = await window.ilha.setCfg({ islandAlpha: Number(e.target.value) }); });
$('#set-alerts').addEventListener('change', async e => { S.cfg = await window.ilha.setCfg({ liveAlerts: e.target.checked }); });
$('#set-monitor').addEventListener('click', async e => {
  const b = e.target.closest('button'); if (!b) return;
  S.cfg = await window.ilha.setCfg({ monitor: b.dataset.v }); fillSettings();
  toast(b.dataset.v === 'cursor' ? 'A ilha segue o monitor do mouse' : 'A ilha fica no monitor principal');
});
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
  $('#theme-name').textContent = t.name;
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

/* =================== atalhos: prateleira e favoritos =================== */
const FILE_EMPTY = {
  shelf: '<div class="empty-files"><svg viewBox="0 0 24 24"><path d="M12 4v11M7 10l5 5 5-5"/><path d="M4 17v2a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-2"/></svg>Arraste arquivos até a ilha para guardá-los aqui.<br>Depois arraste daqui para qualquer lugar.</div>',
  favs: '<div class="empty-files"><svg viewBox="0 0 24 24"><path d="M12 3l2.6 5.6 6 .7-4.5 4.1 1.2 6L12 16.6 6.7 19.4l1.2-6L3.4 9.3l6-.7z"/></svg>Arraste apps, pastas ou arquivos para cá,<br>ou adicione um site abaixo.</div>',
};
const fileCache = new Map();
async function infos(paths) {
  const miss = paths.filter(p => !/^https?:/.test(p) && !fileCache.has(p));
  if (miss.length) (await window.ilha.fileInfo(miss)).forEach(i => fileCache.set(i.path, i));
  return paths.map(p => /^https?:/.test(p) ? { path: p, url: true, name: p.replace(/^https?:\/\/(www\.)?/, '').replace(/\/.*$/, ''), exists: true } : fileCache.get(p) || { path: p, name: p, exists: false });
}
async function renderFiles(kind) {
  const list = S.cfg[kind] || [], el = $('#' + kind);
  if (!list.length) { el.innerHTML = FILE_EMPTY[kind]; return; }
  const items = await infos(list);
  el.innerHTML = items.map((f, i) => {
    const site = f.url && siteIcons.get(f.path);
    const ico = site ? `<img class="site" src="${site}" alt="">` : f.url ? `<span class="letter">${esc(f.name[0]?.toUpperCase() || '?')}</span>` : f.icon ? `<img src="${f.icon}" alt="">` : `<span class="letter">${esc(f.name[0] || '?')}</span>`;
    return `<div class="fitem ${f.exists ? '' : 'missing'}" data-i="${i}" data-kind="${kind}" ${f.url ? '' : 'draggable="true"'} title="${esc(f.path)}">${ico}<span>${esc(f.name)}</span><button class="x" data-x title="Remover">✕</button></div>`;
  }).join('');
  // ícones dos sites: busca em segundo plano (fica guardado) e redesenha quando chegar
  for (const f of items) if (f.url && !siteIcons.has(f.path)) {
    siteIcons.set(f.path, '');
    window.ilha.siteIcon(f.path).then(d => { if (d) { siteIcons.set(f.path, d); renderFiles(kind); } }).catch(() => {});
  }
}
const siteIcons = new Map();
async function addFiles(kind, paths) {
  paths = paths.filter(Boolean);
  if (!paths.length) return;
  const cur = S.cfg[kind] || [];
  const next = [...cur, ...paths.filter(p => !cur.includes(p))].slice(-40);
  S.cfg = await window.ilha.setCfg({ [kind]: next });
  renderFiles(kind);
  toast(kind === 'shelf' ? `${paths.length} na prateleira` : 'Adicionado aos favoritos');
}
async function removeFile(kind, i) {
  const next = (S.cfg[kind] || []).filter((_, j) => j !== i);
  S.cfg = await window.ilha.setCfg({ [kind]: next }); renderFiles(kind);
}
for (const kind of ['shelf', 'favs']) {
  const el = $('#' + kind);
  el.addEventListener('click', e => {
    const it = e.target.closest('.fitem'); if (!it) return;
    const p = S.cfg[kind][Number(it.dataset.i)];
    if (e.target.closest('[data-x]')) return removeFile(kind, Number(it.dataset.i));
    window.ilha.openPath(p);
    if (kind === 'favs') close();
  });
  el.addEventListener('contextmenu', e => { const it = e.target.closest('.fitem'); if (it) { const p = S.cfg[kind][Number(it.dataset.i)]; if (!/^https?:/.test(p)) window.ilha.reveal(p); } });
  // arrastar para fora: o Windows recebe o arquivo de verdade
  el.addEventListener('dragstart', e => {
    const it = e.target.closest('.fitem'); if (!it) return;
    e.preventDefault();
    window.ilha.dragOut(S.cfg[kind][Number(it.dataset.i)]);
  });
}
$('#shelf-clear').addEventListener('click', async () => { S.cfg = await window.ilha.setCfg({ shelf: [] }); renderFiles('shelf'); });
$('#fav-add').addEventListener('click', async () => {
  let v = $('#fav-url').value.trim(); if (!v) return;
  if (!/^https?:\/\//i.test(v)) v = 'https://' + v;
  try { new URL(v); } catch (_) { toast('Endereço inválido'); return; }
  $('#fav-url').value = ''; addFiles('favs', [v]);
});
$('#fav-url').addEventListener('keydown', e => { if (e.key === 'Enter') $('#fav-add').click(); });

// soltar arquivos: arrastar até o topo abre a ilha na aba Atalhos
let dragDepth = 0;
const hasFiles = e => [...(e.dataTransfer?.types || [])].includes('Files');
document.addEventListener('dragenter', e => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  if (dragDepth++ === 0) { document.body.classList.add('dragging'); open(); if (S.tab !== 'files') setTab('files'); }
});
document.addEventListener('dragleave', e => {
  if (!hasFiles(e)) return;
  if (--dragDepth <= 0) { dragDepth = 0; document.body.classList.remove('dragging'); $$('.drop-over').forEach(x => x.classList.remove('drop-over')); }
});
document.addEventListener('dragover', e => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  const card = e.target.closest('#shelf-card, #fav-card');
  $$('#shelf-card, #fav-card').forEach(c => c.classList.toggle('drop-over', c === card));
  e.dataTransfer.dropEffect = card ? 'copy' : 'none';
});
document.addEventListener('drop', e => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  dragDepth = 0; document.body.classList.remove('dragging');
  const card = e.target.closest('#shelf-card, #fav-card');
  $$('.drop-over').forEach(x => x.classList.remove('drop-over'));
  if (!card) return;
  const paths = [...e.dataTransfer.files].map(f => window.ilha.pathOf(f));
  addFiles(card.id === 'shelf-card' ? 'shelf' : 'favs', paths);
});


/* =================== versão 1.4 =================== */
const IC2 = {
  mic: '<svg viewBox="0 0 24 24"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/></svg>',
  micOff: '<svg viewBox="0 0 24 24"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M3 3l18 18"/></svg>',
  cam: '<svg viewBox="0 0 24 24"><rect x="2.5" y="6" width="13" height="12" rx="2.5"/><path d="M15.5 10.5 21 7.5v9l-5.5-3"/></svg>',
  dl: '<svg viewBox="0 0 24 24"><path d="M12 4v11M7 10l5 5 5-5"/><path d="M4 17v2a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-2"/></svg>',
  shot: '<svg viewBox="0 0 24 24"><path d="M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16"/><circle cx="12" cy="12" r="3"/></svg>',
  cal: '<svg viewBox="0 0 24 24"><rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/></svg>',
  gh: '<svg viewBox="0 0 24 24"><path d="M12 2.5a9.5 9.5 0 0 0-3 18.5c.5.1.7-.2.7-.5v-1.7c-2.7.6-3.3-1.2-3.3-1.2-.4-1.1-1.1-1.4-1.1-1.4-.9-.6.1-.6.1-.6 1 .1 1.5 1 1.5 1 .9 1.5 2.3 1.1 2.9.8.1-.6.3-1.1.6-1.3-2.1-.2-4.4-1.1-4.4-4.8 0-1 .4-1.9 1-2.6-.1-.2-.4-1.2.1-2.6 0 0 .8-.3 2.6 1a9 9 0 0 1 4.8 0c1.8-1.3 2.6-1 2.6-1 .5 1.4.2 2.4.1 2.6.6.7 1 1.6 1 2.6 0 3.7-2.3 4.6-4.4 4.8.3.3.6.9.6 1.8v2.6c0 .3.2.6.7.5A9.5 9.5 0 0 0 12 2.5z"/></svg>',
  head: '<svg viewBox="0 0 24 24"><path d="M4 15v-3a8 8 0 0 1 16 0v3"/><rect x="3" y="14" width="4.5" height="6.5" rx="2"/><rect x="16.5" y="14" width="4.5" height="6.5" rx="2"/></svg>',
};
Object.assign(NOTE_IC, { mic: IC2.mic, cam: IC2.cam, dl: IC2.dl, shot: IC2.shot, head: IC2.head });

/* ---- Claude: Permitir / Negar direto na ilha ---- */
window.ilha.onPerm(p => {
  chime();
  showAlert('Claude quer permissão', `${p.title}${p.project ? ' · ' + p.project : ''}`, `<span style="color:${CLAUDE_C}">${NOTE_IC.claude}</span>`, {
    id: 'perm:' + p.id, code: p.detail && p.detail !== p.title ? p.detail : '', ms: 30000,
    buttons: [{ label: 'Negar', cls: 'deny', fn: () => window.ilha.permAnswer(p.id, false) }, { label: 'Permitir', cls: 'allow', fn: () => { window.ilha.permAnswer(p.id, true); toast('Permitido'); } }],
  });
});
window.ilha.onPermClose(id => { if (S.alert?.id === 'perm:' + id) dismissAlert(); });

/* ---- microfone e câmera em uso ---- */
const appLabel = a => appName(a) || a;
function renderAv() {
  const av = S.av || { mic: [], cam: [] };
  const mic = av.mic.length > 0, cam = av.cam.length > 0;
  const dot = $('#pdot');
  dot.classList.toggle('on', mic || cam); dot.classList.toggle('cam', cam);
  let h = '';
  if (cam) h += `<span class="av-chip cam" title="Câmera: ${esc(av.cam.map(appLabel).join(', '))}">${IC2.cam}<span>${esc(appLabel(av.cam[0]))}</span></span>`;
  if (mic) h += `<span class="av-chip ${av.micMuted ? 'muted' : ''}" title="Microfone: ${esc(av.mic.map(appLabel).join(', '))}"><span>${esc(appLabel(av.mic[0]))}</span><button data-micmute title="${av.micMuted ? 'Ativar o microfone' : 'Silenciar o microfone'}">${av.micMuted ? IC2.micOff : IC2.mic}</button></span>`;
  $('#av-chips').innerHTML = h;
}
$('#av-chips').addEventListener('click', e => { if (e.target.closest('[data-micmute]')) { window.ilha.media('micmute'); toast(S.av?.micMuted ? 'Microfone ativado' : 'Microfone silenciado'); } });
function onAv(m) {
  const prev = S.av || { mic: [], cam: [] };
  S.av = m; renderAv();
  if (m.cam.length && !prev.cam.length) notice('cam', '#30d158', 'Câmera em uso', appLabel(m.cam[0]), 3500);
  else if (m.mic.length && !prev.mic.length) notice('mic', '#ff9f0a', 'Microfone em uso', appLabel(m.mic[0]), 3500);
  if (prev.micMuted !== undefined && prev.micMuted !== m.micMuted && m.mic.length) notice('mic', m.micMuted ? '#ff453a' : '#ff9f0a', m.micMuted ? 'Microfone silenciado' : 'Microfone ativado', appLabel(m.mic[0]), 2500);
}

/* ---- brilho do monitor ---- */
let brightT = 0, brightAsked = 0;
function onBright(m) {
  $('#bright-row').classList.toggle('na', m.kind === 'none');
  if (m.value >= 0) { $('#bright').value = m.value; $('#bright').style.setProperty('--p', m.value + '%'); $('#bright-v').textContent = m.value + '%'; }
}
$('#bright').addEventListener('input', e => {
  const v = Number(e.target.value);
  e.target.style.setProperty('--p', v + '%'); $('#bright-v').textContent = v + '%';
  clearTimeout(brightT); brightT = setTimeout(() => window.ilha.media('setbright ' + v), 120); // monitores por DDC/CI são lentos: manda só o último valor
});
function askBright() { if (Date.now() - brightAsked > 60000) { brightAsked = Date.now(); window.ilha.media('bright'); } }

/* ---- bateria dos aparelhos Bluetooth ---- */
// periféricos: Bluetooth + fone/mouse com receptor próprio (HyperX, Logitech)
const lowWarned = new Set();
function onPeripherals(list) {
  const prev = new Set((S.btBat || []).map(d => d.name));
  const first = S.btBat === undefined;
  S.btBat = list;
  const bt = list.filter(d => d.kind === 'bt');
  if (bt[0]) { $('#ql-bt').textContent = `${bt[0].name.split(' ')[0]} ${bt[0].battery}% ›`; $('#ql-bt').title = bt.map(d => `${d.name}: ${d.battery}%`).join('\n') + '\nClique para ver os dispositivos'; }
  else { $('#ql-bt').textContent = 'Bluetooth ›'; $('#ql-bt').title = 'Ver os dispositivos Bluetooth'; }
  // no PC de mesa (sem bateria), o 3º anel do Início mostra o periférico com menos bateria
  if (!S.battery && list.length) {
    const low = [...list].sort((a, b) => a.battery - b.battery)[0];
    setRing('ring-bat', low.battery, low.battery + '%');
    $('#ring-bat span').textContent = low.kind === 'headset' ? 'Fone' : low.kind === 'mouse' ? 'Mouse' : low.name.split(' ')[0];
    $('#ring-bat').style.setProperty('--c', low.battery <= 15 ? '#ff453a' : low.battery <= 35 ? '#ff9f0a' : '#30d158');
    $('#ring-bat').title = list.map(d => `${d.name}: ${d.battery}%${d.charging ? ' (carregando)' : ''}`).join('\n');
  }
  for (const d of list) {
    if (!first && !prev.has(d.name)) notice('head', '#0a84ff', d.name, `Bateria ${d.battery}%`, 4000);
    if (d.battery <= 15 && !d.charging && !lowWarned.has(d.name)) { lowWarned.add(d.name); notice('head', '#ff453a', 'Bateria fraca', `${d.name}: ${d.battery}%`, 6000); }
    if (d.battery > 20) lowWarned.delete(d.name);
  }
}
window.ilha.onBtBat(onPeripherals);
window.ilha.peripherals().then(l => { if (l?.length) onPeripherals(l); }).catch(() => {});

/* ---- downloads ao vivo ---- */
window.ilha.onDownload(m => {
  if (m.active) { const had = !!S.dl?.length; S.dl = m.active; if (!S.open && (had !== !!m.active.length || m.active.length)) render(); }
  if (m.done) {
    showAlert('Download concluído', m.done.name, `<span style="color:#64d2ff">${IC2.dl}</span>`, {
      ms: 9000, buttons: [{ label: 'Mostrar', fn: () => window.ilha.reveal(m.done.path) }, { label: 'Abrir', cls: 'blue', fn: () => window.ilha.openPath(m.done.path) }],
    });
  }
});
function renderDownload(L, R) {
  const d = S.dl[0];
  if (L.dataset.k !== 'dl') { L.innerHTML = `<span class="c-ico" style="background:rgba(100,210,255,.2);color:#64d2ff">${IC2.dl}</span><span class="c-note" style="color:var(--t1);max-width:190px"></span>`; L.dataset.k = 'dl'; }
  L.lastChild.textContent = S.dl.length > 1 ? `${S.dl.length} downloads` : d.name;
  const [sv, su] = fmtRate(d.speed);
  R.innerHTML = `<span style="color:var(--t3)">${fmtBytes(d.size)}</span><b style="color:#64d2ff">${sv} ${su}</b>`; R.dataset.k = '';
}

/* ---- print de uma área da tela ---- */
$('#shelf-print').addEventListener('click', () => { close(); window.ilha.print(); });
window.ilha.onPrinted(p => {
  S.cfg.shelf = p.shelf; renderFiles('shelf');
  notice('shot', '#ffffff', 'Print salvo', 'Está na prateleira, pronto para arrastar', 3500);
});

/* ---- ilha pulsando com a música + cor da capa ---- */
const audio = { ctx: null, an: null, stream: null, data: null, raf: 0, lvl: 0, idleT: 0 };
function artColor(src) {
  const img = new Image();
  img.onload = () => {
    const c = document.createElement('canvas'); c.width = c.height = 24;
    const g = c.getContext('2d'); g.drawImage(img, 0, 0, 24, 24);
    const px = g.getImageData(0, 0, 24, 24).data; let best = null, bs = -1;
    for (let i = 0; i < px.length; i += 4) {
      const r = px[i], gg = px[i + 1], b = px[i + 2], mx = Math.max(r, gg, b), mn = Math.min(r, gg, b);
      const sat = mx ? (mx - mn) / mx : 0, score = sat * (mx / 255) * (mx > 60 ? 1 : .2);
      if (score > bs) { bs = score; best = [r, gg, b]; }
    }
    if (best) isl.style.setProperty('--mc', `rgb(${best.join(',')})`);
  };
  img.src = src;
}
async function startAudio() {
  if (audio.stream || S.cfg.musicPulse === false) return;
  try {
    const st = await navigator.mediaDevices.getDisplayMedia({ audio: true, video: { width: 1, height: 1, frameRate: 1 } });
    st.getVideoTracks().forEach(t => t.stop()); // só o som interessa
    if (!st.getAudioTracks().length) return;
    audio.stream = st; audio.ctx = new AudioContext();
    audio.an = audio.ctx.createAnalyser(); audio.an.fftSize = 512; audio.an.smoothingTimeConstant = .6;
    audio.ctx.createMediaStreamSource(st).connect(audio.an);
    audio.data = new Uint8Array(audio.an.frequencyBinCount);
    let last = 0;
    const loop = t => {
      audio.raf = requestAnimationFrame(loop);
      if (t - last < 33) return; last = t;
      audio.an.getByteFrequencyData(audio.data);
      const band = (a, b) => { let s = 0; for (let i = a; i < b; i++) s += audio.data[i]; return s / (b - a) / 255; };
      const bass = band(1, 6);
      audio.lvl = Math.max(bass, audio.lvl * .82);
      isl.style.setProperty('--pulse', Math.min(1, Math.pow(audio.lvl, 1.6) * 1.4).toFixed(3));
      // equalizador da ilha compacta segue o som de verdade
      const bars = $$('#compact .eq i');
      if (bars.length) { const bands = [band(1, 4), band(4, 12), band(12, 40), band(40, 120)]; bars.forEach((el, i) => { el.style.height = (22 + Math.min(1, bands[i] * 1.5) * 78) + '%'; }); }
    };
    audio.raf = requestAnimationFrame(loop);
  } catch (_) { audio.stream = null; }
}
function stopAudio() {
  cancelAnimationFrame(audio.raf);
  audio.stream?.getTracks().forEach(t => t.stop()); audio.stream = null;
  audio.ctx?.close().catch(() => {}); audio.ctx = null;
  isl.style.setProperty('--pulse', 0);
}
function syncPulse() {
  const playing = !!(S.media?.has && S.media.playing) && S.cfg.musicPulse !== false;
  isl.classList.toggle('pulsing', playing);
  $('#compact .eq')?.classList.toggle('live', playing && !!audio.stream);
  clearTimeout(audio.idleT);
  if (playing) startAudio();
  else audio.idleT = setTimeout(stopAudio, 6000); // pausou: espera um pouco antes de soltar a captura
}

/* ---- agenda ---- */
const fmtHM = t => new Date(t).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
function dayLabel(t) {
  const d = new Date(t), n = new Date(), tm = new Date(n.getFullYear(), n.getMonth(), n.getDate() + 1);
  if (d.toDateString() === n.toDateString()) return 'Hoje';
  if (d.toDateString() === tm.toDateString()) return 'Amanhã';
  const s = d.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'short' }); return s[0].toUpperCase() + s.slice(1);
}
function renderAgenda() {
  const a = S.agenda || { events: [] }, now = Date.now();
  const evs = (a.events || []).filter(e => e.end > now);
  const next = evs.find(e => !e.allDay && e.start > now - 5 * 60e3) || evs[0];
  $('#next-ev').innerHTML = next ? `<i></i><span><b>${next.allDay ? dayLabel(next.start) : (dayLabel(next.start) === 'Hoje' ? '' : dayLabel(next.start) + ' ') + fmtHM(next.start)}</b> · ${esc(next.title)}</span>` : '';
  $('#ag-sub').textContent = a.error ? `Erro: ${a.error}` : evs.length ? `${evs.length} compromissos nos próximos dias` : '';
  if (!S.cfg.icsUrl) { $('#ag-list').innerHTML = '<div class="ag-empty">Cole o link iCal da sua agenda em <b>Ajustes → Agenda</b>.<br>Google Agenda: Configurações → sua agenda → <b>Endereço secreto no formato iCal</b>.<br>Outlook: Configurações → Calendário → Calendários compartilhados → <b>Publicar</b> (link ICS).</div>'; return; }
  let h = '', lastDay = '';
  for (const e of evs.slice(0, 40)) {
    const dl = dayLabel(e.start);
    if (dl !== lastDay) { h += `<div class="ag-day">${dl}</div>`; lastDay = dl; }
    const nowEv = e.start <= now && e.end > now;
    h += `<div class="ag-ev ${nowEv ? 'now' : ''}"><em>${e.allDay ? 'Dia inteiro' : `${fmtHM(e.start)} – ${fmtHM(e.end)}`}</em><i></i><div><b>${esc(e.title)}</b>${e.where ? `<small>${esc(e.where)}</small>` : ''}</div>${e.link ? `<button class="join" data-link="${esc(e.link)}">Entrar</button>` : '<span></span>'}</div>`;
  }
  $('#ag-list').innerHTML = h || '<div class="ag-empty">Nada na agenda para os próximos dias.</div>';
}
window.ilha.onAgenda(a => { S.agenda = a; renderAgenda(); });
$('#next-ev').addEventListener('click', () => { $('#forecast').classList.remove('show'); $('#agenda').classList.add('show'); });
$('#ag-close').addEventListener('click', () => $('#agenda').classList.remove('show'));
$('#ag-list').addEventListener('click', e => { const b = e.target.closest('[data-link]'); if (b) { window.ilha.open(b.dataset.link); close(); } });
setInterval(renderAgenda, 60000);
window.ilha.onAgendaAlert(e => {
  chime();
  const mins = Math.max(0, Math.round((e.start - Date.now()) / 60000));
  showAlert(mins ? `Em ${mins} min: ${e.title}` : `Agora: ${e.title}`, `${fmtHM(e.start)} – ${fmtHM(e.end)}${e.where ? ' · ' + e.where : ''}`, `<span style="color:#ff453a">${IC2.cal}</span>`, {
    ms: 60000, buttons: e.link ? [{ label: 'Depois' }, { label: 'Entrar', cls: 'blue', fn: () => window.ilha.open(e.link) }] : [{ label: 'OK', cls: 'primary' }],
  });
});

/* ---- GitHub: teste falhou ---- */
window.ilha.onGhFail(r => {
  showAlert('Teste falhou no GitHub', `${r.repo} · ${r.name}${r.branch ? ' (' + r.branch + ')' : ''}`, `<span style="color:#ff6961">${IC2.gh}</span>`, {
    ms: 20000, buttons: [{ label: 'Depois' }, { label: 'Ver', cls: 'blue', fn: () => window.ilha.open(r.url) }],
  });
});
function renderClaudeExtras(c) {
  const t = c.today || {};
  $('#cl-today').innerHTML = `<span>Hoje: <b>${t.tasks || 0}</b> tarefa${t.tasks === 1 ? '' : 's'}</span><span><b>${fmtDurS(t.ms || 0).replace(/ \d+ s$/, '')}</b> trabalhando</span><span><b>${fmtTok(t.tokens || 0)}</b> tokens</span><span><b>${t.commits || 0}</b> commit${t.commits === 1 ? '' : 's'} · <b>${t.pushes || 0}</b> push</span>`;
  $('#cl-gh').innerHTML = (c.gh || []).map(g => {
    const cls = g.status !== 'completed' ? 'run' : g.conclusion === 'success' ? 'ok' : g.conclusion === 'failure' ? 'fail' : '';
    return `<button class="${cls}" data-url="${esc(g.url)}" title="${esc(g.name)} · ${esc(g.conclusion || g.status)}"><i></i>${esc(g.repo)}</button>`;
  }).join('');
}
$('#cl-gh').addEventListener('click', e => { const b = e.target.closest('[data-url]'); if (b) window.ilha.open(b.dataset.url); });

/* ---- ajustes novos ---- */
onEnter($('#set-ics'), async () => { S.cfg = await window.ilha.setCfg({ icsUrl: $('#set-ics').value.trim() }); toast($('#set-ics').value.trim() ? 'Carregando a agenda…' : 'Agenda removida'); });
$('#set-pulse').addEventListener('change', async e => { S.cfg = await window.ilha.setCfg({ musicPulse: e.target.checked }); syncPulse(); if (!e.target.checked) stopAudio(); });

/* =================== início =================== */
(async function init() {
  S.cfg = await window.ilha.getCfg();
  S.covered = !!S.cfg.covered;
  $('#ver').textContent = S.cfg.version;
  $('#notes').value = S.cfg.notes || '';
  fillSettings();
  renderClips(S.cfg.clips);
  S.conn = await window.ilha.conn();
  S.claude = await window.ilha.claudeState();
  window.ilha.media('radios');
  S.agenda = await window.ilha.agenda(); renderAgenda();
  renderHistory(S.cfg.speedHistory);
  renderFiles('shelf'); renderFiles('favs');
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
