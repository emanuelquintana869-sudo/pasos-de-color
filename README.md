# Pasos de Color · Good is Good × Nikao

**En vivo:** https://pasos-de-color.vercel.app · **Panel:** https://pasos-de-color.vercel.app/admin

Landing para que clientes y seguidores participen y ganen medias de la fábrica **Good is Good**, con rondas en vivo en tiempo real.

## Qué hace

- **Registro** con requisitos (seguir a @goodisgood, @nikao, TikTok, etiquetar amigos) y número de participación.
- **Chances extra por referidos**: cada persona tiene su link `/?r=GIG-XXXXXX`; cada amigo que se anota con ese link suma una chance.
- **Contador** a la próxima ronda, con botón para agendarla en Google Calendar.
- **Pantalla EN VIVO** colorida que se abre sola en todos los dispositivos cuando arranca la ronda: cuenta regresiva, mezcla de números y ganador con confeti. Usa Supabase Realtime.
- **Avisos**: notificaciones push (web push con VAPID), mail (vía Resend) y Google Calendar.
- **Últimos ganadores** con su club y **videos** de la fábrica (YouTube se ve dentro de la página).
- **Panel de admin** en `/admin`: crear rondas, arrancar el vivo, elegir ganador (al azar y ponderado por chances, del lado del servidor), ver contacto del ganador, mandar avisos, exportar participantes a CSV y cargar videos.

## Estructura del repo

Dos sitios **totalmente separados**, cada uno en su carpeta y con su propio proyecto de Vercel:

```
sitio-principal/   → Pasos de Color (pasos-de-color.vercel.app)
  index.html  styles.css  app.js     → sitio público
  admin.html  admin.js               → panel de rondas
  sw.js  manifest.webmanifest        → notificaciones push / app instalable
  config.js                          → URL y clave pública de Supabase, redes
  supabase/migrations/0001_init.sql  → tablas, reglas de seguridad y funciones
  supabase/functions/notify/         → función que envía push y mails
club/              → Club Pasos de Color (club-pasos-de-color.vercel.app)
```

Es un sitio estático: no necesita compilación. Se publica tal cual en Vercel.

## Configuración

1. **Redes**: editá los links en `sitio-principal/config.js`.
2. **Contraseña del panel**: se guarda encriptada en `private.admin`. Para cambiarla, en el editor SQL de Supabase:
   ```sql
   update private.admin set pass_hash = extensions.crypt('NUEVA-CONTRASEÑA', extensions.gen_salt('bf'));
   ```
3. **Mails**: creá una cuenta en [resend.com](https://resend.com), verificá tu dominio y cargá la clave:
   ```sql
   insert into private.config (key, value) values
     ('resend_api_key', 're_...'),
     ('resend_from', 'Pasos de Color <avisos@tudominio.com>')
   on conflict (key) do update set value = excluded.value;
   ```
   Sin dominio verificado, Resend solo envía a tu propio mail.

## Cómo hacer una ronda

1. Entrá a `/admin` con la contraseña.
2. (Opcional) Mandá un aviso desde "Mandar un aviso" unas horas antes.
3. A la hora de la ronda, tocá **Arrancar en vivo**: a todos se les abre la pantalla con la cuenta regresiva.
4. Al llegar a 0 se elige el ganador automáticamente (o tocá **Elegir ganador**). Aparece en vivo para todos.
5. Tocá **Ver contacto** para escribirle al ganador.

## Publicación

El proyecto de Vercel `pasos-de-color` publica la carpeta `sitio-principal/` y `club-pasos-de-color` publica `club/`.

## Club Pasos de Color (carpeta `club/`)

Landing **totalmente independiente** del sitio principal, para que **clubes de barrio** ganen **medias personalizadas** con sus colores.

- **Cómo funciona:** alguien del club (dirigente, jugador, profe, socio) lo postula con sus colores y su historia. Los hinchas lo apoyan desde el link del club (`/?c=CLB-XXXXX`). En cada ronda en vivo se elige un club al azar: cada hincha es una chance para su club.
- **Secciones:** carrusel, manifiesto y números reales, cómo funciona, premio de la próxima ronda, ranking de clubes (con buscador y filtro por provincia), historias de los clubes, mapa de barrios, avisos, clubes ganadores, preguntas.
- **Panel** `/admin` (contraseña propia): rondas con premio libre, en vivo, contacto del club ganador, avisos, lista de clubes (ocultar/mostrar) y Excel de clubes e hinchas.
- **Link propio:** proyecto de Vercel `club-pasos-de-color` con raíz en `club/` → https://club-pasos-de-color.vercel.app
- **Datos propios:** tablas `club_teams`, `club_supporters`, `club_rounds`, `club_push_subscriptions` y funciones `club_*` (ver `club/supabase/`). Avisos con la función `club-notify` y claves push propias. No comparte nada con el sitio principal.
- **Clientes:** al apoyar a un club, un cliente puede marcar "Soy cliente" y poner **solo su número de pedido**. Su apoyo vale x3. Cuidados: cada pedido se usa una sola vez; se guardan solo hashes con un secreto del servidor (`private.club_orders`); límite de 10 intentos fallidos por IP y 5 por pedido por hora. Los pedidos se cargan desde el panel subiendo el **Excel** (o `.json`) del sistema: se lee en el navegador y solo se sube el número de pedido (ver `club/supabase/0003_clientes.sql`).
