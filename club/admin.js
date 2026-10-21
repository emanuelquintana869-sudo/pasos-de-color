import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { CONFIG } from './config.js';

const sb = createClient(CONFIG.supabaseUrl, CONFIG.supabaseKey, { auth: { persistSession: false } });
const $ = (id) => document.getElementById(id);
const TZ = 'America/Argentina/Buenos_Aires';
let PASS = sessionStorage.getItem('club_admin') || '';
let rounds = [];
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
  await Promise.all([loadRounds(), loadParticipants(), loadOrdersStats()]);
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
      if ($('autoNotify').checked) sendNotify('¡La ronda está EN VIVO!', `Entrá ya: en ${secs} segundos elegimos al club de barrio que gana medias nuevas.`, true, false, '/?envivo=1');
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
    toast(`Ganó ${r.winner_name}`, 6000);
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
  d.innerHTML = `<strong>${esc(c.team)}</strong> · ${esc(c.code)} · ${c.supporters} hinchas<br>
    Postuló: <strong>${esc(c.name)}</strong>${c.role ? ` (${esc(c.role)})` : ''}<br>
    Mail: <a href="mailto:${esc(c.email)}">${esc(c.email)}</a>
    ${c.phone ? ` · WhatsApp: <a href="https://wa.me/${esc(c.phone.replace(/\D/g, ''))}" target="_blank" rel="noopener">${esc(c.phone)}</a>` : ''}
    ${c.instagram ? ` · Instagram: <a href="https://instagram.com/${esc(c.instagram.replace('@', ''))}" target="_blank" rel="noopener">${esc(c.instagram)}</a>` : ''}<br>
    ${esc([c.barrio, c.city, c.province].filter(Boolean).join(', '))} · Colores:
    <span style="display:inline-block;width:16px;height:16px;border-radius:50%;background:${esc(c.color1)};vertical-align:middle;border:1px solid #0003"></span>
    <span style="display:inline-block;width:16px;height:16px;border-radius:50%;background:${esc(c.color2)};vertical-align:middle;border:1px solid #0003"></span>
    ${esc(c.color1)} / ${esc(c.color2)}`;
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

// ---------- Clubes ----------
let teams = [];
async function loadParticipants() {
  try { teams = await rpc('club_admin_list_teams_v2'); } catch (err) { toast(err.message); return; }
  const real = teams.filter((t) => !t.is_demo);
  const demos = teams.filter((t) => t.is_demo);
  $('sPart').textContent = real.filter((t) => t.visible).length;
  $('sRef').textContent = real.reduce((n, t) => n + Number(t.supporters), 0);
  const demosOn = demos.some((t) => t.visible);
  $('demoBtn').textContent = demosOn ? `Ocultar los ${demos.length} clubes de ejemplo` : `Mostrar los ${demos.length} clubes de ejemplo`;
  $('demoBtn').dataset.on = demosOn ? '0' : '1';
  $('demoBtn').classList.toggle('hidden', !demos.length);
  $('pBody').innerHTML = teams.map((t) => `<tr style="${t.visible ? '' : 'opacity:.5'}">
    <td><span style="display:inline-block;width:14px;height:14px;border-radius:50%;background:${esc(t.color1)};border:3px solid ${esc(t.color2)};box-shadow:0 0 0 1px #0003;vertical-align:middle"></span> <strong>${esc(t.name)}</strong>${t.is_demo ? ' <small style="background:#FFE9A8;padding:2px 6px;border-radius:6px;font-weight:800">EJEMPLO</small>' : ''}<br><small>${esc(t.code)} · ${esc(t.sport || '')}</small></td>
    <td>${esc([t.barrio, t.city].filter(Boolean).join(', '))}<br><small>${esc(t.province)}</small></td>
    <td><strong>${t.supporters}</strong></td>
    <td>${esc(t.rep_name)}${t.rep_role ? `<br><small>${esc(t.rep_role)}</small>` : ''}</td>
    <td><a href="mailto:${esc(t.rep_email)}">${esc(t.rep_email)}</a>${t.rep_phone ? `<br><a href="https://wa.me/${esc(t.rep_phone.replace(/\D/g, ''))}" target="_blank" rel="noopener">${esc(t.rep_phone)}</a>` : ''}</td>
    <td style="white-space:normal;min-width:240px;max-width:360px"><small>${esc(t.story || '—')}</small></td>
    <td><div class="acts"><button type="button" data-vis="${esc(t.code)}" data-on="${t.visible ? '0' : '1'}">${t.visible ? 'Ocultar' : 'Mostrar'}</button></div></td>
  </tr>`).join('') || '<tr><td colspan="7">Todavía no se postuló ningún club.</td></tr>';
}
$('pBody').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-vis]');
  if (!b) return;
  const on = b.dataset.on === '1';
  if (!on && !confirm('¿Ocultar este club? Deja de aparecer en la página y no entra en las rondas.')) return;
  try { await rpc('club_admin_set_team_visible', { p_code: b.dataset.vis, p_visible: on }); toast(on ? 'Club visible de nuevo' : 'Club oculto'); loadParticipants(); }
  catch (err) { toast(err.message); }
});
$('reloadP').addEventListener('click', loadParticipants);
$('demoBtn').addEventListener('click', async () => {
  const on = $('demoBtn').dataset.on === '1';
  try { const n = await rpc('club_admin_set_demos_visible', { p_visible: on }); toast(on ? `${n} clubes de ejemplo visibles` : `${n} clubes de ejemplo ocultos`); loadParticipants(); }
  catch (err) { toast(err.message); }
});
function downloadCsv(rows, cols, name) {
  const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const out = [cols.join(';'), ...rows.map((r) => cols.map((c) => q(r[c])).join(';'))];
  const blob = new Blob(['\ufeff' + out.join('\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${name}-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
}
$('csv').addEventListener('click', () => downloadCsv(teams,
  ['created_at', 'code', 'name', 'sport', 'barrio', 'city', 'province', 'color1', 'color2', 'supporters', 'rep_name', 'rep_role', 'rep_email', 'rep_phone', 'team_instagram', 'visible', 'story'],
  'clubes-club-pasos-de-color'));
$('csvFans').addEventListener('click', async () => {
  try { const fans = await rpc('club_admin_list_supporters'); downloadCsv(fans, ['created_at', 'team_code', 'team_name', 'name', 'email', 'city'], 'hinchas-club-pasos-de-color'); }
  catch (err) { toast(err.message); }
});

// ---------- Pedidos de clientes ----------
let orderRows = [];
async function loadOrdersStats() {
  try {
    const st = await rpc('club_admin_orders_stats');
    $('oTotal').textContent = Number(st.total).toLocaleString('es-AR');
    $('oUsed').textContent = Number(st.used).toLocaleString('es-AR');
    $('oLast').textContent = st.last_upload ? new Date(st.last_upload).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: TZ }) : '—';
  } catch (err) { toast(err.message); }
}
function flatten(obj, prefix = '', out = {}) {
  if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
    for (const [k, v] of Object.entries(obj)) {
      const key = prefix ? `${prefix}.${k}` : k;
      if (v && typeof v === 'object' && !Array.isArray(v) && prefix.split('.').length < 3) flatten(v, key, out);
      else if (!Array.isArray(v)) out[key] = v;
    }
  }
  return out;
}
// Busca la lista de pedidos dentro del JSON (prioriza "orders"/"pedidos"/"ventas")
// y, si cada pedido apunta a un cliente (clientId), le suma los datos de ese cliente.
const ORDER_KEYS = ['orders', 'pedidos', 'ventas', 'sales', 'ordenes', 'compras'];
const isObjList = (v) => Array.isArray(v) && v.some((x) => x && typeof x === 'object' && !Array.isArray(x));
function findRecords(data) {
  if (Array.isArray(data)) return data.filter((x) => x && typeof x === 'object');
  if (!data || typeof data !== 'object') return [];
  const lower = (k) => k.toLowerCase();
  const key = Object.keys(data).find((k) => ORDER_KEYS.includes(lower(k)) && isObjList(data[k]))
    || Object.keys(data).filter((k) => isObjList(data[k]))
      .sort((a, b) => score(data[b]) - score(data[a]))[0];
  if (!key) {
    for (const v of Object.values(data)) {
      if (v && typeof v === 'object' && !Array.isArray(v)) { const r = findRecords(v); if (r.length) return r; }
    }
    return [];
  }
  return joinRelated(data, data[key].filter((x) => x && typeof x === 'object'));
}
// Puntaje: listas con campos de pedido (número, cliente, total, fecha) ganan; usuarios/contraseñas pierden
function score(list) {
  const k = Object.keys(list.find((x) => x && typeof x === 'object') || {}).map((x) => x.toLowerCase());
  let s = 0;
  if (k.some((x) => /number|numero|nro|pedido|order/.test(x))) s += 3;
  if (k.some((x) => /client|cliente|customer/.test(x))) s += 2;
  if (k.some((x) => /total|monto|amount/.test(x))) s += 1;
  if (k.some((x) => /password|contrase/.test(x))) s -= 10;
  return s;
}
// clientId → busca en "clients"/"clientes" y agrega sus campos como "cliente.xxx"
function joinRelated(root, rows) {
  const sample = rows[0] || {};
  for (const fk of Object.keys(sample)) {
    const m = fk.match(/^(.*?)_?id$/i);
    if (!m || !m[1]) continue;
    const base = m[1].toLowerCase();
    const listKey = Object.keys(root).find((k) => isObjList(root[k]) && [base + 's', base + 'es', base].includes(k.toLowerCase()));
    if (!listKey) continue;
    const byId = new Map(root[listKey].map((x) => [String(x.id), x]));
    rows = rows.map((r) => {
      const rel = byId.get(String(r[fk]));
      if (!rel) return r;
      const extra = {};
      for (const [k, v] of Object.entries(rel)) if (v == null || typeof v !== 'object') extra[`${base}.${k}`] = v;
      return { ...r, ...extra };
    });
  }
  return rows;
}
function guess(keys, words) {
  const n = (k) => k.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  for (const w of words) { const k = keys.find((x) => n(x).split('.').pop().includes(w)); if (k) return k; }
  return '';
}
const mask = (v, keep = 3) => { const s = String(v ?? ''); return s.length <= keep ? s : s.slice(0, keep) + '•'.repeat(Math.min(6, s.length - keep)); };
const maskMail = (v) => { const s = String(v ?? ''); const [u, d] = s.split('@'); return d ? `${u.slice(0, 2)}•••@${d}` : (s ? '(no es un mail)' : ''); };
function buildRows() {
  const fo = $('oOrder').value; const fe = $('oEmail').value; const fp = $('oPhone').value;
  return orderRows.map((r) => ({ o: r[fo], e: fe ? r[fe] : null, p: fp ? r[fp] : null }))
    .map((x) => ({ o: x.o == null ? '' : String(x.o).trim(), e: x.e ? String(x.e).trim() : null, p: x.p ? String(x.p) : null }))
    .filter((x) => x.o && ((x.e && x.e.includes('@')) || (x.p && x.p.replace(/\D/g, '').length >= 4)));
}
function previewOrders() {
  const rows = buildRows();
  $('oPreview').innerHTML = rows.slice(0, 5).map((x) => `<tr><td>${esc(mask(x.o))}</td><td>${esc(maskMail(x.e))}</td><td>${x.p ? '••••' + esc(x.p.replace(/\D/g, '').slice(-4)) : ''}</td></tr>`).join('')
    || '<tr><td colspan="3">Elegí el campo del pedido y al menos el mail o el teléfono.</td></tr>';
  const lost = orderRows.length - rows.length;
  $('oUpload').textContent = `Subir ${rows.length.toLocaleString('es-AR')} pedidos`;
  $('oUpload').disabled = !rows.length || !$('oOrder').value;
  $('oMsg').textContent = lost > 0 ? `${lost} ${lost === 1 ? 'pedido sin mail ni teléfono válido no se va' : 'pedidos sin mail ni teléfono válido no se van'} a subir.` : '';
  $('oMsg').style.color = 'var(--muted)';
}
$('oFile').addEventListener('change', async () => {
  const f = $('oFile').files[0];
  if (!f) return;
  try {
    const data = JSON.parse(await f.text());
    orderRows = findRecords(data).map((r) => flatten(r));
    if (!orderRows.length) { toast('No encontré una lista de pedidos en ese archivo', 6000); $('oMap').classList.add('hidden'); return; }
    const keys = [...new Set(orderRows.slice(0, 50).flatMap((r) => Object.keys(r)))];
    const opts = (sel) => '<option value="">— ninguno —</option>' + keys.map((k) => `<option ${k === sel ? 'selected' : ''}>${esc(k)}</option>`).join('');
    $('oOrder').innerHTML = opts(guess(keys, ['number', 'numero', 'nro', 'pedido', 'order', 'num', 'orden', 'venta', 'factura', 'comprobante', 'id', '_clave']));
    $('oEmail').innerHTML = opts(guess(keys, ['email', 'mail', 'correo']));
    $('oPhone').innerHTML = opts(guess(keys, ['whatsapp', 'telefono', 'phone', 'celular', 'movil', 'tel', 'cel']));
    $('oFound').textContent = `Encontré ${orderRows.length.toLocaleString('es-AR')} pedidos en "${f.name}". Revisá que los campos estén bien elegidos:`;
    $('oMap').classList.remove('hidden');
    previewOrders();
  } catch (err) {
    console.error(err);
    toast('Ese archivo no es un JSON válido', 6000);
  }
});
['oOrder', 'oEmail', 'oPhone'].forEach((id) => $(id).addEventListener('change', previewOrders));
$('oUpload').addEventListener('click', async () => {
  const rows = buildRows();
  if (!rows.length) return;
  const btn = $('oUpload'); btn.disabled = true;
  let ins = 0, upd = 0, skip = 0;
  try {
    for (let i = 0; i < rows.length; i += 1000) {
      $('oMsg').style.color = 'var(--ink)';
      $('oMsg').textContent = `Subiendo ${Math.min(i + 1000, rows.length).toLocaleString('es-AR')} de ${rows.length.toLocaleString('es-AR')}…`;
      const r = await rpc('club_admin_import_orders', { p_rows: rows.slice(i, i + 1000) });
      ins += r.inserted; upd += r.updated; skip += r.skipped;
    }
    $('oMsg').style.color = '#0E8F4E';
    $('oMsg').textContent = `Listo: ${ins} nuevos, ${upd} actualizados${skip ? `, ${skip} salteados` : ''}.`;
    $('oFile').value = '';
    orderRows = [];
    loadOrdersStats();
  } catch (err) {
    $('oMsg').style.color = '#C0134A';
    $('oMsg').textContent = `Error: ${err.message}`;
  } finally { btn.disabled = false; }
});

if (PASS) rpc('club_admin_login').then(enter).catch(() => logout());
