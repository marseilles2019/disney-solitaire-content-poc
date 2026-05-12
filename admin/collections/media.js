// admin/collections/media.js — Media Library browser + upload

const { api, toast } = window.__contentAdmin;

const DEFAULT_DIRS = [
  "assets/chips",
  "assets/placeholders/chips",
  "assets/audio",
  "assets/placeholders/homemap.ugui",
  "assets/placeholders/levelcompletemodal.ugui",
];

let state = { dir: DEFAULT_DIRS[1] };

export async function renderMedia(panel) {
  panel.innerHTML = "";
  const header = document.createElement("div");
  header.className = "flex items-center justify-between mb-6";
  header.innerHTML = `
    <div>
      <h2 class="text-2xl font-semibold">媒体库 Media Library</h2>
      <div class="text-[11px] text-slate-500 mono mt-1">public/assets/ 浏览 + 上传 PNG / WAV</div>
    </div>
    <button id="upload-new" class="text-xs px-4 py-2 rounded bg-purple-500/20 border border-purple-500/40 text-purple-300 hover:bg-purple-500/30">+ 上传文件</button>
  `;
  panel.appendChild(header);

  // Dir selector
  const dirNav = document.createElement("div");
  dirNav.className = "flex gap-2 mb-6 flex-wrap";
  for (const d of DEFAULT_DIRS) {
    const btn = document.createElement("button");
    btn.className = "text-[11px] px-3 py-1 rounded border " + (d === state.dir ? "border-purple-400 text-purple-300 bg-purple-500/10" : "border-white/10 text-slate-400 hover:border-white/30");
    btn.textContent = d.replace("assets/", "");
    btn.addEventListener("click", async () => { state.dir = d; await refreshList(panel); });
    dirNav.appendChild(btn);
  }
  panel.appendChild(dirNav);

  document.getElementById("upload-new").addEventListener("click", () => pickAndUploadNew(panel));

  await refreshList(panel);
}

async function refreshList(panel) {
  let listWrap = panel.querySelector(".media-grid-wrap");
  if (!listWrap) {
    listWrap = document.createElement("div");
    listWrap.className = "media-grid-wrap";
    panel.appendChild(listWrap);
  }
  listWrap.innerHTML = "<div class='text-slate-500'>Loading...</div>";
  const { files } = await api.getMedia(state.dir);
  if (!files.length) {
    listWrap.innerHTML = `<div class="text-slate-500 text-sm">空目录 ${state.dir}</div>`;
    return;
  }
  const grid = document.createElement("div");
  grid.className = "media-grid";
  for (const f of files) {
    const card = document.createElement("div");
    card.className = "media-card";
    const isImg = /\.(png|jpe?g)$/i.test(f.path);
    const isAudio = /\.(ogg|wav)$/i.test(f.path);
    card.innerHTML = `
      <div class="thumb">
        ${isImg ? `<img src="${api.getMediaUrl(f.path)}&t=${f.mtime}" />` : isAudio ? `<div class="text-center pt-12 text-2xl">🔊</div>` : `<div class="text-center pt-12 text-2xl">📄</div>`}
      </div>
      <div class="name">${f.path.split("/").pop()}</div>
      <div class="size">${formatSize(f.size)}</div>
    `;
    grid.appendChild(card);
  }
  listWrap.innerHTML = "";
  listWrap.appendChild(grid);
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function pickAndUploadNew(panel) {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".png,.jpg,.jpeg,.ogg,.wav";
  input.multiple = true;
  input.onchange = async () => {
    for (const file of input.files) {
      const target = `${state.dir}/${file.name}`;
      if (file.size > 10 * 1024 * 1024) { toast(`${file.name} 超 10 MB`, "error"); continue; }
      const r = new FileReader();
      await new Promise((res) => {
        r.onload = async () => {
          const b64 = r.result.split(",", 2)[1];
          try {
            await api.upload(target, b64);
            toast(`已上传 ${file.name}`);
          } catch (e) {
            toast(`${file.name} 失败: ${e.message}`, "error");
          }
          res();
        };
        r.readAsDataURL(file);
      });
    }
    await refreshList(panel);
  };
  input.click();
}
