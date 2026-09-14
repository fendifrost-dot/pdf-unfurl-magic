const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("pdfReliefDesktop", {
  isDesktop: true,
  pickPdf: () => ipcRenderer.invoke("desktop:pick-pdf"),
  pickPdfs: () => ipcRenderer.invoke("desktop:pick-pdfs"),
  pickImages: () => ipcRenderer.invoke("desktop:pick-images"),
  takePendingPdf: () => ipcRenderer.invoke("desktop:take-pending-pdf"),
  saveFile: (payload) => ipcRenderer.invoke("desktop:save-file", payload),
  onPdfReady: (callback) => {
    const listener = () => {
      callback();
    };
    ipcRenderer.on("desktop:pdf-ready", listener);
    return () => ipcRenderer.removeListener("desktop:pdf-ready", listener);
  },
});
