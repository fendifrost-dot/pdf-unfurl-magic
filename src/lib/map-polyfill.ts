/** PDF.js 6 uses Map/WeakMap.getOrInsertComputed (Chrome 135+). Electron 38 may lack it. */

type Insertable = {
  has(key: unknown): boolean;
  get(key: unknown): unknown;
  set(key: unknown, value: unknown): unknown;
};

declare global {
  interface Map<K, V> {
    getOrInsert(key: K, value: V): V;
    getOrInsertComputed(key: K, callbackfn: (key: K) => V): V;
  }
  interface WeakMap<K extends WeakKey, V> {
    getOrInsert(key: K, value: V): V;
    getOrInsertComputed(key: K, callbackfn: (key: K) => V): V;
  }
}

function installGetOrInsert(proto: Insertable & { getOrInsert?: unknown; getOrInsertComputed?: unknown }) {
  if (typeof proto.getOrInsert !== "function") {
    Object.defineProperty(proto, "getOrInsert", {
      configurable: true,
      writable: true,
      value: function getOrInsert(this: Insertable, key: unknown, value: unknown) {
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
      value: function getOrInsertComputed(
        this: Insertable,
        key: unknown,
        callbackfn: (key: unknown) => unknown
      ) {
        if (this.has(key)) return this.get(key);
        const value = callbackfn(key);
        this.set(key, value);
        return value;
      },
    });
  }
}

export function installMapPolyfills() {
  installGetOrInsert(Map.prototype as unknown as Insertable & { getOrInsert?: unknown; getOrInsertComputed?: unknown });
  installGetOrInsert(
    WeakMap.prototype as unknown as Insertable & { getOrInsert?: unknown; getOrInsertComputed?: unknown }
  );
}
