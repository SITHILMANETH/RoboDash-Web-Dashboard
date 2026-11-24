(() => {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

  let S = null;      // full server state
  let CSRF = '';
  let tab = 'stream';

  /* ---------- api ---------- */
  async function api(method, url, body) {
    const opt = { method, credentials: 'same-origin', headers: { Accept: 'application/json' } };
    if (method !== 'GET') { opt.headers['Content-Type'] = 'application/json'; opt.headers['X-CSRF-Token'] = CSRF; }
    if (body !== undefined) opt.body = JSON.stringify(body);
    const r = await fetch(url, opt);
    const data = await r.json().catch(() => ({}));
    if (r.status === 401) { location.href = '/login'; throw new Error('Signed out'); }
    if (!r.ok) throw new Error(data.error || `Request failed (${r.status})`);
    return data;
  }
  async function uploadImage(file) {
    const fd = new FormData(); fd.append('file', file);
    const r = await fetch('/api/admin/upload/image', { method: 'POST', credentials: 'same-origin', headers: { 'X-CSRF-Token': CSRF }, body: fd });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || 'Upload failed');
    return data.path;
  }

  let toastTimer = 0;
  function toast(msg, bad) {
    const t = $('#toast'); t.textContent = msg; t.className = 'toast' + (bad ? ' bad' : ''); t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, bad ? 6000 : 2500);
  }
  async function run(btn, fn, okMsg) {
    if (btn) btn.disabled = true;
    try { await fn(); if (okMsg) toast(okMsg); } catch (e) { toast(e.message, true); }
    finally { if (btn) btn.disabled = false; }
  }

  /* ---------- form helpers ---------- */
  function field(label, input, wide) {
    const f = el('div', 'field' + (wide ? ' wide' : '')); f.append(el('label', '', label), input); return f;
  }
  function text(value, max, type = 'text') { const i = el('input'); i.type = type; i.value = value || ''; if (max) i.maxLength = max; return i; }
  function area(value, max) { const t = el('textarea'); t.value = value || ''; if (max) t.maxLength = max; return t; }
  function select(value, opts) {
    const s = el('select'); opts.forEach(([v, l]) => { const o = el('option', '', l); o.value = v; s.append(o); }); s.value = value; return s;
  }
  function check(label, value) {
    const w = el('label', 'check'); const i = el('input'); i.type = 'checkbox'; i.checked = !!value; w.append(i, document.createTextNode(label)); w.input = i; return w;
  }
  function imageField(label, current) {
    const box = el('div'); const state = { path: current || '' };
    const thumb = el('div', 'thumb'); const file = el('input'); file.type = 'file'; file.accept = 'image/png,image/jpeg,image/webp,image/gif';
    const clear = el('button', 'btn sm', 'Remove'); clear.type = 'button';
    const draw = () => {
      thumb.replaceChildren();
      if (state.path) { const i = new Image(); i.src = state.path; i.alt = ''; thumb.append(i); } else thumb.append(el('div', 'ph', 'no image'));
      const col = el('div'); col.append(file); if (state.path) col.append(clear); thumb.append(col);
    };
    file.addEventListener('change', async () => {
      if (!file.files[0]) return;
      try { state.path = await uploadImage(file.files[0]); draw(); toast('Image uploaded — press Save to apply'); } catch (e) { toast(e.message, true); }
    });
    clear.addEventListener('click', () => { state.path = ''; draw(); });
    draw(); box.append(thumb, el('div', 'hint', 'PNG / JPG / WEBP / GIF, up to 4 MB.'));
    const f = field(label, box); f.get = () => state.path; return f;
  }

  /* ---------- collections (messages, ads, teams, org) ---------- */
  const COLS = {
    ticker: {
      title: 'Messages & fun facts', lead: 'Short lines that rotate in the strip under the stream. Keep each under about 120 characters so it fits on one line.',
      noun: 'message', label: (i) => i.text.slice(0, 70),
      fields: (i) => ({
        text: field('Message', area(i.text, 220), true),
        active: { el: check('Show on screen', i.active !== false), plain: true }
      })
    },
    ads: {
      title: 'Ads & sponsors', lead: 'Three ad boxes sit under the strip. With more than three ads they rotate in pages. Landscape images (about 16:9) look best.',
      noun: 'ad', label: (i) => i.title || 'Image ad',
      fields: (i) => ({
        title: field('Title / sponsor name', text(i.title, 80)),
        label: field('Small label (e.g. "Gold sponsor")', text(i.label, 40)),
        image: imageField('Image', i.image),
        active: { el: check('Show on screen', i.active !== false), plain: true }
      })
    },
    teams: {
      title: 'Teams', lead: 'Shown in the top-right slideshow. Set a team to "On track" and its name appears in the green strip under the stream.',
      noun: 'team', label: (i) => `${i.name}${i.university ? ' · ' + i.university : ''}`,
      fields: (i) => ({
        name: field('Team name', text(i.name, 60)),
        university: field('University / school', text(i.university, 80)),
        country: field('Country', text(i.country, 40)),
        countryCode: field('Country code (2 letters, for the flag)', text(i.countryCode, 2)),
        robot: field('Robot name', text(i.robot, 50)),
        status: field('Status', select(i.status || 'waiting', [['waiting', 'Up next'], ['live', 'On track (live now)'], ['done', 'Finished']])),
        members: field('Members (one per line, max 6)', area((i.members || []).join('\n'), 320), true),
        blurb: field('Short blurb', text(i.blurb, 180), true),
        photo: imageField('Team photo', i.photo),
        active: { el: check('Show on screen', i.active !== false), plain: true }
      })
    },
    org: {
      title: 'Organisation, courses & news', lead: 'Bottom-right slideshow: campus information, courses on offer, breaking news and photos.',
      noun: 'slide', label: (i) => i.title,
      fields: (i) => ({
        kind: field('Type', select(i.kind || 'campus', [['campus', 'Campus'], ['course', 'Course'], ['news', 'Breaking news'], ['photo', 'Gallery']])),
        title: field('Title', text(i.title, 90)),
        body: field('Text', area(i.body, 320), true),
        image: imageField('Background image (optional)', i.image),
        active: { el: check('Show on screen', i.active !== false), plain: true }
      })
    }
  };

  function readFields(fields) {
    const out = {};
    for (const [k, f] of Object.entries(fields)) {
      if (f.plain) out[k] = f.el.input.checked;
      else if (f.get) out[k] = f.get();
      else { const inp = f.querySelector('input,textarea,select'); out[k] = inp.value; }
    }
    return out;
  }
  function mountFields(fields, host) {
    const grid = el('div', 'grid');
    for (const f of Object.values(fields)) grid.append(f.plain ? f.el : f);
    host.append(grid);
  }

  function renderCollection(col) {
    const spec = COLS[col], list = S[col];
    const root = el('div');
    root.append(el('h2', '', spec.title), el('p', 'lead', spec.lead));

    const add = el('button', 'btn primary', `+ Add ${spec.noun}`); add.type = 'button';
    add.addEventListener('click', () => run(add, async () => {
      const seed = { text: 'New message', title: `New ${spec.noun}`, name: 'New team', active: false, members: [] };
      S = await api('POST', `/api/admin/${col}`, seed); draw();
    }));
    root.append(add);

    if (!list.length) root.append(el('p', 'hint', `No ${spec.noun}s yet.`));
    list.forEach((item, idx) => {
      const p = el('section', 'panel item');
      const head = el('header'); const t = el('strong', '', spec.label(item) || '(untitled)');
      const right = el('div', 'row'); right.append(el('span', 'pill' + (item.active ? ' on' : ''), item.active ? 'on screen' : 'hidden'));
      head.append(t, right); p.append(head);

      const fields = spec.fields(item); mountFields(fields, p);
      const bar = el('div', 'row');
      const save = el('button', 'btn primary', 'Save'); save.type = 'button';
      save.addEventListener('click', () => run(save, async () => { S = await api('PUT', `/api/admin/${col}/${item.id}`, readFields(fields)); draw(); }, 'Saved — screens updated'));
      const up = el('button', 'btn sm', '↑'); const down = el('button', 'btn sm', '↓');
      up.type = down.type = 'button'; up.disabled = idx === 0; down.disabled = idx === list.length - 1;
      const move = (d) => run(null, async () => {
        const ids = list.map((x) => x.id); [ids[idx], ids[idx + d]] = [ids[idx + d], ids[idx]];
        S = await api('PUT', `/api/admin/${col}/order`, { ids }); draw();
      });
      up.addEventListener('click', () => move(-1)); down.addEventListener('click', () => move(1));
      const del = el('button', 'btn sm danger', 'Delete'); del.type = 'button';
      del.addEventListener('click', () => { if (confirm(`Delete this ${spec.noun}?`)) run(del, async () => { S = await api('DELETE', `/api/admin/${col}/${item.id}`); draw(); }, 'Deleted'); });
      bar.append(save, up, down, del); p.append(bar);
      root.append(p);
    });
    return root;
  }

  /* ---------- stream ---------- */
  function renderStream() {
    const st = S.stream, root = el('div');
    root.append(el('h2', '', 'Live stream'),
      el('p', 'lead', 'Paste the public link of your live stream. You can change it any time — screens switch within a second. The link is checked on the server and only YouTube, Facebook, Instagram (posts/reels), Twitch and Vimeo are accepted.'));

    const p = el('section', 'panel item'); const g = el('div', 'grid');
    const url = text(st.url, 400, 'url'); url.placeholder = 'https://www.youtube.com/watch?v=…   or   https://www.youtube.com/live/…';
    const title = text(st.title, 80);
    const standby = text(st.standbyMessage, 100);
    g.append(field('Stream link', url, true), field('Internal name (not shown)', title), field('Message while off air', standby));
    p.append(g);

    const toggle = el('div', 'big-toggle'); const sw = check('Stream is ON', st.enabled); const stateTxt = el('span', 'state ' + (st.enabled ? 'live' : 'off'), st.enabled ? '● LIVE ON SCREENS' : 'OFF AIR — standby screen showing');
    const mute = check('Start muted (recommended for the browser; untick for a kiosk screen — see README)', st.muted !== false);
    toggle.append(sw, stateTxt); p.append(toggle, mute);

    const bar = el('div', 'row');
    const save = el('button', 'btn go', 'Save & apply'); save.type = 'button';
    save.addEventListener('click', () => run(save, async () => {
      S = await api('PUT', '/api/admin/stream', { url: url.value, title: title.value, standbyMessage: standby.value, enabled: sw.input.checked, muted: mute.input.checked }); draw();
    }, 'Stream updated'));
    const off = el('button', 'btn danger', 'Emergency: go off air'); off.type = 'button';
    off.addEventListener('click', () => run(off, async () => {
      S = await api('PUT', '/api/admin/stream', { url: S.stream.url, title: S.stream.title, standbyMessage: S.stream.standbyMessage, enabled: false, muted: S.stream.muted }); draw();
    }, 'Stream is off air'));
    bar.append(save, off); p.append(bar);

    const prev = el('div', 'preview');
    if (st.embedUrl) {
      const f = el('iframe'); f.src = st.embedUrl; f.title = 'Preview';
      f.setAttribute('allow', 'autoplay; encrypted-media; picture-in-picture; fullscreen'); f.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
      f.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-presentation'); prev.append(f);
    } else prev.append(el('span', '', 'Preview appears after you save a link'));
    p.append(el('div', 'hint', st.ref ? `Detected platform: ${st.ref.provider}` : 'No link saved yet.'), prev);

    p.append(el('p', 'hint', 'Tip — Instagram Live cannot be embedded on other websites. To show an Instagram session here, stream through OBS (or Restream) to YouTube Live and paste the YouTube link; you can send the same feed to Instagram at the same time.'));
    root.append(p);
    return root;
  }

  /* ---------- event & timing ---------- */
  const toLocalInput = (iso) => { const d = new Date(iso); if (Number.isNaN(d.getTime())) return ''; const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };

  function renderEventPanel() {
    const ev = S.event, se = S.settings, root = el('div');
    root.append(el('h2', '', 'Event & timing'), el('p', 'lead', 'The title, start time (drives the countdown on the standby screen), logo and how fast slideshows rotate.'));

    const p = el('section', 'panel item'); const g = el('div', 'grid');
    const title = text(ev.title, 60), sub = text(ev.subtitle, 120), venue = text(ev.venue, 80);
    const when = text(toLocalInput(ev.startsAt), 0, 'datetime-local');
    const logo = imageField('Logo (shown top-left)', ev.logo);
    const tz = text(se.timezone, 60);
    const num = (v) => { const i = text(v, 2, 'number'); i.min = 3; i.max = 60; return i; };
    const ts = num(se.teamSeconds), os = num(se.orgSeconds), as = num(se.adSeconds), ks = num(se.tickerSeconds);
    g.append(field('Event title', title), field('Subtitle', sub, true), field('Venue', venue), field('Start (this computer\'s time zone)', when), logo,
      field('Clock time zone (IANA name)', tz), field('Team slide seconds', ts), field('Organisation slide seconds', os), field('Ad rotation seconds', as), field('Message rotation seconds', ks));
    p.append(g);
    const save = el('button', 'btn primary', 'Save'); save.type = 'button';
    save.addEventListener('click', () => run(save, async () => {
      await api('PUT', '/api/admin/event', { title: title.value, subtitle: sub.value, venue: venue.value, startsAt: new Date(when.value).toISOString(), logo: logo.get() });
      S = await api('PUT', '/api/admin/settings', { timezone: tz.value, teamSeconds: ts.value, orgSeconds: os.value, adSeconds: as.value, tickerSeconds: ks.value }); draw();
    }, 'Saved — screens updated'));
    p.append(save); root.append(p);
    return root;
  }

  /* ---------- account ---------- */
  function renderAccount() {
    const root = el('div'); root.append(el('h2', '', 'Account & security'), el('p', 'lead', 'Use a long, unique password (12+ characters). Every sign-in and change is recorded in the server\'s audit log.'));
    const p = el('section', 'panel item'); const g = el('div', 'grid');
    const cur = text('', 200, 'password'), nw = text('', 200, 'password'), nw2 = text('', 200, 'password');
    cur.autocomplete = 'current-password'; nw.autocomplete = nw2.autocomplete = 'new-password';
    g.append(field('Current password', cur), field('New password', nw), field('Repeat new password', nw2)); p.append(g);
    const b = el('button', 'btn primary', 'Change password'); b.type = 'button';
    b.addEventListener('click', () => run(b, async () => {
      if (nw.value !== nw2.value) throw new Error('New passwords do not match.');
      await api('POST', '/api/auth/password', { current: cur.value, next: nw.value }); cur.value = nw.value = nw2.value = '';
    }, 'Password changed'));
    p.append(b); root.append(p);
    return root;
  }

  /* ---------- shell ---------- */
  const TABS = [['stream', 'Live stream'], ['ticker', 'Messages'], ['ads', 'Ads'], ['teams', 'Teams'], ['org', 'Organisation'], ['event', 'Event & timing'], ['account', 'Account']];
  function draw() {
    const nav = $('#nav');
    nav.querySelectorAll('button.nav').forEach((b) => b.remove());
    const anchor = nav.querySelector('.spacer');
    TABS.forEach(([id, label]) => {
      const b = el('button', 'nav' + (id === tab ? ' on' : ''), label); b.type = 'button';
      b.addEventListener('click', () => { tab = id; draw(); }); nav.insertBefore(b, anchor);
    });
    const panel = $('#panel'); panel.replaceChildren(
      tab === 'stream' ? renderStream() : tab === 'event' ? renderEventPanel() : tab === 'account' ? renderAccount() : renderCollection(tab));
  }

  async function init() {
    const me = await api('GET', '/api/auth/me');
    CSRF = me.csrf; $('#who').textContent = `Signed in as ${me.username}`;
    S = await api('GET', '/api/admin/state'); draw();
    $('#logout').addEventListener('click', async () => { try { await api('POST', '/api/auth/logout'); } finally { location.href = '/login'; } });
  }
  init().catch((e) => { if (e.message !== 'Signed out') toast(e.message, true); });
})();
