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
const sockHTML = (pattern) => `<div class="sock ${pattern}"><div class="leg"></div><div class="foot"></div><div class="cuff"></div></div>`;

const state = {
  rounds: [],
  next: null,
  liveRound: null,
  phase: 'closed',
  me: null, // { ticket, first_name, chances }
  rollTimer: null,
};

function toast(msg, ms = 3200) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.add('hidden'), ms);
}

function fmtLong(iso) {
  const d = new Date(iso);
  const day = d.toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: TZ });
  const time = d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: TZ });
  return { day: day.charAt(0).toUpperCase() + day.slice(1), time };
}

function calendarUrl(round) {
  if (!round) return '#';
  const start = new Date(round.scheduled_at);
  const end = new Date(start.getTime() + 30 * 60000);
  const f = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const p = new URLSearchParams({
    action: 'TEMPLATE',
    text: `${round.title} en vivo · Club Pasos de Color`,
    dates: `${f(start)}/${f(end)}`,
    details: `Ronda en vivo para ganar medias Good is Good × Nikao. Entrá a ${location.origin} un ratito antes.`,
    location: location.origin,
  });
  return `https://calendar.google.com/calendar/render?${p}`;
}

// ---------------- Links de redes ----------------
$('igBtn').href = L.goodisgoodInstagram;
$('sIg').href = L.goodisgoodInstagram;
$('fIg').href = L.goodisgoodInstagram;
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
const sections = ['inicio', 'premios', 'ganadores', 'club', 'niveles', 'preguntas'];
const io = new IntersectionObserver((entries) => {
  entries.forEach((en) => {
    if (!en.isIntersecting) return;
    $$('#menu a').forEach((a) => a.classList.toggle('on', a.getAttribute('href') === `#${en.target.id}`));
  });
}, { rootMargin: '-45% 0px -50% 0px' });
sections.forEach((id) => $(id) && io.observe($(id)));

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
function play() { if (reduceMotion) return; stop(); auto = setInterval(() => go(cur + 1), 6000); }
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

// ---------------- Beneficios desplegables ----------------
$$('.perk-toggle').forEach((b) => b.addEventListener('click', () => {
  const p = $(b.getAttribute('aria-controls'));
  const open = b.getAttribute('aria-expanded') !== 'true';
  b.setAttribute('aria-expanded', String(open));
  p.hidden = !open;
}));

// ---------------- Niveles ----------------
const LEVELS = [
  { name: 'De colección', badge: 'NIVEL 4', desc: 'Leyenda del barrio', friends: 5, pattern: 'p-stripe-pink', bg: '#FFE9A8', top: true },
  { name: 'Media larga', badge: 'NIVEL 3', desc: 'Se te ve el compromiso', friends: 3, pattern: 'p-dots-blue', bg: '#DDE1FF' },
  { name: 'Media corta', badge: 'NIVEL 2', desc: 'Ya le metiste onda', friends: 1, pattern: 'p-stripe-mint', bg: '#C9F7E8' },
  { name: 'Descalzo', badge: 'NIVEL 1', desc: 'Recién llegás al club', friends: 0, pattern: 'p-zig', bg: '#E9E0FF' },
];
const ASC = [...LEVELS].sort((a, b) => a.friends - b.friends);
function levelFor(chances) {
  const friends = Math.max(0, (chances || 1) - 1);
  let lv = ASC[0];
  ASC.forEach((l) => { if (friends >= l.friends) lv = l; });
  const nextLv = ASC.find((l) => l.friends > friends) || null;
  return { lv, friends, nextLv };
}

function renderLevels() {
  const mine = state.me ? levelFor(state.me.chances) : null;
  $('lvGrid').innerHTML = LEVELS.map((l) => {
    const chances = l.friends + 1;
    const isMine = mine && mine.lv.name === l.name;
    const action = state.me
      ? `<button type="button" class="cta" data-share>${isMine ? 'Compartir mi link' : 'Sumar amigos'}</button>`
      : `<button type="button" class="cta" data-join>${l.friends === 0 ? 'Empezar gratis' : '¡Sumarme ya!'}</button>`;
    return `<article class="lv ${l.top ? 'top' : ''} ${isMine ? 'mine' : ''}">
      ${l.top ? '<div class="lv-flag">El nivel más alto del club</div>' : ''}
      <div class="lv-head"><span class="lv-name">${esc(l.name)}</span><span class="lv-badge">${l.badge}</span></div>
      <p class="lv-desc">${esc(l.desc)}</p>
      <div class="lv-avatar" style="background:${l.bg}" aria-hidden="true">${sockHTML(l.pattern)}</div>
      <ul>
        <li>Participás en todas las rondas en vivo.</li>
        <li>Te avisamos antes de cada ronda.</li>
        <li><strong>${chances} ${chances === 1 ? 'chance' : 'chances'}</strong> en cada ronda.</li>
      </ul>
      <div class="lv-price"><b>Gratis</b><small>×${chances} ${chances === 1 ? 'chance' : 'chances'}</small></div>
      <div class="lv-note">${l.friends === 0 ? 'Con solo anotarte' : `Con ${l.friends} ${l.friends === 1 ? 'amigo sumado' : 'amigos sumados'}`}</div>
      ${isMine ? '<div class="lv-me">Este es tu nivel</div>' : ''}
      ${action}
    </article>`;
  }).join('');

  const box = $('myLevel');
  if (!mine) { box.classList.add('hidden'); return; }
  box.classList.remove('hidden');
  const { lv, friends, nextLv } = mine;
  const pct = nextLv ? Math.round((friends - lv.friends) / (nextLv.friends - lv.friends) * 100) : 100;
  const falta = nextLv ? nextLv.friends - friends : 0;
  box.innerHTML = `<div>${esc(state.me.first_name || 'Hola')}, sos nivel <strong>${esc(lv.name)}</strong> · ${state.me.chances} ${state.me.chances === 1 ? 'chance' : 'chances'} por ronda</div>
    <div style="margin-top:4px;color:var(--soft);font-size:15px">${nextLv ? `Te ${falta === 1 ? 'falta 1 amigo' : `faltan ${falta} amigos`} para llegar a <strong>${esc(nextLv.name)}</strong>` : '¡Llegaste al nivel más alto!'}</div>
    <div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><i style="width:${pct}%"></i></div>`;
}
$('lvGrid').addEventListener('click', (e) => { if (e.target.closest('[data-share]')) openJoin(true); });

// ---------------- Rondas ----------------
async function loadRounds() {
  const { data, error } = await sb.from('rounds').select('*').neq('status', 'cancelled').order('scheduled_at', { ascending: true });
  if (error) { console.error(error); return; }
  state.rounds = data || [];
  pickNext();
  renderRounds();
  renderWinners();
  const live = state.rounds.find((r) => r.status === 'live');
  $('liveBar').classList.toggle('on', !!live);
  if (live && state.phase === 'closed') openLive(live);
  const now = Date.now();
  const recent = state.rounds
    .filter((r) => r.status === 'done' && r.picked_at && now - new Date(r.picked_at).getTime() < 10 * 60e3)
    .sort((a, b) => new Date(b.picked_at) - new Date(a.picked_at))[0];
  if (recent && LS.get('pdc_seen_winner', null) !== recent.id && state.phase === 'closed') {
    state.liveRound = recent; showLive(); showWinner(recent);
  }
}

function pickNext() {
  const now = Date.now();
  state.next = state.rounds.find((r) => r.status === 'live')
    || state.rounds.find((r) => r.status === 'scheduled' && new Date(r.scheduled_at).getTime() > now - 3 * 3600e3)
    || null;
}

function renderRounds() {
  const r = state.next;
  if (!r) {
    $('luckyPrize').textContent = 'La próxima ronda se anuncia pronto. Anotate y te avisamos.';
    $('posterDate').textContent = 'Fecha a confirmar';
    $('weekLabel').textContent = 'Próxima ronda';
    $('s2Date').textContent = 'Próxima ronda a confirmar';
    $('calBtn').classList.add('hidden');
  } else {
    const { day, time } = fmtLong(r.scheduled_at);
    $('luckyPrize').textContent = `${r.title}: ${r.prize} · ${day}, ${time} h`;
    $('posterDate').textContent = `${day} · ${time} h`;
    $('posterPrize').textContent = `${r.title} · ${r.prize}. Participás gratis con solo anotarte.`;
    $('weekLabel').textContent = r.status === 'live' ? 'EN VIVO AHORA' : `Ronda del ${day.toLowerCase()}`;
    $('s2Date').textContent = `${day} · ${time} h`;
    $('calBtn').classList.remove('hidden');
    $('calBtn').href = calendarUrl(r);
  }
  const upcoming = state.rounds.filter((x) => x.status === 'live' || (x.status === 'scheduled' && new Date(x.scheduled_at).getTime() > Date.now() - 3 * 3600e3));
  $('roundsList').innerHTML = upcoming.slice(0, 6).map((x, i) => {
    const { day, time } = fmtLong(x.scheduled_at);
    return `<div class="round-card">
      <span class="pill" ${x.status === 'live' ? 'style="background:var(--pink)"' : ''}>${x.status === 'live' ? 'EN VIVO' : i === 0 ? 'PRÓXIMA' : 'PROGRAMADA'}</span>
      <b>${esc(x.title)}</b>
      <span>${esc(day)} · ${esc(time)} h</span>
      <span style="color:var(--white);font-weight:700">${esc(x.prize)}</span>
    </div>`;
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
    if (el.textContent !== String(left)) {
      el.textContent = String(left);
      el.classList.remove('tick'); void el.offsetWidth; el.classList.add('tick');
    }
    if (left === 0) startRoll();
  }
}
setInterval(tick, 250);

// ---------------- Ganadores ----------------
const TILE_BG = [
  'repeating-linear-gradient(135deg,#FF3D8B 0 22px,#FFD1E4 22px 32px)',
  'repeating-linear-gradient(135deg,#FFD60A 0 22px,#FFF3B0 22px 32px)',
  'repeating-linear-gradient(135deg,#2EE6B0 0 22px,#C9F7E8 22px 32px)',
  'repeating-linear-gradient(135deg,#6C7BFF 0 22px,#DDE1FF 22px 32px)',
  'repeating-linear-gradient(135deg,#FF8A3D 0 22px,#FFE0C7 22px 32px)',
];
function renderWinners() {
  const done = state.rounds.filter((r) => r.status === 'done' && r.winner_name)
    .sort((a, b) => new Date(b.picked_at) - new Date(a.picked_at));
  const tiles = done.map((w, i) => {
    const parts = (w.winner_name || '').split(' ');
    const ini = ((parts[0]?.[0] || '') + (parts[1]?.[0] || '')).toUpperCase();
    return `<div class="w-tile ${i % 3 === 0 ? 'wide' : ''}" style="background:${TILE_BG[i % TILE_BG.length]}">
      <span class="ini" aria-hidden="true">${esc(ini)}</span>
      <b>${esc(w.winner_name)}</b>
      <span>${esc([w.winner_club, w.title].filter(Boolean).join(' · '))}</span>
    </div>`;
  });
  const fillers = ['Tu nombre acá', 'Próximo ganador', '¿Vos?', 'Medias nuevas', 'Este viernes', 'Sumate y jugá'];
  let i = 0;
  while (tiles.length < 8) {
    tiles.push(`<div class="w-tile empty ${tiles.length % 3 === 0 ? 'wide' : ''}"><b>${fillers[i % fillers.length]}</b><span>Club Pasos de Color</span></div>`);
    i++;
  }
  const half = Math.ceil(tiles.length / 2);
  const row1 = tiles.slice(0, half).join('');
  const row2 = tiles.slice(half).concat(tiles.slice(0, Math.max(0, half - (tiles.length - half)))).join('');
  $('track1').innerHTML = row1 + row1;
  $('track2').innerHTML = row2 + row2;
  [$('track1'), $('track2')].forEach((t) => [...t.children].slice(t.children.length / 2).forEach((c) => c.setAttribute('aria-hidden', 'true')));
}

// ---------------- Sumarme ----------------
const REQS = [
  { id: 'ig', title: 'Seguí a @goodisgood', desc: 'Instagram de la fábrica', href: L.goodisgoodInstagram, cta: 'Seguir' },
  { id: 'nk', title: 'Seguí a @nikao', desc: 'Instagram de Nikao', href: L.nikaoInstagram, cta: 'Seguir' },
  { id: 'tt', title: 'Seguí a Good is Good en TikTok', desc: 'El detrás de escena', href: L.goodisgoodTiktok, cta: 'Seguir' },
  { id: 'tag', title: 'Like al posteo y etiquetá a 2 amigos', desc: 'En el posteo fijado', href: L.postFijado, cta: 'Ir' },
];
const checks = LS.get('pdc_checks', {});
const channels = { gmail: true, push: true, whatsapp: false, calendar: false };
let lastFocus = null;

function renderReqs() {
  $('reqList').innerHTML = REQS.map((r, i) => {
    const done = !!checks[r.id];
    return `<div class="req ${done ? 'done' : ''}">
      <button type="button" class="req-check" data-req="${r.id}" aria-pressed="${done}" aria-label="${done ? 'Desmarcar' : 'Marcar como hecho'}: ${esc(r.title)}">${done ? '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>' : i + 1}</button>
      <div class="req-txt"><strong>${esc(r.title)}</strong><span>${esc(r.desc)}</span></div>
      <a href="${esc(r.href)}" target="_blank" rel="noopener" data-req-link="${r.id}">${esc(r.cta)}</a>
    </div>`;
  }).join('');
  const missing = REQS.filter((r) => !checks[r.id]).length;
  $('toStep2').disabled = missing > 0;
  $('h1').textContent = missing ? `Te ${missing === 1 ? 'falta 1 paso' : `faltan ${missing} pasos`}` : '¡Perfecto! Seguí al paso 2';
}
$('reqList').addEventListener('click', (e) => {
  const b = e.target.closest('[data-req]');
  const a = e.target.closest('[data-req-link]');
  if (b) checks[b.dataset.req] = !checks[b.dataset.req];
  else if (a) checks[a.dataset.reqLink] = true;
  else return;
  LS.set('pdc_checks', checks);
  renderReqs();
});

function setStep(n) {
  [1, 2, 3].forEach((k) => {
    $(`step${k}`).classList.toggle('hidden', k !== n);
    $(`sb${k}`).classList.toggle('on', k <= n);
  });
}

function openSheet(id) {
  lastFocus = document.activeElement;
  $(id).classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  setTimeout(() => $(id).querySelector('.sheet-close')?.focus(), 50);
}
function closeSheets() {
  $$('.sheet').forEach((s) => s.classList.add('hidden'));
  if (state.phase === 'closed') document.body.style.overflow = '';
  lastFocus?.focus?.();
}
$$('.sheet').forEach((s) => s.addEventListener('click', (e) => {
  if (e.target === s || e.target.closest('[data-close]')) closeSheets();
}));
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (state.phase !== 'closed') closeLive();
  else closeSheets();
});

function startForm() {
  renderReqs();
  setStep(REQS.every((r) => checks[r.id]) ? 2 : 1);
  validate();
}
function openJoin(showMine = !!state.me) {
  closeSheets();
  if (showMine && state.me) {
    showDone(state.me.first_name, state.me.ticket, state.me.chances, false);
    $('okText').textContent = 'Seguís participando en todas las rondas. Sumá amigos con tu link para subir de nivel.';
    setStep(3);
  } else startForm();
  openSheet('joinSheet');
}
document.addEventListener('click', (e) => {
  if (e.target.closest('[data-join]')) { e.preventDefault(); openJoin(); return; }
  if (e.target.closest('[data-me]')) openMe();
});
$('anotherBtn').addEventListener('click', () => {
  $('step2').reset();
  $$('[data-ch]').forEach((b) => { channels[b.dataset.ch] = b.dataset.ch === 'gmail' || b.dataset.ch === 'push'; b.setAttribute('aria-pressed', String(channels[b.dataset.ch])); });
  startForm();
});
$('toStep2').addEventListener('click', () => { setStep(2); validate(); $('fName').focus(); });
$('back1').addEventListener('click', () => { renderReqs(); setStep(1); });

$$('[data-ch]').forEach((b) => b.addEventListener('click', () => {
  const k = b.dataset.ch;
  channels[k] = !channels[k];
  b.setAttribute('aria-pressed', String(channels[k]));
  if (k === 'whatsapp' && channels[k]) $('fPhone').focus();
  validate();
}));

const emailOk = (v) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.trim());
function validate() {
  let msg = '';
  if ($('fName').value.trim().length < 2) msg = 'Completá tu nombre';
  else if (!emailOk($('fEmail').value)) msg = 'Poné un email válido';
  else if (channels.whatsapp && $('fPhone').value.trim().length < 6) msg = 'Dejanos tu WhatsApp o desmarcá esa opción';
  else if (!$('fConsent').checked) msg = 'Aceptá para continuar';
  $('submitBtn').disabled = !!msg;
  $('h2').classList.remove('err');
  $('h2').textContent = msg || '¡Todo listo!';
  return !msg;
}
$('step2').addEventListener('input', validate);
$('step2').addEventListener('change', validate);

const ref = new URLSearchParams(location.search).get('r');
if (ref) LS.set('pdc_ref', ref.toUpperCase());

$('step2').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!validate()) return;
  const btn = $('submitBtn');
  btn.disabled = true;
  btn.textContent = 'Sumándote…';
  const name = $('fName').value.trim();
  const { data, error } = await sb.rpc('register_participant', {
    p_name: name,
    p_email: $('fEmail').value.trim(),
    p_instagram: $('fIg2').value.trim().replace(/^@?/, '@').replace(/^@$/, ''),
    p_club: $('fClub').value.trim(),
    p_city: $('fCity').value.trim(),
    p_phone: $('fPhone').value.trim(),
    p_channels: { ...channels, origen: 'club' },
    p_ref: LS.get('pdc_ref', null),
  });
  btn.textContent = '¡Sumarme al club!';
  if (error) {
    console.error(error);
    $('h2').textContent = 'No pudimos anotarte. Revisá los datos e intentá de nuevo.';
    $('h2').classList.add('err');
    btn.disabled = false;
    return;
  }
  const first = name.split(' ')[0];
  state.me = { ticket: data.ticket, first_name: first, chances: data.chances };
  LS.set('pdc_ticket', data.ticket);
  showDone(first, data.ticket, data.chances, data.existing);
  setStep(3);
  renderLevels();
  if (channels.push) subscribePush(true);
  if (channels.calendar && state.next) window.open(calendarUrl(state.next), '_blank', 'noopener');
  loadStats();
});

function showDone(first, ticket, chances, existing) {
  const { lv } = levelFor(chances);
  $('okTitle').textContent = existing ? `¡Ya eras del club, ${first || 'crack'}!` : `¡Ya sos del club, ${first || 'crack'}!`;
  $('okText').textContent = existing ? 'Ese mail ya estaba anotado: seguís con tu mismo número.' : 'Quedaste anotado para todas las rondas.';
  $('okTicket').textContent = ticket;
  $('okLevel').textContent = `Nivel ${lv.name} · ${chances} ${chances === 1 ? 'chance' : 'chances'}`;
  const link = `${location.origin}/?r=${ticket}`;
  $('okLink').textContent = link;
  const msg = `Me sumé al Club Pasos de Color para ganar medias Good is Good × Nikao. Entrá gratis con mi link: ${link}`;
  $('waShare').href = `https://wa.me/?text=${encodeURIComponent(msg)}`;
  if (navigator.share) {
    $('nativeShare').classList.remove('hidden');
    $('nativeShare').onclick = () => navigator.share({ title: 'Club Pasos de Color', text: msg, url: link }).catch(() => {});
  }
  $('copyLink').onclick = async () => {
    try { await navigator.clipboard.writeText(link); toast('Link copiado'); } catch { toast(link, 6000); }
  };
}

// ---------------- Mi número ----------------
function openMe() {
  closeSheets();
  $('meHint').textContent = '';
  $('meTicket').value = state.me?.ticket || '';
  openSheet('meSheet');
}
$('meBtn').addEventListener('click', () => (state.me ? openJoin(true) : openMe()));
$('meForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const t = $('meTicket').value.trim().toUpperCase();
  if (!/^GIG-[0-9A-F]{6}$/.test(t)) { $('meHint').textContent = 'El número tiene este formato: GIG-1A2B3C'; $('meHint').classList.add('err'); return; }
  const { data } = await sb.rpc('participant_status', { p_ticket: t });
  if (!data) { $('meHint').textContent = 'No encontramos ese número.'; $('meHint').classList.add('err'); return; }
  state.me = data;
  LS.set('pdc_ticket', data.ticket);
  renderLevels();
  refreshMeBtn();
  closeSheets();
  openJoin(true);
});
function refreshMeBtn() { $('meBtn').textContent = state.me ? state.me.ticket : 'Mi número'; }

async function restoreMe() {
  const t = LS.get('pdc_ticket', null);
  if (!t) { renderLevels(); return; }
  const { data } = await sb.rpc('participant_status', { p_ticket: t });
  if (data) state.me = data; else LS.del('pdc_ticket');
  renderLevels();
  refreshMeBtn();
}

async function loadStats() {
  const { data } = await sb.rpc('public_stats');
  const n = data?.participants || 0;
  $('livePlayers').textContent = n ? `${n.toLocaleString('es-AR')} participantes en juego` : 'Todos los anotados están en juego';
}

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
    if (isIOS && !standalone) toast('En iPhone: tocá Compartir → "Agregar a inicio", abrí la app y activá los avisos.', 7000);
    else if (!silent) toast('Este navegador no permite notificaciones. Agendá la ronda en el calendario.', 5000);
    return;
  }
  try {
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') { if (!silent) toast('Permiso de notificaciones rechazado'); return; }
    const reg = swReg || (await navigator.serviceWorker.ready);
    let sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToUint8(CONFIG.vapidPublicKey) });
    const j = sub.toJSON();
    const { error } = await sb.rpc('save_push_subscription', { p_endpoint: j.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth, p_ticket: state.me?.ticket || null });
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
  if (state.liveRound?.status === 'done') LS.set('pdc_seen_winner', state.liveRound.id);
  play();
}
$$('[data-open-live]').forEach((b) => b.addEventListener('click', () => {
  const live = state.rounds.find((r) => r.status === 'live');
  if (live) openLive(live);
  else if (state.next) openLive(state.next);
  else toast('Todavía no hay una ronda anunciada. ¡Sumate y te avisamos!');
}));
$('liveClose').addEventListener('click', closeLive);
$('liveBack').addEventListener('click', closeLive);

const randomTicket = () => 'GIG-' + Math.floor(Math.random() * 0xffffff).toString(16).toUpperCase().padStart(6, '0');
function startRoll(then) {
  if (state.phase !== 'roll') {
    setPhase('roll');
    state.rollStarted = Date.now();
    clearInterval(state.rollTimer);
    state.rollTimer = setInterval(() => { $('liveRollText').textContent = randomTicket(); }, 80);
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
  $('winName').textContent = round.winner_name || '—';
  $('winMeta').textContent = [round.winner_club && `Hincha de ${round.winner_club}`, round.winner_city].filter(Boolean).join(' · ') || round.prize;
  $('winTicket').textContent = `Número ${round.winner_ticket || ''} · ${round.prize}`;
  $('winMe').classList.toggle('hidden', !(state.me && state.me.ticket === round.winner_ticket));
  buildConfetti();
  setPhase('win');
  LS.set('pdc_seen_winner', round.id);
}
function buildConfetti() {
  const c = $('confetti');
  if (c.childElementCount) return;
  const colors = ['#FF3D8B', '#FFD60A', '#2EE6B0', '#B794FF', '#FF8A3D', '#FFFFFF'];
  let html = '';
  for (let i = 0; i < 60; i++) {
    const w = 8 + (i * 7) % 10;
    html += `<i style="left:${(i * 37) % 100}%;width:${w}px;height:${w * 1.8}px;background:${colors[i % colors.length]};animation-duration:${3 + (i % 5) * 0.7}s;animation-delay:${(i % 10) * 0.2}s"></i>`;
  }
  c.innerHTML = html;
}
function notifyLocal(title, body) {
  try { if (document.hidden && Notification.permission === 'granted' && swReg) swReg.showNotification(title, { body, icon: '/icon-192.png', tag: 'pdc-live' }); } catch {}
}

function onRoundChange(payload) {
  const r = payload.new;
  if (!r || !r.id) { loadRounds(); return; }
  const idx = state.rounds.findIndex((x) => x.id === r.id);
  if (r.status === 'cancelled') { if (idx >= 0) state.rounds.splice(idx, 1); }
  else if (idx >= 0) state.rounds[idx] = r; else state.rounds.push(r);
  state.rounds.sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at));
  pickNext();
  renderRounds();
  $('liveBar').classList.toggle('on', state.rounds.some((x) => x.status === 'live'));
  if (r.status === 'live') {
    notifyLocal('¡La ronda está EN VIVO!', 'Entrá ya al Club Pasos de Color para ver quién gana.');
    openLive(r);
  } else if (r.status === 'done' && r.winner_name) {
    if (state.phase === 'closed') { state.liveRound = r; showLive(); }
    $('liveTitle').textContent = `${r.title} · Club Pasos de Color`;
    if (state.phase === 'win' && state.liveRound?.id === r.id) showWinner(r);
    else startRoll(() => showWinner(r));
  } else if (state.liveRound?.id === r.id && r.status === 'scheduled' && state.phase !== 'closed') {
    setPhase('wait');
  }
  renderWinners();
}
sb.channel('club-rondas').on('postgres_changes', { event: '*', schema: 'public', table: 'rounds' }, onRoundChange).subscribe();
document.addEventListener('visibilitychange', () => { if (!document.hidden) loadRounds(); });
setInterval(loadRounds, 60000);

// ---------------- Inicio ----------------
renderReqs();
renderWinners();
loadRounds();
loadStats();
restoreMe();
if (ref) setTimeout(() => { if (!state.me) openJoin(); }, 1200);
if (new URLSearchParams(location.search).has('envivo')) setTimeout(() => document.querySelector('[data-open-live]')?.click(), 900);
