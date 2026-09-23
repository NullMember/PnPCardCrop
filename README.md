# PnPCardCrop

Client-side cropping for print-and-play files. Nothing is uploaded.

- **Grid crop** (`index.html`): cut cards out of PnP sheets — a PDF or images
  (any format the browser opens; one page per image, sized from its DPI) — on a grid, with
  front/back matching for duplex (long/short edge, portrait or landscape), back
  on the last page and fold layouts, grid offsets and PNG/JPEG/WebP export.
- **Freeform crop** (`freeform.html`): cut any shape out of scans or PDF pages.
  Detect every object at once, trace them one by one, or draw regions with the
  shared vector editor (rectangles, ellipses, pen, freehand, node editing).
  Each region is exported as a PNG with a transparent background and its DPI
  recorded; rotated rectangles come out straightened.

Part of [PnPTools](https://github.com/NullMember/PnPTools).
