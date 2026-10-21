import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { CONFIG } from './config.js';

const sb = createClient(CONFIG.supabaseUrl, CONFIG.supabaseKey, {
  auth: { persistSession: false },
  realtime: { params: { eventsPerSecond: 5 } },
});

const $ = (id) => document.getElementById(id);
const pad = (n) => String(n).padStart(2, '0');
const TZ = 'America/Argentina/Buenos_Aires';
const LS = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  del(k) { try { localStorage.removeItem(k); } catch {} },
};

const state = {
  rounds: [],
  next: null,          // próxima ronda programada o en vivo
  liveRound: null,     // ronda mostrada en la pantalla en vivo
  phase: 'closed',     // closed | wait | count | roll | win
  shownWinnerFor: LS.get('pdc_seen_winner', null),
  myTicket: LS.get('pdc_ticket', null),
  rollTimer: null,
  participants: 0,
};

// ---------------- Utilidades ----------------
function toast(msg, ms = 3200) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.add('hidden'), ms);
}

function fmtDate(iso) {
  const d = new Date(iso);
  const day = d.toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'short', timeZone: TZ });
  const time = d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: TZ });
  return `${day.charAt(0).toUpperCase()}${day.slice(1)} · ${time} h`;
}

function calendarUrl(round) {
  if (!round) return '#';
  const start = new Date(round.scheduled_at);
  const end = new Date(start.getTime() + 30 * 60000);
  const f = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const p = new URLSearchParams({
    action: 'TEMPLATE',
    text: `${round.title} en vivo · Pasos de Color (Good is Good × Nikao)`,
    dates: `${f(start)}/${f(end)}`,
    details: `Ronda en vivo para ganar medias Good is Good. Entrá a ${location.origin} un ratito antes.`,
    location: location.origin,
  });
  return `https://calendar.google.com/calendar/render?${p}`;
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---------------- Menú móvil ----------------
$('menuBtn').addEventListener('click', () => {
  const open = $('navLinks').classList.toggle('open');
  $('menuBtn').setAttribute('aria-expanded', String(open));
});
$('navLinks').addEventListener('click', (e) => {
  if (e.target.closest('a')) { $('navLinks').classList.remove('open'); $('menuBtn').setAttribute('aria-expanded', 'false'); }
});

// ---------------- Links de redes ----------------
const L = CONFIG.links;
$('igLink').href = L.goodisgoodInstagram;
$('fGig').href = L.goodisgoodInstagram;
$('fNik').href = L.nikaoInstagram;

// ---------------- Rondas ----------------
async function loadRounds() {
  const { data, error } = await sb.from('rounds').select('*').neq('status', 'cancelled').order('scheduled_at', { ascending: true });
  if (error) { console.error(error); return; }
  state.rounds = data || [];
  const now = Date.now();
  state.next = state.rounds.find((r) => r.status === 'live')
    || state.rounds.find((r) => r.status === 'scheduled' && new Date(r.scheduled_at).getTime() > now - 3 * 3600e3)
    || null;
  renderNext();
  renderWinners();

  const live = state.rounds.find((r) => r.status === 'live');
  $('liveStrip').classList.toggle('on', !!live);
  if (live && state.phase === 'closed') openLive(live);

  // Si se eligió un ganador hace poco y no lo vimos, mostrarlo
  const recent = state.rounds
    .filter((r) => r.status === 'done' && r.picked_at && now - new Date(r.picked_at).getTime() < 10 * 60e3)
    .sort((a, b) => new Date(b.picked_at) - new Date(a.picked_at))[0];
  if (recent && state.shownWinnerFor !== recent.id && state.phase === 'closed') {
    state.liveRound = recent;
    showLive();
    showWinner(recent);
  }
}

function renderNext() {
  const r = state.next;
  if (!r) {
    $('cdKicker').textContent = 'PRÓXIMA RONDA';
    $('cdDate').textContent = 'Fecha a confirmar';
    $('cdPrize').textContent = 'Anotate ahora y te avisamos apenas la anunciemos.';
    ['cdD', 'cdH', 'cdM', 'cdS'].forEach((id) => ($(id).textContent = '--'));
    $('calLink').classList.add('hidden');
    $('calLink2').href = '#participar';
    $('calLink2').removeAttribute('target');
    return;
  }
  $('cdKicker').textContent = r.status === 'live' ? 'RONDA EN VIVO AHORA' : 'PRÓXIMA RONDA EN VIVO';
  $('cdDate').textContent = fmtDate(r.scheduled_at);
  $('cdPrize').textContent = `${r.title} · Premio: ${r.prize}`;
  $('calLink').classList.remove('hidden');
  $('calLink').href = calendarUrl(r);
  $('calLink2').href = calendarUrl(r);
  $('calLink2').setAttribute('target', '_blank');
}

function tick() {
  const r = state.next;
  if (r) {
    const diff = Math.max(0, Math.floor((new Date(r.scheduled_at).getTime() - Date.now()) / 1000));
    $('cdD').textContent = pad(Math.floor(diff / 86400));
    $('cdH').textContent = pad(Math.floor((diff % 86400) / 3600));
    $('cdM').textContent = pad(Math.floor((diff % 3600) / 60));
    $('cdS').textContent = pad(diff % 60);
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
function renderWinners() {
  const grid = $('winnersGrid');
  const done = state.rounds.filter((r) => r.status === 'done' && r.winner_name)
    .sort((a, b) => new Date(b.picked_at) - new Date(a.picked_at)).slice(0, 9);
  if (!done.length) {
    grid.innerHTML = `<div class="empty"><h3>Todavía no hay ganadores</h3><p>La primera ronda se viene: anotate y la primera tarjeta puede ser la tuya.</p></div>`;
    return;
  }
  const colors = ['#FF3D8B', '#8FA2FF', '#19C99A', '#FF8A3D', '#FFD60A'];
  grid.innerHTML = done.map((w, i) => {
    const parts = (w.winner_name || '').split(' ');
    const ini = (parts[0]?.[0] || '') + (parts[1]?.[0] || '');
    const bg = colors[i % colors.length];
    const when = new Date(w.picked_at).toLocaleDateString('es-AR', { day: 'numeric', month: 'short', timeZone: TZ });
    return `<article class="winner">
      <div class="winner-top" style="background: repeating-linear-gradient(135deg, ${bg} 0 22px, #FFFFFF 22px 30px)">
        <span class="pill">${esc(w.title)}</span><span class="pill">${esc(when)}</span>
        <div class="winner-badge" aria-hidden="true">${esc(ini.toUpperCase())}</div>
      </div>
      <div class="winner-body">
        <div class="top"><strong>${esc(w.winner_name)}</strong>${w.winner_club ? `<span class="club">${esc(w.winner_club)}</span>` : ''}</div>
        ${w.winner_city ? `<span>${esc(w.winner_city)}</span>` : ''}
        <span class="prize">${esc(w.prize)}</span>
      </div>
    </article>`;
  }).join('');
}

// ---------------- Videos ----------------
async function loadVideos() {
  const { data } = await sb.from('videos').select('*').order('sort');
  const grid = $('videosGrid');
  if (!data?.length) { grid.innerHTML = ''; return; }
  grid.innerHTML = data.map((v, i) => {
    const has = !!v.url;
    const angle = 45 + (i % 4) * 45;
    return `<button type="button" class="video" data-url="${esc(v.url || '')}" ${has ? '' : 'aria-disabled="true"'} aria-label="${has ? 'Ver video: ' : 'Próximamente: '}${esc(v.title)}">
      <div class="video-thumb" style="background: repeating-linear-gradient(${angle}deg, ${esc(v.color)} 0 26px, #FFFFFF 26px 40px)">
        <div class="play"><svg width="28" height="28" viewBox="0 0 24 24" fill="#16131F" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg></div>
        <span class="video-len">${has ? esc(v.duration || 'Ver') : 'Próximamente'}</span>
      </div>
      <div class="video-body"><div class="video-tag">${esc(v.tag)}</div><div class="video-title">${esc(v.title)}</div></div>
    </button>`;
  }).join('');
}

function youtubeId(url) {
  const m = url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|shorts\/|embed\/))([\w-]{11})/);
  return m ? m[1] : null;
}

$('videosGrid').addEventListener('click', (e) => {
  const b = e.target.closest('.video');
  if (!b) return;
  const url = b.dataset.url;
  if (!url) { toast('Este video se publica muy pronto'); return; }
  const yt = youtubeId(url);
  if (!yt) { window.open(url, '_blank', 'noopener'); return; }
  const m = document.createElement('div');
  m.className = 'modal';
  m.innerHTML = `<div class="modal-box"><button class="modal-close" aria-label="Cerrar video"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#16131F" stroke-width="3" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button><iframe src="https://www.youtube-nocookie.com/embed/${yt}?autoplay=1" title="Video" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>`;
  const close = () => m.remove();
  m.addEventListener('click', (ev) => { if (ev.target === m || ev.target.closest('.modal-close')) close(); });
  document.addEventListener('keydown', function esc(ev) { if (ev.key === 'Escape') { close(); document.removeEventListener('keydown', esc); } });
  document.body.appendChild(m);
});

// ---------------- Requisitos ----------------
const REQS = [
  { id: 'ig', title: 'Seguir a @goodisgood en Instagram', desc: 'La cuenta oficial de la fábrica.', cta: 'Ir a Instagram', href: L.goodisgoodInstagram },
  { id: 'nk', title: 'Seguir a @nikao en Instagram', desc: 'Nuestro aliado en esta colaboración.', cta: 'Ir a Instagram', href: L.nikaoInstagram },
  { id: 'tt', title: 'Seguir a Good is Good en TikTok', desc: 'Ahí subimos el detrás de escena.', cta: 'Ir a TikTok', href: L.goodisgoodTiktok },
  { id: 'tag', title: 'Like al posteo y etiquetar a 2 amigos', desc: 'En el posteo fijado de la ronda.', cta: 'Ver posteo', href: L.postFijado },
  { id: 'res', title: 'Vivir en Argentina', desc: 'Para poder mandarte las medias a tu casa.' },
];
const checks = LS.get('pdc_checks', {});

function renderReqs() {
  $('reqList').innerHTML = REQS.map((r, i) => {
    const done = !!checks[r.id];
    return `<div class="req ${done ? 'done' : ''}">
      <button type="button" class="req-check" data-req="${r.id}" aria-pressed="${done}" aria-label="${done ? 'Desmarcar' : 'Marcar como hecho'}: ${esc(r.title)}">
        ${done ? '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#16131F" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>' : i + 1}
      </button>
      <div class="req-text"><strong>${esc(r.title)}</strong><div>${esc(r.desc)}</div></div>
      ${r.href ? `<a href="${esc(r.href)}" target="_blank" rel="noopener" data-req-link="${r.id}">${esc(r.cta)}</a>` : ''}
    </div>`;
  }).join('');
  const n = REQS.filter((r) => checks[r.id]).length;
  $('progText').textContent = `${n} de ${REQS.length}`;
  $('progFill').style.width = `${(n / REQS.length) * 100}%`;
  $('progBar').setAttribute('aria-valuenow', String(n));
  validate();
}

$('reqList').addEventListener('click', (e) => {
  const b = e.target.closest('[data-req]');
  const a = e.target.closest('[data-req-link]');
  if (b) { checks[b.dataset.req] = !checks[b.dataset.req]; }
  else if (a) { checks[a.dataset.reqLink] = true; } // al abrir la red, lo damos por hecho
  else return;
  LS.set('pdc_checks', checks);
  renderReqs();
});

// ---------------- Formulario ----------------
const channels = { gmail: true, push: true, whatsapp: false, calendar: false };
document.querySelectorAll('[data-ch]').forEach((b) => {
  b.addEventListener('click', () => {
    const k = b.dataset.ch;
    channels[k] = !channels[k];
    b.setAttribute('aria-pressed', String(channels[k]));
    if (k === 'whatsapp' && channels[k]) $('fPhone').focus();
  });
});

const form = $('joinForm');
const emailOk = (v) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.trim());

function validate() {
  const missing = REQS.length - REQS.filter((r) => checks[r.id]).length;
  const name = $('fName').value.trim();
  const mail = $('fEmail').value.trim();
  let msg = '';
  if (missing > 0) msg = `Te ${missing === 1 ? 'falta 1 requisito' : `faltan ${missing} requisitos`} para participar`;
  else if (name.length < 2) msg = 'Completá tu nombre';
  else if (!emailOk(mail)) msg = 'Poné un email válido';
  else if (channels.whatsapp && $('fPhone').value.trim().length < 6) msg = 'Dejanos tu WhatsApp o desmarcá esa opción';
  else if (!$('fConsent').checked) msg = 'Aceptá las bases para continuar';
  $('submitBtn').disabled = !!msg;
  const h = $('formHint');
  h.classList.remove('err');
  h.textContent = msg || '¡Todo listo, mandale!';
  return !msg;
}
form.addEventListener('input', validate);
form.addEventListener('change', validate);

const ref = new URLSearchParams(location.search).get('r');
if (ref) LS.set('pdc_ref', ref.toUpperCase());

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!validate()) return;
  const btn = $('submitBtn');
  btn.disabled = true;
  btn.textContent = 'Anotándote…';
  const payload = {
    p_name: $('fName').value.trim(),
    p_email: $('fEmail').value.trim(),
    p_instagram: $('fIg').value.trim().replace(/^@?/, '@').replace(/^@$/, ''),
    p_club: $('fClub').value.trim(),
    p_city: $('fCity').value.trim(),
    p_phone: $('fPhone').value.trim(),
    p_channels: { ...channels },
    p_ref: LS.get('pdc_ref', null),
  };
  const { data, error } = await sb.rpc('register_participant', payload);
  btn.textContent = 'Quiero participar';
  if (error) {
    console.error(error);
    const h = $('formHint');
    h.textContent = 'No pudimos anotarte. Revisá los datos e intentá de nuevo.';
    h.classList.add('err');
    btn.disabled = false;
    return;
  }
  state.myTicket = data.ticket;
  LS.set('pdc_ticket', data.ticket);
  LS.set('pdc_name', payload.p_name.split(' ')[0]);
  showSuccess(payload.p_name.split(' ')[0], data.ticket, data.chances, data.existing);
  if (channels.push) subscribePush(true);
  if (channels.calendar && state.next) window.open(calendarUrl(state.next), '_blank', 'noopener');
  loadStats();
});

function showSuccess(first, ticket, chances, existing) {
  form.classList.add('hidden');
  $('success').classList.remove('hidden');
  $('okTitle').textContent = existing ? `¡Ya estabas adentro, ${first || 'crack'}!` : `¡Ya estás adentro, ${first || 'crack'}!`;
  $('okText').textContent = existing
    ? 'Ese mail ya estaba anotado: seguís participando con tu mismo número.'
    : 'Quedaste anotado para la próxima ronda. Te avisamos antes de que arranque.';
  $('okTicket').textContent = ticket;
  $('okChances').textContent = `${chances} ${chances === 1 ? 'chance' : 'chances'} en cada ronda`;
  const link = `${location.origin}/?r=${ticket}`;
  $('okLink').textContent = link;
  const msg = `Me anoté para ganar medias Good is Good × Nikao. Sumate gratis acá: ${link}`;
  $('waShare').href = `https://wa.me/?text=${encodeURIComponent(msg)}`;
  if (navigator.share) {
    $('nativeShare').classList.remove('hidden');
    $('nativeShare').onclick = () => navigator.share({ title: 'Pasos de Color', text: msg, url: link }).catch(() => {});
  }
  $('copyLink').onclick = async () => {
    try { await navigator.clipboard.writeText(link); toast('Link copiado'); } catch { toast(link, 6000); }
  };
}

$('anotherBtn').addEventListener('click', () => {
  form.reset();
  $('success').classList.add('hidden');
  form.classList.remove('hidden');
  validate();
  $('fName').focus();
});

async function restoreTicket() {
  if (!state.myTicket) return;
  const { data } = await sb.rpc('participant_status', { p_ticket: state.myTicket });
  if (data) showSuccess(data.first_name, data.ticket, data.chances, false);
  else { LS.del('pdc_ticket'); state.myTicket = null; }
  if (data) {
    $('okTitle').textContent = `¡Ya estás adentro, ${data.first_name}!`;
    $('okText').textContent = 'Seguís participando en todas las rondas. Compartí tu link para sumar chances.';
  }
}

async function loadStats() {
  const { data } = await sb.rpc('public_stats');
  const n = data?.participants || 0;
  state.participants = n;
  if (n >= 5) {
    $('heroCount').textContent = `Ya se ${n === 1 ? 'anotó' : 'anotaron'} ${n.toLocaleString('es-AR')} personas`;
    $('heroCount').classList.remove('hidden');
  }
  $('livePlayers').textContent = n ? `${n.toLocaleString('es-AR')} participantes en juego` : 'Todos los anotados están en juego';
}

// ---------------- Notificaciones push ----------------
function b64ToUint8(b64) {
  const p = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + p).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

let swReg = null;
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').then((r) => { swReg = r; refreshPushButton(); }).catch(() => {});
}

async function refreshPushButton() {
  const big = $('pushBig');
  if (!('PushManager' in window) || !swReg) return;
  const sub = await swReg.pushManager.getSubscription();
  if (sub && Notification.permission === 'granted') big.textContent = 'Avisos activados en este dispositivo';
}

async function subscribePush(silent = false) {
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    if (isIOS && !standalone) toast('En iPhone: tocá Compartir → "Agregar a inicio", abrí la app y activá los avisos.', 7000);
    else if (!silent) toast('Este navegador no permite notificaciones. Agendá la ronda en el calendario.', 5000);
    return false;
  }
  try {
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') { if (!silent) toast('Permiso de notificaciones rechazado'); return false; }
    const reg = swReg || (await navigator.serviceWorker.ready);
    let sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToUint8(CONFIG.vapidPublicKey) });
    const j = sub.toJSON();
    const { error } = await sb.rpc('save_push_subscription', {
      p_endpoint: j.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth, p_ticket: state.myTicket,
    });
    if (error) throw error;
    $('pushBig').textContent = 'Avisos activados en este dispositivo';
    toast('¡Listo! Te avisamos cuando arranque la ronda');
    return true;
  } catch (err) {
    console.error(err);
    if (!silent) toast('No pudimos activar los avisos en este dispositivo');
    return false;
  }
}
document.querySelectorAll('[data-push]').forEach((b) => b.addEventListener('click', () => subscribePush(false)));

// ---------------- Pantalla en vivo ----------------
function setPhase(p) {
  state.phase = p;
  $('liveWait').classList.toggle('hidden', p !== 'wait');
  $('liveCount').classList.toggle('hidden', p !== 'count');
  $('liveRoll').classList.toggle('hidden', p !== 'roll');
  $('liveWin').classList.toggle('hidden', p !== 'win');
  $('confetti').classList.toggle('hidden', p !== 'win');
  $('liveBadgeText').textContent = p === 'wait' ? 'PANTALLA EN VIVO' : 'EN VIVO AHORA';
}

function showLive() {
  $('live').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function openLive(round) {
  state.liveRound = round;
  showLive();
  $('liveTitle').textContent = `${round.title} · Good is Good × Nikao`;
  if (round.status === 'live') setPhase('count');
  else if (round.status === 'done') showWinner(round);
  else setPhase('wait');
  tick();
}

function closeLive() {
  clearInterval(state.rollTimer);
  $('live').classList.add('hidden');
  document.body.style.overflow = '';
  state.phase = 'closed';
  if (state.liveRound?.status === 'done') { state.shownWinnerFor = state.liveRound.id; LS.set('pdc_seen_winner', state.liveRound.id); }
}

document.querySelectorAll('[data-open-live]').forEach((b) => b.addEventListener('click', () => {
  const live = state.rounds.find((r) => r.status === 'live');
  if (live) openLive(live);
  else if (state.next) openLive(state.next);
  else toast('Todavía no hay una ronda anunciada. ¡Anotate y te avisamos!');
}));
$('liveClose').addEventListener('click', closeLive);
$('liveBack').addEventListener('click', closeLive);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && state.phase !== 'closed') closeLive(); });

function randomTicket() {
  return 'GIG-' + Math.floor(Math.random() * 0xffffff).toString(16).toUpperCase().padStart(6, '0');
}

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
  $('winMe').classList.toggle('hidden', !(state.myTicket && state.myTicket === round.winner_ticket));
  buildConfetti();
  setPhase('win');
  state.shownWinnerFor = round.id;
  LS.set('pdc_seen_winner', round.id);
}

function buildConfetti() {
  const c = $('confetti');
  if (c.childElementCount) return;
  const colors = ['#FF3D8B', '#FFD60A', '#19C99A', '#8FA2FF', '#FF8A3D', '#FFFFFF'];
  let html = '';
  for (let i = 0; i < 60; i++) {
    const w = 8 + (i * 7) % 10;
    html += `<i style="left:${(i * 37) % 100}%;width:${w}px;height:${w * 1.8}px;background:${colors[i % colors.length]};animation-duration:${3 + (i % 5) * 0.7}s;animation-delay:${(i % 10) * 0.2}s"></i>`;
  }
  c.innerHTML = html;
}

function notifyLocal(title, body) {
  try {
    if (document.hidden && Notification.permission === 'granted' && swReg) swReg.showNotification(title, { body, icon: '/icon.svg', tag: 'pdc-live' });
  } catch {}
}

function onRoundChange(payload) {
  const r = payload.new;
  if (!r || !r.id) { loadRounds(); return; }
  const idx = state.rounds.findIndex((x) => x.id === r.id);
  if (idx >= 0) state.rounds[idx] = r; else state.rounds.push(r);
  state.rounds.sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at));
  const now = Date.now();
  state.next = state.rounds.find((x) => x.status === 'live')
    || state.rounds.find((x) => x.status === 'scheduled' && new Date(x.scheduled_at).getTime() > now - 3 * 3600e3) || null;
  renderNext();
  $('liveStrip').classList.toggle('on', state.rounds.some((x) => x.status === 'live'));

  if (r.status === 'live') {
    notifyLocal('¡La ronda está EN VIVO!', 'Entrá ya a Pasos de Color para ver quién gana.');
    openLive(r);
  } else if (r.status === 'done' && r.winner_name) {
    if (state.phase === 'closed') { state.liveRound = r; showLive(); }
    $('liveTitle').textContent = `${r.title} · Good is Good × Nikao`;
    if (state.phase === 'win' && state.liveRound?.id === r.id) showWinner(r);
    else startRoll(() => showWinner(r));
  } else if (state.liveRound?.id === r.id && r.status === 'scheduled' && state.phase !== 'closed') {
    setPhase('wait');
  }
  renderWinners();
}

sb.channel('rondas')
  .on('postgres_changes', { event: '*', schema: 'public', table: 'rounds' }, onRoundChange)
  .subscribe();

// Si la pestaña vuelve a estar visible, refrescar por las dudas
document.addEventListener('visibilitychange', () => { if (!document.hidden) loadRounds(); });
setInterval(loadRounds, 60000);

// ---------------- Inicio ----------------
renderReqs();
loadRounds();
loadVideos();
loadStats();
restoreTicket();
if (new URLSearchParams(location.search).has('envivo')) {
  setTimeout(() => document.querySelector('[data-open-live]')?.click(), 800);
}
