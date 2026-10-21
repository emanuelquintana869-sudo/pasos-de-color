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

## Estructura

```
index.html  styles.css  app.js     → sitio público
admin.html  admin.js               → panel de rondas
sw.js  manifest.webmanifest        → notificaciones push / app instalable
config.js                          → URL y clave pública de Supabase, redes
supabase/migrations/0001_init.sql  → tablas, reglas de seguridad y funciones
supabase/functions/notify/         → función que envía push y mails
```

Es un sitio estático: no necesita compilación. Se publica tal cual en Vercel.

## Configuración

1. **Redes**: editá los links en `config.js`.
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

El proyecto de Vercel `pasos-de-color` está conectado a este repo: cada push a `main` se publica solo.

## Club Pasos de Color (carpeta `club/`)

Segunda landing, independiente del sitio principal, con formato "club": carrusel, premios de las rondas, beneficios, pared de ganadores y niveles gratuitos (Descalzo → Media corta → Media larga → De colección) que se suben sumando amigos con el link propio.

- Se publica como **otro proyecto de Vercel** (`club-pasos-de-color`) con raíz en `club/`. El sitio principal la ignora (`.vercelignore`).
- Usa la **misma base de datos** que el sitio principal: los anotados, las rondas, la pantalla en vivo y los avisos son los mismos, y todo se maneja desde el mismo `/admin`.
- Los niveles salen de las chances: 1 chance base + 1 por cada amigo anotado con tu link.
