"use strict";

/**
 * pdfjs-dist calls Promise.withResolvers at module load (Node 22+ / modern
 * browsers). Load this with `node --require` so it is in place before Vitest
 * workers evaluate pdfjs on Node 20.
 */
if (typeof Promise.withResolvers !== "function") {
  Object.defineProperty(Promise, "withResolvers", {
    configurable: true,
    writable: true,
    value: function withResolvers() {
      let resolve;
      let reject;
      const promise = new Promise((res, rej) => {
        resolve = res;
        reject = rej;
      });
      return { promise, resolve, reject };
    },
  });
}
