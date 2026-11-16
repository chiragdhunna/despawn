export const VERSION = '0.0.0';
export { PAPER_MM, CARD_MM, mmToPx, paperPx, type PaperSize } from './paper.js';
export {
  computePlacements,
  findContentBox,
  type LayoutKind,
  type Placement,
  type SheetSize,
  type SourceSize,
} from './layout.js';
export {
  PURPOSES,
  buildWatermarkText,
  tileGeometry,
  type StampStyle,
  type WatermarkText,
} from './watermark.js';
export {
  applyMode,
  composeSheet,
  drawWatermark,
  encodeCanvas,
  trimSource,
  type ColorMode,
  type ComposeOptions,
  type SourceImage,
} from './draw.js';
