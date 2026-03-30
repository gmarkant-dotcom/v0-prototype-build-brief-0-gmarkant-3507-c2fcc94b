/**
 * pdfjs-dist (pulled in by pdf-parse) expects browser globals. Node 20 / some
 * serverless runtimes omit them — define minimal stubs before loading pdf-parse.
 */
export function installPdfNodePolyfills(): void {
  if (typeof globalThis.DOMMatrix === "undefined") {
    globalThis.DOMMatrix = class DOMMatrix {
      a = 1
      b = 0
      c = 0
      d = 1
      e = 0
      f = 0
      constructor(_init?: string | number[]) {
        /* stub */
      }
      multiplySelf() {
        return this
      }
      invertSelf() {
        return this
      }
    } as unknown as typeof globalThis.DOMMatrix
  }
  if (typeof globalThis.Path2D === "undefined") {
    globalThis.Path2D = class Path2D {
      constructor(_path?: unknown) {
        /* stub */
      }
    } as unknown as typeof globalThis.Path2D
  }
}
