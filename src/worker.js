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
      enabled: state.stream.enabled === true,
      muted: true,
      url: "",
      ref: null,
      title: "RoboDash Live",
      standbyMessage: "Live stream starting soon",
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
  let embedUrl = "";
  try {
    const streamUrl = new URL(state.stream.url || "");
    if (streamUrl.hostname.includes("youtube.com") || streamUrl.hostname.includes("youtu.be")) {
      const videoId = streamUrl.hostname.includes("youtu.be")
        ? streamUrl.pathname.slice(1)
        : streamUrl.searchParams.get("v");
      if (videoId) embedUrl = `https://www.youtube-nocookie.com/embed/${videoId}`;
    }
  } catch {}
  return {
    rev: state.rev,
    event: state.event,
    settings: state.settings,
    stream: {
      enabled: false,
      title: state.stream.title,
      standbyMessage: state.stream.standbyMessage,
      embedUrl,
    },
    ticker: active(state.ticker),
    ads: active(state.ads),
    teams: active(state.teams),
    org: active(state.org),
  };
}

function json(data, status = 200, headers = {}) {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store", ...headers } });
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

async function getSession(request, env) {
  const id = getCookie(request, "rd_session");
  if (!id) return null;
  const session = await env.robodash_db
    .prepare("SELECT s.user_id, s.expires_at, u.email, u.name, u.avatar, u.role FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.id=?")
    .bind(id)
    .first();
  if (!session || new Date(session.expires_at).getTime() <= Date.now()) return null;
  return session;
}

async function verifyGoogleCredential(credential, env) {
  const response = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`);
  if (!response.ok) throw new Error("Google could not verify this sign-in.");
  const payload = await response.json();
  if (payload.aud !== env.GOOGLE_CLIENT_ID) throw new Error("This sign-in was issued for a different application.");
  if (!["accounts.google.com", "https://accounts.google.com"].includes(payload.iss)) throw new Error("Invalid Google sign-in issuer.");
  if (payload.email_verified !== "true" && payload.email_verified !== true) throw new Error("Your Google email is not verified.");
  if (!payload.exp || Number(payload.exp) * 1000 <= Date.now()) throw new Error("Your Google sign-in has expired.");
  if (!payload.sub || !payload.email) throw new Error("Google did not return the required account details.");
  return payload;
}

function noStoreAsset(request, env, path) {
  return env.ASSETS.fetch(new Request(new URL(path, request.url), request));
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const method = request.method;

    if (url.pathname === "/api/auth/google" && method === "POST") {
      try {
        const body = await request.json();
        const payload = await verifyGoogleCredential(String(body.credential || ""), env);
        const email = payload.email.toLowerCase();
        let user = await env.robodash_db.prepare("SELECT * FROM users WHERE google_subject=? OR email=?").bind(payload.sub, email).first();
        if (!user) {
          const id = crypto.randomUUID();
          await env.robodash_db.prepare(
            "INSERT INTO users (id,google_subject,email,name,avatar,role,approved_at,approved_by,created_at) VALUES (?,?,?,?,?,?,?,?,?)"
          ).bind(
            id, payload.sub, email, String(payload.name || email).slice(0, 100),
            String(payload.picture || "").slice(0, 500),
            email === env.SUPER_ADMIN_EMAIL.toLowerCase() ? "super_admin" : "pending",
            email === env.SUPER_ADMIN_EMAIL.toLowerCase() ? new Date().toISOString() : "",
            email === env.SUPER_ADMIN_EMAIL.toLowerCase() ? email : "",
            new Date().toISOString()
          ).run();
          user = await env.robodash_db.prepare("SELECT * FROM users WHERE id=?").bind(id).first();
        }
        if (user.role === "pending") return json({ error: "Your account is waiting for super-admin approval.", pending: true }, 403);

        const sessionId = randomId();
        const expiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString();
        await env.robodash_db.prepare(
          "INSERT INTO sessions (id,user_id,expires_at,created_at) VALUES (?,?,?,?)"
        ).bind(sessionId, user.id, expiresAt, new Date().toISOString()).run();
        await env.robodash_db.prepare("DELETE FROM sessions WHERE expires_at < ?").bind(new Date().toISOString()).run();
        return json(
          { ok: true, user: { email: user.email, name: user.name, role: user.role } },
          200,
          { "Set-Cookie": `rd_session=${sessionId}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=28800` }
        );
      } catch (error) {
        return json({ error: error.message || "Google sign-in failed." }, 401);
      }
    }

    if (url.pathname === "/api/auth/me") {
      const session = await getSession(request, env);
      return session ? json({ email: session.email, name: session.name, role: session.role }) : json({ error: "Not signed in." }, 401);
    }

    if (url.pathname === "/api/auth/logout" && method === "POST") {
      const id = getCookie(request, "rd_session");
      if (id) await env.robodash_db.prepare("DELETE FROM sessions WHERE id=?").bind(id).run();
      return json({ ok: true }, 200, { "Set-Cookie": "rd_session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0" });
    }

    if (url.pathname === "/api/admin/state" && method === "GET") {
      const session = await getSession(request, env);
      if (!session || !["super_admin", "admin"].includes(session.role)) return json({ error: "Admin access required." }, 403);
      let row = await env.robodash_db.prepare("SELECT value,revision FROM dashboard_state WHERE id=1").first();
      if (!row) {
        const state = defaultState();
        await env.robodash_db.prepare(
          "INSERT INTO dashboard_state (id,value,revision,updated_at) VALUES (1,?,?,?)"
        ).bind(JSON.stringify(state), 1, new Date().toISOString()).run();
        row = { value: JSON.stringify(state), revision: 1 };
      }
      return json(JSON.parse(row.value));
    }

    if (url.pathname === "/api/admin/state" && method === "PUT") {
      const session = await getSession(request, env);
      if (!session || !["super_admin", "admin"].includes(session.role)) return json({ error: "Admin access required." }, 403);
      const origin = request.headers.get("Origin");
      if (origin) {
        const allowed = new URL(request.url).origin;
        if (origin !== allowed) return json({ error: "Bad origin." }, 403);
      }
      const body = await request.json();
      const state = { ...body, rev: (Number(body.rev) || 1) + 1 };
      await env.robodash_db.prepare(
        "INSERT INTO dashboard_state (id,value,revision,updated_at) VALUES (1,?,?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value,revision=excluded.revision,updated_at=excluded.updated_at"
      ).bind(JSON.stringify(state), state.rev, new Date().toISOString()).run();
      return json(state);
    }

    if (url.pathname === "/api/admin/users" && method === "GET") {
      const session = await getSession(request, env);
      if (!session || session.role !== "super_admin") return json({ error: "Super-admin access required." }, 403);
      const result = await env.robodash_db.prepare(
        "SELECT id,email,name,avatar,role,approved_at,approved_by,created_at FROM users ORDER BY created_at DESC"
      ).all();
      return json({ users: result.results });
    }

    if (url.pathname === "/api/admin/users/approve" && method === "POST") {
      const session = await getSession(request, env);
      if (!session || session.role !== "super_admin") return json({ error: "Super-admin access required." }, 403);
      const body = await request.json();
      const role = body.role === "admin" ? "admin" : body.role === "super_admin" ? "super_admin" : "pending";
      await env.robodash_db.prepare(
        "UPDATE users SET role=?,approved_at=?,approved_by=? WHERE id=?"
      ).bind(role, new Date().toISOString(), session.email, String(body.id || "")).run();
      return json({ ok: true });
    }

    if (url.pathname === "/api/public/state") {
      const row = await env.robodash_db
        .prepare("SELECT value FROM dashboard_state WHERE id = 1")
        .first("value");
      const state = row ? JSON.parse(row) : defaultState();
      return Response.json(publicView(state));
    }
    if (url.pathname === "/api/public/events") {
      const body = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("retry: 3000\n: connected\n\n"));
        },
      });
      return new Response(body, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-store",
          "Connection": "keep-alive",
        },
      });
    }
    if (url.pathname === "/api/auth/me" || url.pathname.startsWith("/api/admin/")) {
      return Response.json({ error: "Google login setup is required." }, { status: 401 });
    }

    if (url.pathname === "/") {
      return env.ASSETS.fetch(new Request(new URL("/public/index.html", request.url), request));
    }
    if (url.pathname === "/login") {
      const session = await getSession(request, env);
      if (session && ["super_admin", "admin"].includes(session.role)) {
        return Response.redirect(new URL("/admin", request.url).toString(), 302);
      }
      return env.ASSETS.fetch(new Request(new URL("/admin/login.html", request.url), request));
    }
    if (url.pathname === "/admin") {
      const session = await getSession(request, env);
      if (!session || !["super_admin", "admin"].includes(session.role)) {
        return Response.redirect(new URL("/login", request.url).toString(), 302);
      }
      return env.ASSETS.fetch(new Request(new URL("/admin/admin.html", request.url), request));
    }
    if (url.pathname === "/admin/admin.js") {
      return env.ASSETS.fetch(new Request(new URL("/admin/admin.js", request.url), request));
    }
    if (url.pathname === "/admin/login.js") {
      return env.ASSETS.fetch(new Request(new URL("/admin/login.js", request.url), request));
    }
    if (url.pathname === "/health") {
      return Response.json({ ok: true, service: "RoboDash" });
    }
    if (url.pathname === "/favicon.svg") {
      return env.ASSETS.fetch(new Request(new URL("/public/favicon.svg", request.url), request));
    }

    for (const prefix of ["/css/", "/js/", "/fonts/"]) {
      if (url.pathname.startsWith(prefix)) {
        return env.ASSETS.fetch(new Request(new URL(`/public${url.pathname}`, request.url), request));
      }
    }

    return env.ASSETS.fetch(request);
  },
};
