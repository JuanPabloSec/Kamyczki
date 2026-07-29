const API = {
  token: localStorage.getItem("kamyczki_token") || null,
  user: null,

  setToken(token) {
    this.token = token;
    if (token) localStorage.setItem("kamyczki_token", token);
    else localStorage.removeItem("kamyczki_token");
  },

  async request(path, options = {}) {
    const headers = { ...(options.headers || {}) };
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    if (options.json) {
      headers["Content-Type"] = "application/json";
      options.body = JSON.stringify(options.json);
      delete options.json;
    }

    const res = await fetch(path, { ...options, headers });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || `Błąd ${res.status}`);
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  },

  register(body) {
    return this.request("/api/auth/register", { method: "POST", json: body });
  },
  login(body) {
    return this.request("/api/auth/login", { method: "POST", json: body });
  },
  me() {
    return this.request("/api/auth/me");
  },

  stones(params = {}) {
    const q = new URLSearchParams(params).toString();
    return this.request(`/api/stones${q ? `?${q}` : ""}`);
  },
  stoneByCode(code) {
    return this.request(`/api/stones/code/${encodeURIComponent(code)}`);
  },
  createStone(formData) {
    return this.request("/api/stones", { method: "POST", body: formData });
  },
  deleteStone(id) {
    return this.request(`/api/stones/${id}`, { method: "DELETE" });
  },

  spots(params = {}) {
    const q = new URLSearchParams(params).toString();
    return this.request(`/api/map/spots${q ? `?${q}` : ""}`);
  },
  createSpot(formData) {
    return this.request("/api/map/spots", { method: "POST", body: formData });
  },
  deleteSpot(id) {
    return this.request(`/api/map/spots/${id}`, { method: "DELETE" });
  },
  feed() {
    return this.request("/api/map/feed");
  },
};
