// Settings drawer — Force Repack All Atlases (v6.3 recovery path)

export function renderSettingsPanel() {
  return `
    <div class="settings-panel" id="v3-settings-panel" hidden>
      <h3>开发者工具</h3>
      <button class="settings-action" id="v3-force-repack-btn">
        🧩 Force Repack All Atlases
      </button>
      <div class="settings-hint">
        一次性维护工具：让 Unity 把工程内所有 SpriteAtlas 全量 repack。
        仅在 v4 老存量回写或 manifest 关掉 auto-repack 时需要。
      </div>
    </div>
  `;
}

export function wireSettingsPanel() {
  const btn = document.getElementById("v3-force-repack-btn");
  if (!btn) return;
  btn.addEventListener("click", async () => {
    if (!confirm("Force Repack All Atlases?\n\n会让 Unity Editor 一次性 repack 工程内所有 SpriteAtlas。无 atlas 时为 no-op。继续？")) return;
    btn.disabled = true;
    const orig = btn.textContent;
    btn.textContent = "⏳ Repacking...";
    try {
      const r = await fetch("/api/v6/force-repack-all", { method: "POST" });
      const data = await r.json();
      if (!r.ok || !data.ok) throw new Error(data.error || `HTTP ${r.status}`);
      alert("✅ 标记已写入 admin/data/force-repack.flag\n切到 Unity Editor 后会自动触发 repack（看 Console 的 [ForceRepack] 行）。");
    } catch (err) {
      alert("失败: " + err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = orig;
    }
  });
}
