/**
 * electron-builder copies production node_modules unless this hook says the
 * app already handled them. The packed desktop shell is static files +
 * desktop/main.cjs — Vite has already bundled the renderer.
 */
module.exports = async function beforeBuild() {
  return false;
};
