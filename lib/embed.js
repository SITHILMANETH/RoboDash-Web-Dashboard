'use strict';
// Turns an admin-pasted link into a *reference* we trust, and later into an embed URL.
// Only allowlisted hosts are accepted, so an admin account (or a stolen session) can never
// make the public dashboard load an arbitrary site inside the stream frame.

const YT_ID = /^[A-Za-z0-9_-]{11}$/;
const YT_CHANNEL = /^UC[A-Za-z0-9_-]{22}$/;

function parseStreamUrl(raw) {
  let u;
  try { u = new URL(String(raw).trim()); } catch { throw new Error('That is not a valid link.'); }
  if (u.protocol !== 'https:') throw new Error('Only https:// links are allowed.');
  const host = u.hostname.toLowerCase().replace(/^(www|m)\./, '');
  const seg = u.pathname.split('/').filter(Boolean);

  if (['youtube.com', 'youtube-nocookie.com', 'youtu.be'].includes(host)) {
    if (host === 'youtu.be' && YT_ID.test(seg[0] || '')) return { provider: 'youtube', kind: 'video', id: seg[0] };
    const v = u.searchParams.get('v');
    if (seg[0] === 'watch' && YT_ID.test(v || '')) return { provider: 'youtube', kind: 'video', id: v };
    if (['live', 'embed', 'shorts'].includes(seg[0]) && YT_ID.test(seg[1] || '')) return { provider: 'youtube', kind: 'video', id: seg[1] };
    if (seg[0] === 'channel' && YT_CHANNEL.test(seg[1] || '')) return { provider: 'youtube', kind: 'channel', id: seg[1] };
    throw new Error('No YouTube video ID found. Paste the watch/live link (youtube.com/watch?v=… or youtube.com/live/…) or a youtube.com/channel/UC… link. @handle links cannot be embedded.');
  }

  if (host === 'facebook.com' || host === 'fb.watch') {
    if (u.href.length > 300) throw new Error('That Facebook link is too long.');
    return { provider: 'facebook', href: `${u.origin}${u.pathname}${u.search}` };
  }

  if (host === 'instagram.com') {
    const i = seg.findIndex((s) => ['p', 'reel', 'tv'].includes(s));
    const code = i >= 0 ? seg[i + 1] : '';
    if (/^[A-Za-z0-9_-]{5,25}$/.test(code || '')) return { provider: 'instagram', type: seg[i], code };
    throw new Error('Instagram can only embed posts and reels (instagram.com/p/… or /reel/…). Live broadcasts cannot be embedded.');
  }

  if (host === 'twitch.tv') {
    if (/^[A-Za-z0-9_]{3,25}$/.test(seg[0] || '')) return { provider: 'twitch', channel: seg[0].toLowerCase() };
    throw new Error('No Twitch channel found in that link.');
  }

  if (host === 'vimeo.com' || host === 'player.vimeo.com') {
    const id = seg.find((s) => /^\d{6,12}$/.test(s));
    if (id) return { provider: 'vimeo', id };
    throw new Error('No Vimeo video ID found in that link.');
  }

  throw new Error('Unsupported platform. Use YouTube, Facebook, Instagram (posts/reels), Twitch or Vimeo.');
}

function buildEmbed(ref, hostname, muted = true) {
  if (!ref) return '';
  const m = muted ? 1 : 0;
  switch (ref.provider) {
    case 'youtube': {
      const q = `autoplay=1&mute=${m}&rel=0&modestbranding=1&playsinline=1`;
      return ref.kind === 'channel'
        ? `https://www.youtube-nocookie.com/embed/live_stream?channel=${ref.id}&${q}`
        : `https://www.youtube-nocookie.com/embed/${ref.id}?${q}`;
    }
    case 'facebook':
      return `https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(ref.href)}&show_text=false&autoplay=true&mute=${muted}`;
    case 'instagram':
      return `https://www.instagram.com/${ref.type}/${ref.code}/embed`;
    case 'twitch':
      // Twitch requires the embedding site's hostname in "parent".
      return `https://player.twitch.tv/?channel=${ref.channel}&parent=${encodeURIComponent(hostname)}&muted=${muted}&autoplay=true`;
    case 'vimeo':
      return `https://player.vimeo.com/video/${ref.id}?autoplay=1&muted=${m}&dnt=1`;
    default:
      return '';
  }
}

module.exports = { parseStreamUrl, buildEmbed };
