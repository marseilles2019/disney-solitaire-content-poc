// admin/collections/homemap.js — HomeMap 章节条配置 editor

const { api, toast } = window.__contentAdmin;

let contentMap = null;
let saveTimer = null;

export async function renderHomeMap(panel) {
  contentMap = await api.getContentMap();
  panel.innerHTML = "";

  const header = document.createElement("div");
  header.className = "flex items-center justify-between mb-6 pb-4 border-b border-white/5";
  header.innerHTML = `
    <div>
      <h2 class="text-2xl font-semibold">HomeMap 章节条配置</h2>
      <div class="text-[11px] text-slate-500 mono mt-1">public/content_map.json · layouts[0] + sprites[chip_0X]</div>
    </div>
    <div id="autosave-indicator" class="text-[11px] text-slate-500 flex items-center gap-2">
      <span class="w-1.5 h-1.5 rounded-full bg-slate-600"></span>
      <span>—</span>
    </div>
  `;
  panel.appendChild(header);

  // Layout fields (3 number inputs)
  renderLayoutFields(panel);

  // Chips list
  renderChipsList(panel);
}

function renderLayoutFields(panel) {
  const layout = (contentMap.layouts || []).find(l => l.key === "homemap_chipstrip") || (contentMap.layouts || [])[0] || { spacing: 0, padding_left: 0, padding_right: 0, child_size: 96 };
  if (!contentMap.layouts || contentMap.layouts.length === 0) {
    contentMap.layouts = [{ key: "homemap_chipstrip", spacing: 24, padding_left: 16, padding_right: 16, child_size: 96 }];
  }
  const wrap = document.createElement("div");
  wrap.className = "grid grid-cols-3 gap-4 mb-8";
  wrap.innerHTML = `
    <div class="field">
      <span class="field-label">chip_spacing (px)</span>
      <input class="field-input short" type="number" id="f-spacing" value="${layout.spacing}" />
    </div>
    <div class="field">
      <span class="field-label">padding_left (px)</span>
      <input class="field-input short" type="number" id="f-padl" value="${layout.padding_left}" />
    </div>
    <div class="field">
      <span class="field-label">padding_right (px)</span>
      <input class="field-input short" type="number" id="f-padr" value="${layout.padding_right}" />
    </div>
  `;
  panel.appendChild(wrap);

  for (const [id, prop] of [["f-spacing", "spacing"], ["f-padl", "padding_left"], ["f-padr", "padding_right"]]) {
    document.getElementById(id).addEventListener("input", (e) => {
      const val = parseInt(e.target.value || "0", 10);
      const lay = contentMap.layouts.find(l => l.key === "homemap_chipstrip") || contentMap.layouts[0];
      lay[prop] = val;
      scheduleAutoSave();
    });
  }
}

function renderChipsList(panel) {
  const title = document.createElement("div");
  title.className = "field-label mb-3";
  title.textContent = "Chips · 5 项 (chip_01 ~ chip_05)";
  panel.appendChild(title);

  const list = document.createElement("div");
  list.className = "space-y-2";

  // PoC has 2 chip key conventions: bare "chip_0X" and "chips/chip_0X"; show "chips/" prefix as canonical
  const chipKeys = ["chips/chip_01", "chips/chip_02", "chips/chip_03", "chips/chip_04", "chips/chip_05"];
  for (const key of chipKeys) {
    const sprite = (contentMap.sprites || []).find(s => s.key === key);
    if (!sprite) continue;
    const row = renderChipRow(sprite);
    list.appendChild(row);
  }
  panel.appendChild(list);
}

function renderChipRow(sprite) {
  const row = document.createElement("div");
  row.className = "chip-list-row";
  row.innerHTML = `
    <div class="chip-thumb"><img src="${api.getMediaUrl(sprite.path)}&t=${Date.now()}" alt="" /></div>
    <div>
      <div class="mono text-purple-300 text-xs">${sprite.key}</div>
      <div class="mono text-slate-500 text-[10px]">${sprite.path}</div>
    </div>
    <div class="text-[11px] text-slate-400">always</div>
    <button class="text-[11px] px-3 py-1 rounded border border-white/10 hover:border-purple-400 hover:text-purple-300 transition">替换 PNG</button>
  `;
  const btn = row.querySelector("button");
  btn.addEventListener("click", () => pickAndUpload(sprite, row));
  return row;
}

async function pickAndUpload(sprite, row) {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".png,.jpg,.jpeg";
  input.onchange = async () => {
    const file = input.files[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) { toast("文件超过 10 MB", "error"); return; }
    const b64 = await fileToBase64(file);
    try {
      await api.upload(sprite.path, b64);
      row.querySelector(".chip-thumb img").src = api.getMediaUrl(sprite.path) + "&t=" + Date.now();
      toast(`已替换 ${sprite.key}`);
    } catch (e) {
      toast(`上传失败: ${e.message}`, "error");
    }
  };
  input.click();
}

function fileToBase64(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => {
      const dataUrl = r.result;
      const b64 = dataUrl.split(",", 2)[1];
      res(b64);
    };
    r.onerror = rej;
    r.readAsDataURL(file);
  });
}

function scheduleAutoSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try {
      await api.saveContentMap(contentMap);
      const ind = document.getElementById("autosave-indicator");
      if (ind) ind.innerHTML = `<span class="w-1.5 h-1.5 rounded-full bg-emerald-400"></span><span>Auto-saved · ${new Date().toLocaleTimeString()}</span>`;
    } catch (e) {
      toast(`Auto-save 失败: ${e.message}`, "error");
    }
  }, 2000);
}
