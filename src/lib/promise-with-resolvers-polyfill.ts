/**
 * Promise.withResolvers is Node 22+ / modern browsers. pdfjs-dist calls it
 * while the module evaluates, so Node 20 tests (and any Node 20 script that
 * imports pdfjs) need this installed first.
 */

type WithResolvers<T> = {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
};

type PromiseWithResolversCtor = PromiseConstructor & {
  withResolvers?: <T>() => WithResolvers<T>;
};

export function installPromiseWithResolvers(): void {
  const ctor = Promise as PromiseWithResolversCtor;
  if (typeof ctor.withResolvers === "function") return;
  Object.defineProperty(Promise, "withResolvers", {
    configurable: true,
    writable: true,
    value: function withResolvers<T = unknown>(): WithResolvers<T> {
      let resolve!: (value: T | PromiseLike<T>) => void;
      let reject!: (reason?: unknown) => void;
      const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
      });
      return { promise, resolve, reject };
    },
  });
}
