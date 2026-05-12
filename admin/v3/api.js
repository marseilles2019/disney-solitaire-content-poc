// Web Admin v3 API client — talks to server.py /api/v2/* endpoints (same backend as v2).

const V2 = "/api/v2";

export const api = {
  async fetchSnapshot() {
    const r = await fetch(`${V2}/snapshot`, { cache: "no-store" });
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      throw new Error(err.error || `snapshot fetch ${r.status}`);
    }
    return r.json();
  },

  async queueChanges(changes) {
    const r = await fetch(`${V2}/queue-changes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ changes }),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || `queue-changes ${r.status}`);
    return d;
  },

  async clearPending() {
    const r = await fetch(`${V2}/clear-pending`, { method: "POST" });
    if (!r.ok) throw new Error(`clear-pending ${r.status}`);
    return r.json();
  },

  async getLastApplied() {
    const r = await fetch(`${V2}/last-applied`, { cache: "no-store" });
    return r.ok ? r.json() : {};
  },

  thumbUrl(guid) {
    if (!guid) return null;
    return `${V2}/thumb?guid=${encodeURIComponent(guid)}&_t=${Date.now()}`;
  },

  assetUrl(path) {
    if (!path) return null;
    return `${V2}/asset?path=${encodeURIComponent(path)}&_t=${Date.now()}`;
  },
};
