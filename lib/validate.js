'use strict';
// Server-side validation. The admin UI also limits lengths, but the server never trusts it.

// Strip control characters, trim, hard-cap length.
const clean = (v, max) =>
  String(v ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, max);

const bool = (v) => v === true || v === 'true';
const oneOf = (v, list, fallback) => (list.includes(v) ? v : fallback);

// Images may only point at files this server itself created in /uploads.
function image(v) {
  const s = String(v || '');
  if (!s) return '';
  if (/^\/uploads\/[a-f0-9]{32}\.(png|jpg|webp|gif)$/.test(s)) return s;
  throw new Error('Invalid image reference.');
}

function video(v) {
  const s = String(v || '');
  if (!s) return '';
  if (/^\/uploads\/[a-f0-9]{32}\.mp4$/.test(s)) return s;
  throw new Error('Invalid video reference.');
}

const COLLECTIONS = {
  ticker: {
    max: 60,
    make: (b) => {
      const text = clean(b.text, 220);
      if (!text) throw new Error('Message text is required.');
      return { text, active: bool(b.active) };
    }
  },
  ads: {
    make: (b) => {
      const title = clean(b.title, 80);
      const image_ = image(b.image);
      const mediaType = oneOf(b.mediaType, ['text', 'image', 'upload', 'youtube'], image_ ? 'image' : 'text');
      const videoPath = video(b.videoPath);
      const videoUrl = clean(b.videoUrl, 400);
      if (!title && !image_ && !videoPath && !videoUrl) throw new Error('An ad needs a title or media.');
      if (mediaType === 'image' && !image_) throw new Error('Upload an image for this ad.');
      if (mediaType === 'upload' && !videoPath) throw new Error('Upload an MP4 for this ad.');
      if (mediaType === 'youtube' && !videoUrl) throw new Error('Add a YouTube video link for this ad.');
      return { title, label: clean(b.label, 40), mediaType, image: image_, videoPath, videoUrl, active: bool(b.active) };
    }
  },
  teams: {
    make: (b) => {
      const name = clean(b.name, 60);
      if (!name) throw new Error('Team name is required.');
      const members = (Array.isArray(b.members) ? b.members : String(b.members || '').split('\n'))
        .map((m) => clean(m, 50)).filter(Boolean).slice(0, 6);
      const cc = clean(b.countryCode, 2).toUpperCase();
      return {
        name,
        university: clean(b.university, 80),
        country: clean(b.country, 40),
        countryCode: /^[A-Z]{2}$/.test(cc) ? cc : '',
        members,
        robot: clean(b.robot, 50),
        blurb: clean(b.blurb, 180),
        photo: image(b.photo),
        status: oneOf(b.status, ['waiting', 'live', 'done'], 'waiting'),
        active: bool(b.active)
      };
    }
  },
  org: {
    max: 40,
    make: (b) => {
      const title = clean(b.title, 90);
      if (!title) throw new Error('Title is required.');
      return {
        kind: oneOf(b.kind, ['campus', 'course', 'news', 'photo'], 'campus'),
        title,
        body: clean(b.body, 320),
        image: image(b.image),
        active: bool(b.active)
      };
    }
  }
};

function validTimezone(tz) {
  try { new Intl.DateTimeFormat('en', { timeZone: tz }); return true; } catch { return false; }
}

function secs(v, fallback) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(60, Math.max(3, n)) : fallback;
}

module.exports = { clean, bool, image, video, oneOf, COLLECTIONS, validTimezone, secs };
