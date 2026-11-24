'use strict';
// End-to-end check of the API and its security controls.  Run:  npm test
// Uses a throwaway data directory, so your real data is never touched.
const os = require('os');
const fs = require('fs');
const path = require('path');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'robodash-test-'));
process.env.DATA_DIR = tmp;
process.env.NODE_ENV = 'development';

const bcrypt = require('bcryptjs');
const store = require('../lib/store');
store.saveUsers([{ username: 'tester', hash: bcrypt.hashSync('correct horse battery', 10), role: 'admin' }]);

const app = require('../server');
const { parseStreamUrl } = require('../lib/embed');

let pass = 0, failed = 0;
const ok = (cond, name) => { if (cond) { pass++; console.log('  ok   ' + name); } else { failed++; console.log('  FAIL ' + name); } };

(async () => {
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  let cookie = '', csrf = '';
  const call = async (method, url, body, extra = {}) => {
    const headers = { ...(cookie ? { cookie } : {}), ...extra };
    if (body !== undefined && !(body instanceof FormData)) headers['content-type'] = 'application/json';
    const r = await fetch(base + url, { method, headers, body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body), redirect: 'manual' });
    const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
    let data = null; try { data = await r.json(); } catch { /* not json */ }
    return { r, data };
  };

  console.log('Public access');
  let x = await call('GET', '/api/public/state');
  ok(x.r.status === 200 && x.data.teams.length >= 1, 'public state is readable without login');
  ok(!('users' in x.data) && !JSON.stringify(x.data).includes('hash'), 'public state leaks no secrets');
  x = await call('GET', '/api/admin/state'); ok(x.r.status === 401, 'admin API rejects anonymous requests');
  x = await call('GET', '/admin'); ok(x.r.status === 302, '/admin redirects anonymous users to login');
  x = await call('POST', '/api/admin/teams', { name: 'x' }); ok(x.r.status === 401, 'anonymous write is rejected');

  console.log('Headers');
  x = await call('GET', '/');
  const csp = x.r.headers.get('content-security-policy') || '';
  ok(/script-src 'self'/.test(csp) && !/unsafe-inline/.test(csp), 'CSP forbids inline scripts');
  ok(/frame-ancestors 'none'/.test(csp), 'CSP blocks clickjacking');
  ok(x.r.headers.get('x-content-type-options') === 'nosniff', 'nosniff set');
  ok(!x.r.headers.get('x-powered-by'), 'X-Powered-By hidden');

  console.log('Login');
  x = await call('POST', '/api/auth/login', { username: 'tester', password: 'wrong' }); ok(x.r.status === 401, 'wrong password rejected');
  x = await call('POST', '/api/auth/login', { username: 'nobody', password: 'wrong' }); ok(x.r.status === 401 && x.data.error === 'Invalid username or password.', 'unknown user gives the same message');
  x = await call('POST', '/api/auth/login', { username: 'tester', password: 'correct horse battery' }); ok(x.r.status === 200, 'correct password accepted');
  const flags = x.r.headers.get('set-cookie') || '';
  ok(/HttpOnly/i.test(flags) && /SameSite=Strict/i.test(flags), 'session cookie is HttpOnly + SameSite=Strict');
  x = await call('GET', '/api/auth/me'); csrf = x.data.csrf; ok(!!csrf, 'signed in, csrf token issued');

  console.log('CSRF & validation');
  x = await call('POST', '/api/admin/ticker', { text: 'hi', active: true }); ok(x.r.status === 403, 'write without CSRF token is rejected');
  x = await call('POST', '/api/admin/ticker', { text: 'hi', active: true }, { 'x-csrf-token': csrf, origin: 'https://evil.example' }); ok(x.r.status === 403, 'write from a foreign Origin is rejected');
  const H = { 'x-csrf-token': csrf };
  x = await call('POST', '/api/admin/ticker', { text: '<img src=x onerror=alert(1)>', active: true }, H); ok(x.r.status === 200, 'valid write accepted');
  x = await call('POST', '/api/admin/nope', { text: 'x' }, H); ok(x.r.status === 404, 'unknown collection rejected');
  x = await call('POST', '/api/admin/teams', { name: '' }, H); ok(x.r.status === 400, 'empty team name rejected');
  x = await call('POST', '/api/admin/ads', { title: 'bad', image: 'https://evil.example/x.png' }, H); ok(x.r.status === 400, 'external image URL rejected');
  x = await call('POST', '/api/admin/ads', { title: 'bad', image: '/uploads/../../etc/passwd' }, H); ok(x.r.status === 400, 'path-traversal image rejected');

  console.log('Stream links');
  x = await call('PUT', '/api/admin/stream', { url: 'https://evil.example/watch?v=dQw4w9WgXcQ', enabled: true }, H); ok(x.r.status === 400, 'unknown host rejected');
  x = await call('PUT', '/api/admin/stream', { url: 'http://www.youtube.com/watch?v=dQw4w9WgXcQ', enabled: true }, H); ok(x.r.status === 400, 'non-https link rejected');
  x = await call('PUT', '/api/admin/stream', { url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&x="><script>', enabled: true, title: 'T' }, H);
  ok(x.r.status === 200 && x.data.stream.embedUrl === 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1&mute=1&rel=0&modestbranding=1&playsinline=1', 'YouTube link becomes a clean nocookie embed URL');
  x = await call('GET', '/api/public/state'); ok(x.data.stream.enabled && x.data.stream.embedUrl.startsWith('https://www.youtube-nocookie.com/embed/'), 'public screens receive the embed URL');
  ok(parseStreamUrl('https://youtu.be/dQw4w9WgXcQ').id === 'dQw4w9WgXcQ', 'youtu.be short link parsed');
  ok(parseStreamUrl('https://www.twitch.tv/somechannel').channel === 'somechannel', 'twitch link parsed');
  let threw = false; try { parseStreamUrl('https://www.instagram.com/someuser/'); } catch { threw = true; } ok(threw, 'instagram profile/live link explained as unsupported');

  console.log('Uploads');
  const fakeSvg = new FormData(); fakeSvg.append('file', new Blob(['<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'], { type: 'image/png' }), 'a.png');
  x = await call('POST', '/api/admin/upload/image', fakeSvg, H); ok(x.r.status === 400, 'SVG disguised as PNG is rejected (magic-byte check)');
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
  const good = new FormData(); good.append('file', new Blob([png], { type: 'image/png' }), 'evil.php');
  x = await call('POST', '/api/admin/upload/image', good, H); ok(x.r.status === 200 && /^\/uploads\/[a-f0-9]{32}\.png$/.test(x.data.path), 'real PNG accepted and renamed to a random .png name');
  const up = await fetch(base + x.data.path); ok(up.status === 200 && /sandbox/.test(up.headers.get('content-security-policy') || ''), 'uploads are served sandboxed');

  console.log('Rate limit & lockout');
  cookie = '';
  let last = 0; for (let i = 0; i < 7; i++) { last = (await call('POST', '/api/auth/login', { username: 'tester', password: 'nope' + i })).r.status; }
  ok(last === 429, 'repeated failures lock the account/IP');
  x = await call('POST', '/api/auth/login', { username: 'tester', password: 'correct horse battery' }); ok(x.r.status === 429, 'even the right password is refused during lockout');

  console.log(`\n${pass} passed, ${failed} failed`);
  server.close(); fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
