'use strict';
require('dotenv').config();

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const session = require('express-session');
const MemoryStore = require('memorystore')(session);
const bcrypt = require('bcryptjs');
const multer = require('multer');

const store = require('./lib/store');
const { parseStreamUrl, buildEmbed } = require('./lib/embed');
const V = require('./lib/validate');

const PROD = process.env.NODE_ENV === 'production';
const PORT = Number(process.env.PORT || 3000);
const UPLOAD_DIR = path.join(__dirname, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// ---------- secrets ----------
let SESSION_SECRET = process.env.SESSION_SECRET || '';
if (SESSION_SECRET.length < 32) {
  if (PROD) { console.error('FATAL: set SESSION_SECRET (32+ random chars) in .env'); process.exit(1); }
  SESSION_SECRET = crypto.randomBytes(32).toString('hex');
  console.warn('[dev] Using a temporary session secret. Everyone is logged out on restart.');
}

const app = express();
app.disable('x-powered-by');
// Set TRUST_PROXY=1 when running behind Nginx/Caddy/Cloudflare so req.ip and secure cookies work.
if (process.env.TRUST_PROXY) app.set('trust proxy', Number(process.env.TRUST_PROXY) || process.env.TRUST_PROXY);

// ---------- security headers ----------
app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: false,
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'"],
      imgSrc: ["'self'", 'data:'],
      fontSrc: ["'self'"],
      connectSrc: ["'self'"],
      // The ONLY third parties allowed inside the page: live-stream players.
      frameSrc: [
        'https://www.youtube-nocookie.com',
        'https://www.facebook.com',
        'https://www.instagram.com',
        'https://player.twitch.tv',
        'https://player.vimeo.com'
      ],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
      ...(PROD ? { upgradeInsecureRequests: [] } : {})
    }
  },
  // YouTube's embed refuses to play when the Referer is stripped, so don't use "no-referrer".
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  hsts: PROD ? { maxAge: 31536000, includeSubDomains: true } : false,
  crossOriginEmbedderPolicy: false
}));

// ---------- sessions ----------
app.use(session({
  name: 'rd.sid',
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  rolling: true,
  store: new MemoryStore({ checkPeriod: 3600_000 }),
  cookie: {
    httpOnly: true,
    sameSite: 'strict',
    secure: PROD,           // cookie only travels over HTTPS in production
    maxAge: 8 * 3600_000    // 8 h idle timeout
  }
}));

app.use('/api', express.json({ limit: '20kb' }));

// ---------- helpers ----------
const sleepless = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const ip = (req) => req.ip || 'unknown';
const fail = (res, code, msg) => res.status(code).json({ error: msg });

function requireAuth(req, res, next) {
  if (req.session && req.session.user) return next();
  return fail(res, 401, 'Not signed in.');
}

// CSRF: SameSite=Strict cookie + per-session token header + Origin check.
function csrf(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.get('origin');
  if (origin) {
    try { if (new URL(origin).host !== req.get('host')) return fail(res, 403, 'Bad origin.'); }
    catch { return fail(res, 403, 'Bad origin.'); }
  }
  const sent = Buffer.from(String(req.get('x-csrf-token') || ''));
  const want = Buffer.from(String((req.session && req.session.csrf) || ''));
  if (!want.length || sent.length !== want.length || !crypto.timingSafeEqual(sent, want)) {
    return fail(res, 403, 'Security token missing or invalid. Reload the page.');
  }
  next();
}

// ---------- public API (read-only, no secrets) ----------
const publicLimiter = rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: true, legacyHeaders: false });

function publicView(req) {
  const s = store.getState();
  const on = (a) => a.filter((x) => x.active);
  return {
    rev: s.rev,
    event: s.event,
    settings: s.settings,
    stream: {
      enabled: s.stream.enabled && !!s.stream.ref,
      title: s.stream.title,
      standbyMessage: s.stream.standbyMessage,
      embedUrl: s.stream.enabled ? buildEmbed(s.stream.ref, req.hostname, s.stream.muted !== false) : ''
    },
    ticker: on(s.ticker),
    ads: on(s.ads),
    teams: on(s.teams),
    org: on(s.org)
  };
}

app.get('/api/public/state', publicLimiter, (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(publicView(req));
});

// Server-Sent Events: pushes "something changed" so screens update instantly.
const sseClients = new Set();
const SSE_MAX = 300;
const sseLimiter = rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: true, legacyHeaders: false });
app.get('/api/public/events', sseLimiter, (req, res) => {
  if (sseClients.size >= SSE_MAX) return res.status(503).end();
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-store',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  res.write('retry: 3000\n\n');
  sseClients.add(res);
  req.on('close', () => sseClients.delete(res));
});
store.events.on('change', (rev) => { for (const c of sseClients) c.write(`event: update\ndata: ${rev}\n\n`); });
setInterval(() => { for (const c of sseClients) c.write(': ping\n\n'); }, 25_000).unref();

// ---------- auth ----------
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 12); // equalises timing for unknown users
const loginLimiter = rateLimit({
  windowMs: 15 * 60_000, limit: 20, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many login attempts. Try again in a few minutes.' }
});
const attempts = new Map(); // "user|ip" -> { n, until }
const MAX_FAILS = 5, LOCK_MS = 15 * 60_000;

app.post('/api/auth/login', loginLimiter, sleepless(async (req, res) => {
  const username = V.clean(req.body && req.body.username, 64);
  const password = String((req.body && req.body.password) || '').slice(0, 200);
  const key = `${username.toLowerCase()}|${ip(req)}`;
  const a = attempts.get(key);
  if (a && a.until > Date.now()) return fail(res, 429, 'Too many failed attempts. Try again in 15 minutes.');

  const user = store.getUsers().find((u) => u.username.toLowerCase() === username.toLowerCase());
  const ok = await bcrypt.compare(password, user ? user.hash : DUMMY_HASH);
  if (!user || !ok) {
    // Count consecutive failures; start over only after a previous lockout has expired.
    const expired = a && a.until && a.until <= Date.now();
    const n = (a && !expired ? a.n : 0) + 1;
    attempts.set(key, { n, until: n >= MAX_FAILS ? Date.now() + LOCK_MS : 0 });
    store.audit(username, ip(req), 'login_failed');
    return fail(res, 401, 'Invalid username or password.');
  }
  attempts.delete(key);
  // New session id on login prevents session-fixation attacks.
  req.session.regenerate((err) => {
    if (err) return fail(res, 500, 'Session error.');
    req.session.user = { username: user.username, role: user.role };
    req.session.csrf = crypto.randomBytes(24).toString('hex');
    store.audit(user.username, ip(req), 'login_ok');
    req.session.save(() => res.json({ ok: true }));
  });
}));

app.get('/api/auth/me', (req, res) => {
  if (!req.session.user) return fail(res, 401, 'Not signed in.');
  res.json({ username: req.session.user.username, role: req.session.user.role, csrf: req.session.csrf });
});

app.post('/api/auth/logout', requireAuth, csrf, (req, res) => {
  const u = req.session.user.username;
  req.session.destroy(() => {
    store.audit(u, ip(req), 'logout');
    res.clearCookie('rd.sid');
    res.json({ ok: true });
  });
});

app.post('/api/auth/password', requireAuth, csrf, rateLimit({ windowMs: 15 * 60_000, limit: 10 }), sleepless(async (req, res) => {
  const cur = String((req.body && req.body.current) || '').slice(0, 200);
  const next = String((req.body && req.body.next) || '').slice(0, 200);
  if (next.length < 12) return fail(res, 400, 'New password must be at least 12 characters.');
  const users = store.getUsers();
  const me = users.find((u) => u.username === req.session.user.username);
  if (!me || !(await bcrypt.compare(cur, me.hash))) return fail(res, 403, 'Current password is wrong.');
  me.hash = await bcrypt.hash(next, 12);
  store.saveUsers(users);
  store.audit(me.username, ip(req), 'password_changed');
  res.json({ ok: true });
}));

// ---------- admin API (login + CSRF required) ----------
const admin = express.Router();
admin.use(requireAuth, csrf);
admin.use(rateLimit({ windowMs: 60_000, limit: 240, standardHeaders: true, legacyHeaders: false }));

const fullView = (req) => {
  const s = store.getState();
  return { ...s, stream: { ...s.stream, embedUrl: buildEmbed(s.stream.ref, req.hostname, s.stream.muted !== false) } };
};
const log = (req, action, detail) => store.audit(req.session.user.username, ip(req), action, detail);

admin.get('/state', (req, res) => { res.set('Cache-Control', 'no-store'); res.json(fullView(req)); });

admin.put('/event', (req, res) => {
  const b = req.body || {};
  const startsAt = new Date(b.startsAt);
  if (Number.isNaN(startsAt.getTime())) return fail(res, 400, 'Start date/time is invalid.');
  try {
    store.mutate((s) => {
      s.event = {
        title: V.clean(b.title, 60) || 'RoboDash',
        subtitle: V.clean(b.subtitle, 120),
        venue: V.clean(b.venue, 80),
        startsAt: startsAt.toISOString(),
        logo: V.image(b.logo)
      };
    });
  } catch (e) { return fail(res, 400, e.message); }
  log(req, 'event_updated');
  res.json(fullView(req));
});

admin.put('/settings', (req, res) => {
  const b = req.body || {};
  if (!V.validTimezone(b.timezone)) return fail(res, 400, 'Unknown time zone (example: Asia/Colombo).');
  store.mutate((s) => {
    const o = s.settings;
    s.settings = {
      timezone: b.timezone,
      teamSeconds: V.secs(b.teamSeconds, o.teamSeconds),
      orgSeconds: V.secs(b.orgSeconds, o.orgSeconds),
      adSeconds: V.secs(b.adSeconds, o.adSeconds),
      tickerSeconds: V.secs(b.tickerSeconds, o.tickerSeconds)
    };
  });
  log(req, 'settings_updated');
  res.json(fullView(req));
});

admin.put('/stream', (req, res) => {
  const b = req.body || {};
  const enabled = V.bool(b.enabled);
  const url = String(b.url || '').trim().slice(0, 400);
  let ref = null;
  if (url) {
    try { ref = parseStreamUrl(url); } catch (e) { return fail(res, 400, e.message); }
  } else if (enabled) {
    return fail(res, 400, 'Paste a stream link before switching the stream on.');
  }
  store.mutate((s) => {
    s.stream = {
      enabled, muted: b.muted === undefined ? true : V.bool(b.muted), url: ref ? url : '', ref,
      title: V.clean(b.title, 80),
      standbyMessage: V.clean(b.standbyMessage, 100) || 'Live stream starting soon'
    };
  });
  log(req, 'stream_updated', ref ? `${ref.provider} enabled=${enabled}` : 'cleared');
  res.json(fullView(req));
});

// Generic CRUD for ticker / ads / teams / org
const collection = (req, res, next) => {
  const spec = V.COLLECTIONS[req.params.col];
  if (!spec) return fail(res, 404, 'Unknown collection.');
  req.spec = spec; req.col = req.params.col; next();
};

admin.post('/:col', collection, (req, res) => {
  const s = store.getState();
  if (s[req.col].length >= req.spec.max) return fail(res, 400, `Limit of ${req.spec.max} items reached.`);
  let item;
  try { item = req.spec.make(req.body || {}); } catch (e) { return fail(res, 400, e.message); }
  item.id = store.uid();
  store.mutate((st) => { st[req.col].push(item); });
  log(req, `${req.col}_created`, item.id);
  res.json(fullView(req));
});

admin.put('/:col/order', collection, (req, res) => {
  const ids = Array.isArray(req.body && req.body.ids) ? req.body.ids.map(String) : [];
  store.mutate((st) => {
    const by = new Map(st[req.col].map((x) => [x.id, x]));
    const next = ids.map((id) => by.get(id)).filter(Boolean);
    for (const x of st[req.col]) if (!ids.includes(x.id)) next.push(x);
    st[req.col] = next;
  });
  log(req, `${req.col}_reordered`);
  res.json(fullView(req));
});

admin.put('/:col/:id', collection, (req, res) => {
  const cur = store.getState()[req.col].find((x) => x.id === req.params.id);
  if (!cur) return fail(res, 404, 'Not found.');
  let item;
  try { item = req.spec.make(req.body || {}); } catch (e) { return fail(res, 400, e.message); }
  store.mutate(() => { Object.assign(cur, item); });
  log(req, `${req.col}_updated`, cur.id);
  res.json(fullView(req));
});

admin.delete('/:col/:id', collection, (req, res) => {
  const list = store.getState()[req.col];
  const cur = list.find((x) => x.id === req.params.id);
  if (!cur) return fail(res, 404, 'Not found.');
  store.mutate((st) => { st[req.col] = st[req.col].filter((x) => x.id !== cur.id); });
  for (const f of [cur.image, cur.photo]) removeUpload(f);
  log(req, `${req.col}_deleted`, cur.id);
  res.json(fullView(req));
});

// ---------- uploads ----------
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 4 * 1024 * 1024, files: 1 } });
// Detect the real type from magic bytes; never trust the filename or the browser's MIME type.
function sniff(b) {
  if (b.length > 12 && b[0] === 0x89 && b.toString('latin1', 1, 4) === 'PNG') return 'png';
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg';
  if (b.length > 6 && b.toString('latin1', 0, 4) === 'GIF8') return 'gif';
  if (b.length > 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') return 'webp';
  return null; // SVG is deliberately NOT allowed (it can carry scripts)
}
function removeUpload(p) {
  if (!/^\/uploads\/[a-f0-9]{32}\.(png|jpg|webp|gif)$/.test(p || '')) return;
  fs.unlink(path.join(UPLOAD_DIR, path.basename(p)), () => {});
}

admin.post('/upload/image', rateLimit({ windowMs: 60_000, limit: 30 }), upload.single('file'), (req, res) => {
  if (!req.file) return fail(res, 400, 'No file received.');
  const ext = sniff(req.file.buffer);
  if (!ext) return fail(res, 400, 'Only PNG, JPG, WEBP or GIF images are allowed.');
  const name = `${crypto.randomBytes(16).toString('hex')}.${ext}`;
  fs.writeFileSync(path.join(UPLOAD_DIR, name), req.file.buffer, { mode: 0o644 });
  log(req, 'image_uploaded', name);
  res.json({ path: `/uploads/${name}` });
});

app.use('/api/admin', admin);
app.use('/api', (req, res) => fail(res, 404, 'Not found.'));

// ---------- static files ----------
app.use('/uploads', (req, res, next) => {
  // Uploaded files can never run as a page, even if something slipped through.
  res.set('Content-Security-Policy', "default-src 'none'; sandbox");
  res.set('Cache-Control', 'public, max-age=86400, immutable');
  next();
}, express.static(UPLOAD_DIR, { dotfiles: 'deny', index: false }));

app.use(express.static(path.join(__dirname, 'public'), { dotfiles: 'deny', index: 'index.html' }));

const sendPage = (file) => (req, res) => { res.set('Cache-Control', 'no-store'); res.sendFile(path.join(__dirname, 'admin', file)); };
app.get('/login', (req, res, next) => (req.session.user ? res.redirect('/admin') : next()), sendPage('login.html'));
// Admin HTML/JS/CSS are only served to signed-in users.
const pageAuth = (req, res, next) => (req.session.user ? next() : res.redirect('/login'));
app.get('/admin', pageAuth, sendPage('admin.html'));
app.get('/admin/admin.js', pageAuth, (req, res) => res.sendFile(path.join(__dirname, 'admin', 'admin.js')));
app.get('/admin/login.js', (req, res) => res.sendFile(path.join(__dirname, 'admin', 'login.js')));

// ---------- errors ----------
app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  if (err instanceof multer.MulterError) return fail(res, 400, err.code === 'LIMIT_FILE_SIZE' ? 'Image is larger than 4 MB.' : 'Upload failed.');
  if (err && err.type === 'entity.too.large') return fail(res, 413, 'Request too large.');
  if (err && err.type === 'entity.parse.failed') return fail(res, 400, 'Malformed JSON.');
  console.error(err); // details stay in the server log, never sent to the browser
  fail(res, 500, 'Something went wrong.');
});

if (require.main === module) {
  if (!store.getUsers().length) console.warn('\nNo admin user yet. Run:  npm run create-admin\n');
  app.listen(PORT, process.env.HOST || '0.0.0.0', () => console.log(`RoboDash running on http://localhost:${PORT}  (admin: /login)`));
}
module.exports = app;
