# RoboDash Live Dashboard

A TV-style live dashboard for the RoboDash robotics competition, with a separate, login-protected control panel.

```
 PUBLIC SCREEN  (/)                              CONTROL PANEL  (/login → /admin)
 ┌───────────────────────────┬───────────┐       Live stream  – paste YouTube/Facebook/Twitch/Vimeo/IG-post link, on/off, mute
 │  LIVE STREAM  + clock     │  TEAMS    │       Messages     – fun facts / announcements strip
 │                           │ slideshow │       Ads          – sponsor boxes (image or text)
 ├───────────────────────────┤───────────┤       Teams        – name, uni, country flag, members, photo, status
 │ ON TRACK │ fun facts      │ ORGANISA- │       Organisation – campus info, courses, breaking news
 ├────────┬────────┬─────────┤ TION /    │       Event        – title, logo, start time, slide speeds, time zone
 │  ad 1  │  ad 2  │  ad 3   │ NEWS      │       Account      – change password
 └────────┴────────┴─────────┴───────────┘
```

Changes made in the panel appear on every open screen within about a second (server-sent events), and screens keep showing the last known content if the network drops.

## 1. Run it

Requires Node.js 20 or newer.

```bash
npm install
cp .env.example .env          # then edit .env (see below)
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"   # paste into SESSION_SECRET
npm run create-admin          # asks for a username and a 12+ character password
npm start                     # http://localhost:3000   (admin: /login)
npm test                      # 33 automated security / API checks
```

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

**Going live.** In the panel: Live stream → paste the link → tick *Stream is ON* → Save & apply. Use **Emergency: go off air** to drop to the standby screen (with countdown) instantly.

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
* **Single role:** all accounts are full admins. A read-only or "ads only" role would be a natural next step.
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
admin/               login page + control panel (only served after login)
scripts/             create-admin.js, smoke-test.js
data/  uploads/      created at runtime (state, users, audit log, images)
```
