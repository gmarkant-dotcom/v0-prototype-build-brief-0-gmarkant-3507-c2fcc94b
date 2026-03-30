/**
 * pdfjs-dist expects browser globals in some Node / serverless runtimes.
 * Call before importing `pdfjs-dist/legacy/build/pdf.mjs`.
 * instrumentation.ts also calls this so globals exist before any route loads.
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
      m11 = 1
      m12 = 0
      m21 = 0
      m22 = 1
      m41 = 0
      m42 = 0
      constructor(_init?: string | number[]) {
        /* stub — pdfjs may only read identity */
      }
      multiplySelf() {
        return this
      }
      preMultiplySelf() {
        return this
      }
      invertSelf() {
        return this
      }
      translateSelf() {
        return this
      }
      scaleSelf() {
        return this
      }
      rotateSelf() {
        return this
      }
      flipX() {
        return this
      }
      flipY() {
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

  if (typeof globalThis.ImageData === "undefined") {
    globalThis.ImageData = class ImageData {
      data: Uint8ClampedArray
      width: number
      height: number
      constructor(sw: number, sh: number)
      constructor(data: Uint8ClampedArray, sw: number, sh?: number)
      constructor(
        dataOrSw: Uint8ClampedArray | number,
        swOrSh: number,
        sh?: number
      ) {
        if (typeof dataOrSw === "number") {
          this.width = dataOrSw
          this.height = swOrSh
          this.data = new Uint8ClampedArray(this.width * this.height * 4)
        } else {
          this.data = dataOrSw
          this.width = swOrSh
          this.height = sh ?? 0
        }
      }
    } as unknown as typeof globalThis.ImageData
  }
}
