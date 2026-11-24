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
      enabled: false,
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
  return {
    rev: state.rev,
    event: state.event,
    settings: state.settings,
    stream: {
      enabled: false,
      title: state.stream.title,
      standbyMessage: state.stream.standbyMessage,
      embedUrl: "",
    },
    ticker: active(state.ticker),
    ads: active(state.ads),
    teams: active(state.teams),
    org: active(state.org),
  };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

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
      return env.ASSETS.fetch(new Request(new URL("/admin/login.html", request.url), request));
    }
    if (url.pathname === "/admin") {
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
