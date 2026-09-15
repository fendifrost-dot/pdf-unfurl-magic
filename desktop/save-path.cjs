const path = require("node:path");

function sameFsPath(left, right) {
  if (!left || !right) return false;
  const a = path.resolve(left);
  const b = path.resolve(right);
  if (process.platform === "win32" || process.platform === "darwin") {
    return a.toLowerCase() === b.toLowerCase();
  }
  return a === b;
}

/**
 * Save As must never write the uploaded source. If the user picks that path
 * in the native dialog, land beside it as `*-edited.pdf` (or `*-edited-copy`).
 */
function avoidOverwritePath(chosenPath, sourcePath) {
  if (!chosenPath) return chosenPath;
  if (!sourcePath || !sameFsPath(chosenPath, sourcePath)) {
    return path.resolve(chosenPath);
  }
  const dest = path.resolve(chosenPath);
  const dir = path.dirname(dest);
  const ext = path.extname(dest) || ".pdf";
  let base = path.basename(dest, ext);
  if (/-edited$/i.test(base)) base = `${base}-copy`;
  else base = `${base}-edited`;
  let next = path.join(dir, `${base}${ext}`);
  let n = 2;
  while (sameFsPath(next, sourcePath)) {
    next = path.join(dir, `${base}-${n}${ext}`);
    n += 1;
  }
  return next;
}

module.exports = { avoidOverwritePath, sameFsPath };
