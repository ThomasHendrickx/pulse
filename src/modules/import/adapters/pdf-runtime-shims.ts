// Guarded runtime shims for the PDF engine, SERVER SIDE ONLY, installed
// by the extraction adapter immediately before the engine chunks are
// imported (deploy-verify micro round 3).
//
// THE MEASURED MECHANISM, recorded so the next reader does not re-derive
// it: pdf.mjs's Node compatibility prelude polyfills DOMMatrix from the
// OPTIONAL NATIVE package "@napi-rs/canvas", fetched via
// process.getBuiltinModule("module").createRequire, and then the module
// scope evaluates `new DOMMatrix()` unconditionally. That chain has two
// independent ways to break, and both were observed: (a) Node below
// 20.16 has no process.getBuiltinModule, so the prelude cannot obtain
// require at all (reproduced locally: the production build under Node
// 18.20 fails module evaluation with "ReferenceError: DOMMatrix is not
// defined", the exact errorName the deployed probe reported); (b) the
// deployed function bundle carries ZERO files of the optional native
// package (measured: no @napi-rs path in the build's .nft.json trace),
// so on ANY Node version the deployed prelude has nothing to polyfill
// from. Text extraction never renders, so the full native canvas is not
// needed; what module evaluation needs is a DOMMatrix that exists and
// does correct 2D affine arithmetic.
//
// Discipline: each shim is GUARDED (defined only when missing, so a
// runtime or a future pdfjs that provides the real one always wins),
// minimal in surface (exactly the members the engine's reachable sites
// touch), and correct rather than stubbed, so a code path that does use
// it computes right numbers instead of quietly wrong ones.

type MatrixInit = readonly number[] | undefined;

// A correct 2D affine matrix in DOMMatrix's a,b,c,d,e,f layout, mapping
// (x, y) to (a*x + c*y + e, b*x + d*y + f).
class ShimDOMMatrix {
  a = 1;
  b = 0;
  c = 0;
  d = 1;
  e = 0;
  f = 0;

  constructor(init?: MatrixInit) {
    if (init !== undefined && init.length === 6) {
      [this.a, this.b, this.c, this.d, this.e, this.f] = init as [
        number,
        number,
        number,
        number,
        number,
        number,
      ];
    }
  }

  // this = this * other (DOMMatrix post-multiplication).
  multiplySelf(other: ShimDOMMatrix): this {
    const { a, b, c, d, e, f } = this;
    this.a = a * other.a + c * other.b;
    this.b = b * other.a + d * other.b;
    this.c = a * other.c + c * other.d;
    this.d = b * other.c + d * other.d;
    this.e = a * other.e + c * other.f + e;
    this.f = b * other.e + d * other.f + f;
    return this;
  }

  // this = other * this.
  preMultiplySelf(other: ShimDOMMatrix): this {
    const product = new ShimDOMMatrix([
      other.a,
      other.b,
      other.c,
      other.d,
      other.e,
      other.f,
    ]).multiplySelf(this);
    this.a = product.a;
    this.b = product.b;
    this.c = product.c;
    this.d = product.d;
    this.e = product.e;
    this.f = product.f;
    return this;
  }

  multiply(other: ShimDOMMatrix): ShimDOMMatrix {
    return new ShimDOMMatrix([this.a, this.b, this.c, this.d, this.e, this.f]).multiplySelf(
      other,
    );
  }

  translateSelf(tx = 0, ty = 0): this {
    return this.multiplySelf(new ShimDOMMatrix([1, 0, 0, 1, tx, ty]));
  }

  translate(tx = 0, ty = 0): ShimDOMMatrix {
    return this.multiply(new ShimDOMMatrix([1, 0, 0, 1, tx, ty]));
  }

  scaleSelf(sx = 1, sy?: number): this {
    return this.multiplySelf(new ShimDOMMatrix([sx, 0, 0, sy ?? sx, 0, 0]));
  }

  scale(sx = 1, sy?: number): ShimDOMMatrix {
    return this.multiply(new ShimDOMMatrix([sx, 0, 0, sy ?? sx, 0, 0]));
  }

  invertSelf(): this {
    const { a, b, c, d, e, f } = this;
    const determinant = a * d - b * c;
    if (determinant === 0) {
      this.a = this.b = this.c = this.d = this.e = this.f = NaN;
      return this;
    }
    this.a = d / determinant;
    this.b = -b / determinant;
    this.c = -c / determinant;
    this.d = a / determinant;
    this.e = (c * f - d * e) / determinant;
    this.f = (b * e - a * f) / determinant;
    return this;
  }

  inverse(): ShimDOMMatrix {
    return new ShimDOMMatrix([this.a, this.b, this.c, this.d, this.e, this.f]).invertSelf();
  }
}

// Installed once, idempotent by the guards themselves.
export const installPdfRuntimeShims = (): void => {
  const scope = globalThis as { DOMMatrix?: unknown };
  // Shim exactly what the reproduction named (ReferenceError: DOMMatrix
  // is not defined at engine module evaluation); nothing speculative.
  scope.DOMMatrix ??= ShimDOMMatrix;
};
