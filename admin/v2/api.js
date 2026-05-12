// Web Admin v2 API client — talks to server.py /api/v2/* endpoints.

const V2 = "/api/v2";

const api = {
  async fetchSnapshot() {
    const r = await fetch(`${V2}/snapshot`, { cache: "no-store" });
    if (r.status === 404) {
      const err = await r.json().catch(() => ({}));
      throw new Error(err.error || "snapshot.json missing — run Unity Sync");
    }
    if (!r.ok) throw new Error(`snapshot fetch ${r.status}`);
    return await r.json();
  },

  async queueChanges(changes) {
    const r = await fetch(`${V2}/queue-changes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ changes }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || `queue-changes ${r.status}`);
    return data;
  },

  async clearPending() {
    const r = await fetch(`${V2}/clear-pending`, { method: "POST" });
    if (!r.ok) throw new Error(`clear-pending ${r.status}`);
    return await r.json();
  },

  async getLastApplied() {
    const r = await fetch(`${V2}/last-applied`, { cache: "no-store" });
    if (!r.ok) return {};
    return await r.json();
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
