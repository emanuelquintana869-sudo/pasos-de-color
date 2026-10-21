// Envía avisos del Club Pasos de Color (datos separados del sitio principal).
// Requiere la contraseña de admin en el cuerpo del pedido.
import webpush from 'npm:web-push@3.6.7';
import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

function emailHtml(title: string, body: string, link: string) {
  return `<!doctype html><html><body style="margin:0;background:#EFE8FF;font-family:Arial,Helvetica,sans-serif;color:#16131F">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#EFE8FF;padding:24px 12px"><tr><td align="center">
  <table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#FFFFFF;border:2px solid #16131F;border-radius:24px">
    <tr><td style="background:#170A33;color:#FFFFFF;border-radius:22px 22px 0 0;padding:22px 28px;border-bottom:2px solid #16131F">
      <div style="font-size:24px;font-weight:800;letter-spacing:-.5px">CLUB PASOS DE COLOR</div>
      <div style="font-size:13px;font-weight:700;color:#B794FF">Good is Good × Nikao</div>
    </td></tr>
    <tr><td style="padding:28px">
      <h1 style="margin:0 0 12px;font-size:28px;line-height:1.1">${esc(title)}</h1>
      <p style="margin:0 0 24px;font-size:16px;line-height:1.5;color:#3A3547">${esc(body)}</p>
      <a href="${link}" style="display:inline-block;background:#2EE6B0;color:#170A33;text-decoration:none;font-weight:700;font-size:17px;padding:16px 28px;border-radius:999px;border:2px solid #16131F">Entrar a la ronda</a>
    </td></tr>
    <tr><td style="padding:16px 28px 24px;font-size:12px;color:#4A4558">Recibís este mail porque postulaste o apoyás a un club en Club Pasos de Color.</td></tr>
  </table></td></tr></table></body></html>`;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405);

  let input: { pass?: string; title?: string; body?: string; url?: string; push?: boolean; email?: boolean };
  try { input = await req.json(); } catch { return json({ error: 'JSON inválido' }, 400); }

  const url = Deno.env.get('SUPABASE_URL')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const sb = createClient(url, serviceKey, { auth: { persistSession: false } });

  const { error: authErr } = await sb.rpc('club_admin_login', { p_pass: input.pass ?? '' });
  if (authErr) return json({ error: 'Contraseña incorrecta' }, 401);

  const title = (input.title ?? 'Club Pasos de Color').slice(0, 80);
  const body = (input.body ?? '').slice(0, 300);
  const origin = req.headers.get('origin') || Deno.env.get('SITE_URL') || '';
  const path = input.url ?? '/';
  const result: Record<string, unknown> = {};

  const { data: cfg, error: cfgErr } = await sb.rpc('server_config');
  if (cfgErr) return json({ error: 'No se pudo leer la configuración' }, 500);
  const conf = (cfg ?? {}) as Record<string, string>;

  // ---- Push ----
  if (input.push !== false) {
    webpush.setVapidDetails(conf.club_vapid_subject, conf.club_vapid_public, conf.club_vapid_private);
    const { data: subs } = await sb.from('club_push_subscriptions').select('id, endpoint, p256dh, auth');
    let sent = 0, failed = 0;
    const gone: number[] = [];
    const payload = JSON.stringify({ title, body, url: path, tag: 'club-aviso' });
    const list = subs ?? [];
    for (let i = 0; i < list.length; i += 50) {
      await Promise.all(list.slice(i, i + 50).map(async (s) => {
        try {
          await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 3600, urgency: 'high' });
          sent++;
        } catch (e) {
          const code = (e as { statusCode?: number }).statusCode;
          if (code === 404 || code === 410) gone.push(s.id); else failed++;
        }
      }));
    }
    if (gone.length) await sb.from('club_push_subscriptions').delete().in('id', gone);
    result.push = { sent, failed, removed: gone.length };
  }

  // ---- Mail (Resend) ----
  if (input.email) {
    const key = Deno.env.get('RESEND_API_KEY') || conf.resend_api_key;
    if (!key) {
      result.email = { skipped: 'falta configurar la clave de Resend (RESEND_API_KEY) para mandar mails' };
    } else {
      const from = Deno.env.get('RESEND_FROM') || conf.club_resend_from || conf.resend_from || 'Club Pasos de Color <onboarding@resend.dev>';
      const { data: reps } = await sb.from('club_teams').select('rep_email, channels').eq('visible', true);
      const { data: fans } = await sb.from('club_supporters').select('email, channels');
      const to = [...new Set([
        ...(reps ?? []).filter((p) => p.channels?.gmail !== false).map((p) => (p.rep_email as string).toLowerCase()),
        ...(fans ?? []).filter((p) => p.channels?.gmail !== false).map((p) => (p.email as string).toLowerCase()),
      ])];
      const html = emailHtml(title, body, `${origin}${path}`);
      let sent = 0, failed = 0;
      for (let i = 0; i < to.length; i += 100) {
        const batch = to.slice(i, i + 100).map((addr) => ({ from, to: [addr], subject: title, html }));
        const r = await fetch('https://api.resend.com/emails/batch', {
          method: 'POST',
          headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(batch),
        });
        if (r.ok) sent += batch.length; else failed += batch.length;
      }
      result.email = { sent, failed };
    }
  }

  return json(result);
});
