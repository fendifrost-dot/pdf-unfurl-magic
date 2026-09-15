const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("pdfReliefDesktop", {
  isDesktop: true,
  pickPdf: () => ipcRenderer.invoke("desktop:pick-pdf"),
  pickPdfs: () => ipcRenderer.invoke("desktop:pick-pdfs"),
  pickImages: () => ipcRenderer.invoke("desktop:pick-images"),
  takePendingPdf: () => ipcRenderer.invoke("desktop:take-pending-pdf"),
  saveFile: (payload) => ipcRenderer.invoke("desktop:save-file", payload),
  saveSidecar: (payload) => ipcRenderer.invoke("desktop:save-sidecar", payload),
  documentClosed: () => ipcRenderer.invoke("desktop:document-closed"),
  onPdfReady: (callback) => {
    const listener = () => {
      callback();
    };
    ipcRenderer.on("desktop:pdf-ready", listener);
    return () => ipcRenderer.removeListener("desktop:pdf-ready", listener);
  },
  onEditorCommand: (callback) => {
    const listener = (_event, command) => {
      if (command === "save-as" || command === "close-document") callback(command);
    };
    ipcRenderer.on("desktop:editor-command", listener);
    return () => ipcRenderer.removeListener("desktop:editor-command", listener);
  },
});
