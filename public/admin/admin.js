(() => {
  "use strict";

  const $ = (selector, root = document) => root.querySelector(selector);
  const panel = $("#panel");
  let state = null;
  let me = null;

  async function api(method, path, body) {
    const options = { method, credentials: "same-origin", headers: { Accept: "application/json" } };
    if (me && me.csrf) options.headers["X-CSRF-Token"] = me.csrf;
    if (body !== undefined) {
      options.headers["Content-Type"] = "application/json";
      options.body = JSON.stringify(body);
    }
    const response = await fetch(path, options);
    const data = await response.json().catch(() => ({}));
    if (response.status === 401) location.href = "/login";
    if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
    return data;
  }

  function toast(message, bad = false) {
    const node = $("#toast");
    node.textContent = message;
    node.className = "toast" + (bad ? " bad" : "");
    node.hidden = false;
    clearTimeout(node.timer);
    node.timer = setTimeout(() => { node.hidden = true; }, 3000);
  }

  function field(label, value, type = "text") {
    const wrap = document.createElement("div");
    wrap.className = "field";
    const name = document.createElement("label");
    name.textContent = label;
    const input = document.createElement("input");
    input.type = type;
    input.value = value == null ? "" : value;
    wrap.append(name, input);
    return { wrap, input };
  }

  function areaField(label, value) {
    const wrap = document.createElement("div");
    wrap.className = "field";
    const name = document.createElement("label");
    name.textContent = label;
    const input = document.createElement("textarea");
    input.value = value == null ? "" : value;
    wrap.append(name, input);
    return { wrap, input };
  }

  function selectField(label, value, choices) {
    const wrap = document.createElement("div");
    wrap.className = "field";
    const name = document.createElement("label");
    name.textContent = label;
    const input = document.createElement("select");
    choices.forEach(([optionValue, optionLabel]) => {
      const option = document.createElement("option");
      option.value = optionValue;
      option.textContent = optionLabel;
      input.append(option);
    });
    input.value = value || choices[0][0];
    wrap.append(name, input);
    return { wrap, input };
  }

  function localDateTime(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    const offset = date.getTimezoneOffset() * 60_000;
    return new Date(date.getTime() - offset).toISOString().slice(0, 16);
  }

  async function uploadFile(endpoint, file) {
    const form = new FormData();
    form.append("file", file);
    const headers = {};
    if (me && me.csrf) headers["X-CSRF-Token"] = me.csrf;
    const response = await fetch(endpoint, { method: "POST", credentials: "same-origin", headers, body: form });
    const data = await response.json().catch(() => ({}));
    if (response.status === 401) location.href = "/login";
    if (!response.ok) throw new Error(data.error || `Upload failed (${response.status})`);
    return data.path;
  }

  function addFilePicker(grid, label, accept, endpoint, target) {
    const wrap = document.createElement("div");
    wrap.className = "field";
    const name = document.createElement("label");
    name.textContent = label;
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.addEventListener("change", async () => {
      const file = input.files && input.files[0];
      if (!file) return;
      try {
        target.value = await uploadFile(endpoint, file);
        target.dispatchEvent(new Event("input", { bubbles: true }));
        toast("Upload complete");
      } catch (error) {
        toast(error.message, true);
      } finally {
        input.value = "";
      }
    });
    wrap.append(name, input);
    grid.append(wrap);
  }

  function safeMediaUrl(value, kind) {
    if (!value) return "";
    try {
      const url = new URL(value, location.origin);
      const ext = kind === "video" ? "mp4" : "png|jpe?g|webp|gif";
      if (url.origin === location.origin && new RegExp(`^/uploads/[a-f0-9]{32}\\.(${ext})$`, "i").test(url.pathname)) return url.href;
      if (url.protocol === "https:" && /^[a-z0-9-]+\.supabase\.co$/i.test(url.hostname)
        && new RegExp(`^/storage/v1/object/public/dashboard-media/[a-f0-9]{64}\\.(${ext})$`, "i").test(url.pathname)) return url.href;
    } catch { return ""; }
    return "";
  }

  function youtubeEmbedUrl(value) {
    try {
      const url = new URL(value);
      if (url.protocol !== "https:") return "";
      const host = url.hostname.toLowerCase().replace(/^(www|m)\./, "");
      const parts = url.pathname.split("/").filter(Boolean);
      const id = host === "youtu.be" ? parts[0] : url.searchParams.get("v") || parts[1];
      if (!["youtube.com", "youtube-nocookie.com", "youtu.be"].includes(host) || !/^[A-Za-z0-9_-]{11}$/.test(id || "")) return "";
      return `https://www.youtube-nocookie.com/embed/${id}?autoplay=0&mute=1&rel=0&playsinline=1`;
    } catch { return ""; }
  }

  function preview(type, source) {
    const box = document.createElement("div");
    box.className = "media-preview";
    const update = (kind, value) => {
      box.replaceChildren();
      box.hidden = true;
      if (kind === "image") {
        const src = safeMediaUrl(value, "image");
        if (src) {
          const image = document.createElement("img");
          image.src = src;
          image.alt = "Media preview";
          box.append(image);
          box.hidden = false;
          return;
        }
      } else if (kind === "upload") {
        const src = safeMediaUrl(value, "video");
        if (src) {
          const video = document.createElement("video");
          video.src = src;
          video.controls = true;
          video.muted = true;
          video.playsInline = true;
          box.append(video);
          box.hidden = false;
          return;
        }
      } else if (kind === "youtube") {
        const src = youtubeEmbedUrl(value);
        if (src) {
          const frame = document.createElement("iframe");
          frame.src = src;
          frame.title = "YouTube video preview";
          frame.allow = "encrypted-media; picture-in-picture";
          frame.referrerPolicy = "strict-origin-when-cross-origin";
          box.append(frame);
          box.hidden = false;
          return;
        }
      }
    };
    update(type, source);
    return { box, update };
  }

  function toggle(label, checked) {
    const wrap = document.createElement("label");
    wrap.className = "check";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = !!checked;
    wrap.append(input, document.createTextNode(label));
    return { wrap, input };
  }

  function card(title, subtitle) {
    const section = document.createElement("section");
    section.className = "panel item action-block";
    section.dataset.block = title;
    const ids = {
      "Live stream": "live-stream",
      "Emergency video": "emergency-video",
      "Event & timing": "event-timing",
      "Advertisements": "advertisements",
      "Teams": "teams",
      "Messages": "messages",
      "Organisation & news": "organisation-news",
      "Admin users": "admin-users"
    };
    section.id = ids[title] || "";
    const header = document.createElement("header");
    const heading = document.createElement("strong");
    heading.textContent = title;
    header.append(heading);
    section.append(header);
    if (subtitle) {
      const lead = document.createElement("p");
      lead.className = "lead";
      lead.textContent = subtitle;
      section.append(lead);
    }
    return section;
  }

  function makeGrid(...nodes) {
    const grid = document.createElement("div");
    grid.className = "grid";
    nodes.forEach((node) => grid.append(node.wrap || node));
    return grid;
  }

  function renderStream() {
    const block = card("Live stream", "Enable the stream and update the public player.");
    const grid = makeGrid(
      field("Stream link", state.stream.url, "url"),
      field("Standby title", state.stream.title),
      field("Standby message", state.stream.standbyMessage)
    );
    const url = grid.children[0].querySelector("input");
    const title = grid.children[1].querySelector("input");
    const standby = grid.children[2].querySelector("input");
    const enabled = toggle("Stream is ON", state.stream.enabled);
    block.append(grid, enabled.wrap);
    const save = document.createElement("button");
    save.type = "button";
    save.className = "btn primary";
    save.textContent = "Save";
    save.addEventListener("click", async () => {
      state.stream = { ...state.stream, url: url.value, title: title.value, standbyMessage: standby.value, enabled: enabled.input.checked };
      try {
        state = await api("PUT", "/api/admin/stream", {
          url: state.stream.url,
          title: state.stream.title,
          standbyMessage: state.stream.standbyMessage,
          enabled: state.stream.enabled,
          muted: state.stream.muted
        });
        toast("Saved");
      } catch (error) { toast(error.message, true); }
    });
    block.append(save);
    panel.append(block);
  }

  function renderEmergencyVideo() {
    const config = state.emergencyVideo || { type: "youtube", enabled: false, url: "", videoPath: "" };
    const block = card("Emergency video", "Configure the video here, then use the prominent emergency button above to take over the public player.");
    const type = selectField("Video source", config.type, [["youtube", "YouTube link"], ["upload", "Uploaded MP4"]]);
    const url = field("YouTube video link", config.url || "", "url");
    const videoPath = field("Uploaded MP4 path", config.videoPath || "");
    const urlGrid = makeGrid(url);
    const uploadGrid = makeGrid(videoPath);
    const videoPreview = preview(config.type, config.type === "upload" ? config.videoPath : config.url);
    addFilePicker(uploadGrid, "Upload MP4 (maximum 50 MB)", "video/mp4,.mp4", "/api/admin/upload/video", videoPath.input);
    const save = document.createElement("button");
    save.type = "button";
    save.className = "btn primary";
    save.textContent = "Save video setup";
    const updateSourceVisibility = () => {
      urlGrid.hidden = type.input.value !== "youtube";
      uploadGrid.hidden = type.input.value !== "upload";
      videoPreview.update(type.input.value, type.input.value === "upload" ? videoPath.input.value : url.input.value);
    };
    type.input.addEventListener("change", updateSourceVisibility);
    url.input.addEventListener("input", updateSourceVisibility);
    videoPath.input.addEventListener("input", updateSourceVisibility);
    updateSourceVisibility();
    save.addEventListener("click", async () => {
      try {
        state = await api("PUT", "/api/admin/emergency-video", {
          type: type.input.value,
          url: url.input.value,
          videoPath: videoPath.input.value,
          enabled: !!(state.emergencyVideo && state.emergencyVideo.enabled)
        });
        updateEmergencyButton();
        toast("Emergency video setup saved");
      } catch (error) { toast(error.message, true); }
    });
    block.append(type.wrap, urlGrid, uploadGrid, videoPreview.box, save);
    panel.append(block);
  }

  function renderEvent() {
    const block = card("Event & timing", "Control the countdown and dashboard settings.");
    const title = field("Event title", state.event.title);
    const subtitle = field("Subtitle", state.event.subtitle);
    const venue = field("Venue", state.event.venue);
    const startsAt = field("Event start time", localDateTime(state.event.startsAt), "datetime-local");
    const logo = field("Dashboard logo path", state.event.logo || "");
    const logoPreview = preview("image", logo.input.value);
    logo.input.addEventListener("input", () => logoPreview.update("image", logo.input.value));
    const timezone = field("Time zone", state.settings.timezone);
    const teamSeconds = field("Team rotation (seconds)", state.settings.teamSeconds, "number");
    const orgSeconds = field("Organisation rotation (seconds)", state.settings.orgSeconds, "number");
    const adSeconds = field("Ad rotation (seconds)", state.settings.adSeconds, "number");
    const tickerSeconds = field("Message rotation (seconds)", state.settings.tickerSeconds, "number");
    const grid = makeGrid(title, subtitle, venue, startsAt, logo, timezone, teamSeconds, orgSeconds, adSeconds, tickerSeconds);
    addFilePicker(grid, "Upload dashboard logo", "image/png,image/jpeg,image/webp,image/gif", "/api/admin/upload/image", logo.input);
    block.append(grid, logoPreview.box);
    const save = document.createElement("button");
    save.type = "button";
    save.className = "btn primary";
    save.textContent = "Save";
    save.addEventListener("click", async () => {
      try {
        state = await api("PUT", "/api/admin/event", {
          ...state.event,
          title: title.input.value,
          subtitle: subtitle.input.value,
          venue: venue.input.value,
          startsAt: new Date(startsAt.input.value).toISOString(),
          logo: logo.input.value
        });
        state = await api("PUT", "/api/admin/settings", {
          timezone: timezone.input.value,
          teamSeconds: teamSeconds.input.value,
          orgSeconds: orgSeconds.input.value,
          adSeconds: adSeconds.input.value,
          tickerSeconds: tickerSeconds.input.value
        });
        toast("Saved");
      } catch (error) { toast(error.message, true); }
    });
    block.append(save);
    panel.append(block);
  }

  function renderCollections() {
    const configs = [
      { key: "teams", title: "Teams", fields: [
        { key: "name", label: "Team name" }, { key: "university", label: "University" },
        { key: "country", label: "Country" }, { key: "countryCode", label: "Country code" },
        { key: "members", label: "Members (one per line)", type: "area", convert: (value) => Array.isArray(value) ? value.join("\n") : value },
        { key: "robot", label: "Robot" }, { key: "blurb", label: "Description", type: "area" },
        { key: "photo", label: "Team photo path" },
        { key: "status", label: "Status", type: "select", choices: [["waiting", "Waiting"], ["live", "Live"], ["done", "Finished"]] }
      ] },
      { key: "ticker", title: "Messages", fields: [{ key: "text", label: "Message", type: "area" }] },
      { key: "org", title: "Organisation & news", fields: [
        { key: "kind", label: "Category", type: "select", choices: [["campus", "Campus"], ["course", "Course"], ["news", "News"], ["photo", "Photo"]] },
        { key: "title", label: "Title" }, { key: "body", label: "Description", type: "area" }, { key: "image", label: "Image path" }
      ] }
    ];

    renderAdsManager();
    configs.forEach(({ key, title, fields }) => {
      const list = state[key] || [];
      const block = card(title, key === "teams"
        ? "Add as many teams as the event needs. Active teams appear automatically on the public display."
        : "Add, edit and choose which messages or organisation updates appear on the public display.");
      const add = document.createElement("button");
      add.type = "button";
      add.className = "btn";
      add.textContent = `Add ${key === "ticker" ? "message" : key === "org" ? "item" : "team"}`;
      const newEditor = createCollectionEditor(key, fields, null);
      newEditor.hidden = true;
      add.addEventListener("click", () => { newEditor.hidden = !newEditor.hidden; });
      block.append(add, newEditor);
      list.forEach((item) => block.append(createCollectionEditor(key, fields, item)));
      panel.append(block);
    });
  }

  function createCollectionEditor(key, fields, item) {
    const editor = document.createElement("section");
    editor.className = "panel item";
    const grid = document.createElement("div");
    grid.className = "grid";
    const controls = {};
    fields.forEach((spec) => {
      const value = spec.convert ? spec.convert(item && item[spec.key]) : item && item[spec.key];
      const control = spec.type === "area"
        ? areaField(spec.label, value)
        : spec.type === "select"
          ? selectField(spec.label, value, spec.choices)
          : field(spec.label, value);
      controls[spec.key] = control.input;
      grid.append(control.wrap);
      if (spec.key === "image" || spec.key === "photo") {
        const mediaPreview = preview("image", control.input.value);
        control.input.addEventListener("input", () => mediaPreview.update("image", control.input.value));
        grid.append(mediaPreview.box);
        addFilePicker(grid, `Upload ${spec.key === "photo" ? "team photo" : "image or GIF"}`, "image/png,image/jpeg,image/webp,image/gif", "/api/admin/upload/image", control.input);
      }
    });
    const enabled = toggle("Show on dashboard", item ? item.active !== false : true);
    const actions = document.createElement("div");
    actions.className = "row";
    const save = document.createElement("button");
    save.type = "button";
    save.className = "btn primary";
    save.textContent = item ? "Save changes" : "Create";
    save.addEventListener("click", async () => {
      const body = { active: enabled.input.checked };
      fields.forEach(({ key: fieldKey }) => {
        const value = controls[fieldKey].value;
        body[fieldKey] = fieldKey === "members" ? value.split("\n") : value;
      });
      try {
        state = await api(item ? "PUT" : "POST", `/api/admin/${key}${item ? `/${encodeURIComponent(item.id)}` : ""}`, body);
        toast(item ? "Changes saved" : "Item added");
        renderPanel();
      } catch (error) { toast(error.message, true); }
    });
    actions.append(save);
    if (item) {
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "btn danger";
      remove.textContent = "Delete";
      remove.addEventListener("click", async () => {
        if (!window.confirm("Delete this item?")) return;
        try {
          state = await api("DELETE", `/api/admin/${key}/${encodeURIComponent(item.id)}`);
          toast("Item deleted");
          renderPanel();
        } catch (error) { toast(error.message, true); }
      });
      actions.append(remove);
    }
    editor.append(grid, enabled.wrap, actions);
    return editor;
  }

  function renderAdsManager() {
    const ads = state.ads || [];
    const block = card("Advertisements", "Manage all sponsors from one place. Enable, reorder, preview, replace or remove each ad directly from its card.");
    const add = document.createElement("button");
    add.type = "button";
    add.className = "btn";
    add.textContent = "Add advertisement";
    const newEditor = createAdEditor(null, -1);
    newEditor.hidden = true;
    add.addEventListener("click", () => { newEditor.hidden = !newEditor.hidden; });
    block.append(add, newEditor);
    ads.forEach((item, index) => block.append(createAdEditor(item, index)));
    panel.append(block);
  }

  function createAdEditor(item, index) {
    const editor = document.createElement("section");
    editor.className = "panel item ad-editor";
    const title = field("Ad title", item && item.title || "");
    const label = field("Small label", item && item.label || "");
    const initialType = item && item.mediaType || (item && item.image ? "image" : "text");
    const mediaType = selectField("Ad media", initialType, [
      ["text", "Text only"], ["image", "Image or GIF"], ["upload", "Uploaded video"], ["youtube", "YouTube video"]
    ]);
    const imagePath = field("Image path", item && item.image || "");
    const videoPath = field("MP4 path", item && item.videoPath || "");
    const videoUrl = field("YouTube link", item && item.videoUrl || "", "url");
    const imageGrid = makeGrid(imagePath);
    const uploadGrid = makeGrid(videoPath);
    const youtubeGrid = makeGrid(videoUrl);
    const mediaPreview = preview(initialType, initialType === "image" ? imagePath.input.value
      : initialType === "upload" ? videoPath.input.value : videoUrl.input.value);
    addFilePicker(imageGrid, "Upload image or GIF", "image/png,image/jpeg,image/webp,image/gif", "/api/admin/upload/image", imagePath.input);
    addFilePicker(uploadGrid, "Upload MP4 (maximum 50 MB)", "video/mp4,.mp4", "/api/admin/upload/video", videoPath.input);
    const updateMedia = () => {
      const type = mediaType.input.value;
      imageGrid.hidden = type !== "image";
      uploadGrid.hidden = type !== "upload";
      youtubeGrid.hidden = type !== "youtube";
      mediaPreview.update(type, type === "image" ? imagePath.input.value
        : type === "upload" ? videoPath.input.value : videoUrl.input.value);
    };
    mediaType.input.addEventListener("change", updateMedia);
    imagePath.input.addEventListener("input", updateMedia);
    videoPath.input.addEventListener("input", updateMedia);
    videoUrl.input.addEventListener("input", updateMedia);
    updateMedia();
    const enabled = toggle("Enabled on dashboard", item ? item.active !== false : true);
    const actions = document.createElement("div");
    actions.className = "row";
    if (item) {
      const order = document.createElement("div");
      order.className = "order-controls";
      const move = (delta) => {
        const next = index + delta;
        if (next < 0 || next >= (state.ads || []).length) return;
        const ids = state.ads.map((ad) => ad.id);
        [ids[index], ids[next]] = [ids[next], ids[index]];
        api("PUT", "/api/admin/ads/order", { ids })
          .then((nextState) => { state = nextState; renderPanel(); toast("Ad order updated"); })
          .catch((error) => toast(error.message, true));
      };
      [["Move up", -1], ["Move down", 1]].forEach(([text, delta]) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "btn sm";
        button.textContent = text;
        button.disabled = index + delta < 0 || index + delta >= adsLength();
        button.addEventListener("click", () => move(delta));
        order.append(button);
      });
      actions.append(order);
    }
    const save = document.createElement("button");
    save.type = "button";
    save.className = "btn primary";
    save.textContent = item ? "Save ad" : "Create ad";
    save.addEventListener("click", async () => {
      const body = {
        title: title.input.value,
        label: label.input.value,
        mediaType: mediaType.input.value,
        image: imagePath.input.value,
        videoPath: videoPath.input.value,
        videoUrl: videoUrl.input.value,
        active: enabled.input.checked
      };
      try {
        state = await api(item ? "PUT" : "POST", `/api/admin/ads${item ? `/${encodeURIComponent(item.id)}` : ""}`, body);
        toast(item ? "Ad saved" : "Ad added");
        renderPanel();
      } catch (error) { toast(error.message, true); }
    });
    actions.append(save);
    if (item) {
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "btn danger";
      remove.textContent = "Delete";
      remove.addEventListener("click", async () => {
        if (!window.confirm("Remove this advertisement?")) return;
        try {
          state = await api("DELETE", `/api/admin/ads/${encodeURIComponent(item.id)}`);
          toast("Advertisement removed");
          renderPanel();
        } catch (error) { toast(error.message, true); }
      });
      actions.append(remove);
    }
    editor.append(title.wrap, label.wrap, mediaType.wrap, imageGrid, uploadGrid, youtubeGrid, mediaPreview.box, enabled.wrap, actions);
    return editor;
  }

  function adsLength() {
    return (state.ads || []).length;
  }

  async function renderUsers() {
    const nav = $("#users-nav");
    const allowed = me.provider !== "supabase" || me.role === "super_admin";
    nav.hidden = !allowed;
    if (!allowed) return;

    const block = card("Admin users", me.provider === "supabase"
      ? "Invite additional administrators by email. Supabase sends each person a secure setup link."
      : "Create and revoke local administrator accounts.");
    const form = document.createElement("div");
    form.className = "grid";
    const identity = field(me.provider === "supabase" ? "Admin email" : "Username", "", me.provider === "supabase" ? "email" : "text");
    const password = me.provider === "supabase" ? null : field("Password (12+ characters)", "", "password");
    if (password) {
      password.input.minLength = 12;
      password.input.autocomplete = "new-password";
      password.input.placeholder = "At least 12 characters";
    }
    form.append(identity.wrap);
    if (password) form.append(password.wrap);
    const create = document.createElement("button");
    create.type = "button";
    create.className = "btn primary";
    create.textContent = me.provider === "supabase" ? "Send invitation" : "Create admin";
    const help = document.createElement("p");
    help.className = "admin-help";
    help.textContent = me.provider === "supabase"
      ? "Invited admins set their own password through Supabase Auth."
      : "Each local admin has a separate username and password. Removed accounts have their active sessions revoked.";
    const users = document.createElement("div");
    users.className = "admin-users-list";
    block.append(form, create, help, users);
    panel.append(block);

    const renderList = async () => {
      users.replaceChildren(document.createTextNode("Loading admin accounts…"));
      try {
        const result = await api("GET", "/api/admin/users");
        users.replaceChildren();
        (result.users || []).forEach((user) => {
          const identityText = user.email || user.username || user.user_id;
          const row = document.createElement("div");
          row.className = "admin-user";
          const label = document.createElement("div");
          const name = document.createElement("strong");
          name.textContent = identityText;
          const role = document.createElement("small");
          role.textContent = String(user.role || "admin").replaceAll("_", " ");
          label.append(name, role);
          row.append(label);
          const isOwner = user.role === "super_admin" || (me.provider !== "supabase" && user.username === me.username);
          if (!isOwner) {
            const remove = document.createElement("button");
            remove.type = "button";
            remove.className = "btn danger sm";
            remove.textContent = "Revoke access";
            remove.addEventListener("click", async () => {
              if (!window.confirm(`Revoke admin access for ${identityText}?`)) return;
              try {
                const identifier = user.user_id || user.username;
                await api("DELETE", `/api/admin/users/${encodeURIComponent(identifier)}`);
                toast("Admin access revoked");
                await renderList();
              } catch (error) { toast(error.message, true); }
            });
            row.append(remove);
          }
          users.append(row);
        });
        if (!(result.users || []).length) users.append(document.createTextNode("No admin accounts found."));
      } catch (error) {
        users.replaceChildren();
        const notice = document.createElement("p");
        notice.className = "admin-help";
        notice.textContent = error.message;
        users.append(notice);
      }
    };

    create.addEventListener("click", async () => {
      const body = me.provider === "supabase"
        ? { email: identity.input.value }
        : { username: identity.input.value, password: password.input.value };
      try {
        await api("POST", "/api/admin/users", body);
        identity.input.value = "";
        if (password) password.input.value = "";
        toast(me.provider === "supabase" ? "Invitation sent" : "Admin account created");
        await renderList();
      } catch (error) { toast(error.message, true); }
    });
    await renderList();
  }

  function updateEmergencyButton() {
    const button = $("#quick-emergency");
    const config = state && state.emergencyVideo || {};
    const active = config.enabled === true;
    const ready = config.type === "upload" ? !!config.videoPath : !!config.url;
    button.textContent = active ? "Stop emergency video" : "Start emergency video";
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
    button.disabled = !active && !ready;
  }

  async function toggleEmergencyVideo() {
    const config = state.emergencyVideo || {};
    try {
      state = await api("PUT", "/api/admin/emergency-video", {
        type: config.type || "youtube",
        url: config.url || "",
        videoPath: config.videoPath || "",
        enabled: !config.enabled
      });
      updateEmergencyButton();
      toast(config.enabled ? "Emergency video stopped" : "Emergency video is now live");
    } catch (error) { toast(error.message, true); }
  }

  function renderPanel() {
    panel.replaceChildren();
    renderStream();
    renderEmergencyVideo();
    renderEvent();
    renderCollections();
    renderUsers();
    updateEmergencyButton();
  }

  async function init() {
    me = await api("GET", "/api/auth/me");
    const identity = me.username || me.email || "Administrator";
    const level = (me.role || "admin").replaceAll("_", " ");
    const who = $("#who");
    const access = document.createElement("span");
    access.className = "access-level";
    access.textContent = level;
    who.replaceChildren(document.createTextNode(`Signed in as ${identity}`), document.createElement("br"), access);
    state = await api("GET", "/api/admin/state");
    renderPanel();
    $("#quick-emergency").addEventListener("click", toggleEmergencyVideo);
    $("#logout").addEventListener("click", async () => {
      await api("POST", "/api/auth/logout");
      location.href = "/login";
    });
  }

  init().catch((error) => toast(error.message, true));
})();
