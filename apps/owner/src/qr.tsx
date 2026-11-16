import qrcode from 'qrcode-generator';

/** Renders text as a QR code made of <rect>s. No HTML injection: everything is built as elements. */
export function Qr({ text, label }: { text: string; label: string }) {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  const quiet = 4;
  const size = n + quiet * 2;
  const rects = [];
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (qr.isDark(r, c)) {
        rects.push(<rect key={`${r}-${c}`} x={c + quiet} y={r + quiet} width="1" height="1" />);
      }
    }
  }
  return (
    <svg
      className="qr"
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={label}
      shapeRendering="crispEdges"
    >
      <rect width={size} height={size} fill="#fff" />
      <g fill="#000">{rects}</g>
    </svg>
  );
}
