# RoboDash Live Dashboard

A TV-style live dashboard for the RoboDash robotics competition, with a separate, login-protected control panel.

```
 PUBLIC SCREEN  (/)                              CONTROL PANEL  (/login → /admin)
 ┌───────────────────────────┬───────────┐       Live stream  – choose and enable a public stream
 │  LIVE STREAM               │  TEAMS    │       Emergency    – take over with a YouTube video or uploaded MP4
 │                           │ slideshow │       Messages     – add/edit announcements
 ├───────────────────────────┤───────────┤       Ads          – manage image/GIF/video sponsor slides
 │ ON TRACK │ fun facts      │ ORGANISA- │       Teams        – edit names, members, photos and status
 ├────────┬────────┬─────────┤ TION /    │       Organisation – edit campus info, courses and news
 │  ad 1  │  ad 2  │  ad 3   │ NEWS      │       Event        – update metadata and slideshow timing
 └────────┴────────┴─────────┴───────────┘
```

Changes made in the panel appear on open screens as their data refreshes, and screens keep showing the last known content if the network drops. Use the **Admin** link on the public page to open the password-protected control panel.

## 1. Run it

Requires Node.js 20 or newer.

```bash
npm install
cp .env.example .env          # then edit .env (see below)
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"   # paste into SESSION_SECRET
npm run create-admin          # asks for a username and a 12+ character password
npm start                     # http://localhost:3000   (admin: /login)
npm test                      # smoke tests for auth, API, uploads and dashboard features
```

### Cloudflare + Supabase

The Cloudflare Worker uses Supabase Auth for admin accounts and Supabase Postgres/Storage for dashboard state and public media. The publishable key in `wrangler.toml` is intended for public client use; never add a Supabase `service_role` or secret key to source control.

1. In the Supabase SQL Editor, run [`supabase/migrations/20261125000100_dashboard.sql`](./supabase/migrations/20261125000100_dashboard.sql).
2. In Supabase **Authentication → Users**, create/confirm the configured admin email and set a strong password there. Do not put that password in this repository.
3. Run [`supabase/migrations/20261125000200_admin_users.sql`](./supabase/migrations/20261125000200_admin_users.sql) to register the configured email as the super administrator and enable admin roles.
4. Add the deployed Cloudflare login URL (`https://robodash-web-dashboard.simaneth.workers.dev/login*`) to Supabase Auth's allowed redirect URLs. Deploy the `admin-users` Supabase Edge Function in [`supabase/functions/admin-users/index.ts`](./supabase/functions/admin-users/index.ts) with JWT verification enabled. It keeps the service-role key inside Supabase; do not copy it to Cloudflare or the browser.
5. Confirm `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, and `SUPABASE_ADMIN_EMAIL` in `wrangler.toml`, then deploy with `npm run deploy:cloudflare`. Admin access is at `/login`; each admin signs in with their own Supabase email and password.

The SQL migrations enable public read access to dashboard content and media, and restrict writes to registered admins. The configured email is seeded as the super administrator; additional admins can be invited from the control panel and set their own password through Supabase Auth. Uploaded media is stored in the public `dashboard-media` bucket. Use the top-right emergency button to switch the prepared YouTube or MP4 video over the live player.

## 2. Event-day setup

**Where to host it.** Two sensible options:

| Option | Good for | Notes |
|---|---|---|
| Laptop / mini-PC at the venue, screens open `http://<its-LAN-IP>:3000` | Reliable on-site, no hosting cost | Set `HOST=0.0.0.0`. Use `ipconfig`/`ip a` for the IP. Add HTTPS if admins log in from outside the LAN (see option 2). |
| Small VPS (or a Cloudflare Tunnel from the laptop) with HTTPS | Admins editing from anywhere | Put **Caddy** or **Nginx** in front, keep the app on `127.0.0.1`, set `TRUST_PROXY=1`, `NODE_ENV=production`. |

Minimal Caddy config (it obtains and renews the HTTPS certificate automatically):

```
dash.yourdomain.lk {
  reverse_proxy 127.0.0.1:3000
}
```

Keep it running with `pm2 start server.js --name robodash` or a systemd service.

**Screens (kiosk mode).** On the TV's PC:

```bash
google-chrome --kiosk --autoplay-policy=no-user-gesture-required http://<address>/
```

Browsers block autoplay *with sound*. The stream therefore starts muted by default. For a screen that needs audio, untick **Start muted** in the Live stream tab **and** launch Chrome with the flag above (or click once on the page).

**Going live.** In the panel: Live stream → paste the link → tick *Stream is ON* → Save. Use the emergency-video button to override the stream, and press it again to return to the live feed.

**Instagram.** Instagram does **not** allow live broadcasts to be embedded on other sites; only posts/reels embed. To show an Instagram session, broadcast with OBS or Restream to **YouTube Live** (you can send the same feed to Instagram simultaneously) and paste the YouTube link.

**YouTube links that work:** `youtube.com/watch?v=…`, `youtube.com/live/…`, `youtu.be/…`, and `youtube.com/channel/UC…` (always shows that channel's current live stream). `@handle` links cannot be embedded.

**Colours.** `public/css/theme.css` → `:root` variables: SLT-Mobitel blue and green plus IET purple. Adjust them there if the campus brand guide specifies exact values.

## 3. Security: what is built in

| Threat | Protection in this project |
|---|---|
| Stolen / guessed password | bcrypt (cost 12), 12-character minimum, 5 failed attempts locks that user+IP for 15 min, plus a per-IP rate limit; unknown usernames take the same time and give the same message as wrong passwords |
| Session theft | Random session ID in an `HttpOnly`, `SameSite=Strict`, `Secure` (production) cookie; new ID on login (prevents fixation); 8 h idle timeout; real logout |
| CSRF (another site making your admin click) | `SameSite=Strict` + per-session CSRF token header + `Origin` check on every write |
| XSS (script injected through a team name, message, etc.) | Public and admin pages only use `textContent`; strict Content-Security-Policy: no inline scripts, no third-party scripts; input is trimmed, control characters stripped and length-limited on the server |
| Malicious stream link | Link is parsed on the server; only https links on allow-listed platforms are accepted; only the extracted video/channel ID is stored and the embed URL is rebuilt from it. CSP `frame-src` also lists only those players |
| Malicious upload | 4 MB limit; real type detected from file bytes (PNG/JPG/WEBP/GIF only, **no SVG**); random file name; served with a sandboxing CSP and `nosniff`; image fields only accept paths this server created |
| Clickjacking | `frame-ancestors 'none'` |
| Brute-force / flooding | Rate limits on login, admin API, public API and the live-update connection; request body capped at 20 KB |
| Information leaks | No stack traces to the browser, `X-Powered-By` removed, public API contains only on-screen content, data folder created `0700`, files `0600` |
| "Who changed that?" | `data/audit.log` records every login, failed login and change with time, user and IP |
| Supply chain | 8 well-known dependencies; run `npm audit` before the event |

## 4. Security: what *you* must do

1. **HTTPS is mandatory** anywhere outside a closed LAN, otherwise passwords and cookies travel in clear text. Use Caddy/Nginx/Cloudflare as above.
2. **Set a real `SESSION_SECRET`** and never commit `.env` (already in `.gitignore`).
3. **Use unique, long passwords** and create one account per organiser (`npm run create-admin` again with a new name). Delete accounts when someone leaves the team.
4. **Firewall:** expose only 80/443. With a reverse proxy keep `HOST=127.0.0.1`.
5. **Back up `data/` and `uploads/`** before the event and copy them off the machine afterwards.
6. **Keep software current:** `npm audit`, `npm update`, OS updates. Run the app as a normal user, not root.
7. **Protect the stream itself.** Your YouTube/OBS stream key is a password. Never paste it into this dashboard (only the public watch link belongs here) and don't show it on screen.
8. **Optional extras for a public deployment:** put the admin behind Cloudflare Access or a VPN/IP allow-list, enable two-factor on the hosting and domain accounts, and review `data/audit.log` after the event.
9. **Privacy:** team photos and names of students are personal data. Get consent from teams (especially minors) before showing photos publicly.
10. **Sponsor / ad content:** admins decide what appears on a public screen; keep admin accounts limited to people you trust.

## 5. Known limits (and the upgrade path)

* **Sessions live in memory:** restarting the server logs everyone out (screens are unaffected). For multi-server deployments, switch to a Redis/SQLite session store.
* **Data is a JSON file** (atomic writes): perfect for one event and a handful of editors. Swap `lib/store.js` for SQLite/Postgres if it grows.
* **Admin roles:** invited accounts are admins; only the seeded super administrator can manage admin accounts.
* **No image resizing:** upload images around 1600 px wide or smaller (add `sharp` if you want automatic resizing).
* **Flag emoji** may display as two letters on Windows computers (a Windows font limit, not a bug).
* **Stream embeds depend on the platform:** the owner may disable embedding for a video; test the link in the panel's preview before the event.

## 6. Folder map

```
server.js            API, auth, security middleware, static hosting
lib/store.js         JSON data store, users, audit log
lib/embed.js         stream-link allow-list + embed URL builder
lib/validate.js      server-side validation / sanitising
public/              the public dashboard (index.html, css/theme.css, js/dashboard.js, fonts)
public/admin/        login page + control panel (admin routes are protected by the server)
scripts/             create-admin.js, smoke-test.js
data/  uploads/      created at runtime (state, users, audit log, images)
```
