(() => {
  'use strict';
  // Everything from the server is rendered with textContent / property assignment, never innerHTML,
  // so content typed into the admin panel can never inject script into the public screen.

  const $ = (s, r = document) => r.querySelector(s);
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const pad = (n) => String(n).padStart(2, '0');
  const CACHE_KEY = 'robodash.state.v1';
  // Start the fade-in: force a reflow so the browser registers the "enter" style first.
  // (requestAnimationFrame is paused in background tabs and some kiosk setups, so it is not used.)
  const reveal = (node) => { void node.offsetWidth; node.classList.remove('enter'); };

  let state = null;

  /* ---------------- reusable slideshow ---------------- */
  function Slideshow(stage, bar, counter, build, emptyText) {
    let items = [], idx = 0, timer = 0, sig = '', secs = 10;
    function show() {
      clearTimeout(timer);
      if (!items.length) {
        stage.replaceChildren(el('div', 'empty', emptyText));
        counter.textContent = ''; bar.style.animation = 'none';
        return;
      }
      stage.querySelectorAll('.empty').forEach((n) => n.remove());
      const old = stage.querySelector('.slide:not(.leave)');
      const slide = build(items[idx]);
      slide.classList.add('slide', 'enter');
      stage.append(slide);
      reveal(slide);
      if (old) { old.classList.add('leave'); setTimeout(() => old.remove(), 1200); }
      counter.textContent = `${pad(idx + 1)} / ${pad(items.length)}`;
      bar.style.animation = 'none'; void bar.offsetWidth;
      if (items.length > 1) {
        bar.style.animation = `fill ${secs}s linear forwards`;
        timer = setTimeout(() => { idx = (idx + 1) % items.length; show(); }, secs * 1000);
      } else { bar.style.animation = 'none'; }
    }
    return {
      set(list, seconds) {
        const next = JSON.stringify(list) + '|' + seconds;
        if (next === sig) return;       // nothing changed: don't restart the slideshow
        sig = next; items = list; secs = seconds;
        if (idx >= items.length) idx = 0;
        show();
      }
    };
  }

  /* ---------------- builders ---------------- */
  const flag = (cc) => /^[A-Z]{2}$/.test(cc || '') ? String.fromCodePoint(...[...cc].map((c) => 127397 + c.charCodeAt(0))) : '';
  const initials = (n) => n.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  const STATUS = { live: 'On track', waiting: 'Up next', done: 'Finished' };

  function img(src) { const i = new Image(); i.alt = ''; i.decoding = 'async'; i.src = src; return i; }

  function buildTeam(t) {
    const s = el('article');
    const photo = el('div', 'team-photo');
    if (t.photo) photo.append(img(t.photo)); else { photo.classList.add('noimg'); photo.append(el('span', 'initials', initials(t.name))); }
    s.append(photo, el('span', `status ${t.status}`, STATUS[t.status] || ''));
    const body = el('div', 'team-body');
    body.append(el('h3', 'team-name', t.name));
    const meta = el('p', 'team-meta');
    const f = flag(t.countryCode); if (f) meta.append(el('span', 'flag', f));
    if (t.country) meta.append(el('span', '', t.country));
    if (t.university) meta.append(el('span', 'uni', t.university));
    body.append(meta);
    if (t.robot) body.append(el('div', 'team-robot', `🤖 ${t.robot}`));
    if (t.members && t.members.length) { const m = el('div', 'members'); t.members.forEach((n) => m.append(el('span', '', n))); body.append(m); }
    if (t.blurb) body.append(el('p', 'blurb', t.blurb));
    s.append(body);
    return s;
  }

  const KIND = { campus: 'Campus', course: 'Courses', news: 'Breaking news', photo: 'Gallery' };
  function buildOrg(o) {
    const s = el('article', 'org-slide' + (o.image ? '' : ' plain'));
    if (o.image) { const b = el('div', 'bgimg'); b.append(img(o.image)); s.append(b); }
    s.append(el('span', `kind ${o.kind}`, KIND[o.kind] || 'Info'), el('h3', '', o.title));
    if (o.body) s.append(el('p', '', o.body));
    return s;
  }

  const teams = Slideshow($('#teamStage'), $('#teamBar'), $('#teamCount'), buildTeam, 'Teams will appear here');
  const org = Slideshow($('#orgStage'), $('#orgBar'), $('#orgCount'), buildOrg, 'Organisation updates will appear here');

  /* ---------------- stream ---------------- */
  function renderStream(st) {
    const frame = $('#streamFrame');
    const want = st.stream.enabled && st.stream.embedUrl ? st.stream.embedUrl : '';
    if (want) {
      if (frame.dataset.src !== want) { frame.src = want; frame.dataset.src = want; } // only reload when the link changes
      frame.hidden = false; $('#standby').hidden = true;
    } else {
      if (frame.dataset.src) { frame.removeAttribute('src'); delete frame.dataset.src; }
      frame.hidden = true; $('#standby').hidden = false;
    }
    $('#liveBadge').hidden = !want;
    $('#standbyTitle').textContent = st.event.title || 'RoboDash';
    $('#standbyMsg').textContent = st.stream.standbyMessage || 'Live stream starting soon';
  }

  /* ---------------- header / event ---------------- */
  function renderEvent(st) {
    document.title = `${st.event.title || 'RoboDash'} Live`;
    $('#title').textContent = st.event.title || 'RoboDash';
    $('#subtitle').textContent = st.event.subtitle || '';
    const venue = $('#venueChip');
    venue.textContent = st.event.venue ? `📍 ${st.event.venue}` : ''; venue.hidden = !st.event.venue;
    const mark = $('#mark');
    const existing = mark.querySelector('img');
    if (st.event.logo) {
      if (!existing || existing.getAttribute('src') !== st.event.logo) { mark.replaceChildren(img(st.event.logo)); }
    } else if (existing) { location.reload(); }
  }

  /* ---------------- ticker strip ---------------- */
  let tickTimer = 0, tickIdx = 0, tickSig = '';
  function renderTicker(st) {
    const live = st.teams.filter((t) => t.status === 'live');
    const tag = $('#tickTag');
    if (live.length) {
      tag.classList.remove('idle');
      $('#tickTagText').textContent = 'On track: ' + live.map((t) => t.name).join(' · ');
    } else { tag.classList.add('idle'); $('#tickTagText').textContent = 'Did you know'; }

    const msgs = st.ticker.map((m) => m.text);
    const sig = JSON.stringify(msgs) + st.settings.tickerSeconds;
    if (sig === tickSig) return;
    tickSig = sig; clearInterval(tickTimer); tickIdx = 0;
    const box = $('#tickMsg');
    const put = () => {
      if (!msgs.length) { box.replaceChildren(); return; }
      const old = box.querySelector('span:not(.leave)');
      const s = el('span', 'enter', msgs[tickIdx % msgs.length]);
      box.append(s);
      reveal(s);
      if (old) { old.classList.add('leave'); setTimeout(() => old.remove(), 900); }
      tickIdx++;
    };
    put();
    if (msgs.length > 1) tickTimer = setInterval(put, st.settings.tickerSeconds * 1000);
  }

  /* ---------------- ads (3 slots, rotating pages) ---------------- */
  let adTimer = 0, adPage = 0, adSig = '';
  function setAd(slot, ad) {
    const s = el('div', 'ad-slide enter');
    if (!ad) {
      s.classList.add('house');
      const b = el('b', '', $('#title').textContent); s.append(b, document.createTextNode('Live robotics competition'));
    } else if (ad.image) {
      s.append(img(ad.image));
      if (ad.title || ad.label) { const c = el('div', 'cap'); if (ad.label) c.append(el('small', '', ad.label)); c.append(document.createTextNode(ad.title || '')); s.append(c); }
    } else {
      s.classList.add('text');
      const w = el('div'); if (ad.label) w.append(el('small', '', ad.label)); w.append(document.createTextNode(ad.title)); s.append(w);
    }
    const old = slot.querySelector('.ad-slide');
    slot.append(s);
    reveal(s);
    if (old) { old.classList.add('leave'); setTimeout(() => old.remove(), 1100); }
  }
  function showAdPage(ads) {
    const slots = [...document.querySelectorAll('#ads .ad')];
    slots.forEach((slot, i) => setTimeout(() => setAd(slot, ads.length ? (ads.length <= 3 ? ads[i] : ads[(adPage * 3 + i) % ads.length]) : null), i * 250));
  }
  function renderAds(st) {
    const sig = JSON.stringify(st.ads) + st.settings.adSeconds;
    if (sig === adSig) return;
    adSig = sig; clearInterval(adTimer); adPage = 0;
    showAdPage(st.ads);
    if (st.ads.length > 3) {
      const pages = Math.ceil(st.ads.length / 3);
      adTimer = setInterval(() => { adPage = (adPage + 1) % pages; showAdPage(st.ads); }, st.settings.adSeconds * 1000);
    }
  }

  /* ---------------- clock + countdown ---------------- */
  let fmtTime, fmtDate, fmtTz = '';
  function ensureFormatters(tz) {
    if (tz === fmtTz && fmtTime) return;
    try {
      fmtTime = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
      fmtDate = new Intl.DateTimeFormat('en-GB', { timeZone: tz, weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });
    } catch { fmtTime = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }); fmtDate = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' }); }
    fmtTz = tz;
  }
  function tick() {
    const now = new Date();
    ensureFormatters(state ? state.settings.timezone : 'Asia/Colombo');
    const [hm, ss] = [fmtTime.format(now).slice(0, 5), fmtTime.format(now).slice(6)];
    $('#clkT').textContent = hm; $('#clkS').textContent = ss; $('#clkD').textContent = fmtDate.format(now);
    if (!state) return;
    const diff = new Date(state.event.startsAt).getTime() - now.getTime();
    const chip = $('#countdownChip'), count = $('#standbyCount');
    if (diff > 0) {
      const d = Math.floor(diff / 864e5), h = Math.floor(diff % 864e5 / 36e5), m = Math.floor(diff % 36e5 / 6e4), s = Math.floor(diff % 6e4 / 1e3);
      $('#countdown').textContent = d > 0 ? `${d}d ${pad(h)}h ${pad(m)}m` : `${pad(h)}:${pad(m)}:${pad(s)}`;
      chip.hidden = false; count.hidden = false;
      $('#cd-d').textContent = d; $('#cd-h').textContent = pad(h); $('#cd-m').textContent = pad(m); $('#cd-s').textContent = pad(s);
    } else { chip.hidden = true; count.hidden = true; }
  }
  setInterval(tick, 1000); tick();

  /* ---------------- data loading ---------------- */
  const fullscreenBtn = $('#fullscreenBtn');
  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen();
    } catch (error) {
      setConn(false);
    }
  }
  function updateFullscreenButton() {
    const active = !!document.fullscreenElement;
    fullscreenBtn.title = active ? 'Exit fullscreen' : 'Enter fullscreen';
    fullscreenBtn.setAttribute('aria-label', fullscreenBtn.title);
  }
  fullscreenBtn.addEventListener('click', toggleFullscreen);
  document.addEventListener('fullscreenchange', updateFullscreenButton);
  document.addEventListener('keydown', (event) => {
    if (event.key.toLowerCase() === 'f' && !event.ctrlKey && !event.metaKey && !event.altKey) toggleFullscreen();
  });
  updateFullscreenButton();

  function apply(st) {
    state = st;
    renderEvent(st); renderStream(st);
    teams.set(st.teams, st.settings.teamSeconds);
    org.set(st.org, st.settings.orgSeconds);
    renderTicker(st); renderAds(st); tick();
  }
  function setConn(ok) {
    $('#conn').classList.toggle('off', !ok);
    $('#connText').textContent = ok ? 'LIVE DATA' : 'RECONNECTING';
  }
  let lastRev = -1, loading = false;
  async function load() {
    if (loading) return; loading = true;
    try {
      const r = await fetch('/api/public/state', { cache: 'no-store' });
      if (!r.ok) throw new Error(r.status);
      const st = await r.json();
      setConn(true);
      if (st.rev !== lastRev) { lastRev = st.rev; apply(st); try { localStorage.setItem(CACHE_KEY, JSON.stringify(st)); } catch { /* storage may be blocked */ } }
    } catch { setConn(false); }
    finally { loading = false; }
  }

  // Show the last known content instantly (and keep working if the network drops).
  try { const c = localStorage.getItem(CACHE_KEY); if (c) apply(JSON.parse(c)); } catch { /* ignore */ }

  load();
  setInterval(load, 60_000); // safety net in case the push connection is blocked
  if ('EventSource' in window) {
    const es = new EventSource('/api/public/events');
    es.addEventListener('update', load);
    es.onopen = () => setConn(true);
    es.onerror = () => setConn(false); // the browser reconnects automatically
  }
})();
