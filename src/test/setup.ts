import { installPromiseWithResolvers } from "../lib/promise-with-resolvers-polyfill";

// Must run before test files import pdfjs-dist.
installPromiseWithResolvers();
