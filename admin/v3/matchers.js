// Pure matchers; each returns the array of element IDs in `elements` that match the file.
// `file` shape: { name: string (basename), relPath: string (relative path inside dropped folder) }

const norm = s => s.toLowerCase().replace(/^.*\//, "").replace(/\.(png|jpe?g)$/i, "");

export const matchers = {
  filename(file, elements) {
    const base = file.name.toLowerCase();
    return elements.filter(e =>
      e.currentAssetPath && e.currentAssetPath.toLowerCase().endsWith("/" + base)
    ).map(e => e.id);
  },
  subpath(file, elements) {
    if (!file.relPath || !file.relPath.includes("/")) return [];
    const lower = file.relPath.toLowerCase();
    return elements.filter(e =>
      e.currentAssetPath && e.currentAssetPath.toLowerCase().endsWith(lower)
    ).map(e => e.id);
  },
  contentTag(file, elements) {
    const key = norm(file.name);
    return elements.filter(e =>
      e.contentTagKey && (
        e.contentTagKey.toLowerCase() === key ||
        e.contentTagKey.toLowerCase().endsWith("/" + key)
      )
    ).map(e => e.id);
  },
  gameObjectName(file, elements) {
    const key = norm(file.name);
    return elements.filter(e => {
      const last = (e.gameObjectPath || "").split("/").pop().toLowerCase();
      return last === key;
    }).map(e => e.id);
  },
};

// Returns { matcherName, matchedIds } for the first matcher that produces ≥1 hit.
// `order` is a string[] of matcher names; missing names skipped.
export function matchFile(file, elements, order = ["filename", "subpath", "contentTag"]) {
  for (const name of order) {
    const fn = matchers[name];
    if (!fn) continue;
    const hits = fn(file, elements);
    if (hits.length > 0) return { matcherName: name, matchedIds: hits };
  }
  return { matcherName: null, matchedIds: [] };
}
