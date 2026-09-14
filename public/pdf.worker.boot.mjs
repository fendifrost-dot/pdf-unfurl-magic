(function polyfillMapHelpers() {
  function install(proto) {
    if (typeof proto.getOrInsert !== "function") {
      Object.defineProperty(proto, "getOrInsert", {
        configurable: true,
        writable: true,
        value: function getOrInsert(key, value) {
          if (this.has(key)) return this.get(key);
          this.set(key, value);
          return value;
        },
      });
    }
    if (typeof proto.getOrInsertComputed !== "function") {
      Object.defineProperty(proto, "getOrInsertComputed", {
        configurable: true,
        writable: true,
        value: function getOrInsertComputed(key, callbackfn) {
          if (this.has(key)) return this.get(key);
          const value = callbackfn(key);
          this.set(key, value);
          return value;
        },
      });
    }
  }
  install(Map.prototype);
  install(WeakMap.prototype);
})();

import "./pdf.worker.min.mjs";
