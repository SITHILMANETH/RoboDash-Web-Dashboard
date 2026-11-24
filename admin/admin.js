(() => {
  "use strict";

  const $ = (selector, root = document) => root.querySelector(selector);
  const panel = $("#panel");
  let state = null;
  let me = null;

  async function api(method, path, body) {
    const options = { method, credentials: "same-origin", headers: { Accept: "application/json" } };
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
    section.draggable = true;
    section.dataset.block = title;
    const header = document.createElement("header");
    header.innerHTML = "<span class=\"drag-handle\" title=\"Drag to move\">&#8942;&#8942;</span>";
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

  function addSectionDrag(section) {
    section.addEventListener("dragstart", () => section.classList.add("dragging"));
    section.addEventListener("dragend", () => section.classList.remove("dragging"));
  }

  function enableBlockSorting() {
    panel.addEventListener("dragover", (event) => {
      const dragging = panel.querySelector(".dragging");
      if (!dragging) return;
      event.prevented = true;
      event.preventDefault();
      const blocks = [...panel.querySelectorAll(".action-block:not(.dragging)")];
      const next = blocks.find((block) => event.clientY <= block.getBoundingClientRect().top + block.offsetHeight / 2);
      panel.insertBefore(dragging, next || null);
    });
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
      try { state = await api("PUT", "/api/admin/state", state); toast("Saved"); } catch (error) { toast(error.message, true); }
    });
    block.append(save);
    addSectionDrag(block);
    panel.append(block);
  }

  function renderEvent() {
    const block = card("Event & timing", "Control the countdown and dashboard settings.");
    const title = field("Event title", state.event.title);
    const subtitle = field("Subtitle", state.event.subtitle);
    const venue = field("Venue", state.event.venue);
    const timezone = field("Time zone", state.settings.timezone);
    const grid = makeGrid(title, subtitle, venue, timezone);
    block.append(grid);
    const save = document.createElement("button");
    save.type = "button";
    save.className = "btn primary";
    save.textContent = "Save";
    save.addEventListener("click", async () => {
      state.event.title = title.input.value;
      state.event.subtitle = subtitle.input.value;
      state.event.venue = venue.input.value;
      state.settings.timezone = timezone.input.value;
      try { state = await api("PUT", "/api/admin/state", state); toast("Saved"); } catch (error) { toast(error.message, true); }
    });
    block.append(save);
    addSectionDrag(block);
    panel.append(block);
  }

  function renderCollections() {
    const specs = [
      ["ticker", "Messages"],
      ["ads", "Ads"],
      ["teams", "Teams"],
      ["org", "Organisation"]
    ];
    specs.forEach(([key, title]) => {
      const block = card(title, "Use the toggle for every item and drag the cards to reorder them.");
      const list = state[key] || [];
      list.forEach((item, index) => {
        const row = document.createElement("div");
        row.className = "panel item action-block";
        row.draggable = true;
        row.dataset.itemId = item.id;
        const label = item.text || item.title || item.name || "Untitled";
        const name = document.createElement("strong");
        name.textContent = `${index + 1}. ${label}`;
        const enabled = toggle("Show on screen", item.active !== false);
        enabled.input.addEventListener("change", () => { item.active = enabled.input.checked; });
        row.append(name, enabled.wrap);
        addSectionDrag(row);
        block.append(row);
      });
      const save = document.createElement("button");
      save.type = "button";
      save.className = "btn primary";
      save.textContent = "Save";
      save.addEventListener("click", async () => {
        state[key] = [...block.querySelectorAll("[data-item-id]")].map((row) => {
          const item = list.find((candidate) => candidate.id === row.dataset.itemId);
          return item;
        }).filter(Boolean);
        try { state = await api("PUT", "/api/admin/state", state); toast("Saved"); } catch (error) { toast(error.message, true); }
      });
      block.append(save);
      addSectionDrag(block);
      panel.append(block);
    });
  }

  async function renderUsers() {
    if (me.role !== "super_admin") return;
    const block = card("User approvals", "Approve Google accounts before they can open the control panel.");
    const data = await api("GET", "/api/admin/users");
    data.users.forEach((user) => {
      const row = document.createElement("div");
      row.className = "row";
      row.innerHTML = "<strong></strong>";
      row.querySelector("strong").textContent = `${user.email} (${user.role})`;
      if (user.role !== "super_admin") {
        const approve = document.createElement("button");
        approve.type = "button";
        approve.className = "btn primary";
        approve.textContent = "Approve admin";
        approve.addEventListener("click", async () => {
          await api("POST", "/api/admin/users/approve", { id: user.id, role: "admin" });
          toast("Approved");
          await renderUsers();
        });
        row.append(approve);
      }
      block.append(row);
    });
    addSectionDrag(block);
    panel.append(block);
  }

  async function init() {
    me = await api("GET", "/api/auth/me");
    $("#who").textContent = `Signed in as ${me.email}`;
    state = await api("GET", "/api/admin/state");
    panel.replaceChildren();
    renderStream();
    renderEvent();
    renderCollections();
    await renderUsers();
    enableBlockSorting();
    $("#logout").addEventListener("click", async () => {
      await api("POST", "/api/auth/logout");
      location.href = "/login";
    });
  }

  init().catch((error) => toast(error.message, true));
})();
