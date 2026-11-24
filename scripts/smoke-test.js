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
  x = await call('GET', '/admin/admin.html'); ok(x.r.status === 302, 'direct admin HTML access redirects anonymous users');
  x = await call('GET', '/admin/admin.js'); ok(x.r.status === 302, 'direct admin script access redirects anonymous users');
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
  x = await call('POST', '/api/admin/ads', { title: 'Sponsor', label: 'Partner', image: '', active: true }, H);
  const adId = x.data.ads[0] && x.data.ads[0].id;
  ok(x.r.status === 200 && adId && x.data.ads[0].title === 'Sponsor', 'admin can add dashboard ads');
  x = await call('PUT', `/api/admin/ads/${adId}`, { title: 'Updated sponsor', label: 'Main partner', image: '', active: true }, H);
  ok(x.r.status === 200 && x.data.ads[0].title === 'Updated sponsor', 'admin can edit dashboard ad content');
  x = await call('DELETE', `/api/admin/ads/${adId}`, undefined, H);
  ok(x.r.status === 200 && x.data.ads.length === 0, 'admin can delete dashboard ads');
  x = await call('POST', '/api/admin/ads', { title: 'Video sponsor', mediaType: 'youtube', videoUrl: 'https://evil.example/watch?v=dQw4w9WgXcQ', active: true }, H);
  ok(x.r.status === 400, 'video ads reject untrusted YouTube hosts');
  x = await call('POST', '/api/admin/ads', { title: 'Video sponsor', mediaType: 'youtube', videoUrl: 'https://youtu.be/dQw4w9WgXcQ', active: true }, H);
  const videoAd = x.data.ads[0];
  ok(x.r.status === 200 && videoAd.videoEmbedUrl.includes('/embed/dQw4w9WgXcQ'), 'YouTube video ads receive a safe public player URL');
  x = await call('GET', '/api/public/state');
  ok(x.data.ads[0].videoEmbedUrl.includes('/embed/dQw4w9WgXcQ'), 'public dashboard receives video ads');
  await call('DELETE', `/api/admin/ads/${videoAd.id}`, undefined, H);
  x = await call('POST', '/api/admin/users', { username: 'second-admin', password: 'a-strong-password-123' }, H);
  ok(x.r.status === 201, 'admin can create an additional local admin account');
  x = await call('GET', '/api/admin/users');
  ok(x.r.status === 200 && x.data.users.some((user) => user.username === 'second-admin' && !user.hash), 'admin list does not expose password hashes');
  x = await call('DELETE', '/api/admin/users/second-admin', undefined, H);
  ok(x.r.status === 200, 'admin can revoke another local admin');
  x = await call('POST', '/api/auth/login', { username: 'second-admin', password: 'a-strong-password-123' });
  ok(x.r.status === 401, 'revoked admin cannot log in');
  let teamResult;
  for (let i = 0; i < 80; i++) {
    teamResult = await call('POST', '/api/admin/teams', { name: `Expanded team ${i + 1}`, active: true }, H);
  }
  ok(teamResult.r.status === 200 && teamResult.data.teams.length === 81, 'team list is no longer capped at 80 entries');
  x = await call('PUT', '/api/admin/event', { title: 'Updated event', subtitle: 'New text', venue: 'Main hall', startsAt: '2026-12-16T03:30:00.000Z', logo: '' }, H);
  ok(x.r.status === 200 && x.data.event.title === 'Updated event', 'admin can update dashboard event text');
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

  console.log('Emergency video');
  x = await call('PUT', '/api/admin/emergency-video', { type: 'youtube', url: 'https://evil.example/video', enabled: true }, H);
  ok(x.r.status === 400, 'emergency video rejects untrusted hosts');
  x = await call('PUT', '/api/admin/emergency-video', { type: 'youtube', url: 'https://youtu.be/dQw4w9WgXcQ', enabled: true }, H);
  ok(x.r.status === 200 && x.data.emergencyVideo.enabled, 'YouTube emergency video can be activated');
  x = await call('GET', '/api/public/state');
  ok(x.data.emergencyVideo.enabled && x.data.emergencyVideo.embedUrl.includes('/embed/dQw4w9WgXcQ'), 'public dashboard receives emergency override');

  console.log('Uploads');
  const fakeSvg = new FormData(); fakeSvg.append('file', new Blob(['<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'], { type: 'image/png' }), 'a.png');
  x = await call('POST', '/api/admin/upload/image', fakeSvg, H); ok(x.r.status === 400, 'SVG disguised as PNG is rejected (magic-byte check)');
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
  const good = new FormData(); good.append('file', new Blob([png], { type: 'image/png' }), 'evil.php');
  x = await call('POST', '/api/admin/upload/image', good, H); ok(x.r.status === 200 && /^\/uploads\/[a-f0-9]{32}\.png$/.test(x.data.path), 'real PNG accepted and renamed to a random .png name');
  const up = await fetch(base + x.data.path); ok(up.status === 200 && /sandbox/.test(up.headers.get('content-security-policy') || ''), 'uploads are served sandboxed');
  const fakeVideo = new FormData(); fakeVideo.append('file', new Blob(['not a video'], { type: 'video/mp4' }), 'fake.mp4');
  x = await call('POST', '/api/admin/upload/emergency-video', fakeVideo, H); ok(x.r.status === 400, 'invalid emergency video upload is rejected');
  const mp4 = Buffer.alloc(16); mp4.write('....ftypisom', 0, 'latin1');
  const videoForm = new FormData(); videoForm.append('file', new Blob([mp4], { type: 'video/mp4' }), 'clip.mp4');
  x = await call('POST', '/api/admin/upload/emergency-video', videoForm, H);
  const videoPath = x.data && x.data.path;
  ok(x.r.status === 200 && /^\/uploads\/[a-f0-9]{32}\.mp4$/.test(videoPath || ''), 'valid MP4 upload is stored under a random name');
  if (videoPath) {
    const videoResponse = await fetch(base + videoPath);
    ok(videoResponse.status === 200 && (videoResponse.headers.get('content-type') || '').startsWith('video/mp4'), 'uploaded MP4 is served as video');
    fs.unlinkSync(path.join(__dirname, '..', videoPath.slice(1)));
  }
  const adVideoForm = new FormData(); adVideoForm.append('file', new Blob([mp4], { type: 'video/mp4' }), 'sponsor.mp4');
  x = await call('POST', '/api/admin/upload/video', adVideoForm, H);
  const adVideoPath = x.data && x.data.path;
  ok(x.r.status === 200 && /^\/uploads\/[a-f0-9]{32}\.mp4$/.test(adVideoPath || ''), 'generic video upload supports video advertisements');
  x = await call('POST', '/api/admin/ads', { title: 'Uploaded sponsor', mediaType: 'upload', videoPath: adVideoPath, active: true }, H);
  const uploadedAd = x.data.ads[0];
  ok(x.r.status === 200 && uploadedAd.videoPath === adVideoPath, 'uploaded MP4 can be attached to a video ad');
  await call('DELETE', `/api/admin/ads/${uploadedAd.id}`, undefined, H);
  const adVideoFile = path.join(__dirname, '..', adVideoPath.slice(1));
  if (fs.existsSync(adVideoFile)) fs.unlinkSync(adVideoFile);

  console.log('Rate limit & lockout');
  cookie = '';
  let last = 0; for (let i = 0; i < 7; i++) { last = (await call('POST', '/api/auth/login', { username: 'tester', password: 'nope' + i })).r.status; }
  ok(last === 429, 'repeated failures lock the account/IP');
  x = await call('POST', '/api/auth/login', { username: 'tester', password: 'correct horse battery' }); ok(x.r.status === 429, 'even the right password is refused during lockout');

  console.log(`\n${pass} passed, ${failed} failed`);
  server.close(); fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
