const projectUrl = Deno.env.get("SUPABASE_URL") || "";
const publicKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

const response = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
  });

async function errorMessage(res: Response, fallback: string) {
  const body = await res.json().catch(() => ({}));
  const message = body.msg || body.message || body.error_description || body.error;
  return typeof message === "string" ? message.slice(0, 180) : fallback;
}

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") return response({ error: "Method not allowed." }, 405);
  if (!projectUrl || !publicKey || !serviceKey) return response({ error: "Supabase admin service configuration is incomplete." }, 503);

  const authorization = request.headers.get("Authorization") || "";
  const accessToken = authorization.replace(/^Bearer\s+/i, "");
  if (!accessToken || accessToken === authorization) return response({ error: "Sign in as a super administrator." }, 401);

  const userResponse = await fetch(`${projectUrl}/auth/v1/user`, {
    headers: { apikey: publicKey, Authorization: `Bearer ${accessToken}` }
  });
  if (!userResponse.ok) return response({ error: "Sign in as a super administrator." }, 401);
  const user = await userResponse.json();
  const serviceHeaders = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };
  const roleUrl = new URL("/rest/v1/admin_users", projectUrl);
  roleUrl.searchParams.set("user_id", `eq.${user.id}`);
  roleUrl.searchParams.set("select", "role");
  const roleResponse = await fetch(roleUrl, { headers: serviceHeaders });
  if (!roleResponse.ok) return response({ error: "Could not verify admin permissions." }, 502);
  const roles = await roleResponse.json();
  if (!roles.some((item: { role: string }) => item.role === "super_admin")) {
    return response({ error: "Only a super administrator can manage admin accounts." }, 403);
  }

  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return response({ error: "Malformed request." }, 400); }

  if (body.action === "list") {
    const listUrl = new URL("/rest/v1/admin_users", projectUrl);
    listUrl.searchParams.set("select", "user_id,email,role,created_at");
    listUrl.searchParams.set("order", "created_at.asc");
    const result = await fetch(listUrl, { headers: serviceHeaders });
    if (!result.ok) return response({ error: "Could not load admin accounts." }, 502);
    return response({ users: await result.json() });
  }

  if (body.action === "invite") {
    const email = String(body.email || "").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 254) {
      return response({ error: "Enter a valid email address." }, 400);
    }

    let redirectTo = "";
    if (body.redirectTo) {
      try {
        const redirect = new URL(String(body.redirectTo));
        if (redirect.protocol !== "https:" || redirect.username || redirect.password) throw new Error();
        redirectTo = redirect.toString();
      } catch {
        return response({ error: "The invitation redirect URL is invalid." }, 400);
      }
    }
    const inviteUrl = new URL("/auth/v1/invite", projectUrl);
    if (redirectTo) inviteUrl.searchParams.set("redirect_to", redirectTo);
    const invite = await fetch(inviteUrl, {
      method: "POST",
      headers: { ...serviceHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ email, data: { role: "admin" } })
    });
    const invited = await invite.json().catch(() => ({}));
    if (!invite.ok) return response({ error: await errorMessage(new Response(JSON.stringify(invited), { status: invite.status }), "Supabase could not send the invitation.") }, invite.status >= 500 ? 502 : 400);
    const invitedUser = invited.user || invited;
    if (!invitedUser.id) return response({ error: "Supabase did not return the invited user ID." }, 502);

    const inserted = await fetch(new URL("/rest/v1/admin_users", projectUrl), {
      method: "POST",
      headers: { ...serviceHeaders, "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify({ user_id: invitedUser.id, email, role: "admin", created_by: user.id })
    });
    if (!inserted.ok) {
      await fetch(new URL(`/auth/v1/admin/users/${encodeURIComponent(invitedUser.id)}`, projectUrl), {
        method: "DELETE",
        headers: serviceHeaders
      });
      return response({ error: "Invitation created but admin access could not be saved; verify the migration and retry." }, 502);
    }
    return response({ ok: true, email }, 201);
  }

  if (body.action === "revoke") {
    const userId = String(body.userId || "");
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId)) {
      return response({ error: "Invalid admin account ID." }, 400);
    }
    if (userId === user.id) return response({ error: "You cannot revoke your own admin access." }, 400);
    const targetUrl = new URL("/rest/v1/admin_users", projectUrl);
    targetUrl.searchParams.set("user_id", `eq.${userId}`);
    targetUrl.searchParams.set("select", "role");
    const targetResponse = await fetch(targetUrl, { headers: serviceHeaders });
    if (!targetResponse.ok) return response({ error: "Could not verify the selected admin account." }, 502);
    const target = await targetResponse.json();
    if (!target.length) return response({ error: "Admin account not found." }, 404);
    if (target[0].role === "super_admin") return response({ error: "The primary super administrator cannot be revoked here." }, 403);

    const deleteUrl = new URL("/rest/v1/admin_users", projectUrl);
    deleteUrl.searchParams.set("user_id", `eq.${userId}`);
    const removed = await fetch(deleteUrl, { method: "DELETE", headers: serviceHeaders });
    if (!removed.ok) return response({ error: "Could not revoke admin access." }, 502);
    return response({ ok: true });
  }

  return response({ error: "Unknown admin account action." }, 400);
});
