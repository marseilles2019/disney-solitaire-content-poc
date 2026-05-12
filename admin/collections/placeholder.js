// admin/collections/placeholder.js
export function renderPlaceholder(panel, label) {
  panel.innerHTML = `
    <div class="max-w-2xl">
      <h2 class="text-2xl font-semibold mb-2">${label}</h2>
      <p class="text-sm text-slate-500 mb-8 mono">Coming soon · Phase 5+</p>
      <div class="border border-dashed border-white/10 rounded-lg p-12 text-center">
        <div class="text-4xl mb-4 opacity-30">🔒</div>
        <p class="text-slate-400">这个 collection 的 Content schema 项目尚未定义。</p>
        <p class="text-slate-500 text-sm mt-2">Phase 5+ 实施时会补 wiring。</p>
      </div>
    </div>
  `;
}
