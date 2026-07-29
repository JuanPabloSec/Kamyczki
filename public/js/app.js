/* global L, API */

const state = {
  view: "home",
  spotFilter: "all",
  spots: [],
  map: null,
  markersLayer: null,
  cemeteryLayer: null,
  showCemeteries: true,
  cemeteryCount: 0,
  cemeteryLoading: false,
  cemeteryTimer: null,
  skipMapClick: false,
  pendingLatLng: null,
};

/** Full polygon shapes from OSM */
const CEMETERY_SHAPE_ZOOM = 12;
/** Point markers (centers) — wider overview */
const CEMETERY_POINTS_ZOOM = 9;

// —— Helpers ——
function $(sel, root = document) {
  return root.querySelector(sel);
}

function $$(sel, root = document) {
  return [...root.querySelectorAll(sel)];
}

function toast(msg) {
  const el = $("#toast");
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => {
    el.hidden = true;
  }, 2800);
}

function formatDate(iso) {
  try {
    return new Date(iso).toLocaleString("pl-PL", {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}

function typeLabel(type) {
  return type === "found" ? "Znaleziony" : "Zostawiony";
}

function statusLabel(s) {
  const map = {
    collection: "W kolekcji",
    hidden: "Ukryty w terenie",
    travelling: "Wędruje",
  };
  return map[s] || s;
}

function showError(id, msg) {
  const el = $(id);
  if (!el) return;
  if (!msg) {
    el.hidden = true;
    el.textContent = "";
    return;
  }
  el.hidden = false;
  el.textContent = msg;
}

// —— Auth UI ——
function renderHeaderAuth() {
  const box = $("#header-auth");
  if (API.user) {
    box.innerHTML = `
      <div class="user-chip">
        <span>Cześć, <strong>${escapeHtml(API.user.username)}</strong></span>
        <button type="button" class="btn btn-ghost" id="btn-logout">Wyloguj</button>
      </div>`;
    $("#btn-logout")?.addEventListener("click", logout);
  } else {
    box.innerHTML = `
      <button type="button" class="btn btn-ghost" data-nav="login">Zaloguj</button>
      <button type="button" class="btn btn-primary" data-nav="register">Załóż konto</button>`;
    box.querySelectorAll("[data-nav]").forEach((b) =>
      b.addEventListener("click", () => navigate(b.dataset.nav))
    );
  }
}

async function restoreSession() {
  if (!API.token) {
    API.user = null;
    renderHeaderAuth();
    return;
  }
  try {
    const { user } = await API.me();
    API.user = user;
  } catch {
    API.setToken(null);
    API.user = null;
  }
  renderHeaderAuth();
}

function logout() {
  API.setToken(null);
  API.user = null;
  renderHeaderAuth();
  toast("Wylogowano");
  navigate("home");
}

// —— Navigation ——
function navigate(view, opts = {}) {
  state.view = view;
  $$(".view").forEach((v) => {
    v.hidden = v.id !== `view-${view}`;
  });
  $$(".nav-btn").forEach((b) => {
    b.classList.toggle("active", b.dataset.nav === view);
  });

  if (view === "map") {
    initMap();
    loadSpots();
  }
  if (view === "collection") loadCollection();
  if (view === "feed") loadFeed();
  if (view === "home") loadHomeStats();
  if (view === "track" && opts.code) loadTrack(opts.code);

  window.scrollTo({ top: 0, behavior: "smooth" });
}

// —— Home stats ——
async function loadHomeStats() {
  try {
    const [stonesRes, spotsRes] = await Promise.all([API.stones(), API.spots()]);
    $("#stat-stones").textContent = stonesRes.stones.length;
    $("#stat-spots").textContent = spotsRes.spots.length;
    $("#stat-found").textContent = spotsRes.spots.filter((s) => s.type === "found").length;
  } catch {
    /* ignore */
  }
}

// —— Map ——
function initMap() {
  if (state.map) {
    setTimeout(() => state.map.invalidateSize(), 50);
    scheduleCemeteries();
    return;
  }

  state.map = L.map("map", { zoomControl: true }).setView([52.1, 19.4], 6);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> · cmentarze OSM',
  }).addTo(state.map);

  state.cemeteryLayer = L.geoJSON(null, {
    style: cemeteryStyle,
    pointToLayer: cemeteryPoint,
    onEachFeature: onCemeteryFeature,
  }).addTo(state.map);

  state.markersLayer = L.layerGroup().addTo(state.map);

  state.map.on("click", (e) => {
    if (state.skipMapClick) {
      state.skipMapClick = false;
      return;
    }
    if (!API.user) {
      toast("Zaloguj się, aby dodać punkt na mapie");
      navigate("login");
      return;
    }
    openSpotModal(e.latlng.lat, e.latlng.lng);
  });

  state.map.on("moveend", () => scheduleCemeteries());
  state.map.on("zoomend", () => {
    updateCemeteryUi();
    scheduleCemeteries();
  });

  setTimeout(() => {
    state.map.invalidateSize();
    scheduleCemeteries();
  }, 100);
}

function cemeteryStyle() {
  return {
    color: "#7d6b8a",
    weight: 1.5,
    opacity: 0.9,
    fillColor: "#5c4a63",
    fillOpacity: 0.38,
  };
}

function cemeteryPoint(feature, latlng) {
  return L.circleMarker(latlng, {
    radius: 7,
    color: "#9a86a8",
    weight: 1.5,
    fillColor: "#6b5578",
    fillOpacity: 0.75,
  });
}

function onCemeteryFeature(feature, layer) {
  const name = feature.properties?.name || "Cmentarz";
  const religion = feature.properties?.religion
    ? `<br><small>Wyznanie: ${escapeHtml(feature.properties.religion)}</small>`
    : "";
  const osm = feature.properties?.id
    ? `<br><small class="muted">OSM ${escapeHtml(feature.properties.id)}</small>`
    : "";
  layer.bindPopup(
    `<strong>🪦 ${escapeHtml(name)}</strong>${religion}${osm}<br><small>Kształt z OpenStreetMap</small>`
  );
  layer.on("click", () => {
    state.skipMapClick = true;
  });
}

function scheduleCemeteries() {
  if (!state.map || !state.showCemeteries) return;
  clearTimeout(state.cemeteryTimer);
  state.cemeteryTimer = setTimeout(() => loadCemeteries(), 450);
}

function updateCemeteryUi() {
  const status = $("#cemetery-status");
  const btn = $("#btn-cemeteries");
  if (btn) {
    btn.classList.toggle("active", state.showCemeteries);
    btn.setAttribute("aria-pressed", state.showCemeteries ? "true" : "false");
  }
  if (!status) return;

  if (!state.showCemeteries) {
    status.textContent = "Warstwa cmentarzy wyłączona.";
    return;
  }
  if (!state.map) return;
  const z = state.map.getZoom();
  if (z < CEMETERY_POINTS_ZOOM) {
    status.textContent = `Przybliż mapę (zoom ${CEMETERY_POINTS_ZOOM}+), aby zobaczyć cmentarze z OSM.`;
    return;
  }
  if (state.cemeteryLoading) {
    status.textContent = "Ładowanie cmentarzy z OpenStreetMap…";
    return;
  }
  if (z >= CEMETERY_SHAPE_ZOOM) {
    status.textContent = `Cmentarze w widoku: ${state.cemeteryCount} — kontury z OSM.`;
  } else {
    status.textContent = `Cmentarze w widoku: ${state.cemeteryCount} (punkty). Zoom ${CEMETERY_SHAPE_ZOOM}+ = pełne kształty.`;
  }
}

async function loadCemeteries() {
  if (!state.map || !state.cemeteryLayer || !state.showCemeteries) return;

  const z = state.map.getZoom();
  if (z < CEMETERY_POINTS_ZOOM) {
    state.cemeteryLayer.clearLayers();
    state.cemeteryCount = 0;
    updateCemeteryUi();
    return;
  }

  const mode = z >= CEMETERY_SHAPE_ZOOM ? "full" : "points";
  const b = state.map.getBounds();
  const bbox = {
    south: b.getSouth(),
    west: b.getWest(),
    north: b.getNorth(),
    east: b.getEast(),
    mode,
  };

  const area = (bbox.north - bbox.south) * (bbox.east - bbox.west);
  const maxArea = mode === "full" ? 2.5 : 12;
  if (area > maxArea) {
    state.cemeteryLayer.clearLayers();
    state.cemeteryCount = 0;
    const status = $("#cemetery-status");
    if (status) status.textContent = "Obszar za duży — przybliż mapę.";
    return;
  }

  state.cemeteryLoading = true;
  updateCemeteryUi();

  try {
    const data = await API.cemeteries(bbox);
    if (!state.showCemeteries || !state.cemeteryLayer) return;
    state.cemeteryLayer.clearLayers();
    state.cemeteryLayer.addData(data);
    state.cemeteryCount = data.count ?? data.features?.length ?? 0;
    state._cemeteryMode = mode;
  } catch (e) {
    state.cemeteryCount = 0;
    const status = $("#cemetery-status");
    if (status) status.textContent = e.message || "Błąd ładowania cmentarzy.";
    return;
  } finally {
    state.cemeteryLoading = false;
    updateCemeteryUi();
  }
}

function toggleCemeteries() {
  state.showCemeteries = !state.showCemeteries;
  if (!state.showCemeteries) {
    state.cemeteryLayer?.clearLayers();
    state.cemeteryCount = 0;
    updateCemeteryUi();
    return;
  }
  if (state.map && state.cemeteryLayer && !state.map.hasLayer(state.cemeteryLayer)) {
    state.cemeteryLayer.addTo(state.map);
  }
  scheduleCemeteries();
  updateCemeteryUi();
}

function pinIcon(type) {
  return L.divIcon({
    className: "",
    html: `<div class="marker-pin ${type}"></div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 28],
    popupAnchor: [0, -24],
  });
}

function renderMarkers() {
  if (!state.markersLayer) return;
  state.markersLayer.clearLayers();

  const list = filteredSpots();
  list.forEach((spot) => {
    const m = L.marker([spot.lat, spot.lng], { icon: pinIcon(spot.type) });
    const place = spot.placeName || "Bez nazwy miejsca";
    const stoneLine = spot.stone
      ? `<br><a href="#" data-track="${escapeAttr(spot.stone.code)}">Kod: ${escapeHtml(spot.stone.code)}</a>`
      : "";
    m.bindPopup(
      `<strong>${escapeHtml(typeLabel(spot.type))}</strong><br>${escapeHtml(place)}` +
        `<br><small>${escapeHtml(spot.user?.username || "?")} · ${escapeHtml(formatDate(spot.createdAt))}</small>` +
        stoneLine +
        (spot.note ? `<br><em>${escapeHtml(spot.note)}</em>` : "")
    );
    m.on("popupopen", () => {
      const link = document.querySelector(`[data-track="${CSS.escape(spot.stone?.code || "")}"]`);
      link?.addEventListener("click", (ev) => {
        ev.preventDefault();
        navigate("track", { code: spot.stone.code });
      });
    });
    m.addTo(state.markersLayer);
  });

  renderSpotList(list);
}

function filteredSpots() {
  if (state.spotFilter === "all") return state.spots;
  return state.spots.filter((s) => s.type === state.spotFilter);
}

function renderSpotList(list) {
  const box = $("#map-spot-list");
  if (!list.length) {
    box.innerHTML = `<p class="map-hint">Brak punktów. Kliknij mapę, by dodać pierwszy!</p>`;
    return;
  }
  box.innerHTML = list
    .slice(0, 40)
    .map(
      (s) => `
    <button type="button" class="spot-item" data-focus="${s.id}">
      <span class="badge badge-${s.type}">${typeLabel(s.type)}</span>
      <h3>${escapeHtml(s.placeName || "Punkt na mapie")}</h3>
      <p>${escapeHtml(s.user?.username || "?")} · ${escapeHtml(formatDate(s.createdAt))}</p>
      ${s.stone ? `<p>🪨 ${escapeHtml(s.stone.code)} — ${escapeHtml(s.stone.name)}</p>` : ""}
    </button>`
    )
    .join("");

  box.querySelectorAll("[data-focus]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const spot = state.spots.find((s) => s.id === btn.dataset.focus);
      if (!spot || !state.map) return;
      state.map.setView([spot.lat, spot.lng], 15);
    });
  });
}

async function loadSpots() {
  try {
    const { spots } = await API.spots();
    state.spots = spots;
    renderMarkers();
  } catch (e) {
    toast(e.message);
  }
}

async function openSpotModal(lat, lng) {
  state.pendingLatLng = { lat, lng };
  $("#spot-lat").value = lat;
  $("#spot-lng").value = lng;
  $("#spot-coords").textContent = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
  showError("#spot-error", null);
  $("#form-spot").reset();
  $("#spot-lat").value = lat;
  $("#spot-lng").value = lng;
  $("#form-spot").querySelector('input[name="type"][value="left"]').checked = true;

  // fill own stones for "left"
  const wrap = $("#spot-stone-wrap");
  const select = $("#spot-stone-select");
  select.innerHTML = `<option value="">— bez powiązania —</option>`;
  try {
    const { stones } = await API.stones({ mine: "1" });
    stones.forEach((s) => {
      const opt = document.createElement("option");
      opt.value = s.id;
      opt.textContent = `${s.code} — ${s.name}`;
      select.appendChild(opt);
    });
    wrap.hidden = stones.length === 0;
  } catch {
    wrap.hidden = true;
  }

  $("#modal-spot").showModal();
}

// —— Collection ——
async function loadCollection() {
  const guest = $("#collection-guest");
  const grid = $("#collection-grid");
  const empty = $("#collection-empty");
  const addBtn = $("#btn-add-stone");

  if (!API.user) {
    guest.hidden = false;
    grid.innerHTML = "";
    empty.hidden = true;
    addBtn.hidden = true;
    return;
  }

  guest.hidden = true;
  addBtn.hidden = false;

  try {
    const { stones } = await API.stones({ mine: "1" });
    if (!stones.length) {
      grid.innerHTML = "";
      empty.hidden = false;
      return;
    }
    empty.hidden = true;
    grid.innerHTML = stones
      .map(
        (s) => `
      <button type="button" class="stone-card" data-stone="${s.id}">
        <img src="${escapeAttr(s.imageUrl)}" alt="${escapeAttr(s.name)}" loading="lazy" />
        <div class="body">
          <h3>${escapeHtml(s.name)}</h3>
          <div class="code">${escapeHtml(s.code)}</div>
          <p class="meta">${escapeHtml(statusLabel(s.status))}</p>
        </div>
      </button>`
      )
      .join("");

    grid.querySelectorAll("[data-stone]").forEach((card) => {
      card.addEventListener("click", () => openStoneDetail(card.dataset.stone, stones));
    });
  } catch (e) {
    toast(e.message);
  }
}

function openStoneDetail(id, list) {
  const s = list.find((x) => x.id === id);
  if (!s) return;
  $("#detail-title").textContent = s.name;
  $("#detail-body").innerHTML = `
    <img class="detail-photo" src="${escapeAttr(s.imageUrl)}" alt="" />
    <div class="detail-code">${escapeHtml(s.code)}</div>
    <p style="margin:0;color:var(--text-muted)">Napisz ten kod na odwrocie kamyczka wraz z #kamyczki</p>
    <p style="margin:0">${escapeHtml(s.description || "Bez opisu")}</p>
    <p style="margin:0;color:var(--text-muted);font-size:0.9rem">${escapeHtml(statusLabel(s.status))} · ${escapeHtml(formatDate(s.createdAt))}</p>
  `;
  $("#detail-footer").innerHTML = `
    <button type="button" class="btn btn-danger" id="detail-delete">Usuń</button>
    <button type="button" class="btn btn-ghost" data-close="modal-detail">Zamknij</button>
    <button type="button" class="btn btn-primary" id="detail-track">Historia na mapie</button>
  `;
  $("#detail-delete")?.addEventListener("click", async () => {
    if (!confirm("Usunąć kamyczek z kolekcji?")) return;
    try {
      await API.deleteStone(s.id);
      $("#modal-detail").close();
      toast("Usunięto");
      loadCollection();
    } catch (e) {
      toast(e.message);
    }
  });
  $("#detail-track")?.addEventListener("click", () => {
    $("#modal-detail").close();
    navigate("track", { code: s.code });
  });
  $("#detail-footer [data-close]")?.addEventListener("click", () => $("#modal-detail").close());
  $("#modal-detail").showModal();
}

// —— Feed ——
async function loadFeed() {
  const box = $("#feed-list");
  try {
    const { feed } = await API.feed();
    if (!feed.length) {
      box.innerHTML = `<div class="empty-panel"><h2>Jeszcze cicho</h2><p>Gdy ktoś zostawi lub znajdzie kamyczek, pojawi się tu wpis.</p></div>`;
      return;
    }
    box.innerHTML = feed
      .map((s) => {
        const img =
          s.imageUrl || s.stone?.imageUrl
            ? `<div class="thumb"><img src="${escapeAttr(s.imageUrl || s.stone.imageUrl)}" alt="" /></div>`
            : `<div class="thumb">🪨</div>`;
        return `
        <article class="feed-item">
          ${img}
          <div>
            <span class="badge badge-${s.type}">${typeLabel(s.type)}</span>
            <h3>${escapeHtml(s.placeName || "Punkt na mapie")}</h3>
            <p><strong>${escapeHtml(s.user?.username || "?")}</strong> · ${escapeHtml(formatDate(s.createdAt))}</p>
            ${s.stone ? `<p>Kod: <button type="button" class="link-btn" data-go-track="${escapeAttr(s.stone.code)}">${escapeHtml(s.stone.code)}</button> — ${escapeHtml(s.stone.name)}</p>` : ""}
            ${s.note ? `<p>${escapeHtml(s.note)}</p>` : ""}
          </div>
        </article>`;
      })
      .join("");

    box.querySelectorAll("[data-go-track]").forEach((btn) => {
      btn.addEventListener("click", () => navigate("track", { code: btn.dataset.goTrack }));
    });
  } catch (e) {
    box.innerHTML = `<p class="form-error">${escapeHtml(e.message)}</p>`;
  }
}

// —— Track journey ——
async function loadTrack(code) {
  const content = $("#track-content");
  $("#track-sub").textContent = `Kod: ${code}`;
  content.innerHTML = `<p class="page-sub">Ładowanie…</p>`;
  try {
    const { stone, journey } = await API.stoneByCode(code);
    content.innerHTML = `
      <div class="feed-item" style="margin-bottom:1.25rem">
        ${stone.imageUrl ? `<div class="thumb"><img src="${escapeAttr(stone.imageUrl)}" alt="" /></div>` : `<div class="thumb">🪨</div>`}
        <div>
          <h3>${escapeHtml(stone.name)}</h3>
          <p class="detail-code" style="margin:0.25rem 0">${escapeHtml(stone.code)}</p>
          <p>Autor: <strong>${escapeHtml(stone.owner?.username || "?")}</strong> · ${escapeHtml(statusLabel(stone.status))}</p>
          <p>${escapeHtml(stone.description || "")}</p>
        </div>
      </div>
      <h2 style="font-family:var(--font-display);font-size:1.25rem;margin:0 0 0.75rem">Podróż kamyczka</h2>
      ${
        journey.length
          ? `<div class="journey">${journey
              .map(
                (j) => `
            <div class="journey-step ${j.type}">
              <strong>${typeLabel(j.type)}</strong> · ${escapeHtml(formatDate(j.createdAt))}<br>
              ${escapeHtml(j.placeName || `${j.lat.toFixed(4)}, ${j.lng.toFixed(4)}`)}
              ${j.user ? ` · ${escapeHtml(j.user.username)}` : ""}
              ${j.note ? `<br><em>${escapeHtml(j.note)}</em>` : ""}
            </div>`
              )
              .join("")}</div>`
          : `<div class="empty-panel"><p>Ten kamyczek jeszcze nie ma punktów na mapie. Zostaw go i oznacz miejsce!</p></div>`
      }
    `;
  } catch (e) {
    content.innerHTML = `<div class="empty-panel"><h2>Nie znaleziono</h2><p>${escapeHtml(e.message)}</p></div>`;
  }
}

// —— Escape ——
function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(str) {
  return escapeHtml(str).replace(/'/g, "&#39;");
}

// —— Events ——
function bindEvents() {
  document.body.addEventListener("click", (e) => {
    const nav = e.target.closest("[data-nav]");
    if (nav) {
      e.preventDefault();
      navigate(nav.dataset.nav);
    }
    const close = e.target.closest("[data-close]");
    if (close) {
      const dlg = document.getElementById(close.dataset.close);
      dlg?.close();
    }
  });

  $$("[data-spot-filter]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.spotFilter = btn.dataset.spotFilter;
      $$("[data-spot-filter]").forEach((b) => b.classList.toggle("active", b === btn));
      renderMarkers();
    });
  });

  $("#btn-locate")?.addEventListener("click", () => {
    if (!navigator.geolocation) {
      toast("Geolokalizacja niedostępna");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        initMap();
        state.map.setView([pos.coords.latitude, pos.coords.longitude], 14);
        toast("Jesteś tu");
        scheduleCemeteries();
      },
      () => toast("Nie udało się pobrać lokalizacji")
    );
  });

  $("#btn-cemeteries")?.addEventListener("click", () => toggleCemeteries());

  $("#btn-add-stone")?.addEventListener("click", () => {
    if (!API.user) return navigate("login");
    showError("#stone-error", null);
    $("#form-stone").reset();
    $("#stone-preview").hidden = true;
    $("#modal-stone").showModal();
  });

  $("#form-stone input[name=photo]")?.addEventListener("change", (e) => {
    const file = e.target.files?.[0];
    const box = $("#stone-preview");
    if (!file) {
      box.hidden = true;
      return;
    }
    const url = URL.createObjectURL(file);
    box.querySelector("img").src = url;
    box.hidden = false;
  });

  $("#form-login")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    showError("#login-error", null);
    const fd = new FormData(e.target);
    try {
      const data = await API.login({
        login: fd.get("login"),
        password: fd.get("password"),
      });
      API.setToken(data.token);
      API.user = data.user;
      renderHeaderAuth();
      toast(`Witaj, ${data.user.username}!`);
      navigate("collection");
    } catch (err) {
      showError("#login-error", err.message);
    }
  });

  $("#form-register")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    showError("#register-error", null);
    const fd = new FormData(e.target);
    try {
      const data = await API.register({
        username: fd.get("username"),
        email: fd.get("email"),
        password: fd.get("password"),
        postalCode: fd.get("postalCode"),
        city: fd.get("city"),
      });
      API.setToken(data.token);
      API.user = data.user;
      renderHeaderAuth();
      toast("Konto utworzone — witaj w zabawie!");
      navigate("collection");
    } catch (err) {
      showError("#register-error", err.message);
    }
  });

  $("#form-stone")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    showError("#stone-error", null);
    const fd = new FormData(e.target);
    try {
      const { stone } = await API.createStone(fd);
      $("#modal-stone").close();
      toast(`Dodano! Kod: ${stone.code}`);
      loadCollection();
    } catch (err) {
      showError("#stone-error", err.message);
    }
  });

  $("#form-spot")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    showError("#spot-error", null);
    const form = e.target;
    const fd = new FormData(form);
    // ensure lat/lng present
    if (!fd.get("lat") && state.pendingLatLng) {
      fd.set("lat", state.pendingLatLng.lat);
      fd.set("lng", state.pendingLatLng.lng);
    }
    // empty stoneId should not be sent as empty confusing backend — ok
    if (!fd.get("stoneId")) fd.delete("stoneId");
    if (!fd.get("code")?.toString().trim()) fd.delete("code");
    const photo = form.querySelector('input[name="photo"]');
    if (photo && !photo.files?.length) fd.delete("photo");

    try {
      await API.createSpot(fd);
      $("#modal-spot").close();
      toast("Punkt zapisany na mapie!");
      loadSpots();
    } catch (err) {
      showError("#spot-error", err.message);
    }
  });

  // close dialogs on backdrop
  $$("dialog.modal").forEach((dlg) => {
    dlg.addEventListener("click", (e) => {
      if (e.target === dlg) dlg.close();
    });
  });
}

// —— Boot ——
async function boot() {
  bindEvents();
  await restoreSession();
  navigate("home");
}

boot();
