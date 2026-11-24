function defaultState() {
  return {
    rev: 1,
    event: {
      title: "RoboDash",
      subtitle: "Provorant 1.0 - Inter-Faculty Line Following Robot Competition",
      venue: "SLT MNIT Auditorium",
      startsAt: "2026-12-16T09:00:00+05:30",
      logo: "",
    },
    settings: {
      timezone: "Asia/Colombo",
      teamSeconds: 9,
      orgSeconds: 10,
      adSeconds: 12,
      tickerSeconds: 8,
    },
    stream: {
      enabled: true,
      muted: true,
      url: "https://www.youtube.com/live/f17J3AXVK5w?si=t0QISw36_2RZq93C",
      ref: null,
      title: "RoboDash Live",
      standbyMessage: "Live stream starting soon",
    },
    emergencyVideo: {
      enabled: false,
      type: "youtube",
      url: "",
      videoPath: "",
    },
    ticker: [
      {
        id: "sample-ticker",
        text: "Line following robots read the track with infrared sensors and correct their steering many times every second.",
        active: true,
      },
    ],
    ads: [],
    teams: [
      {
        id: "sample-team",
        name: "Team Alpha",
        university: "Sample University",
        country: "Sri Lanka",
        countryCode: "LK",
        members: ["Member One", "Member Two", "Member Three"],
        robot: "Robot name",
        blurb: "Replace this sample team from the admin panel.",
        photo: "",
        status: "waiting",
        active: true,
      },
    ],
    org: [
      {
        id: "sample-org",
        kind: "campus",
        title: "SLT-Mobitel Nebula Institute of Technology",
        body: "The education arm of SLT-Mobitel, formerly the SLT Training Centre.",
        image: "",
        active: true,
      },
    ],
  };
}

function publicView(state) {
  const active = (items) => items.filter((item) => item.active);
  const stream = state.stream || {};
  const emergency = state.emergencyVideo || {};
  const embedUrl = youtubeEmbed(stream.url, stream.muted !== false);
  const emergencyEmbedUrl = emergency.type === "youtube" ? youtubeEmbed(emergency.url, true) : "";
  return {
    rev: state.rev,
    event: state.event,
    settings: state.settings,
    stream: {
      enabled: stream.enabled === true && !!embedUrl,
      title: stream.title,
      standbyMessage: stream.standbyMessage,
      embedUrl,
    },
    emergencyVideo: {
      enabled: emergency.enabled === true,
      type: emergency.type,
      videoPath: emergency.type === "upload" ? emergency.videoPath : "",
      embedUrl: emergencyEmbedUrl,
    },
    ticker: active(state.ticker),
    ads: active(state.ads).map((ad) => ({
      ...ad,
      videoEmbedUrl: ad.mediaType === "youtube" ? youtubeEmbed(ad.videoUrl, true) : ""
    })),
    teams: active(state.teams),
    org: active(state.org),
  };
}

function json(data, status = 200, headers = {}) {
  const responseHeaders = new Headers(headers);
  responseHeaders.set("Cache-Control", "no-store");
  return Response.json(data, { status, headers: responseHeaders });
}

function getCookie(request, name) {
  const cookie = request.headers.get("Cookie") || "";
  const match = cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : "";
}

function randomId() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function supabaseBase(env) {
  if (!env.SUPABASE_URL || !env.SUPABASE_PUBLISHABLE_KEY) throw new Error("Supabase configuration is missing.");
  return env.SUPABASE_URL.replace(/\/+$/, "");
}

async function supabaseFetch(env, path, options = {}, accessToken = "") {
  const headers = new Headers(options.headers || {});
  headers.set("apikey", env.SUPABASE_PUBLISHABLE_KEY);
  if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`);
  return fetch(`${supabaseBase(env)}${path}`, { ...options, headers });
}

async function supabaseFunctionFetch(env, functionName, accessToken, body) {
  const headers = new Headers();
  headers.set("apikey", env.SUPABASE_PUBLISHABLE_KEY);
  headers.set("Authorization", `Bearer ${accessToken}`);
  headers.set("Content-Type", "application/json");
  return fetch(`${supabaseBase(env)}/functions/v1/${functionName}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body)
  });
}

async function adminRole(env, userId, accessToken) {
  const response = await supabaseFetch(
    env,
    `/rest/v1/admin_users?user_id=eq.${encodeURIComponent(userId)}&select=role`,
    { method: "GET" },
    accessToken
  );
  if (!response.ok) throw new Error("Could not verify the administrator account.");
  const rows = await response.json();
  return rows[0] && rows[0].role || "";
}

function appendSessionCookies(headers, accessToken, refreshToken, maxAge = 3600) {
  const secure = "; HttpOnly; Secure; SameSite=Strict; Path=/";
  headers.append("Set-Cookie", `rd_access=${encodeURIComponent(accessToken)}${secure}; Max-Age=${maxAge}`);
  headers.append("Set-Cookie", `rd_refresh=${encodeURIComponent(refreshToken)}${secure}; Max-Age=2592000`);
}

function sessionJson(session, data, status = 200) {
  const headers = new Headers();
  if (session && session.refreshed) appendSessionCookies(headers, session.accessToken, session.refreshToken, session.expiresIn);
  return json(data, status, headers);
}

async function getSession(request, env) {
  let accessToken = getCookie(request, "rd_access");
  let refreshToken = getCookie(request, "rd_refresh");
  if (!accessToken) return null;

  let response = await supabaseFetch(env, "/auth/v1/user", { method: "GET" }, accessToken);
  let refreshed = false;
  let expiresIn = 3600;
  if (response.status === 401 && refreshToken) {
    response = await supabaseFetch(env, "/auth/v1/token?grant_type=refresh_token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: refreshToken })
    });
    if (!response.ok) {
      if (response.status < 500) return null;
      throw new Error("Supabase session refresh failed.");
    }
    const tokens = await response.json();
    accessToken = tokens.access_token;
    refreshToken = tokens.refresh_token;
    expiresIn = Number(tokens.expires_in) || 3600;
    response = new Response(JSON.stringify(tokens.user), { status: 200 });
    refreshed = true;
  }
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) return null;
    throw new Error("Supabase authentication validation failed.");
  }
  const user = await response.json();
  const role = await adminRole(env, user.id, accessToken);
  if (!role) return null;
  return {
    id: user.id,
    email: user.email,
    username: user.email,
    name: user.user_metadata && user.user_metadata.name || user.email,
    role,
    accessToken,
    refreshToken,
    expiresIn,
    refreshed
  };
}

function noStoreAsset(request, env, path) {
  return env.ASSETS.fetch(new Request(new URL(path, request.url), request));
}

function originAllowed(request) {
  const origin = request.headers.get("Origin");
  return !origin || origin === new URL(request.url).origin;
}

async function readState(env, accessToken = "") {
  const response = await supabaseFetch(
    env,
    "/rest/v1/dashboard_state?id=eq.1&select=value,revision",
    { method: "GET" },
    accessToken
  );
  if (!response.ok) throw new Error("Could not read dashboard data from Supabase.");
  const rows = await response.json();
  if (!rows.length) return defaultState();
  return { ...rows[0].value, rev: rows[0].revision || rows[0].value.rev || 1 };
}

async function saveState(env, accessToken, state) {
  state.rev = (Number(state.rev) || 1) + 1;
  const response = await supabaseFetch(
    env,
    "/rest/v1/dashboard_state?on_conflict=id",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=minimal"
      },
      body: JSON.stringify({ id: 1, value: state, revision: state.rev, updated_at: new Date().toISOString() })
    },
    accessToken
  );
  if (!response.ok) throw new Error("Could not save dashboard data in Supabase.");
  return state;
}

function adminState(state, hostname) {
  const emergency = state.emergencyVideo || {};
  return {
    ...state,
    stream: { ...state.stream, embedUrl: youtubeEmbed(state.stream.url, true) },
    ads: (state.ads || []).map((ad) => ({
      ...ad,
      videoEmbedUrl: ad.mediaType === "youtube" ? youtubeEmbed(ad.videoUrl, true) : ""
    })),
    emergencyVideo: {
      ...emergency,
      embedUrl: emergency.type === "youtube" ? youtubeEmbed(emergency.url, true) : ""
    }
  };
}

function youtubeEmbed(raw, muted) {
  if (!raw) return "";
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:") return "";
    const host = url.hostname.toLowerCase().replace(/^(www|m)\./, "");
    const segments = url.pathname.split("/").filter(Boolean);
    const id = host === "youtu.be" ? segments[0] : url.searchParams.get("v") || segments[1];
    if (!["youtube.com", "youtube-nocookie.com", "youtu.be"].includes(host) || !/^[A-Za-z0-9_-]{11}$/.test(id || "")) return "";
    return `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&mute=${muted ? 1 : 0}&rel=0&modestbranding=1&playsinline=1`;
  } catch {
    return "";
  }
}

function cleanText(value, max) {
  return String(value || "").replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, max);
}

function mediaPath(value, env, kind) {
  if (!value) return "";
  const path = String(value);
  const base = supabaseBase(env);
  const prefix = `${base}/storage/v1/object/public/dashboard-media/`;
  const extension = kind === "video" ? "mp4" : "png|jpe?g|webp|gif";
  if (path.startsWith(prefix) && new RegExp(`^[a-f0-9]{64}\\.${extension}$`, "i").test(path.slice(prefix.length))) return path;
  throw new Error("Invalid media reference.");
}

function makeCollectionItem(key, body, env) {
  if (key === "ticker") {
    const text = cleanText(body.text, 220);
    if (!text) throw new Error("Message text is required.");
    return { text, active: body.active === true };
  }
  if (key === "ads") {
    const title = cleanText(body.title, 80);
    const image = mediaPath(body.image, env, "image");
    const mediaType = ["text", "image", "upload", "youtube"].includes(body.mediaType)
      ? body.mediaType
      : image ? "image" : "text";
    const videoPath = mediaPath(body.videoPath, env, "video");
    const videoUrl = cleanText(body.videoUrl, 400);
    if (!title && !image && !videoPath && !videoUrl) throw new Error("An ad needs a title or media.");
    if (mediaType === "image" && !image) throw new Error("Upload an image for this ad.");
    if (mediaType === "upload" && !videoPath) throw new Error("Upload an MP4 for this ad.");
    if (mediaType === "youtube" && !youtubeVideoReference(videoUrl)) throw new Error("Add a valid YouTube video link for this ad.");
    return { title, label: cleanText(body.label, 40), mediaType, image, videoPath, videoUrl, active: body.active === true };
  }
  if (key === "teams") {
    const name = cleanText(body.name, 60);
    if (!name) throw new Error("Team name is required.");
    const members = (Array.isArray(body.members) ? body.members : String(body.members || "").split("\n"))
      .map((member) => cleanText(member, 50)).filter(Boolean).slice(0, 6);
    const countryCode = cleanText(body.countryCode, 2).toUpperCase();
    return {
      name, university: cleanText(body.university, 80), country: cleanText(body.country, 40),
      countryCode: /^[A-Z]{2}$/.test(countryCode) ? countryCode : "",
      members, robot: cleanText(body.robot, 50), blurb: cleanText(body.blurb, 180),
      photo: mediaPath(body.photo, env, "image"),
      status: ["waiting", "live", "done"].includes(body.status) ? body.status : "waiting",
      active: body.active === true
    };
  }
  if (key === "org") {
    const title = cleanText(body.title, 90);
    if (!title) throw new Error("Title is required.");
    return {
      kind: ["campus", "course", "news", "photo"].includes(body.kind) ? body.kind : "campus",
      title, body: cleanText(body.body, 320), image: mediaPath(body.image, env, "image"),
      active: body.active === true
    };
  }
  throw new Error("Unknown collection.");
}

function youtubeVideoReference(raw) {
  try {
    const url = new URL(String(raw || "").trim());
    if (url.protocol !== "https:") return false;
    const host = url.hostname.toLowerCase().replace(/^(www|m)\./, "");
    const segments = url.pathname.split("/").filter(Boolean);
    const id = host === "youtu.be" ? segments[0] : url.searchParams.get("v") || segments[1];
    return ["youtube.com", "youtube-nocookie.com", "youtu.be"].includes(host) && /^[A-Za-z0-9_-]{11}$/.test(id || "");
  } catch {
    return false;
  }
}

async function uploadMedia(request, env, session, kind) {
  const form = await request.formData();
  const file = form.get("file");
  if (!file || typeof file.arrayBuffer !== "function") return json({ error: "Choose a file to upload." }, 400);
  const maxBytes = kind === "video" ? 50 * 1024 * 1024 : 4 * 1024 * 1024;
  if (!file.size || file.size > maxBytes) {
    return json({ error: kind === "video" ? "Video must be 50 MB or smaller." : "Image must be 4 MB or smaller." }, 400);
  }
  const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  let extension = "";
  let mime = "";
  if (kind === "video" && head.length >= 12 && String.fromCharCode(...head.slice(4, 8)) === "ftyp") {
    extension = "mp4"; mime = "video/mp4";
  } else if (kind === "image" && head.length >= 12 && head[0] === 0x89 && String.fromCharCode(...head.slice(1, 4)) === "PNG") {
    extension = "png"; mime = "image/png";
  } else if (kind === "image" && head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) {
    extension = "jpg"; mime = "image/jpeg";
  } else if (kind === "image" && head.length >= 12 && String.fromCharCode(...head.slice(0, 4)) === "RIFF" && String.fromCharCode(...head.slice(8, 12)) === "WEBP") {
    extension = "webp"; mime = "image/webp";
  } else if (kind === "image" && head.length >= 6 && String.fromCharCode(...head.slice(0, 4)) === "GIF8") {
    extension = "gif"; mime = "image/gif";
  } else {
    return json({ error: kind === "video" ? "Only valid MP4 videos are allowed." : "Only PNG, JPG, WEBP or GIF images are allowed." }, 400);
  }

  const name = `${randomId()}.${extension}`;
  const uploadResponse = await supabaseFetch(env, `/storage/v1/object/dashboard-media/${name}`, {
    method: "POST",
    headers: { "Content-Type": mime, "x-upsert": "false" },
    body: await file.arrayBuffer()
  }, session.accessToken);
  if (!uploadResponse.ok) return sessionJson(session, { error: "Supabase Storage could not save the upload." }, 502);
  const path = `${supabaseBase(env)}/storage/v1/object/public/dashboard-media/${name}`;
  return sessionJson(session, { path });
}

function requireWriteOrigin(request) {
  return originAllowed(request);
}

function resetCookies(headers) {
  headers.append("Set-Cookie", "rd_access=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0");
  headers.append("Set-Cookie", "rd_refresh=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0");
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const method = request.method;
    const path = url.pathname;

    if (path === "/api/auth/login" && method === "POST") {
      if (!env.SUPABASE_ADMIN_EMAIL) return json({ error: "Supabase admin email is not configured." }, 503);
      const body = await request.json();
      const submitted = String(body.username || body.email || "").trim().slice(0, 254);
      const email = submitted.includes("@")
        ? submitted.toLowerCase()
        : submitted.toLowerCase() === String(env.SUPABASE_ADMIN_USERNAME || "").toLowerCase()
          ? String(env.SUPABASE_ADMIN_EMAIL).toLowerCase()
          : "";
      const password = String(body.password || "").slice(0, 200);
      if (!email || !password) {
        return json({ error: "Invalid email or password." }, 401);
      }
      const response = await supabaseFetch(env, "/auth/v1/token?grant_type=password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password })
      });
      if (!response.ok) {
        if (response.status >= 500) throw new Error("Supabase authentication service is unavailable.");
        return json({ error: "Invalid email or password." }, 401);
      }
      const session = await response.json();
      if (String(session.user && session.user.email || "").toLowerCase() !== email) {
        return json({ error: "This account is not authorized for the control panel." }, 403);
      }
      const role = await adminRole(env, session.user.id, session.access_token);
      if (!role) return json({ error: "This account is not authorized for the control panel." }, 403);
      const headers = new Headers();
      appendSessionCookies(headers, session.access_token, session.refresh_token, Number(session.expires_in) || 3600);
      return json({ ok: true, user: { email, username: email, role } }, 200, headers);
    }

    if (path === "/api/auth/accept-invite" && method === "POST") {
      if (!originAllowed(request)) return json({ error: "Bad origin." }, 403);
      const body = await request.json();
      const accessToken = String(body.accessToken || "").slice(0, 8000);
      const refreshToken = String(body.refreshToken || "").slice(0, 8000);
      if (!accessToken || !refreshToken) return json({ error: "The invitation link is missing its sign-in tokens." }, 400);
      const response = await supabaseFetch(env, "/auth/v1/user", { method: "GET" }, accessToken);
      if (!response.ok) return json({ error: "The invitation is invalid or has expired." }, 401);
      const user = await response.json();
      const role = await adminRole(env, user.id, accessToken);
      if (!role) return json({ error: "This account does not have an active admin invitation." }, 403);
      const headers = new Headers();
      appendSessionCookies(headers, accessToken, refreshToken);
      return json({ ok: true, email: user.email }, 200, headers);
    }

    if (path === "/api/auth/password" && method === "POST") {
      if (!originAllowed(request)) return json({ error: "Bad origin." }, 403);
      const session = await getSession(request, env);
      if (!session) return json({ error: "Admin access required." }, 401);
      const body = await request.json();
      const password = String(body.next || "");
      if (password.length < 12 || password.length > 200) return sessionJson(session, { error: "Password must be 12–200 characters." }, 400);
      const response = await supabaseFetch(env, "/auth/v1/user", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password })
      }, session.accessToken);
      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        return sessionJson(session, { error: cleanText(result.msg || result.message || result.error_description, 180) || "Supabase could not update the password." }, response.status >= 500 ? 502 : 400);
      }
      return sessionJson(session, { ok: true });
    }

    if (path === "/api/auth/me" && method === "GET") {
      const session = await getSession(request, env);
      return session
        ? sessionJson(session, { email: session.email, username: session.username, name: session.name, role: session.role, provider: "supabase" })
        : json({ error: "Not signed in." }, 401);
    }

    if (path === "/api/auth/logout" && method === "POST") {
      if (!originAllowed(request)) return json({ error: "Bad origin." }, 403);
      const accessToken = getCookie(request, "rd_access");
      if (accessToken) {
        const response = await supabaseFetch(env, "/auth/v1/logout", { method: "POST" }, accessToken);
        if (!response.ok && response.status !== 401) console.error("Supabase logout failed.");
      }
      const headers = new Headers();
      resetCookies(headers);
      return json({ ok: true }, 200, headers);
    }

    if (path === "/api/public/state" && method === "GET") {
      return json(publicView(await readState(env)));
    }
    if (path === "/api/public/events" && method === "GET") {
      const body = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("retry: 3000\n: connected\n\n"));
        }
      });
      return new Response(body, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-store" } });
    }

    if (path.startsWith("/api/admin/")) {
      const session = await getSession(request, env);
      if (!session) return json({ error: "Admin access required." }, 401);
      if (method !== "GET" && !requireWriteOrigin(request)) return sessionJson(session, { error: "Bad origin." }, 403);
      if (path === "/api/admin/users" || /^\/api\/admin\/users\/[0-9a-f-]+$/i.test(path)) {
        if (session.role !== "super_admin") return sessionJson(session, { error: "Only a super administrator can manage admin accounts." }, 403);
        let body;
        if (path === "/api/admin/users" && method === "GET") body = { action: "list" };
        else if (path === "/api/admin/users" && method === "POST") {
          try { body = await request.json(); } catch { return sessionJson(session, { error: "Malformed request." }, 400); }
          body = { ...body, action: "invite", redirectTo: new URL("/login?invite=1", request.url).toString() };
        } else {
          const userId = path.match(/^\/api\/admin\/users\/([0-9a-f-]+)$/i);
          if (userId && method === "DELETE") body = { action: "revoke", userId: userId[1] };
        }
        if (body) {
          const result = await supabaseFunctionFetch(env, "admin-users", session.accessToken, body);
          const data = await result.json().catch(() => ({ error: "Supabase admin service returned an invalid response." }));
          return sessionJson(session, data, result.status);
        }
        return sessionJson(session, { error: "Method not allowed." }, 405);
      }
      const state = await readState(env, session.accessToken);

      if (path === "/api/admin/state" && method === "GET") {
        return sessionJson(session, adminState(state, url.hostname));
      }
      if (path === "/api/admin/state" && method === "PUT") {
        const body = await request.json();
        return sessionJson(session, adminState(await saveState(env, session.accessToken, body), url.hostname));
      }
      if (path === "/api/admin/event" && method === "PUT") {
        const body = await request.json();
        const startsAt = new Date(body.startsAt);
        if (Number.isNaN(startsAt.getTime())) return sessionJson(session, { error: "Start date/time is invalid." }, 400);
        let logo;
        try { logo = mediaPath(body.logo, env, "image"); }
        catch (error) { return sessionJson(session, { error: error.message }, 400); }
        state.event = {
          ...state.event,
          title: cleanText(body.title, 60) || "RoboDash",
          subtitle: cleanText(body.subtitle, 120),
          venue: cleanText(body.venue, 80),
          startsAt: startsAt.toISOString(),
          logo
        };
        return sessionJson(session, adminState(await saveState(env, session.accessToken, state), url.hostname));
      }
      if (path === "/api/admin/settings" && method === "PUT") {
        const body = await request.json();
        const timezone = String(body.timezone || "");
        try { new Intl.DateTimeFormat("en", { timeZone: timezone }); } catch { return sessionJson(session, { error: "Unknown time zone." }, 400); }
        const seconds = (value, fallback) => {
          const number = Math.round(Number(value));
          return Number.isFinite(number) ? Math.min(60, Math.max(3, number)) : fallback;
        };
        state.settings = {
          timezone,
          teamSeconds: seconds(body.teamSeconds, state.settings.teamSeconds),
          orgSeconds: seconds(body.orgSeconds, state.settings.orgSeconds),
          adSeconds: seconds(body.adSeconds, state.settings.adSeconds),
          tickerSeconds: seconds(body.tickerSeconds, state.settings.tickerSeconds)
        };
        return sessionJson(session, adminState(await saveState(env, session.accessToken, state), url.hostname));
      }
      if (path === "/api/admin/stream" && method === "PUT") {
        const body = await request.json();
        const source = String(body.url || "").trim().slice(0, 400);
        if (body.enabled && !youtubeVideoReference(source)) return sessionJson(session, { error: "Add a supported YouTube video link before enabling the stream." }, 400);
        state.stream = {
          ...state.stream,
          enabled: body.enabled === true,
          url: source,
          title: cleanText(body.title, 80),
          standbyMessage: cleanText(body.standbyMessage, 100) || "Live stream starting soon",
          muted: body.muted !== false
        };
        return sessionJson(session, adminState(await saveState(env, session.accessToken, state), url.hostname));
      }
      if (path === "/api/admin/emergency-video" && method === "PUT") {
        const body = await request.json();
        const type = body.type === "upload" ? "upload" : "youtube";
        const videoUrl = String(body.url || "").trim().slice(0, 400);
        let videoPath = "";
        if (type === "youtube" && body.enabled && !youtubeVideoReference(videoUrl)) {
          return sessionJson(session, { error: "Add a YouTube video link before enabling the emergency override." }, 400);
        }
        if (type === "upload") {
          try { videoPath = mediaPath(body.videoPath, env, "video"); }
          catch (error) { return sessionJson(session, { error: error.message }, 400); }
          if (body.enabled && !videoPath) return sessionJson(session, { error: "Upload an MP4 before enabling the emergency override." }, 400);
        }
        state.emergencyVideo = { enabled: body.enabled === true, type, url: type === "youtube" ? videoUrl : "", videoPath };
        return sessionJson(session, adminState(await saveState(env, session.accessToken, state), url.hostname));
      }
      if (path === "/api/admin/upload/image" && method === "POST") return uploadMedia(request, env, session, "image");
      if (path === "/api/admin/upload/video" && method === "POST") return uploadMedia(request, env, session, "video");
      if (path === "/api/admin/upload/emergency-video" && method === "POST") return uploadMedia(request, env, session, "video");

      const orderMatch = path.match(/^\/api\/admin\/(ticker|ads|teams|org)\/order$/);
      if (orderMatch && method === "PUT") {
        const body = await request.json();
        const key = orderMatch[1];
        const current = state[key] || [];
        const byId = new Map(current.map((item) => [item.id, item]));
        const ordered = (Array.isArray(body.ids) ? body.ids : []).map((id) => byId.get(String(id))).filter(Boolean);
        for (const item of current) if (!ordered.includes(item)) ordered.push(item);
        state[key] = ordered;
        return sessionJson(session, adminState(await saveState(env, session.accessToken, state), url.hostname));
      }
      const collectionMatch = path.match(/^\/api\/admin\/(ticker|ads|teams|org)(?:\/([^/]+))?$/);
      if (collectionMatch) {
        const key = collectionMatch[1];
        const id = collectionMatch[2] ? decodeURIComponent(collectionMatch[2]) : "";
        const list = state[key] || [];
        if (method === "POST" && !id) {
          const limits = { ticker: 60, org: 40 };
          if (limits[key] && list.length >= limits[key]) return sessionJson(session, { error: `Limit of ${limits[key]} items reached.` }, 400);
          let item;
          try { item = makeCollectionItem(key, await request.json(), env); }
          catch (error) { return sessionJson(session, { error: error.message }, 400); }
          item.id = crypto.randomUUID();
          state[key] = [...list, item];
          return sessionJson(session, adminState(await saveState(env, session.accessToken, state), url.hostname));
        }
        const index = list.findIndex((item) => item.id === id);
        if (method === "PUT" && id) {
          if (index < 0) return sessionJson(session, { error: "Not found." }, 404);
          let item;
          try { item = makeCollectionItem(key, await request.json(), env); }
          catch (error) { return sessionJson(session, { error: error.message }, 400); }
          item.id = id;
          state[key] = [...list.slice(0, index), item, ...list.slice(index + 1)];
          return sessionJson(session, adminState(await saveState(env, session.accessToken, state), url.hostname));
        }
        if (method === "DELETE" && id) {
          if (index < 0) return sessionJson(session, { error: "Not found." }, 404);
          state[key] = list.filter((item) => item.id !== id);
          return sessionJson(session, adminState(await saveState(env, session.accessToken, state), url.hostname));
        }
      }
      return sessionJson(session, { error: "Not found." }, 404);
    }

    if (path === "/") return env.ASSETS.fetch(request);
    if (path === "/login") {
      const session = await getSession(request, env);
      if (session && !url.searchParams.has("invite")) return Response.redirect(new URL("/admin", request.url).toString(), 302);
      return noStoreAsset(request, env, "/admin/login.html");
    }
    if (path === "/admin") {
      const session = await getSession(request, env);
      if (!session) return Response.redirect(new URL("/login", request.url).toString(), 302);
      return noStoreAsset(request, env, "/admin/admin.html");
    }
    if (path === "/admin/admin.html") {
      if (!await getSession(request, env)) return Response.redirect(new URL("/login", request.url).toString(), 302);
      return noStoreAsset(request, env, path);
    }
    if (path === "/admin/admin.js") {
      if (!await getSession(request, env)) return Response.redirect(new URL("/login", request.url).toString(), 302);
      return noStoreAsset(request, env, path);
    }
    if (path === "/admin/login.js") return noStoreAsset(request, env, path);
    if (path === "/favicon.svg") return noStoreAsset(request, env, "/favicon.svg");
    if (path === "/health") return json({ ok: true, service: "RoboDash" });

    for (const prefix of ["/css/", "/js/", "/fonts/"]) {
      if (path.startsWith(prefix)) return env.ASSETS.fetch(request);
    }
    return env.ASSETS.fetch(request);
  }
};
