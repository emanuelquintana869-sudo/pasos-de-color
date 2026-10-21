import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { CONFIG } from './config.js';

const sb = createClient(CONFIG.supabaseUrl, CONFIG.supabaseKey, {
  auth: { persistSession: false },
  realtime: { params: { eventsPerSecond: 5 } },
});

const $ = (id) => document.getElementById(id);
const $$ = (sel) => document.querySelectorAll(sel);
const pad = (n) => String(n).padStart(2, '0');
const TZ = 'America/Argentina/Buenos_Aires';
const L = CONFIG.links;
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const LS = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  del(k) { try { localStorage.removeItem(k); } catch {} },
};
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const norm = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

const PROVINCIAS = ['Buenos Aires', 'CABA', 'Catamarca', 'Chaco', 'Chubut', 'Córdoba', 'Corrientes', 'Entre Ríos', 'Formosa', 'Jujuy', 'La Pampa', 'La Rioja', 'Mendoza', 'Misiones', 'Neuquén', 'Río Negro', 'Salta', 'San Juan', 'San Luis', 'Santa Cruz', 'Santa Fe', 'Santiago del Estero', 'Tierra del Fuego', 'Tucumán'];
const SWATCHES = ['#C8102E', '#1F3FA8', '#0E8F4E', '#FFD60A', '#000000', '#FFFFFF', '#6CC4EE', '#7A1C2E', '#FF8A3D', '#5B2BB5'];

const state = {
  teams: [],
  rounds: [],
  next: null,
  liveRound: null,
  phase: 'closed',
  me: LS.get('club_me', null), // { code, role: 'rep' | 'fan' }
  shown: 10,
  supTeam: null,
};

function toast(msg, ms = 3200) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.add('hidden'), ms);
}

// Color de texto legible sobre un color de fondo
function fgFor(hex) {
  const h = (hex || '#000000').replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.4 ? '#170A33' : '#FFFFFF';
}
function initials(name) {
  const stop = ['club', 'social', 'deportivo', 'y', 'de', 'del', 'la', 'el', 'atletico', 'atlético', 'cultural', 'sociedad', 'asociacion', 'asociación', 'fomento', 'cs', 'csd', 'cad'];
  const words = String(name || '').split(/\s+/).filter(Boolean);
  const main = words.filter((w) => !stop.includes(norm(w)));
  const src = main.length ? main : words;
  return (src.length > 1 ? src[0][0] + src[1][0] : (src[0] || '?').slice(0, 2)).toUpperCase();
}
const teamVars = (t) => `--c1:${t.color1};--c2:${t.color2};--fg:${fgFor(t.color1)}`;
const badge = (t, cls = '') => `<span class="badge ${cls}" style="${teamVars(t)}" aria-hidden="true">${esc(initials(t.name))}</span>`;
const where = (t) => [t.barrio, t.city, t.province].filter(Boolean).join(', ');
const paintSock = (el, c1, c2) => { el.style.setProperty('--c1', c1); el.style.setProperty('--c2', c2); };
const teamLink = (code) => `${location.origin}/?c=${code}`;

function fmtLong(iso) {
  const d = new Date(iso);
  const day = d.toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: TZ });
  const time = d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: TZ });
  return { day: day.charAt(0).toUpperCase() + day.slice(1), time };
}
function calendarUrl(round) {
  const start = new Date(round.scheduled_at);
  const end = new Date(start.getTime() + 30 * 60000);
  const f = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  return `https://calendar.google.com/calendar/render?${new URLSearchParams({
    action: 'TEMPLATE', text: `${round.title} en vivo · Club Pasos de Color`, dates: `${f(start)}/${f(end)}`,
    details: `Ronda en vivo: un club de barrio gana medias personalizadas. Entrá a ${location.origin}`, location: location.origin,
  })}`;
}

// ---------------- Redes ----------------
['igBtn', 'sIg', 'fIg'].forEach((id) => ($(id).href = L.goodisgoodInstagram));
$('sNk').href = L.nikaoInstagram;
$('sTt').href = L.goodisgoodTiktok;

// ---------------- Menú ----------------
$('burger').addEventListener('click', () => {
  const open = $('menu').classList.toggle('open');
  $('burger').setAttribute('aria-expanded', String(open));
});
$('menu').addEventListener('click', (e) => {
  if (!e.target.closest('a')) return;
  $('menu').classList.remove('open');
  $('burger').setAttribute('aria-expanded', 'false');
});
const io = new IntersectionObserver((entries) => entries.forEach((en) => {
  if (en.isIntersecting) $$('#menu a').forEach((a) => a.classList.toggle('on', a.getAttribute('href') === `#${en.target.id}`));
}), { rootMargin: '-45% 0px -50% 0px' });
['inicio', 'como', 'ranking', 'historias', 'mapa', 'ganadores', 'preguntas'].forEach((id) => $(id) && io.observe($(id)));

// ---------------- Carrusel ----------------
const slides = [...$$('.slide')];
let cur = 0;
let auto = null;
$('dots').innerHTML = slides.map((_, i) => `<button type="button" role="tab" aria-label="Ir al slide ${i + 1}" aria-current="${i === 0}"></button>`).join('');
const dotBtns = [...$('dots').children];
function go(i) {
  cur = (i + slides.length) % slides.length;
  slides.forEach((s, k) => {
    s.classList.toggle('on', k === cur);
    s.setAttribute('aria-hidden', String(k !== cur));
    s.querySelectorAll('a,button').forEach((el) => (k === cur ? el.removeAttribute('tabindex') : el.setAttribute('tabindex', '-1')));
  });
  dotBtns.forEach((d, k) => d.setAttribute('aria-current', String(k === cur)));
}
function play() { if (reduceMotion) return; stop(); auto = setInterval(() => go(cur + 1), 6500); }
function stop() { clearInterval(auto); }
dotBtns.forEach((d, i) => d.addEventListener('click', () => { go(i); play(); }));
$('prev').addEventListener('click', () => { go(cur - 1); play(); });
$('next').addEventListener('click', () => { go(cur + 1); play(); });
$('slides').addEventListener('mouseenter', stop);
$('slides').addEventListener('mouseleave', play);
$('slides').addEventListener('focusin', stop);
let touchX = null;
$('slides').addEventListener('touchstart', (e) => { touchX = e.touches[0].clientX; }, { passive: true });
$('slides').addEventListener('touchend', (e) => {
  if (touchX === null) return;
  const dx = e.changedTouches[0].clientX - touchX;
  if (Math.abs(dx) > 50) { go(cur + (dx < 0 ? 1 : -1)); play(); }
  touchX = null;
});
go(0);
play();

// ---------------- Clubes ----------------
async function loadTeams() {
  const [{ data: teams }, { data: stats }] = await Promise.all([sb.rpc('club_public_teams'), sb.rpc('club_public_stats')]);
  state.teams = Array.isArray(teams) ? teams : [];
  if (stats) {
    $('stTeams').textContent = (stats.teams || 0).toLocaleString('es-AR');
    $('stFans').textContent = (stats.supporters || 0).toLocaleString('es-AR');
    $('stCities').textContent = (stats.cities || 0).toLocaleString('es-AR');
    $('livePlayers').textContent = stats.teams ? `${stats.teams} clubes en juego · ${stats.supporters} hinchas` : 'Todos los clubes están en juego';
  }
  const provs = [...new Set(state.teams.map((t) => t.province))].sort((a, b) => a.localeCompare(b, 'es'));
  const sel = $('provF');
  const curP = sel.value;
  sel.innerHTML = '<option value="">Todas las provincias</option>' + provs.map((p) => `<option ${p === curP ? 'selected' : ''}>${esc(p)}</option>`).join('');
  // Las medias del carrusel toman los colores de clubes reales
  state.teams.slice(0, 3).forEach((t, i) => { const s = document.querySelector(`[data-team-sock="${i}"]`); if (s) paintSock(s, t.color1, t.color2); });
  renderRank();
  renderStories();
  renderMap();
  renderPicker();
  renderMe();
}

function filteredTeams() {
  const q = norm($('q').value.trim());
  const p = $('provF').value;
  return state.teams.filter((t) => (!p || t.province === p) && (!q || norm(`${t.name} ${t.barrio} ${t.city} ${t.province}`).includes(q)));
}

function renderRank() {
  const list = filteredTeams();
  const max = Math.max(1, ...state.teams.map((t) => t.chances ?? t.supporters));
  if (!state.teams.length) {
    $('rankList').innerHTML = `<div class="empty-box"><h3>El ranking está esperando a su primer club</h3><p>¿Tu club de barrio se merece medias nuevas? Postulalo y que el barrio empiece a empujar.</p><button type="button" class="cta" data-postular>Postular a mi club</button></div>`;
    $('moreBtn').classList.add('hidden');
    return;
  }
  if (!list.length) {
    $('rankList').innerHTML = `<div class="empty-box"><h3>No encontramos ese club</h3><p>Puede que todavía no lo haya postulado nadie.</p><button type="button" class="cta" data-postular>Postularlo</button></div>`;
    $('moreBtn').classList.add('hidden');
    return;
  }
  const rankOf = new Map(state.teams.filter((t) => !t.demo).map((t, i) => [t.code, i + 1]));
  const hasDemo = list.some((t) => t.demo);
  $('rankList').innerHTML = list.slice(0, state.shown).map((t) => {
    const pos = rankOf.get(t.code);
    const pct = Math.max(4, Math.round(((t.chances ?? t.supporters) / max) * 100));
    const mine = state.me?.code === t.code;
    return `<article class="team-row ${!t.demo && pos <= 3 ? `top${pos}` : ''} ${t.demo ? 'demo' : ''}" style="${mine ? 'outline:3px solid var(--mint);outline-offset:2px' : ''}">
      <span class="pos" ${t.demo ? 'aria-hidden="true"' : `aria-label="Puesto ${pos}"`}>${t.demo ? '·' : pos}</span>
      ${badge(t)}
      <div class="team-info">
        <strong>${esc(t.name)}${t.won ? '<span class="won-tag">YA GANÓ</span>' : ''}${t.demo ? '<span class="demo-tag">CLUB DE EJEMPLO</span>' : ''}</strong>
        <span class="where">${esc([t.sport, where(t)].filter(Boolean).join(' · '))}</span>
        <div class="bar" aria-hidden="true"><i style="width:${pct}%;background:repeating-linear-gradient(90deg, ${t.color1} 0 14px, ${t.color2} 14px 22px)"></i></div>
        ${t.story ? `<button type="button" class="story-btn" data-story="${t.code}" aria-expanded="false">Leer su historia</button>` : ''}
      </div>
      <div class="team-side">
        <span class="count">${t.supporters} ${t.supporters === 1 ? 'hincha' : 'hinchas'}${t.clients ? ` · <span class="client-count">${t.clients} ${t.clients === 1 ? 'cliente' : 'clientes'}</span>` : ''}</span>
        ${!t.demo && t.chances !== t.supporters ? `<span class="chances">${t.chances} chances</span>` : ''}
        ${t.demo ? '<span class="demo-note">No participa</span>' : `<button type="button" class="cta" data-apoyar="${t.code}">${mine ? 'Compartir' : 'Apoyar'}</button>`}
      </div>
      ${t.story ? `<p class="team-story hidden" id="story-${t.code}">“${esc(t.story)}”</p>` : ''}
    </article>`;
  }).join('');
  if (hasDemo) $('rankList').insertAdjacentHTML('beforeend', '<p class="demo-explain">Los clubes marcados como <strong>ejemplo</strong> muestran cómo se va a ver la página: no son clubes reales, no suman apoyos y no participan en las rondas.</p>');
  $('moreBtn').classList.toggle('hidden', list.length <= state.shown);
}
$('q').addEventListener('input', () => { state.shown = 10; renderRank(); });
$('provF').addEventListener('change', () => { state.shown = 10; renderRank(); });
$('moreBtn').addEventListener('click', () => { state.shown += 20; renderRank(); });
$('rankList').addEventListener('click', (e) => {
  const b = e.target.closest('[data-story]');
  if (!b) return;
  const p = $(`story-${b.dataset.story}`);
  const open = p.classList.toggle('hidden') === false;
  b.setAttribute('aria-expanded', String(open));
  b.textContent = open ? 'Cerrar historia' : 'Leer su historia';
});

function renderStories() {
  const withStory = state.teams.filter((t) => t.story && t.story.length > 20);
  const track = $('storyTrack');
  if (!withStory.length) {
    track.innerHTML = `<div class="empty-box" style="flex:1 1 100%"><h3>Acá van a aparecer sus historias</h3><p>Cada club que se postula cuenta por qué se merece medias nuevas. ¿Cuál es la historia del tuyo?</p><button type="button" class="cta" data-postular>Contar la de mi club</button></div>`;
    return;
  }
  track.innerHTML = [...withStory.filter((t) => !t.demo), ...withStory.filter((t) => t.demo)].slice(0, 12).map((t) => `<article class="story-card" style="${teamVars(t)}">
    ${t.demo ? '<span class="demo-tag" style="align-self:flex-start;margin:0">HISTORIA DE EJEMPLO</span>' : ''}
    <blockquote>${esc(t.story)}</blockquote>
    <div class="story-who">${badge(t)}<div><strong>${esc(t.name)}</strong><span>${esc(where(t))}</span></div></div>
    ${t.demo ? '' : `<button type="button" class="cta" data-apoyar="${t.code}" style="align-self:flex-start">Apoyar a este club</button>`}
  </article>`).join('');
}

function renderMap() {
  const grid = $('mapGrid');
  if (!state.teams.length) {
    grid.innerHTML = `<div class="empty-box" style="grid-column:1/-1"><h3>El mapa todavía está en blanco</h3><p>Cada club que se postula enciende su barrio acá. Que el tuyo sea el primero.</p><button type="button" class="cta" data-postular>Postular a mi club</button></div>`;
    return;
  }
  const byProv = new Map();
  state.teams.forEach((t) => {
    if (!byProv.has(t.province)) byProv.set(t.province, new Map());
    const cities = byProv.get(t.province);
    const key = t.city.trim();
    if (!cities.has(key)) cities.set(key, []);
    cities.get(key).push(t);
  });
  const provs = [...byProv.entries()].sort((a, b) => [...b[1].values()].flat().length - [...a[1].values()].flat().length);
  grid.innerHTML = provs.map(([prov, cities]) => {
    const total = [...cities.values()].flat().length;
    return `<div class="prov"><h3>${esc(prov)} <small>${total} ${total === 1 ? 'club' : 'clubes'}</small></h3>
      ${[...cities.entries()].sort((a, b) => b[1].length - a[1].length).map(([city, teams]) => `<div class="city">
        <div class="city-name"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s-7-6.2-7-11.5A7 7 0 0119 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg>${esc(city)}</div>
        <div class="city-dots">${teams.map((t) => `<button type="button" class="dot-club ${t.demo ? 'demo' : ''}" data-apoyar="${t.code}" style="${teamVars(t)}" title="${esc(t.name)}${t.demo ? ' (club de ejemplo)' : ''}"><i aria-hidden="true"></i>${esc(t.barrio || t.name)}${t.demo ? ' · ejemplo' : ''}</button>`).join('')}</div>
      </div>`).join('')}
    </div>`;
  }).join('');
}

// ---------------- Rondas ----------------
async function loadRounds() {
  const { data, error } = await sb.from('club_rounds').select('*').neq('status', 'cancelled').order('scheduled_at', { ascending: true });
  if (error) { console.error(error); return; }
  state.rounds = data || [];
  pickNext();
  renderRounds();
  renderWinners();
  const live = state.rounds.find((r) => r.status === 'live');
  $('liveBar').classList.toggle('on', !!live);
  if (live && state.phase === 'closed') openLive(live);
  const recent = state.rounds.filter((r) => r.status === 'done' && r.picked_at && Date.now() - new Date(r.picked_at).getTime() < 10 * 60e3)
    .sort((a, b) => new Date(b.picked_at) - new Date(a.picked_at))[0];
  if (recent && LS.get('club_seen_winner', null) !== recent.id && state.phase === 'closed') { state.liveRound = recent; showLive(); showWinner(recent); }
}
function pickNext() {
  state.next = state.rounds.find((r) => r.status === 'live')
    || state.rounds.find((r) => r.status === 'scheduled' && new Date(r.scheduled_at).getTime() > Date.now() - 3 * 3600e3) || null;
}
function renderRounds() {
  const r = state.next;
  if (!r) {
    $('weekLabel').textContent = 'Próxima ronda';
    $('posterDate').textContent = 'Fecha a confirmar';
    $('posterPrize').textContent = 'Postulá a tu club ahora: apenas anunciemos la próxima ronda, te avisamos.';
    $('s2Date').textContent = 'Próxima ronda a confirmar';
    $('calBtn').classList.add('hidden');
    return;
  }
  const { day, time } = fmtLong(r.scheduled_at);
  $('weekLabel').textContent = r.status === 'live' ? 'EN VIVO AHORA' : `${r.title} · ${day.toLowerCase()}`;
  $('posterDate').textContent = `${day} · ${time} h`;
  $('posterPrize').textContent = `Premio de esta ronda: ${r.prize}.`;
  $('s2Date').textContent = `${r.title} · ${day}, ${time} h`;
  $('calBtn').classList.remove('hidden');
  $('calBtn').href = calendarUrl(r);
}
function renderWinners() {
  const done = state.rounds.filter((r) => r.status === 'done' && r.winner_name).sort((a, b) => new Date(b.picked_at) - new Date(a.picked_at));
  if (!done.length) {
    $('winGrid').innerHTML = `<div class="empty-box" style="grid-column:1/-1"><h3>Esta pared espera a su primer club</h3><p>Cuando se juegue la primera ronda, el club ganador va a estar acá, con sus medias nuevas.</p></div>`;
    return;
  }
  $('winGrid').innerHTML = done.map((w) => {
    const t = { name: w.winner_name, color1: w.winner_color1 || '#5B2BB5', color2: w.winner_color2 || '#FFFFFF' };
    const { day } = fmtLong(w.picked_at);
    return `<article class="win-card" style="${teamVars(t)}">
      <div class="win-top">${badge(t, 'lg')}</div>
      <div class="win-body"><strong>${esc(w.winner_name)}</strong>
        <span>${esc([w.winner_barrio, w.winner_city].filter(Boolean).join(' · '))}</span>
        <span>${esc(w.title)} · ${esc(day)}</span>
        <span class="prize">${esc(w.prize)}</span></div>
    </article>`;
  }).join('');
}
function tick() {
  const r = state.next;
  if (r) {
    const diff = Math.max(0, Math.floor((new Date(r.scheduled_at).getTime() - Date.now()) / 1000));
    $('hD').textContent = pad(Math.floor(diff / 86400));
    $('hH').textContent = pad(Math.floor((diff % 86400) / 3600));
    $('hM').textContent = pad(Math.floor((diff % 3600) / 60));
    $('hS').textContent = pad(diff % 60);
    if (state.phase === 'wait') {
      $('liveWaitTime').textContent = diff > 86400
        ? `${Math.floor(diff / 86400)}d ${pad(Math.floor((diff % 86400) / 3600))}:${pad(Math.floor((diff % 3600) / 60))}:${pad(diff % 60)}`
        : `${pad(Math.floor(diff / 3600))}:${pad(Math.floor((diff % 3600) / 60))}:${pad(diff % 60)}`;
    }
  }
  if (state.phase === 'count' && state.liveRound?.countdown_ends_at) {
    const left = Math.max(0, Math.ceil((new Date(state.liveRound.countdown_ends_at).getTime() - Date.now()) / 1000));
    const el = $('liveNum');
    if (el.textContent !== String(left)) { el.textContent = String(left); el.classList.remove('tick'); void el.offsetWidth; el.classList.add('tick'); }
    if (left === 0) startRoll();
  }
}
setInterval(tick, 250);

// ---------------- Hojas (modales) ----------------
let lastFocus = null;
function openSheet(id) {
  lastFocus = document.activeElement;
  $$('.sheet').forEach((s) => s.classList.add('hidden'));
  $(id).classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  setTimeout(() => $(id).querySelector('.sheet-close')?.focus(), 50);
}
function closeSheets() {
  $$('.sheet').forEach((s) => s.classList.add('hidden'));
  if (state.phase === 'closed') document.body.style.overflow = '';
  lastFocus?.focus?.();
}
$$('.sheet').forEach((s) => s.addEventListener('click', (e) => { if (e.target === s || e.target.closest('[data-close]')) closeSheets(); }));
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') (state.phase !== 'closed' ? closeLive() : closeSheets()); });

document.addEventListener('click', (e) => {
  const post = e.target.closest('[data-postular]');
  if (post) { e.preventDefault(); openPostular(); return; }
  const ap = e.target.closest('[data-apoyar]');
  if (ap) { e.preventDefault(); openApoyar(ap.dataset.apoyar || null); return; }
  if (e.target.closest('[data-me]')) { openMe(); }
});

// Seguir a las marcas (dentro de los formularios)
const FOLLOWS = [
  { id: 'gig', label: 'Seguir a @goodisgood', href: L.goodisgoodInstagram },
  { id: 'nik', label: 'Seguir a @nikao', href: L.nikaoInstagram },
];
const follows = LS.get('club_follows', {});
function renderFollows(boxId) {
  $(boxId).innerHTML = FOLLOWS.map((f) => `<a href="${esc(f.href)}" target="_blank" rel="noopener" data-follow="${f.id}" class="${follows[f.id] ? 'done' : ''}">${follows[f.id] ? '✓ ' : ''}${esc(f.label)}</a>`).join('');
}
['follow1', 'follow3'].forEach((id) => $(id).addEventListener('click', (e) => {
  const a = e.target.closest('[data-follow]');
  if (!a) return;
  follows[a.dataset.follow] = true;
  LS.set('club_follows', follows);
  setTimeout(() => { renderFollows('follow1'); renderFollows('follow3'); validateP3(); validateSup(); }, 50);
}));
const followsOk = () => FOLLOWS.every((f) => follows[f.id]);
const emailOk = (v) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(v).trim());

// ---------------- Postular club ----------------
$('tProv').innerHTML = '<option value="">Elegí</option>' + PROVINCIAS.map((p) => `<option>${p}</option>`).join('');
function postStep(n) {
  ['p1', 'p2', 'p3', 'p4'].forEach((id, i) => $(id).classList.toggle('hidden', i + 1 !== n));
  [1, 2, 3].forEach((k) => $(`pb${k}`).classList.toggle('on', k <= n));
}
function openPostular() {
  postStep(1);
  renderFollows('follow3');
  validateP1();
  openSheet('postSheet');
}
function validateP1() {
  let msg = '';
  if ($('tName').value.trim().length < 2) msg = 'Escribí el nombre del club';
  else if ($('tCity').value.trim().length < 2) msg = 'Contanos la ciudad o localidad';
  else if (!$('tProv').value) msg = 'Elegí la provincia';
  $('p1Next').disabled = !!msg;
  $('ph1').textContent = msg;
  return !msg;
}
$('p1').addEventListener('input', validateP1);
$('p1').addEventListener('change', validateP1);
$('p1').addEventListener('submit', (e) => {
  e.preventDefault();
  if (!validateP1()) return;
  const dup = state.teams.find((t) => norm(t.name) === norm($('tName').value.trim()) && norm(t.city) === norm($('tCity').value.trim()));
  if (dup) { closeSheets(); openApoyar(dup.code); toast('Ese club ya está postulado: sumate como hincha', 5000); return; }
  postStep(2);
  updateDesigner();
});
function swatches(boxId, inputId) {
  $(boxId).innerHTML = SWATCHES.map((c) => `<button type="button" class="swatch" data-c="${c}" style="background:${c}" aria-label="Elegir ${c}" aria-pressed="false"></button>`).join('');
  $(boxId).addEventListener('click', (e) => {
    const b = e.target.closest('[data-c]');
    if (!b) return;
    $(inputId).value = b.dataset.c;
    updateDesigner();
  });
}
swatches('sw1', 'c1');
swatches('sw2', 'c2');
function updateDesigner() {
  const c1 = $('c1').value.toUpperCase();
  const c2 = $('c2').value.toUpperCase();
  paintSock($('designSock'), c1, c2);
  $$('#sw1 .swatch').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.c === c1)));
  $$('#sw2 .swatch').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.c === c2)));
}
['c1', 'c2'].forEach((id) => $(id).addEventListener('input', updateDesigner));
$('tStory').addEventListener('input', () => { $('storyCount').textContent = $('tStory').value.length; });
$('p2').addEventListener('submit', (e) => { e.preventDefault(); postStep(3); validateP3(); $('rName').focus(); });
$$('[data-back]').forEach((b) => b.addEventListener('click', () => postStep(Number(b.dataset.back))));

function validateP3() {
  let msg = '';
  if ($('rName').value.trim().length < 2) msg = 'Escribí tu nombre';
  else if (!emailOk($('rEmail').value)) msg = 'Poné un email válido';
  else if ($('rPhone').value.trim().length < 6) msg = 'Dejanos un WhatsApp para avisarte si el club gana';
  else if ($('rIsClient').checked && !$('rOrder').value.trim()) msg = 'Escribí tu número de pedido';
  else if (!followsOk()) msg = 'Seguí a las dos marcas para continuar';
  else if (!$('rConsent').checked) msg = 'Confirmá que tenés el aval del club';
  $('p3Send').disabled = !!msg;
  $('ph3').classList.remove('err');
  $('ph3').textContent = msg || '¡Todo listo!';
  return !msg;
}
$('rIsClient').addEventListener('change', () => {
  const on = $('rIsClient').checked;
  $('rClientFields').classList.toggle('hidden', !on);
  $('rClientBox').classList.toggle('on', on);
  if (on) $('rOrder').focus();
});
$('p3').addEventListener('input', validateP3);
$('p3').addEventListener('change', validateP3);
$('p3').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!validateP3()) return;
  const btn = $('p3Send');
  btn.disabled = true;
  btn.textContent = 'Postulando…';
  const { data, error } = await sb.rpc('club_register_team', {
    p_name: $('tName').value.trim(), p_sport: $('tSport').value, p_barrio: $('tBarrio').value.trim(),
    p_city: $('tCity').value.trim(), p_province: $('tProv').value, p_color1: $('c1').value.toUpperCase(),
    p_color2: $('c2').value.toUpperCase(), p_story: $('tStory').value.trim(), p_rep_name: $('rName').value.trim(),
    p_rep_role: $('rRole').value, p_rep_email: $('rEmail').value.trim(), p_rep_phone: $('rPhone').value.trim(),
    p_rep_instagram: null, p_team_instagram: $('tIg').value.trim().replace(/^@?/, '@').replace(/^@$/, ''),
    p_channels: { gmail: true, whatsapp: true },
  });
  btn.textContent = 'Postular al club';
  if (error) {
    console.error(error);
    $('ph3').textContent = 'No pudimos postular al club. Revisá los datos e intentá de nuevo.';
    $('ph3').classList.add('err');
    btn.disabled = false;
    return;
  }
  let t = data.team;
  let clientMsg = '';
  let clientOk = false;
  if ($('rIsClient').checked && !data.existing) {
    const r = await sb.rpc('club_support_team_client', {
      p_code: t.code, p_order: $('rOrder').value.trim(), p_contact: '',
      p_name: $('rName').value.trim(), p_email: $('rEmail').value.trim(), p_city: $('tCity').value.trim(), p_channels: { gmail: true, whatsapp: true },
    });
    const st = r.data?.status;
    if (!r.error && (st === 'new_client' || st === 'upgraded' || st === 'existing')) { clientOk = true; t = r.data.team; }
    else clientMsg = {
      invalid: 'El club quedó postulado, pero no encontramos ese número de pedido. Revisalo en tu comprobante y sumalo desde "Apoyar a un club".',
      used: 'El club quedó postulado, pero ese número de pedido ya se usó.',
      limit: 'El club quedó postulado. Hubo demasiados intentos con el pedido: probá en una hora desde "Apoyar a un club".',
    }[st] || 'El club quedó postulado, pero no pudimos validar el pedido. Probá desde "Apoyar a un club".';
  } else if ($('rIsClient').checked && data.existing) {
    clientMsg = 'Para sumar tu pedido a este club, apoyalo desde "Apoyar a un club" marcando "Soy cliente".';
  }
  $('p4Client').textContent = clientMsg;
  $('p4Client').classList.toggle('hidden', !clientMsg);
  state.me = { code: t.code, role: 'rep' };
  LS.set('club_me', state.me);
  paintSock($('doneSock'), t.color1, t.color2);
  $('p4Title').textContent = data.existing ? `${t.name} ya estaba postulado` : `¡${t.name} ya está en carrera!`;
  $('p4Text').textContent = data.existing
    ? 'Alguien ya lo había postulado. Lo importante ahora es sumar gente: compartí el link.'
    : (clientOk ? `¡Gracias, cliente! Tu apoyo vale x3: ${t.name} arranca con ${t.chances} chances. Ahora sumá al barrio.`
      : 'Ahora lo que más ayuda es que el barrio se sume: cada hincha es una chance más.');
  setShare('p4', t, 'Postulé a');
  postStep(4);
  loadTeams();
  subscribePush(true);
});

function setShare(prefix, t, verb) {
  const link = teamLink(t.code);
  $(`${prefix}Link`).textContent = link;
  const msg = `${verb} ${t.name} para ganar medias personalizadas con sus colores (Good is Good × Nikao). Cada persona que lo apoya suma una chance. Entrá y bancalo: ${link}`;
  $(`${prefix}Wa`).href = `https://wa.me/?text=${encodeURIComponent(msg)}`;
  $(`${prefix}Copy`).onclick = async () => { try { await navigator.clipboard.writeText(link); toast('Link copiado'); } catch { toast(link, 6000); } };
  const native = $(`${prefix}Native`);
  if (native && navigator.share) {
    native.classList.remove('hidden');
    native.onclick = () => navigator.share({ title: t.name, text: msg, url: link }).catch(() => {});
  }
}

// ---------------- Apoyar club ----------------
function supStep(n) { ['s0', 's1', 's2'].forEach((id, i) => $(id).classList.toggle('hidden', i !== n)); }
function renderPicker() {
  const q = norm($('sq').value.trim());
  const list = state.teams.filter((t) => !t.demo && (!q || norm(`${t.name} ${t.barrio} ${t.city}`).includes(q))).slice(0, 30);
  $('pickList').innerHTML = list.length ? list.map((t) => `<button type="button" class="pick-item" data-pick="${t.code}">${badge(t)}<span><strong>${esc(t.name)}</strong><small>${esc(where(t))} · ${t.supporters} ${t.supporters === 1 ? 'hincha' : 'hinchas'}</small></span></button>`).join('')
    : '<p class="lead">No hay clubes reales con ese nombre todavía. Si es el tuyo, postulalo.</p>';
}
$('sq').addEventListener('input', renderPicker);
$('pickList').addEventListener('click', (e) => { const b = e.target.closest('[data-pick]'); if (b) selectTeam(b.dataset.pick); });
$('supBack').addEventListener('click', () => { supStep(0); renderPicker(); });

async function openApoyar(code) {
  if (state.me?.code && code && state.me.code === code) { openMe(); return; }
  if (code && state.teams.find((t) => t.code === code)?.demo) { toast('Es un club de ejemplo: muestra cómo se va a ver la página. ¡Postulá al tuyo!', 5000); return; }
  openSheet('supSheet');
  renderFollows('follow1');
  if (code) await selectTeam(code);
  else { supStep(0); renderPicker(); setTimeout(() => $('sq').focus(), 80); }
}
async function selectTeam(code) {
  let t = state.teams.find((x) => x.code === code);
  if (!t) { const { data } = await sb.rpc('club_team_status', { p_code: code }); t = data; }
  if (!t) { toast('No encontramos ese club'); supStep(0); renderPicker(); return; }
  state.supTeam = t;
  $('supHead').innerHTML = `${badge(t, 'lg')}<div><strong>${esc(t.name)}</strong><span>${esc([t.sport, where(t)].filter(Boolean).join(' · '))}</span><br><span><b>${t.supporters}</b> ${t.supporters === 1 ? 'hincha' : 'hinchas'} lo apoyan${t.clients ? ` · ${t.clients} ${t.clients === 1 ? 'cliente' : 'clientes'}` : ''}</span></div>`;
  $('supStory').textContent = t.story ? `“${t.story}”` : '';
  supStep(1);
  validateSup();
}
function validateSup() {
  let msg = '';
  if ($('fName').value.trim().length < 2) msg = 'Escribí tu nombre';
  else if (!emailOk($('fEmail').value)) msg = 'Poné un email válido';
  else if ($('isClient').checked && !$('fOrder').value.trim()) msg = 'Escribí tu número de pedido';
  else if (!followsOk()) msg = 'Seguí a las dos marcas para continuar';
  else if (!$('fConsent').checked) msg = 'Aceptá para continuar';
  $('supSend').disabled = !!msg;
  $('sh1').classList.remove('err');
  $('sh1').textContent = msg || '¡Listo para sumar!';
  return !msg;
}
$('isClient').addEventListener('change', () => {
  $('clientFields').classList.toggle('hidden', !$('isClient').checked);
  $('clientBox').classList.toggle('on', $('isClient').checked);
  $('supSend').textContent = $('isClient').checked ? 'Apoyar como cliente' : 'Apoyar al club';
  if ($('isClient').checked) $('fOrder').focus();
});
$('s1').addEventListener('input', validateSup);
$('s1').addEventListener('change', validateSup);
$('s1').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!validateSup() || !state.supTeam) return;
  const btn = $('supSend');
  btn.disabled = true;
  btn.textContent = 'Sumándote…';
  const asClient = $('isClient').checked;
  const { data, error } = asClient
    ? await sb.rpc('club_support_team_client', {
      p_code: state.supTeam.code, p_order: $('fOrder').value.trim(), p_contact: '',
      p_name: $('fName').value.trim(), p_email: $('fEmail').value.trim(), p_city: $('fCity').value.trim(), p_channels: { gmail: true },
    })
    : await sb.rpc('club_support_team', {
      p_code: state.supTeam.code, p_name: $('fName').value.trim(), p_email: $('fEmail').value.trim(),
      p_city: $('fCity').value.trim(), p_instagram: null, p_channels: { gmail: true },
    });
  btn.textContent = asClient ? 'Apoyar como cliente' : 'Apoyar al club';
  const clientErr = {
    invalid: 'No encontramos ese número de pedido. Revisalo en tu comprobante.',
    used: 'Ese número de pedido ya se usó para apoyar a un club.',
    limit: 'Hubo demasiados intentos. Probá de nuevo en una hora, o apoyá sin número de pedido.',
    no_team: 'Ese club ya no está disponible.',
  };
  if (!error && clientErr[data?.status]) {
    $('sh1').textContent = clientErr[data.status];
    $('sh1').classList.add('err');
    btn.disabled = false;
    return;
  }
  if (error) {
    console.error(error);
    $('sh1').textContent = 'No pudimos sumarte. Intentá de nuevo.';
    $('sh1').classList.add('err');
    btn.disabled = false;
    return;
  }
  const t = data.team;
  state.me = { code: t.code, role: 'fan' };
  LS.set('club_me', state.me);
  paintSock($('supDoneSock'), t.color1, t.color2);
  if (data.status === 'other') {
    $('s2Title').textContent = 'Ya tenés club';
    $('s2Text').textContent = `Con ese mail ya apoyás a ${t.name}. Cada persona puede bancar a un solo club: seguí empujando por el tuyo.`;
  } else if (data.status === 'existing') {
    $('s2Title').textContent = `Ya estabas en la hinchada de ${t.name}`;
    $('s2Text').textContent = `Lleva ${t.supporters} ${t.supporters === 1 ? 'hincha' : 'hinchas'}. Lo que más ayuda ahora es sumar a más gente del barrio.`;
  } else if (data.status === 'new_client' || data.status === 'upgraded') {
    $('s2Title').textContent = '¡Gracias, cliente! Tu apoyo vale x3';
    $('s2Text').textContent = `${data.status === 'upgraded' ? 'Ya apoyabas al club y ahora tu apoyo cuenta triple. ' : ''}${t.name} suma ${t.chances} chances para la próxima ronda.`;
  } else {
    $('s2Title').textContent = '¡Ya sos parte de la hinchada!';
    $('s2Text').textContent = `${t.name} ahora tiene ${t.supporters} ${t.supporters === 1 ? 'hincha' : 'hinchas'}. Gracias por empujar.`;
  }
  setShare('s2', t, 'Estoy apoyando a');
  supStep(2);
  loadTeams();
  subscribePush(true);
});

// ---------------- Mi club ----------------
function renderMe() {
  $('meBtn').textContent = state.me ? 'Mi club' : 'Mi club';
}
async function openMe() {
  if (!state.me) { openApoyar(null); toast('Buscá tu club y sumate'); return; }
  let t = state.teams.find((x) => x.code === state.me.code);
  if (!t) { const { data } = await sb.rpc('club_team_status', { p_code: state.me.code }); t = data; }
  if (!t) { LS.del('club_me'); state.me = null; openApoyar(null); return; }
  openSheet('supSheet');
  paintSock($('supDoneSock'), t.color1, t.color2);
  const pos = state.teams.findIndex((x) => x.code === t.code) + 1;
  $('s2Title').textContent = t.name;
  $('s2Text').textContent = `${state.me.role === 'rep' ? 'Postulaste a este club.' : 'Apoyás a este club.'} Tiene ${t.supporters} ${t.supporters === 1 ? 'hincha' : 'hinchas'}${pos ? ` y está ${pos}° en el ranking` : ''}.`;
  setShare('s2', t, 'Estoy apoyando a');
  supStep(2);
}
$('meBtn').addEventListener('click', openMe);

// ---------------- Push ----------------
function b64ToUint8(b64) {
  const p = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + p).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}
let swReg = null;
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').then(async (r) => {
    swReg = r;
    try { if ((await r.pushManager.getSubscription()) && Notification.permission === 'granted') $('pushBtn').textContent = 'Avisos activados'; } catch {}
  }).catch(() => {});
}
async function subscribePush(silent = false) {
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    if (!silent) toast(isIOS && !standalone ? 'En iPhone: tocá Compartir → "Agregar a inicio", abrí la app y activá los avisos.' : 'Este navegador no permite notificaciones.', 6000);
    return;
  }
  if (silent && Notification.permission !== 'default' && Notification.permission !== 'granted') return;
  try {
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') { if (!silent) toast('Permiso de notificaciones rechazado'); return; }
    const reg = swReg || (await navigator.serviceWorker.ready);
    let sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToUint8(CONFIG.vapidPublicKey) });
    const j = sub.toJSON();
    const { error } = await sb.rpc('club_save_push_subscription', { p_endpoint: j.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth, p_ticket: state.me?.code || null });
    if (error) throw error;
    $('pushBtn').textContent = 'Avisos activados';
    if (!silent) toast('¡Listo! Te avisamos cuando arranque la ronda');
  } catch (err) {
    console.error(err);
    if (!silent) toast('No pudimos activar los avisos en este dispositivo');
  }
}
$$('[data-push]').forEach((b) => b.addEventListener('click', () => subscribePush(false)));

// ---------------- En vivo ----------------
function setPhase(p) {
  state.phase = p;
  $('liveWait').classList.toggle('hidden', p !== 'wait');
  $('liveCount').classList.toggle('hidden', p !== 'count');
  $('liveRoll').classList.toggle('hidden', p !== 'roll');
  $('liveWin').classList.toggle('hidden', p !== 'win');
  $('confetti').classList.toggle('hidden', p !== 'win');
  $('liveBadgeText').textContent = p === 'wait' ? 'PANTALLA EN VIVO' : 'EN VIVO AHORA';
}
function showLive() { closeSheets(); $('live').classList.remove('hidden'); document.body.style.overflow = 'hidden'; stop(); }
function openLive(round) {
  state.liveRound = round;
  showLive();
  $('liveTitle').textContent = `${round.title} · Club Pasos de Color`;
  if (round.status === 'live') setPhase('count');
  else if (round.status === 'done') showWinner(round);
  else setPhase('wait');
  tick();
}
function closeLive() {
  clearInterval(state.rollTimer);
  clearTimeout(state.rollThen);
  $('live').classList.add('hidden');
  document.body.style.overflow = '';
  state.phase = 'closed';
  if (state.liveRound?.status === 'done') LS.set('club_seen_winner', state.liveRound.id);
  play();
}
$$('[data-open-live]').forEach((b) => b.addEventListener('click', () => {
  const live = state.rounds.find((r) => r.status === 'live');
  if (live) openLive(live);
  else if (state.next) openLive(state.next);
  else toast('Todavía no hay una ronda anunciada. Postulá a tu club y te avisamos.');
}));
$('liveClose').addEventListener('click', closeLive);
$('liveBack').addEventListener('click', closeLive);

function startRoll(then) {
  if (state.phase !== 'roll') {
    setPhase('roll');
    state.rollStarted = Date.now();
    clearInterval(state.rollTimer);
    const real = state.teams.filter((t) => !t.demo);
    const names = real.length ? real.map((t) => t.name) : ['…'];
    let i = Math.floor(Math.random() * names.length);
    state.rollTimer = setInterval(() => { i = (i + 1 + Math.floor(Math.random() * 3)) % names.length; $('liveRollText').textContent = names[i]; }, 110);
  }
  if (then) {
    clearTimeout(state.rollThen);
    const rolled = Date.now() - (state.rollStarted || Date.now());
    state.rollThen = setTimeout(then, rolled > 2500 ? 1200 : 3500 - rolled);
  }
}
function showWinner(round) {
  clearInterval(state.rollTimer);
  state.liveRound = round;
  const c1 = round.winner_color1 || '#5B2BB5';
  const c2 = round.winner_color2 || '#FFFFFF';
  $('winBox').style.setProperty('--c1', c1);
  $('winBox').style.setProperty('--c2', c2);
  paintSock($('winSock'), c1, c2);
  $('winName').textContent = round.winner_name || '—';
  $('winMeta').textContent = [round.winner_club, round.winner_barrio, round.winner_city].filter(Boolean).join(' · ');
  $('winTicket').textContent = round.prize;
  $('winMe').classList.toggle('hidden', !(state.me && state.me.code === round.winner_ticket));
  buildConfetti(c1, c2);
  setPhase('win');
  LS.set('club_seen_winner', round.id);
}
function buildConfetti(c1, c2) {
  const colors = [c1, c2, '#FFD60A', '#2EE6B0', '#FF3D8B', '#FFFFFF'];
  let html = '';
  for (let i = 0; i < 60; i++) {
    const w = 8 + (i * 7) % 10;
    html += `<i style="left:${(i * 37) % 100}%;width:${w}px;height:${w * 1.8}px;background:${colors[i % colors.length]};animation-duration:${3 + (i % 5) * 0.7}s;animation-delay:${(i % 10) * 0.2}s"></i>`;
  }
  $('confetti').innerHTML = html;
}
function notifyLocal(title, body) {
  try { if (document.hidden && Notification.permission === 'granted' && swReg) swReg.showNotification(title, { body, icon: '/icon-192.png', tag: 'club-live' }); } catch {}
}
function onRoundChange(payload) {
  const r = payload.new;
  if (!r || !r.id) { loadRounds(); return; }
  const idx = state.rounds.findIndex((x) => x.id === r.id);
  if (r.status === 'cancelled') { if (idx >= 0) state.rounds.splice(idx, 1); } else if (idx >= 0) state.rounds[idx] = r; else state.rounds.push(r);
  state.rounds.sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at));
  pickNext();
  renderRounds();
  $('liveBar').classList.toggle('on', state.rounds.some((x) => x.status === 'live'));
  if (r.status === 'live') {
    notifyLocal('¡La ronda está EN VIVO!', 'Entrá ya: estamos por elegir al club que gana medias nuevas.');
    openLive(r);
  } else if (r.status === 'done' && r.winner_name) {
    if (state.phase === 'closed') { state.liveRound = r; showLive(); }
    $('liveTitle').textContent = `${r.title} · Club Pasos de Color`;
    if (state.phase === 'win' && state.liveRound?.id === r.id) showWinner(r);
    else startRoll(() => { showWinner(r); loadTeams(); });
  } else if (state.liveRound?.id === r.id && r.status === 'scheduled' && state.phase !== 'closed') {
    setPhase('wait');
  }
  renderWinners();
}
sb.channel('club-rondas').on('postgres_changes', { event: '*', schema: 'public', table: 'club_rounds' }, onRoundChange).subscribe();
document.addEventListener('visibilitychange', () => { if (!document.hidden) { loadRounds(); loadTeams(); } });
setInterval(loadRounds, 60000);
setInterval(loadTeams, 120000);

// ---------------- Inicio ----------------
updateDesigner();
loadTeams().then(() => {
  const c = new URLSearchParams(location.search).get('c');
  if (c) openApoyar(c.toUpperCase());
});
loadRounds();
if (new URLSearchParams(location.search).has('envivo')) setTimeout(() => document.querySelector('[data-open-live]')?.click(), 900);
