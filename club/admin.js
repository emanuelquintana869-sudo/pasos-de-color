import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { CONFIG } from './config.js';

const sb = createClient(CONFIG.supabaseUrl, CONFIG.supabaseKey, { auth: { persistSession: false } });
const $ = (id) => document.getElementById(id);
const TZ = 'America/Argentina/Buenos_Aires';
let PASS = sessionStorage.getItem('club_admin') || '';
let rounds = [];
let participants = [];
let pickTimer = null;

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function toast(msg, ms = 3500) {
  const t = $('toast'); t.textContent = msg; t.classList.remove('hidden');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.add('hidden'), ms);
}
const fmt = (iso) => new Date(iso).toLocaleString('es-AR', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: TZ });
const STATUS = { scheduled: 'PROGRAMADA', live: 'EN VIVO', done: 'TERMINADA', cancelled: 'CANCELADA' };

async function rpc(fn, args = {}) {
  const { data, error } = await sb.rpc(fn, { p_pass: PASS, ...args });
  if (error) {
    if (error.code === '28P01') { logout(); throw new Error('Contraseña incorrecta'); }
    throw new Error(error.message);
  }
  return data;
}

// ---------- Login ----------
$('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  PASS = $('pass').value;
  try { await rpc('club_admin_login'); sessionStorage.setItem('club_admin', PASS); enter(); }
  catch (err) { $('loginErr').textContent = err.message; }
});
function logout() { PASS = ''; sessionStorage.removeItem('club_admin'); $('app').classList.add('hidden'); $('loginPanel').classList.remove('hidden'); $('logout').classList.add('hidden'); }
$('logout').addEventListener('click', logout);

async function enter() {
  $('loginPanel').classList.add('hidden');
  $('app').classList.remove('hidden');
  $('logout').classList.remove('hidden');
  await Promise.all([loadRounds(), loadParticipants()]);
  sb.channel('club-admin-rondas').on('postgres_changes', { event: '*', schema: 'public', table: 'club_rounds' }, loadRounds).subscribe();
}

// ---------- Rondas ----------
async function loadRounds() {
  const { data } = await sb.from('club_rounds').select('*').order('scheduled_at', { ascending: false });
  rounds = data || [];
  $('sWin').textContent = rounds.filter((r) => r.status === 'done').length;
  $('rounds').innerHTML = rounds.length ? rounds.map((r) => `
    <div class="round" data-id="${r.id}">
      <div class="info">
        <strong>${esc(r.title)}</strong><span class="status st-${r.status}">${STATUS[r.status]}</span>
        <div>${esc(fmt(r.scheduled_at))} · ${esc(r.prize)}</div>
        ${r.winner_name ? `<div><strong style="color:var(--ink)">Ganó: ${esc(r.winner_name)}</strong> · ${esc(r.winner_ticket || '')}${r.winner_club ? ' · ' + esc(r.winner_club) : ''}</div>` : ''}
      </div>
      <div class="acts">
        ${r.status === 'scheduled' ? `<button class="go" data-act="live">Arrancar en vivo</button>` : ''}
        ${r.status === 'live' ? `<button class="pick" data-act="pick">Elegir ganador</button>` : ''}
        ${r.status === 'done' ? `<button data-act="contact">Ver contacto</button><button data-act="live">Repetir ronda</button>` : ''}
        ${r.status === 'live' || r.status === 'done' ? `<button data-act="reset">Volver a programada</button>` : ''}
        ${r.status === 'scheduled' ? `<button data-act="cancel">Cancelar</button>` : ''}
        ${r.status === 'cancelled' ? `<button data-act="reset">Reactivar</button>` : ''}
      </div>
    </div>`).join('') : '<p>No hay rondas. Creá una abajo.</p>';
}

$('rounds').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  const box = b.closest('.round');
  const id = Number(box.dataset.id);
  const act = b.dataset.act;
  b.disabled = true;
  try {
    if (act === 'live') {
      if (!confirm('¿Arrancar la ronda en vivo? A todos los que tengan la página abierta se les abre la pantalla.')) return;
      const secs = Math.max(5, Math.min(600, Number($('secs').value) || 30));
      const r = await rpc('club_admin_start_live', { p_round_id: id, p_seconds: secs });
      toast('¡Ronda en vivo! La pantalla se abrió para todos.');
      if ($('autoNotify').checked) sendNotify('¡La ronda está EN VIVO!', `Entrá ya: en ${secs} segundos elegimos ganador de medias Good is Good × Nikao.`, true, false, '/?envivo=1');
      if ($('autoPick').checked) {
        clearTimeout(pickTimer);
        const ms = new Date(r.countdown_ends_at).getTime() - Date.now() + 1500;
        pickTimer = setTimeout(() => pick(id), Math.max(1000, ms));
      }
    } else if (act === 'pick') {
      await pick(id);
    } else if (act === 'reset') {
      clearTimeout(pickTimer);
      await rpc('club_admin_set_round_status', { p_round_id: id, p_status: 'scheduled' });
    } else if (act === 'cancel') {
      if (!confirm('¿Cancelar esta ronda?')) return;
      await rpc('club_admin_set_round_status', { p_round_id: id, p_status: 'cancelled' });
    } else if (act === 'contact') {
      const c = await rpc('club_admin_winner_contact', { p_round_id: id });
      showContact(box, c);
    }
    await loadRounds();
  } catch (err) { toast(err.message, 5000); }
  finally { b.disabled = false; }
});

async function pick(id) {
  clearTimeout(pickTimer);
  try {
    const r = await rpc('club_admin_pick_winner', { p_round_id: id });
    toast(`Ganó ${r.winner_name} (${r.winner_ticket})`, 6000);
    await loadRounds();
    const c = await rpc('club_admin_winner_contact', { p_round_id: id });
    const box = document.querySelector(`.round[data-id="${id}"]`);
    if (box) showContact(box, c);
  } catch (err) { toast(err.message, 6000); }
}

function showContact(box, c) {
  box.querySelector('.contact')?.remove();
  if (!c) return;
  const d = document.createElement('div');
  d.className = 'contact';
  d.innerHTML = `<strong>${esc(c.name)}</strong> · ${esc(c.ticket)}<br>
    Mail: <a href="mailto:${esc(c.email)}">${esc(c.email)}</a>${c.instagram ? ` · Instagram: <a href="https://instagram.com/${esc(c.instagram.replace('@', ''))}" target="_blank" rel="noopener">${esc(c.instagram)}</a>` : ''}
    ${c.phone ? ` · WhatsApp: <a href="https://wa.me/${esc(c.phone.replace(/\D/g, ''))}" target="_blank" rel="noopener">${esc(c.phone)}</a>` : ''}<br>
    ${esc([c.club, c.city].filter(Boolean).join(' · '))}`;
  box.appendChild(d);
}

$('roundForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const iso = new Date(`${$('rDate').value}:00-03:00`).toISOString();
    await rpc('club_admin_create_round', { p_scheduled_at: iso, p_prize: $('rPrize').value, p_title: $('rTitle').value });
    e.target.reset();
    toast('Ronda creada: ya aparece la cuenta regresiva en la página');
    loadRounds();
  } catch (err) { toast(err.message, 5000); }
});

// ---------- Avisos ----------
async function sendNotify(title, body, push, email, url = '/') {
  const log = $('notifyLog');
  log.classList.remove('hidden');
  log.textContent = 'Enviando…';
  const { data, error } = await sb.functions.invoke('club-notify', { body: { pass: PASS, title, body, url, push, email } });
  if (error) { log.textContent = `Error: ${error.message}`; return; }
  const lines = [];
  if (data.push) lines.push(`Push: ${data.push.sent} enviados${data.push.removed ? `, ${data.push.removed} vencidos borrados` : ''}${data.push.failed ? `, ${data.push.failed} con error` : ''}`);
  if (data.email) lines.push(data.email.skipped ? `Mail: ${data.email.skipped}` : `Mail: ${data.email.sent} enviados${data.email.failed ? `, ${data.email.failed} con error` : ''}`);
  log.textContent = lines.join('\n') || 'Listo';
}
$('notifyForm').addEventListener('submit', (e) => {
  e.preventDefault();
  if (!confirm('¿Enviar el aviso a todos los suscriptos?')) return;
  sendNotify($('nTitle').value, $('nBody').value, $('nPush').checked, $('nMail').checked);
});

// ---------- Participantes ----------
async function loadParticipants() {
  try { participants = await rpc('club_admin_list_participants'); } catch (err) { toast(err.message); return; }
  $('sPart').textContent = participants.length;
  $('sRef').textContent = participants.filter((p) => p.referred_by).length;
  $('pBody').innerHTML = participants.map((p) => `<tr>
    <td>${esc(new Date(p.created_at).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: TZ }))}</td>
    <td>${esc(p.name)}</td><td>${esc(p.email)}</td><td>${esc(p.instagram || '')}</td><td>${esc(p.club || '')}</td>
    <td>${esc(p.city || '')}</td><td>${esc(p.phone || '')}</td><td>${esc(p.ticket)}</td><td>${p.chances}</td></tr>`).join('')
    || '<tr><td colspan="9">Todavía no hay participantes.</td></tr>';
}
$('reloadP').addEventListener('click', loadParticipants);
$('csv').addEventListener('click', () => {
  const cols = ['created_at', 'name', 'email', 'instagram', 'club', 'city', 'phone', 'ticket', 'referred_by', 'chances'];
  const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = [cols.join(';'), ...participants.map((p) => cols.map((c) => q(p[c])).join(';'))];
  const blob = new Blob(['﻿' + rows.join('\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `participantes-club-pasos-de-color-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
});

if (PASS) rpc('club_admin_login').then(enter).catch(() => logout());
