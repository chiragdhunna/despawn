import { sniffLoose, type FileType } from './sniff.js';

export type RenderErrorCode =
  | 'UNSUPPORTED'
  | 'PASSWORD_REQUIRED'
  | 'PASSWORD_INCORRECT'
  | 'TOO_LARGE'
  | 'TOO_MANY_PAGES'
  | 'CORRUPT';

export class RenderError extends Error {
  readonly code: RenderErrorCode;
  constructor(code: RenderErrorCode) {
    super(code);
    this.name = 'RenderError';
    this.code = code;
    Object.setPrototypeOf(this, RenderError.prototype);
  }
}

export interface RenderedPage {
  readonly canvas: HTMLCanvasElement;
  readonly width: number;
  readonly height: number;
}

export interface Source {
  readonly type: FileType;
  readonly pageCount: number;
  /** dpi only affects PDFs; images render at their natural size (capped). */
  renderPage(index: number, dpi?: number): Promise<RenderedPage>;
  destroy(): void;
}

export const MAX_FILE_BYTES = 60 * 1024 * 1024;
export const MAX_SOURCE_PAGES = 50;
const MAX_SIDE = 6000;
const MAX_AREA = 24_000_000;

function canvasOf(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function fitSize(w: number, h: number): { w: number; h: number } {
  const s = Math.min(1, MAX_SIDE / Math.max(w, h), Math.sqrt(MAX_AREA / (w * h)));
  return { w: Math.max(1, Math.round(w * s)), h: Math.max(1, Math.round(h * s)) };
}

async function openImage(file: Blob, type: FileType): Promise<Source> {
  const mime = type === 'svg' ? 'image/svg+xml' : `image/${type}`;
  const typed = new Blob([file], { type: mime });
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(typed);
  } catch {
    throw new RenderError('CORRUPT');
  }
  return {
    type,
    pageCount: 1,
    renderPage: () => {
      const size = fitSize(bitmap.width, bitmap.height);
      const c = canvasOf(size.w, size.h);
      const ctx = c.getContext('2d');
      if (ctx === null) {
        return Promise.reject(new RenderError('CORRUPT'));
      }
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(bitmap, 0, 0, size.w, size.h);
      return Promise.resolve({ canvas: c, width: size.w, height: size.h });
    },
    destroy: () => bitmap.close(),
  };
}

async function openPdf(file: Blob, dpi: number, password?: string): Promise<Source> {
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.min.mjs',
    import.meta.url,
  ).toString();
  const data = new Uint8Array(await file.arrayBuffer());
  const task = pdfjs.getDocument({
    data,
    password,
    enableXfa: false,
    useSystemFonts: true,
    stopAtErrors: false,
  });
  let doc: Awaited<typeof task.promise>;
  try {
    doc = await task.promise;
  } catch (e) {
    const name = (e as { name?: string }).name;
    const code = (e as { code?: number }).code;
    if (name === 'PasswordException') {
      throw new RenderError(code === 2 ? 'PASSWORD_INCORRECT' : 'PASSWORD_REQUIRED');
    }
    throw new RenderError('CORRUPT');
  }
  if (doc.numPages > MAX_SOURCE_PAGES) {
    void task.destroy();
    throw new RenderError('TOO_MANY_PAGES');
  }
  return {
    type: 'pdf',
    pageCount: doc.numPages,
    renderPage: async (index, dpiOverride) => {
      const useDpi = dpiOverride ?? dpi;
      const page = await doc.getPage(index + 1);
      const base = page.getViewport({ scale: useDpi / 72 });
      const size = fitSize(base.width, base.height);
      const viewport = page.getViewport({ scale: (useDpi / 72) * (size.w / base.width) });
      const canvas = canvasOf(Math.round(viewport.width), Math.round(viewport.height));
      const ctx = canvas.getContext('2d');
      if (ctx === null) {
        throw new RenderError('CORRUPT');
      }
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport, canvas }).promise;
      page.cleanup();
      return { canvas, width: canvas.width, height: canvas.height };
    },
    destroy: () => void task.destroy(),
  };
}

/** Opens any supported file. Type comes from the bytes, not the name. */
export async function openSource(
  file: Blob,
  opts: { dpi?: number; password?: string } = {},
): Promise<Source> {
  if (file.size > MAX_FILE_BYTES) {
    throw new RenderError('TOO_LARGE');
  }
  const head = new Uint8Array(await file.slice(0, 1100).arrayBuffer());
  const type = sniffLoose(head);
  if (type === 'unknown') {
    throw new RenderError('UNSUPPORTED');
  }
  if (type === 'pdf') {
    return openPdf(file, opts.dpi ?? 200, opts.password);
  }
  return openImage(file, type);
}
