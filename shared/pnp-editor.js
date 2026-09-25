// PnPTools vector editor — canonical copy lives in the hub's shared/ folder
// and is copied into tools by scripts/sync-shared.sh (needs pnp-shared.js,
// pathgeom.js and raster.js loaded first).
//
//   const editor = PnPEditor.create({
//     stage: el,            // canvas, rulers, tool palette, zoom bar
//     props: el,            // properties, arrange panel, undo/redo
//     options: el,          // tool options (trace/freehand), guide + import buttons
//     layers: [{ id, label, color }],   // first = default; a layer bar shows if > 1
//     tools: ['select', 'node', 'line', 'rect', 'ellipse', 'pen', 'freehand', 'trace'],
//     docSize: { w, h },    // document size in mm (the reference image fills it)
//     viewKey: 'pnp:…',     // localStorage key for grid/snap preferences
//     regionFill: 0.15,     // optional: fill closed shapes (click inside to select)
//     importSvg: true,      // optional: show "Import SVG…"
//     docName: 'page',      // optional: the document's name in hints (default 'card')
//   });
//
// All coordinates are millimetres. Shapes: { id, type: rect | ellipse | line |
// path, layer, x, y, w, h, rotation, ... } — see the "paths" section.

const PnPEditor = (() => {
  const ALL_TOOLS = ['select', 'node', 'line', 'rect', 'ellipse', 'pen', 'freehand', 'trace'];

  // ---------------------------------------------------------------- markup
  //
  // The editor builds its own canvas, palette, properties panel and dialogs
  // inside the containers the host page provides. Element ids are fixed,
  // so there is one editor per page.

  const TOOL_BUTTONS = [
    ['select', `<button type="button" data-tool="select" class="tool-btn" title="Select / move (V)" aria-label="Select / move (V)"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round" aria-hidden="true"><path d="M5 3l14 8-6 1.6L10 19z" fill="currentColor" stroke="none"/></svg></button>`],
    ['node', `<button type="button" data-tool="node" class="tool-btn" title="Edit nodes (A) — or double-click a shape" aria-label="Edit nodes (A) — or double-click a shape"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round" aria-hidden="true"><path d="M4 18C8 6 16 6 20 18"/><rect x="2.5" y="16.5" width="3" height="3" fill="currentColor"/><rect x="18.5" y="16.5" width="3" height="3" fill="currentColor"/><path d="M12 9L6 5"/><circle cx="6" cy="5" r="1.6" fill="currentColor"/></svg></button>`],
    null,
    ['line', `<button type="button" data-tool="line" class="tool-btn" title="Line (L) — Shift for 45° steps" aria-label="Line (L) — Shift for 45° steps"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round" aria-hidden="true"><path d="M5 19L19 5"/><circle cx="5" cy="19" r="1.8" fill="currentColor"/><circle cx="19" cy="5" r="1.8" fill="currentColor"/></svg></button>`],
    ['rect', `<button type="button" data-tool="rect" class="tool-btn" title="Rectangle (R) — Shift square, Alt from centre" aria-label="Rectangle (R) — Shift square, Alt from centre"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round" aria-hidden="true"><rect x="4" y="6" width="16" height="12" rx="1.5"/></svg></button>`],
    ['ellipse', `<button type="button" data-tool="ellipse" class="tool-btn" title="Ellipse (E) — Shift circle, Alt from centre" aria-label="Ellipse (E) — Shift circle, Alt from centre"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round" aria-hidden="true"><ellipse cx="12" cy="12" rx="8.5" ry="6.5"/></svg></button>`],
    ['pen', `<button type="button" data-tool="pen" class="tool-btn" title="Pen (P) — click for corners, drag for curves, click the first node to close, Enter to finish" aria-label="Pen (P) — click for corners, drag for curves, click the first node to close, Enter to finish"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round" aria-hidden="true"><path d="M4 20l3-8 6-6 5 5-6 6z"/><path d="M13 6l5 5"/><circle cx="9.5" cy="14.5" r="1.3" fill="currentColor"/></svg></button>`],
    ['freehand', `<button type="button" data-tool="freehand" class="tool-btn" title="Freehand (F) — draw, the line is smoothed on release" aria-label="Freehand (F) — draw, the line is smoothed on release"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round" aria-hidden="true"><path d="M3 17c3-6 5 2 8-4s5-6 10-3"/></svg></button>`],
    null,
    ['trace', `<button type="button" data-tool="trace" class="tool-btn" title="Trace (T) — click an object on the reference image to outline it" aria-label="Trace (T) — click an object on the reference image to outline it"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round" aria-hidden="true"><path d="M12 3v4M12 17v4M3 12h4M17 12h4"/><circle cx="12" cy="12" r="5" stroke-dasharray="2.5 2"/></svg></button>`],
  ];

  function stageMarkup(o) {
    const layers = o.layers.length > 1 ? `
        <div class="canvas-topbar">
          <span class="canvas-topbar-label">Layer</span>
          <div class="layer-bar" id="layerBar">
            ${o.layers.map((l, i) => `
            <div class="layer-row" data-layer="${l.id}">
              <input type="checkbox" data-vis="${l.id}" checked title="Show ${l.label} layer">
              <input type="color" class="layer-color" data-layer="${l.id}" value="${l.color}" title="${l.label} line colour">
              <button type="button" class="layer-btn${i === 0 ? ' active' : ''}" data-layer="${l.id}">${l.label}</button>
            </div>`).join('')}
          </div>
        </div>` : '<div class="layer-bar" id="layerBar" hidden></div>';
    // Palette: requested tools in the standard order, separators between groups.
    const items = [];
    TOOL_BUTTONS.forEach((t) => {
      if (t === null) { if (items.length && items[items.length - 1] !== null) items.push(null); return; }
      if (o.tools.includes(t[0])) items.push(t);
    });
    while (items.length && items[items.length - 1] === null) items.pop();
    const palette = items.map((t) => (t === null
      ? '<span class="tool-sep" aria-hidden="true"></span>'
      : t[1].replace('class="tool-btn"', `class="tool-btn${t[0] === 'select' ? ' active' : ''}"`))).join('\n            ');
    return `
      <div class="canvas-stage">${layers}
        <div class="canvas-body">
          <div class="canvas-toolbar-left" id="toolButtons" role="toolbar" aria-label="Drawing tools">
            ${palette}
          </div>
          <div class="canvas-area">
            <div class="ruler-corner" aria-hidden="true"></div>
            <canvas class="ruler ruler-h" id="rulerH" title="Drag down to add a horizontal guide"></canvas>
            <canvas class="ruler ruler-v" id="rulerV" title="Drag right to add a vertical guide"></canvas>
            <div class="canvas-wrap" id="canvasWrap"></div>
          </div>
          <div class="canvas-toolbar">
            <button type="button" id="zoomOutBtn" class="zoom-btn" title="Zoom out (Ctrl/Cmd -)">&minus;</button>
            <span id="zoomLevel" class="zoom-level">100%</span>
            <button type="button" id="zoomInBtn" class="zoom-btn" title="Zoom in (Ctrl/Cmd +)">+</button>
            <span class="zoom-sep"></span>
            <button type="button" id="zoomResetBtn" class="zoom-btn zoom-btn-wide" title="Zoom to 100% (Ctrl/Cmd 0)">100%</button>
            <button type="button" id="zoomFitBtn" class="zoom-btn zoom-btn-wide" title="Fit to screen (Shift 1)">Fit</button>
            <span class="zoom-sep"></span>
            <button type="button" id="gridBtn" class="zoom-btn toggle-btn" aria-pressed="false" title="Show grid and snap to it (G)" aria-label="Grid"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M4 4h16v16H4zM9.3 4v16M14.7 4v16M4 9.3h16M4 14.7h16"/></svg></button>
            <label class="grid-size" title="Grid spacing"><input type="number" id="gridSize" data-unit="mm" value="5" min="0.1" max="100" step="0.5" aria-label="Grid spacing (mm)"><span class="grid-unit">(mm)</span></label>
            <button type="button" id="snapBtn" class="zoom-btn toggle-btn" aria-pressed="true" title="Snapping to grid, shapes and card edges (S). Hold Alt to bypass while dragging." aria-label="Snapping"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M6 4v8a6 6 0 0 0 12 0V4"/><path d="M6 8h4M14 8h4"/></svg></button>
          </div>
        </div>
      </div>`;
  }

  function propsMarkup(o) {
    const layerOptions = o.layers.map((l) => `<option value="${l.id}">${l.label}</option>`).join('');
    const single = o.layers.length === 1 ? ' hidden' : '';
    return `
        <div id="propsEmpty" class="props-empty">No shape selected.</div>
        <div id="propsForm" class="props-form" hidden>
          <div class="control-group"${single}>
            <label for="propLayer">Layer</label>
            <select id="propLayer">${layerOptions}</select>
          </div>
          <div class="control-group" id="propXWrap">
            <label for="propX">X (mm)</label>
            <input type="number" id="propX" data-unit="mm" step="0.1">
          </div>
          <div class="control-group" id="propYWrap">
            <label for="propY">Y (mm)</label>
            <input type="number" id="propY" data-unit="mm" step="0.1">
          </div>
          <div class="control-group" id="propWWrap">
            <label for="propW">Width (mm)</label>
            <input type="number" id="propW" data-unit="mm" step="0.1">
          </div>
          <div class="control-group" id="propHWrap">
            <label for="propH">Height (mm)</label>
            <input type="number" id="propH" data-unit="mm" step="0.1">
          </div>
          <div class="control-group" id="propRadiusWrap" hidden>
            <label for="propRadius">Corner radius (mm)</label>
            <input type="number" id="propRadius" data-unit="mm" step="0.1" min="0">
          </div>
          <div class="row" id="propLineWrap" hidden>
            <div class="control-group">
              <label for="propLen">Length (mm)</label>
              <input type="number" id="propLen" data-unit="mm" step="0.1" min="0">
            </div>
            <div class="control-group">
              <label for="propAngle">Angle (°)</label>
              <input type="number" id="propAngle" step="1">
            </div>
          </div>
          <div class="control-group" id="propRotWrap">
            <label for="propRot">Rotation (deg)</label>
            <input type="number" id="propRot" step="1">
          </div>
          <div class="button-group">
            <button type="button" id="deleteShapeBtn" class="btn-secondary danger">Delete shape</button>
          </div>
        </div>


        <div class="arrange-panel" id="arrangePanel" hidden>
          <div class="arrange-title">Arrange <span class="input-hint">— one shape aligns to the ${o.docName}</span></div>
          <div class="arrange-row">
            <button type="button" class="arrange-btn" data-arrange="align:left" title="Align left" aria-label="Align left"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 3v18"/><rect x="7" y="6" width="10" height="4"/><rect x="7" y="14" width="6" height="4"/></svg></button>
            <button type="button" class="arrange-btn" data-arrange="align:hcenter" title="Align centres horizontally" aria-label="Align centres horizontally"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v18"/><rect x="6" y="6" width="12" height="4"/><rect x="8" y="14" width="8" height="4"/></svg></button>
            <button type="button" class="arrange-btn" data-arrange="align:right" title="Align right" aria-label="Align right"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 3v18"/><rect x="7" y="6" width="10" height="4"/><rect x="11" y="14" width="6" height="4"/></svg></button>
            <button type="button" class="arrange-btn" data-arrange="align:top" title="Align top" aria-label="Align top"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 4h18"/><rect x="6" y="7" width="4" height="10"/><rect x="14" y="7" width="4" height="6"/></svg></button>
            <button type="button" class="arrange-btn" data-arrange="align:vcenter" title="Align middles vertically" aria-label="Align middles vertically"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12h18"/><rect x="6" y="6" width="4" height="12"/><rect x="14" y="8" width="4" height="8"/></svg></button>
            <button type="button" class="arrange-btn" data-arrange="align:bottom" title="Align bottom" aria-label="Align bottom"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 20h18"/><rect x="6" y="7" width="4" height="10"/><rect x="14" y="11" width="4" height="6"/></svg></button>
          </div>
          <div class="arrange-row">
            <button type="button" class="arrange-btn" data-arrange="distribute:x" title="Distribute horizontally (3+ shapes)" aria-label="Distribute horizontally (3+ shapes)"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 4v16M21 4v16"/><rect x="9" y="8" width="6" height="8"/></svg></button>
            <button type="button" class="arrange-btn" data-arrange="distribute:y" title="Distribute vertically (3+ shapes)" aria-label="Distribute vertically (3+ shapes)"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 3h16M4 21h16"/><rect x="8" y="9" width="8" height="6"/></svg></button>
            <button type="button" class="arrange-btn" data-arrange="flip:x" title="Flip horizontally (Shift+H)" aria-label="Flip horizontally (Shift+H)"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v18"/><path d="M9 7L4 12l5 5z"/><path d="M15 7l5 5-5 5z"/></svg></button>
            <button type="button" class="arrange-btn" data-arrange="flip:y" title="Flip vertically (Shift+V)" aria-label="Flip vertically (Shift+V)"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12h18"/><path d="M7 9l5-5 5 5z"/><path d="M7 15l5 5 5-5z"/></svg></button>
            <button type="button" class="arrange-btn" data-arrange="rotate:-90" title="Rotate 90° counter-clockwise" aria-label="Rotate 90° counter-clockwise"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9a8 8 0 1 1 1 7"/><path d="M4 4v5h5"/></svg></button>
            <button type="button" class="arrange-btn" data-arrange="rotate:90" title="Rotate 90° clockwise" aria-label="Rotate 90° clockwise"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 9a8 8 0 1 0-1 7"/><path d="M20 4v5h-5"/></svg></button>
          </div>
          <div class="arrange-row">
            <button type="button" class="arrange-btn" data-arrange="order:front" title="Bring to front (Ctrl+Shift+])" aria-label="Bring to front (Ctrl+Shift+])"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="8" y="8" width="12" height="12" fill="currentColor"/><rect x="4" y="4" width="10" height="10"/></svg></button>
            <button type="button" class="arrange-btn" data-arrange="order:forward" title="Bring forward (Ctrl+])" aria-label="Bring forward (Ctrl+])"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5M6 11l6-6 6 6"/></svg></button>
            <button type="button" class="arrange-btn" data-arrange="order:backward" title="Send backward (Ctrl+[)" aria-label="Send backward (Ctrl+[)"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14M6 13l6 6 6-6"/></svg></button>
            <button type="button" class="arrange-btn" data-arrange="order:back" title="Send to back (Ctrl+Shift+[)" aria-label="Send to back (Ctrl+Shift+[)"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="4" width="12" height="12" fill="currentColor"/><rect x="10" y="10" width="10" height="10"/></svg></button>
            <button type="button" class="arrange-btn" data-arrange="duplicate" title="Duplicate (Ctrl+D)" aria-label="Duplicate (Ctrl+D)"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="4" width="11" height="11"/><rect x="9" y="9" width="11" height="11"/></svg></button>
            <button type="button" class="arrange-btn" data-arrange="nodes" title="Edit nodes (A / Enter)" aria-label="Edit nodes (A / Enter)"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 18C8 6 16 6 20 18"/><rect x="2.5" y="16.5" width="3" height="3" fill="currentColor"/><rect x="18.5" y="16.5" width="3" height="3" fill="currentColor"/></svg></button>
          </div>
          <div class="arrange-row wide">
            <button type="button" class="btn-secondary btn-small" data-arrange="array" title="Repeat the selection in a grid or around a circle">Repeat…</button>
            <button type="button" class="btn-secondary btn-small" data-arrange="offset">Offset…</button>
          </div>
        </div>
        <div class="history-buttons">
          <button type="button" id="undoBtn" class="btn-secondary" title="Ctrl/Cmd+Z">Undo</button>
          <button type="button" id="redoBtn" class="btn-secondary" title="Ctrl/Cmd+Shift+Z">Redo</button>
        </div>

        <p class="input-hint">Delete = remove selected shape &middot; Arrow keys = nudge 0.1mm (1mm with shift) &middot; Ctrl/Cmd+A select all, +C copy, +X cut, +V paste</p>`;
  }

  function optionsMarkup(o) {
    const traceOpts = o.tools.includes('trace') ? `<div class="control-group">
          <label for="traceTolerance">Trace: colour tolerance</label>
          <input type="range" id="traceTolerance" min="5" max="150" value="40">
          <div class="input-hint">How different from the background a pixel must be to count as part of the object.</div>
        </div>
        <div class="row">
          <div class="control-group">
            <label for="traceSmoothing">Trace smoothing (mm)</label>
            <input type="number" id="traceSmoothing" data-unit="mm" value="0.3" min="0.05" max="3" step="0.05">
          </div>
          <div class="control-group">
            <label for="freehandSmoothing">Freehand smoothing (mm)</label>
            <input type="number" id="freehandSmoothing" data-unit="mm" value="0.4" min="0.05" max="5" step="0.05">
          </div>
        
        </div>` : '';
    // Shown once the reference image turns out to have transparent pixels.
    const layerOptions = o.layers.map((l) => `<option value="${l.id}">${l.label}</option>`).join('');
    const alphaOpts = o.tools.includes('trace') ? `
        <div class="alpha-panel" id="alphaPanel" hidden>
          <div class="editor-subtitle">Transparent image</div>
          <div class="input-hint">Turn the edges between transparent and opaque pixels into shapes, or pick the Trace tool (T) and click one object.</div>
          <div class="control-group"${o.layers.length === 1 ? ' hidden' : ''}>
            <label for="alphaLayer">Put outlines on</label>
            <select id="alphaLayer">${layerOptions}</select>
          </div>
          <label class="inline"><input type="checkbox" id="alphaHoles" checked> Include holes (transparent areas inside)</label>
          <button type="button" id="alphaTraceBtn" class="btn-secondary btn-small">Outline transparent edges</button>
        </div>` : '';
    const importOpts = o.importSvg ? `
        <div class="control-group editor-import">
          <div class="editor-subtitle">Import SVG</div>
          <div class="dropzone dropzone-compact" id="importSvgDrop">
            <div class="dz-title">Drop SVG files here</div>
            <div>or click to browse</div>
            <input type="file" id="importSvgInput" accept=".svg,image/svg+xml" multiple hidden>
          </div>
          <div id="importList" class="import-list"></div>
        </div>` : '';
    return `${traceOpts}${alphaOpts}
        <button type="button" id="clearGuidesBtn" class="btn-secondary btn-small">Clear guides</button>${importOpts}`;
  }

  function dialogsMarkup(o) {
    const layerOptions = o.layers.map((l) => `<option value="${l.id}">${l.label}</option>`).join('');
    return `<dialog class="pnp-dialog" id="arrayDialog" aria-labelledby="arrayTitle">
  <h2 id="arrayTitle">Repeat selection</h2>
  <div class="control-group">
    <label for="arrayMode">Pattern</label>
    <select id="arrayMode">
      <option value="grid">Grid (rows × columns)</option>
      <option value="circle">Circle (around a point)</option>
    </select>
  </div>
  <div id="arrayGridFields">
    <div class="row">
      <div class="control-group"><label for="arrayRows">Rows</label><input type="number" id="arrayRows" value="2" min="1" max="100" step="1"></div>
      <div class="control-group"><label for="arrayCols">Columns</label><input type="number" id="arrayCols" value="2" min="1" max="100" step="1"></div>
    </div>
    <div class="control-group">
      <label for="arraySpacing">Distances are</label>
      <select id="arraySpacing">
        <option value="gap">Gaps between copies</option>
        <option value="pitch">Centre-to-centre distances</option>
      </select>
    </div>
    <div class="row">
      <div class="control-group"><label for="arrayGapX">Between columns (mm)</label><input type="number" id="arrayGapX" data-unit="mm" value="2" step="0.5"></div>
      <div class="control-group"><label for="arrayGapY">Between rows (mm)</label><input type="number" id="arrayGapY" data-unit="mm" value="2" step="0.5"></div>
    </div>
  </div>
  <div id="arrayCircleFields" hidden>
    <div class="row">
      <div class="control-group"><label for="arrayCount">Copies in total</label><input type="number" id="arrayCount" value="6" min="2" max="360" step="1"></div>
      <div class="control-group"><label for="arrayAngle">Spread (°)</label><input type="number" id="arrayAngle" value="360" min="-360" max="360" step="15"></div>
    </div>
    <div class="control-group">
      <label for="arrayCenter">Around</label>
      <select id="arrayCenter">
        <option value="card">Card centre</option>
        <option value="selection">Selection centre</option>
        <option value="custom">A point…</option>
      </select>
    </div>
    <div class="row" id="arrayCustomCenter" hidden>
      <div class="control-group"><label for="arrayCx">Centre X (mm)</label><input type="number" id="arrayCx" data-unit="mm" value="31.5" step="0.5"></div>
      <div class="control-group"><label for="arrayCy">Centre Y (mm)</label><input type="number" id="arrayCy" data-unit="mm" value="44" step="0.5"></div>
    </div>
    <label class="inline"><input type="checkbox" id="arrayRotate" checked> Rotate copies to follow the circle</label>
  </div>
  <p class="input-hint" id="arrayInfo"></p>
  <div class="dialog-actions">
    <button type="button" class="btn-secondary" id="arrayCancel">Cancel</button>
    <button type="button" class="btn-primary" id="arrayCreate">Create copies</button>
  </div>
</dialog>

<dialog class="pnp-dialog" id="offsetDialog" aria-labelledby="offsetTitle">
  <h2 id="offsetTitle">Offset path</h2>
  <p class="input-hint">Creates a new outline at a fixed distance from the selected shapes: positive grows, negative shrinks. Holes are ignored; open lines get a band around them.</p>
  <div class="row">
    <div class="control-group"><label for="offsetDist">Distance (mm)</label><input type="number" id="offsetDist" data-unit="mm" value="2" step="0.25"></div>
    <div class="control-group">
      <label for="offsetLayer">Layer</label>
      <select id="offsetLayer">
        <option value="same">Same as original</option>${layerOptions}</select>
    </div>
  </div>
  <div class="dialog-actions">
    <button type="button" class="btn-secondary" id="offsetCancel">Cancel</button>
    <button type="button" class="btn-primary" id="offsetCreate">Create offset</button>
  </div>
</dialog>`;
  }

  function create(opts) {
      const o = {
        layers: [{ id: 'cut', label: 'Cut', color: '#c0392b' }],
        tools: ALL_TOOLS,
        docSize: { w: 63, h: 88 },
        viewKey: 'pnp:editor:view',
        regionFill: 0,
        importSvg: false,
        ...opts,
      };
      const LAYER_IDS = o.layers.map((l) => l.id);
      o.stage.innerHTML = stageMarkup(o);
      o.props.innerHTML = propsMarkup(o);
      if (o.options) o.options.innerHTML = optionsMarkup(o);
      const dialogHost = document.createElement('div');
      dialogHost.innerHTML = dialogsMarkup(o);
      document.body.append(...dialogHost.children);
      if (window.PnP) {
        [o.stage, o.props, o.options, document.body].forEach((el) => el && PnP.units.scan(el));
        PnP.units.relabel();
      }

    const SVG_NS = 'http://www.w3.org/2000/svg';
    const PX_PER_MM = 6;
    const ROTATE_HANDLE_OFFSET = 9;
    const MIN_SIZE = 0.5;
    const MIN_ZOOM = 0.1;
    const MAX_ZOOM = 16;
    const SNAP_PX = 8;
    const HANDLE_R_PX = 6;

    const $ = (id) => document.getElementById(id);

    const els = {
      toolButtons: $('toolButtons'),
      layerBar: $('layerBar'),
      canvasWrap: $('canvasWrap'),
      propsEmpty: $('propsEmpty'),
      propsForm: $('propsForm'),
      propLayer: $('propLayer'),
      propX: $('propX'),
      propY: $('propY'),
      propW: $('propW'),
      propH: $('propH'),
      propRadiusWrap: $('propRadiusWrap'),
      propRadius: $('propRadius'),
      propRot: $('propRot'),
      propWWrap: $('propWWrap'),
      propHWrap: $('propHWrap'),
      propRotWrap: $('propRotWrap'),
      propLineWrap: $('propLineWrap'),
      arrangePanel: $('arrangePanel'),
      arrayDialog: $('arrayDialog'),
      arrayMode: $('arrayMode'),
      arrayGridFields: $('arrayGridFields'),
      arrayCircleFields: $('arrayCircleFields'),
      arrayCustomCenter: $('arrayCustomCenter'),
      arrayRows: $('arrayRows'),
      arrayCols: $('arrayCols'),
      arrayGapX: $('arrayGapX'),
      arrayGapY: $('arrayGapY'),
      arraySpacing: $('arraySpacing'),
      arrayCount: $('arrayCount'),
      arrayAngle: $('arrayAngle'),
      arrayCenter: $('arrayCenter'),
      arrayCx: $('arrayCx'),
      arrayCy: $('arrayCy'),
      arrayRotate: $('arrayRotate'),
      arrayInfo: $('arrayInfo'),
      arrayCreate: $('arrayCreate'),
      arrayCancel: $('arrayCancel'),
      offsetDialog: $('offsetDialog'),
      offsetDist: $('offsetDist'),
      offsetLayer: $('offsetLayer'),
      offsetCreate: $('offsetCreate'),
      offsetCancel: $('offsetCancel'),
      propLen: $('propLen'),
      propAngle: $('propAngle'),
      deleteShapeBtn: $('deleteShapeBtn'),
      undoBtn: $('undoBtn'),
      redoBtn: $('redoBtn'),
      zoomOutBtn: $('zoomOutBtn'),
      zoomInBtn: $('zoomInBtn'),
      zoomResetBtn: $('zoomResetBtn'),
      zoomFitBtn: $('zoomFitBtn'),
      rulerH: $('rulerH'),
      rulerV: $('rulerV'),
      clearGuidesBtn: $('clearGuidesBtn'),
      importSvgDrop: $('importSvgDrop'),
      importSvgInput: $('importSvgInput'),
      importList: $('importList'),
      alphaPanel: $('alphaPanel'),
      alphaLayer: $('alphaLayer'),
      alphaHoles: $('alphaHoles'),
      alphaTraceBtn: $('alphaTraceBtn'),
      zoomLevel: $('zoomLevel'),
      snapBtn: $('snapBtn'),
      traceTolerance: $('traceTolerance'),
      traceSmoothing: $('traceSmoothing'),
      freehandSmoothing: $('freehandSmoothing'),
      gridBtn: $('gridBtn'),
      gridSize: $('gridSize'),
    };

    const state = {
      cardW: o.docSize.w,
      cardH: o.docSize.h,
      imageDataUrl: null,
      imageVisible: true,
      imageHasAlpha: false,
      tool: 'select',
      activeLayer: o.layers[0].id,
      layerVisible: Object.fromEntries(o.layers.map((l) => [l.id, true])),
      layerColors: Object.fromEntries(o.layers.map((l) => [l.id, l.color])),
      shapes: [],
      nextId: 1,
      selectedIds: [],
      zoom: 1,
      guides: [], // [{ axis: 'x' | 'y', pos }] ruler guides, in mm
    };

    let history = [];
    let historyIndex = -1;

    // Canvas view preferences, remembered in this browser.
    const VIEW_KEY = o.viewKey;
    const view = (() => {
      const defaults = { snap: true, grid: false, gridSize: 5 };
      try {
        return { ...defaults, ...JSON.parse(localStorage.getItem(VIEW_KEY) || '{}') };
      } catch (e) {
        return defaults;
      }
    })();
    function saveView() {
      try { localStorage.setItem(VIEW_KEY, JSON.stringify(view)); } catch (e) { /* ignore */ }
    }
    let snapEnabled = view.snap;

    // Holding Ctrl/Cmd while dragging bypasses snapping for that gesture.
    function snapOnFor(evt) {
      return snapEnabled && !(evt && (evt.ctrlKey || evt.metaKey));
    }

    function gridStep() {
      return view.grid && view.gridSize > 0 ? view.gridSize : 0;
    }

    // ---------- geometry helpers ----------

    function rotateVec(v, deg) {
      const r = (deg * Math.PI) / 180;
      const cos = Math.cos(r), sin = Math.sin(r);
      return { x: v.x * cos - v.y * sin, y: v.x * sin + v.y * cos };
    }

    function worldCenter(shape) {
      return { x: shape.x + shape.w / 2, y: shape.y + shape.h / 2 };
    }

    function worldFromLocal(shape, Lp) {
      const wc = worldCenter(shape);
      const lc = { x: shape.w / 2, y: shape.h / 2 };
      const rv = rotateVec({ x: Lp.x - lc.x, y: Lp.y - lc.y }, shape.rotation);
      return { x: wc.x + rv.x, y: wc.y + rv.y };
    }

    function localFromWorld(shape, Wp) {
      const wc = worldCenter(shape);
      const lc = { x: shape.w / 2, y: shape.h / 2 };
      const rv = rotateVec({ x: Wp.x - wc.x, y: Wp.y - wc.y }, -shape.rotation);
      return { x: lc.x + rv.x, y: lc.y + rv.y };
    }

    // ---------- paths ----------
    //
    // A 'path' shape stores its nodes as fractions of its box (like the old
    // polygon points), so moving, resizing and rotating work unchanged:
    //   nodes: [{ fx, fy, hi?: {fx, fy}, ho?: {fx, fy}, smooth? }], closed
    // Editing happens in the shape's local (unrotated, mm) frame via
    // localPath() / setLocalPath(); PathGeom does the curve maths.

    function localPath(shape) {
      const f = (p) => ({ x: p.fx * shape.w, y: p.fy * shape.h });
      return {
        closed: !!shape.closed,
        nodes: shape.nodes.map((n) => {
          const o = f(n);
          if (n.hi) o.hi = f(n.hi);
          if (n.ho) o.ho = f(n.ho);
          if (n.smooth) o.smooth = true;
          return o;
        }),
      };
    }

    function worldPath(shape) {
      return PathGeom.mapPath(localPath(shape), (p) => worldFromLocal(shape, p));
    }

    // Replace a path's geometry (local-frame mm) and re-fit its box to the curve
    // without moving anything on the card.
    function setLocalPath(shape, path) {
      const b = PathGeom.bounds(PathGeom.flatten(path));
      const w = Math.max(b.w, 1e-3), h = Math.max(b.h, 1e-3);
      const c = worldFromLocal(shape, { x: b.x + b.w / 2, y: b.y + b.h / 2 });
      const f = (p) => ({ fx: (p.x - b.x) / w, fy: (p.y - b.y) / h });
      shape.nodes = path.nodes.map((n) => {
        const o = f(n);
        if (n.hi) o.hi = f(n.hi);
        if (n.ho) o.ho = f(n.ho);
        if (n.smooth) o.smooth = true;
        return o;
      });
      shape.closed = !!path.closed;
      shape.w = w; shape.h = h;
      shape.x = c.x - w / 2; shape.y = c.y - h / 2;
    }

    // New path shape from card-space (world) coordinates.
    function makePathShape(path, layer) {
      const shape = { id: state.nextId++, type: 'path', layer: layer || state.activeLayer, x: 0, y: 0, w: 1, h: 1, rotation: 0, nodes: [], closed: false };
      setLocalPath(shape, path); // with x = y = 0 and no rotation, local == world
      return shape;
    }

    // Older projects stored polygons; they are paths without curves.
    function migrateShape(shape) {
      if (shape.type === 'polygon' && shape.points) {
        shape.type = 'path';
        shape.closed = true;
        shape.nodes = shape.points.map((p) => ({ fx: p.fx, fy: p.fy }));
        delete shape.points;
      }
      return shape;
    }

    // Rect / ellipse / line -> equivalent path (same box and rotation), for node editing.
    function convertToPath(shape) {
      if (shape.type === 'path') return shape;
      const sn = shape.type === 'polygon' ? null : PathGeom.shapeNodes(shape);
      if (!sn) return shape;
      const { nodes, closed } = sn;
      shape.type = 'path';
      shape.nodes = nodes;
      shape.closed = closed;
      delete shape.radius;
      delete shape.diag;
      return shape;
    }

    function normBox(x1, y1, x2, y2) {
      return {
        x: Math.min(x1, x2),
        y: Math.min(y1, y2),
        w: Math.abs(x2 - x1),
        h: Math.abs(y2 - y1),
      };
    }

    // ---------- snapping ----------

    function snapThresholdMm() {
      return SNAP_PX / (PX_PER_MM * state.zoom);
    }

    function shapePoints(shape) {
      const local = [
        { x: 0, y: 0 }, { x: shape.w, y: 0 }, { x: shape.w, y: shape.h }, { x: 0, y: shape.h },
        { x: shape.w / 2, y: 0 }, { x: shape.w, y: shape.h / 2 }, { x: shape.w / 2, y: shape.h }, { x: 0, y: shape.h / 2 },
        { x: shape.w / 2, y: shape.h / 2 },
      ];
      if (shape.type === 'line') {
        const p1 = shape.diag === 'tlbr' ? { x: 0, y: 0 } : { x: shape.w, y: 0 };
        const p2 = shape.diag === 'tlbr' ? { x: shape.w, y: shape.h } : { x: 0, y: shape.h };
        local.push(p1, p2);
      }
      if (shape.type === 'path' && shape.nodes) {
        shape.nodes.forEach((p) => local.push({ x: p.fx * shape.w, y: p.fy * shape.h }));
      }
      return local.map((lp) => worldFromLocal(shape, lp));
    }

    function collectSnapCandidates(excludeIds) {
      const pts = [];
      const cw = state.cardW, ch = state.cardH;
      [0, cw / 2, cw].forEach((x) => [0, ch / 2, ch].forEach((y) => pts.push({ x, y })));
      // Ruler guides snap along one axis only (NaN never wins a comparison).
      state.guides.forEach((g) => pts.push(g.axis === 'x' ? { x: g.pos, y: NaN } : { x: NaN, y: g.pos }));
      state.shapes.forEach((shape) => {
        if (excludeIds.includes(shape.id)) return;
        pts.push(...shapePoints(shape));
      });
      return pts;
    }

    function resolvePointSnap(rawPoint, excludeIds, enabled, extraPoints) {
      if (!enabled) return { x: rawPoint.x, y: rawPoint.y, guides: [] };
      const thresh = snapThresholdMm();
      const candidates = collectSnapCandidates(excludeIds).concat(extraPoints || []);
      let bestX = null, bestXDist = thresh;
      let bestY = null, bestYDist = thresh;
      candidates.forEach((c) => {
        const dx = Math.abs(c.x - rawPoint.x);
        if (dx < bestXDist) { bestXDist = dx; bestX = c.x; }
        const dy = Math.abs(c.y - rawPoint.y);
        if (dy < bestYDist) { bestYDist = dy; bestY = c.y; }
      });
      const guides = [];
      if (bestX != null) guides.push({ type: 'v', x: bestX });
      if (bestY != null) guides.push({ type: 'h', y: bestY });
      // Grid lines are candidates too, but a closer shape/edge still wins, and
      // grid snaps draw no guide line (the grid itself shows where it went).
      const g = gridStep();
      if (g) {
        const gx = Math.round(rawPoint.x / g) * g;
        const gy = Math.round(rawPoint.y / g) * g;
        if (Math.abs(gx - rawPoint.x) < bestXDist) { bestX = gx; guides.push({ type: 'grid' }); }
        if (Math.abs(gy - rawPoint.y) < bestYDist) { bestY = gy; guides.push({ type: 'grid' }); }
      }
      return { x: bestX != null ? bestX : rawPoint.x, y: bestY != null ? bestY : rawPoint.y, guides };
    }

    // The 8 octant directions for 45deg-step constraining, as exact
    // coordinates rather than cos/sin of a reconstructed angle: Math.PI isn't
    // exactly pi, so e.g. Math.sin(Math.round(...) * (Math.PI/4)) for a
    // "horizontal" 180deg step comes out ~1e-16 instead of exactly 0. That
    // tiny residue used to survive as a non-zero shape.h/w on straight lines
    // and get floored back up to MIN_SIZE by group-scale, kinking the line.
    const OCTANT_DIRS = [
      { x: 1, y: 0 }, { x: Math.SQRT1_2, y: Math.SQRT1_2 },
      { x: 0, y: 1 }, { x: -Math.SQRT1_2, y: Math.SQRT1_2 },
      { x: -1, y: 0 }, { x: -Math.SQRT1_2, y: -Math.SQRT1_2 },
      { x: 0, y: -1 }, { x: Math.SQRT1_2, y: -Math.SQRT1_2 },
    ];

    // Constrains a point to 45deg steps from `fixed`, while still letting the
    // distance along that locked direction snap to nearby points that lie
    // close to the line (so Shift-straightening a line doesn't kill snapping).
    function angleConstrainedPoint(fixed, rawPoint, excludeIds, enabled) {
      const dx = rawPoint.x - fixed.x, dy = rawPoint.y - fixed.y;
      const octant = ((Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) % 8) + 8) % 8;
      const dir = OCTANT_DIRS[octant];
      let t = dx * dir.x + dy * dir.y;
      const guides = [];
      if (enabled) {
        const thresh = snapThresholdMm();
        let bestT = null, bestDist = thresh, bestPoint = null;
        collectSnapCandidates(excludeIds).forEach((c) => {
          const vx = c.x - fixed.x, vy = c.y - fixed.y;
          const ct = vx * dir.x + vy * dir.y;
          const perp = Math.abs(vx * dir.y - vy * dir.x);
          if (perp < thresh) {
            const d = Math.abs(ct - t);
            if (d < bestDist) { bestDist = d; bestT = ct; bestPoint = c; }
          }
        });
        if (bestT != null) {
          t = bestT;
          guides.push({ type: 'v', x: bestPoint.x }, { type: 'h', y: bestPoint.y });
        }
      }
      return { point: { x: fixed.x + dir.x * t, y: fixed.y + dir.y * t }, guides };
    }

    function boxesIntersect(a, b) {
      return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
    }

    // Shared core: given a set of world points that would move rigidly together
    // and a set of candidate points to align to, finds the single best x/y
    // offset (independently per axis) that would snap ANY of those points onto
    // a candidate. Used for both single-shape and whole-group moves so every
    // member of a group gets to contribute its own edges/corners, not just one.
    function snapOffsetForPoints(points, candidates, thresh) {
      let bestDx = 0, bestDxAbs = thresh, bestDxGuide = null;
      let bestDy = 0, bestDyAbs = thresh, bestDyGuide = null;
      points.forEach((p) => {
        candidates.forEach((c) => {
          const dx = c.x - p.x;
          if (Math.abs(dx) < bestDxAbs) { bestDxAbs = Math.abs(dx); bestDx = dx; bestDxGuide = c.x; }
          const dy = c.y - p.y;
          if (Math.abs(dy) < bestDyAbs) { bestDyAbs = Math.abs(dy); bestDy = dy; bestDyGuide = c.y; }
        });
      });
      // Any of the moving points may also land on a grid line.
      const g = gridStep();
      if (g) {
        points.forEach((p) => {
          const dx = Math.round(p.x / g) * g - p.x;
          if (Math.abs(dx) < bestDxAbs) { bestDxAbs = Math.abs(dx); bestDx = dx; bestDxGuide = null; }
          const dy = Math.round(p.y / g) * g - p.y;
          if (Math.abs(dy) < bestDyAbs) { bestDyAbs = Math.abs(dy); bestDy = dy; bestDyGuide = null; }
        });
      }
      const guides = [];
      if (bestDxGuide != null) guides.push({ type: 'v', x: bestDxGuide });
      if (bestDyGuide != null) guides.push({ type: 'h', y: bestDyGuide });
      return { dx: bestDx, dy: bestDy, guides };
    }

    function snapMoveShape(shape, rawX, rawY, enabled, excludeIds) {
      if (!enabled) return { x: rawX, y: rawY, guides: [] };
      const thresh = snapThresholdMm();
      const candidates = collectSnapCandidates(excludeIds || [shape.id]);
      const pts = shapePoints({ ...shape, x: rawX, y: rawY });
      const res = snapOffsetForPoints(pts, candidates, thresh);
      return { x: rawX + res.dx, y: rawY + res.dy, guides: res.guides };
    }

    // Moves a whole selection rigidly: tests every shape's own points (not
    // just one representative shape) against the rest of the canvas, so a
    // group's left/right/top/bottom/center edges can all snap, regardless of
    // which member happens to be first in the selection.
    function snapMoveGroup(ids, origins, rawDx, rawDy, enabled) {
      if (!enabled) return { dx: rawDx, dy: rawDy, guides: [] };
      const thresh = snapThresholdMm();
      const candidates = collectSnapCandidates(ids);
      let pts = [];
      ids.forEach((id) => {
        const s = state.shapes.find((sh) => sh.id === id);
        const o = origins.get(id);
        if (!s || !o) return;
        pts = pts.concat(shapePoints({ ...s, x: o.x + rawDx, y: o.y + rawDy }));
      });
      const res = snapOffsetForPoints(pts, candidates, thresh);
      return { dx: rawDx + res.dx, dy: rawDy + res.dy, guides: res.guides };
    }

    function renderSnapGuides(guides) {
      overlayGroup.querySelectorAll('.snap-guide').forEach((n) => n.remove());
      if (!guides || !guides.length) return;
      const margin = Math.max(state.cardW, state.cardH) * 2;
      guides.forEach((g) => {
        if (g.type === 'grid') return;
        const line = document.createElementNS(SVG_NS, 'line');
        if (g.type === 'v') {
          line.setAttribute('x1', g.x); line.setAttribute('y1', -margin);
          line.setAttribute('x2', g.x); line.setAttribute('y2', state.cardH + margin);
        } else {
          line.setAttribute('x1', -margin); line.setAttribute('y1', g.y);
          line.setAttribute('x2', state.cardW + margin); line.setAttribute('y2', g.y);
        }
        line.setAttribute('class', 'snap-guide');
        line.setAttribute('vector-effect', 'non-scaling-stroke');
        overlayGroup.appendChild(line);
      });
    }

    function renderSnapPointMarker(point) {
      overlayGroup.querySelectorAll('.snap-point').forEach((n) => n.remove());
      if (!point) return;
      const r = HANDLE_R_PX * 0.55 / (PX_PER_MM * state.zoom);
      const c = document.createElementNS(SVG_NS, 'circle');
      c.setAttribute('cx', point.x);
      c.setAttribute('cy', point.y);
      c.setAttribute('r', r);
      c.setAttribute('class', 'snap-point');
      c.setAttribute('vector-effect', 'non-scaling-stroke');
      overlayGroup.appendChild(c);
    }

    // ---------- SVG canvas setup ----------

    let svg, layerGroups = {}, imageEl, bgRect, overlayGroup, gridGroup;
    const svgDblClickHandlers = [];

    // Grid lines every gridSize mm with a stronger line every 5th; lines closer
    // than a few screen pixels are skipped so zoomed-out grids don't turn solid.
    function renderGrid() {
      if (!gridGroup) return;
      gridGroup.innerHTML = '';
      const g = gridStep();
      if (!g) return;
      const pxPerStep = g * PX_PER_MM * state.zoom;
      const every = pxPerStep < 5 ? Math.ceil(5 / pxPerStep) : 1;
      const addLine = (x1, y1, x2, y2, major) => {
        const l = document.createElementNS(SVG_NS, 'line');
        l.setAttribute('x1', x1); l.setAttribute('y1', y1);
        l.setAttribute('x2', x2); l.setAttribute('y2', y2);
        l.setAttribute('class', major ? 'grid-line major' : 'grid-line');
        l.setAttribute('vector-effect', 'non-scaling-stroke');
        gridGroup.appendChild(l);
      };
      for (let i = 0; i * g <= state.cardW + 1e-9; i += every) addLine(i * g, 0, i * g, state.cardH, i % 5 === 0);
      for (let j = 0; j * g <= state.cardH + 1e-9; j += every) addLine(0, j * g, state.cardW, j * g, j % 5 === 0);
    }

    function buildCanvas() {
      els.canvasWrap.innerHTML = '';
      svg = document.createElementNS(SVG_NS, 'svg');
      svg.setAttribute('id', 'canvasSvg');

      // White paper; hidden for images with transparency so the canvas
      // checkerboard shows through their transparent pixels.
      bgRect = document.createElementNS(SVG_NS, 'rect');
      bgRect.setAttribute('x', '0'); bgRect.setAttribute('y', '0');
      bgRect.setAttribute('fill', '#ffffff');
      bgRect.setAttribute('width', '100%'); bgRect.setAttribute('height', '100%');
      svg.appendChild(bgRect);

      imageEl = document.createElementNS(SVG_NS, 'image');
      imageEl.setAttribute('x', '0');
      imageEl.setAttribute('y', '0');
      imageEl.setAttribute('preserveAspectRatio', 'none');
      svg.appendChild(imageEl);

      gridGroup = document.createElementNS(SVG_NS, 'g');
      gridGroup.setAttribute('class', 'grid-layer');
      svg.appendChild(gridGroup);

      updateSvgSize();

      LAYER_IDS.forEach((layer) => {
        const g = document.createElementNS(SVG_NS, 'g');
        g.setAttribute('data-layer-group', layer);
        layerGroups[layer] = g;
        svg.appendChild(g);
      });

      guideGroup = document.createElementNS(SVG_NS, 'g');
      guideGroup.setAttribute('class', 'guide-layer');
      svg.appendChild(guideGroup);

      overlayGroup = document.createElementNS(SVG_NS, 'g');
      overlayGroup.setAttribute('id', 'overlayGroup');
      svg.appendChild(overlayGroup);

      els.canvasWrap.appendChild(svg);

      svg.addEventListener('pointerdown', onCanvasPointerDown);
      svg.addEventListener('dblclick', (evt) => svgDblClickHandlers.forEach((fn) => fn(evt)));
      svg.addEventListener('pointerleave', () => {
        if (drag) return;
        renderSnapGuides([]);
        renderSnapPointMarker(null);
      });
    }

    function updateSvgSize() {
      svg.setAttribute('viewBox', `0 0 ${state.cardW} ${state.cardH}`);
      svg.setAttribute('width', state.cardW * PX_PER_MM * state.zoom);
      svg.setAttribute('height', state.cardH * PX_PER_MM * state.zoom);
      if (imageEl) {
        imageEl.setAttribute('width', state.cardW);
        imageEl.setAttribute('height', state.cardH);
      }
      if (els.zoomLevel) els.zoomLevel.textContent = `${Math.round(state.zoom * 100)}%`;
      renderGrid();
      requestAnimationFrame(drawRulers);
    }

    function svgPoint(evt) {
      const pt = svg.createSVGPoint();
      pt.x = evt.clientX;
      pt.y = evt.clientY;
      return pt.matrixTransform(svg.getScreenCTM().inverse());
    }

    // ---------- rulers & guides ----------

    // Rulers along the canvas edges, drawn from the SVG's screen transform so
    // they follow zoom and scrolling. Dragging out of a ruler makes a guide;
    // dragging a guide back onto a ruler removes it.

    function rulerSteps() {
      const inch = PnP.units.current === 'in';
      return inch
        ? { unit: 25.4, steps: [0.0625, 0.125, 0.25, 0.5, 1, 2, 5, 10], label: (v) => +v.toFixed(3) }
        : { unit: 1, steps: [0.5, 1, 2, 5, 10, 20, 50, 100, 200], label: (v) => +v.toFixed(1) };
    }

    function drawRuler(canvas, horizontal) {
      if (!svg || !canvas.clientWidth) return;
      const dpr = window.devicePixelRatio || 1;
      const W = canvas.clientWidth, H = canvas.clientHeight;
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      const ctx = canvas.getContext('2d');
      ctx.scale(dpr, dpr);
      const css = getComputedStyle(document.documentElement);
      ctx.fillStyle = css.getPropertyValue('--surface2') || '#242836';
      ctx.fillRect(0, 0, W, H);
      const ctm = svg.getScreenCTM();
      const rect = canvas.getBoundingClientRect();
      const { unit, steps, label } = rulerSteps();
      const pxPerUnit = ctm.a * unit;
      const major = steps.find((st) => st * pxPerUnit >= 50) || steps[steps.length - 1];
      const minor = major / (major * pxPerUnit >= 100 ? 10 : 5);
      // Screen position of a ruler value (in the ruler's own pixels)
      const toPx = horizontal ? (v) => ctm.e + v * unit * ctm.a - rect.left : (v) => ctm.f + v * unit * ctm.d - rect.top;
      const len = horizontal ? W : H;
      const from = horizontal ? (rect.left - ctm.e) / ctm.a / unit : (rect.top - ctm.f) / ctm.d / unit;
      const to = from + len / pxPerUnit;
      ctx.strokeStyle = css.getPropertyValue('--text-dim') || '#8b8fa8';
      ctx.fillStyle = css.getPropertyValue('--text-dim') || '#8b8fa8';
      ctx.lineWidth = 1;
      ctx.font = '9px sans-serif';
      const thick = horizontal ? H : W;
      for (let v = Math.floor(from / minor) * minor; v <= to; v += minor) {
        const isMajor = Math.abs(v / major - Math.round(v / major)) < 1e-6;
        const tick = isMajor ? thick * 0.6 : thick * 0.25;
        const q = Math.round(toPx(v)) + 0.5;
        ctx.beginPath();
        if (horizontal) { ctx.moveTo(q, H); ctx.lineTo(q, H - tick); } else { ctx.moveTo(W, q); ctx.lineTo(W - tick, q); }
        ctx.stroke();
        if (isMajor) {
          const text = String(label(v));
          if (horizontal) ctx.fillText(text, q + 2, 9);
          else {
            ctx.save();
            ctx.translate(9, q - 2);
            ctx.rotate(-Math.PI / 2);
            ctx.fillText(text, 0, 0);
            ctx.restore();
          }
        }
      }
      // Card edges highlighted on the ruler
      ctx.fillStyle = 'rgba(108, 140, 255, 0.25)';
      const a = toPx(0), b = toPx((horizontal ? state.cardW : state.cardH) / unit);
      if (horizontal) ctx.fillRect(a, H - 3, b - a, 3); else ctx.fillRect(W - 3, a, 3, b - a);
    }

    function drawRulers() {
      drawRuler(els.rulerH, true);
      drawRuler(els.rulerV, false);
    }

    let guideGroup = null;

    function renderGuides() {
      if (!guideGroup) return;
      guideGroup.innerHTML = '';
      const far = 10000;
      state.guides.forEach((g, i) => {
        ['guide-line', 'guide-hit'].forEach((cls) => {
          const l = document.createElementNS(SVG_NS, 'line');
          if (g.axis === 'x') { l.setAttribute('x1', g.pos); l.setAttribute('x2', g.pos); l.setAttribute('y1', -far); l.setAttribute('y2', far); }
          else { l.setAttribute('y1', g.pos); l.setAttribute('y2', g.pos); l.setAttribute('x1', -far); l.setAttribute('x2', far); }
          l.setAttribute('class', cls);
          l.dataset.guide = i;
          l.setAttribute('vector-effect', 'non-scaling-stroke');
          guideGroup.appendChild(l);
        });
      });
    }

    let guideDrag = null; // { guide }

    function startGuideDrag(guide) {
      guideDrag = { guide };
      window.addEventListener('pointermove', onGuideMove);
      window.addEventListener('pointerup', onGuideEnd);
    }

    function onGuideMove(evt) {
      if (!guideDrag) return;
      const p = svgPoint(evt);
      const g = guideDrag.guide;
      let pos = g.axis === 'x' ? p.x : p.y;
      const step = gridStep();
      if (step && snapOnFor(evt)) {
        const snapped = Math.round(pos / step) * step;
        if (Math.abs(snapped - pos) < snapThresholdMm()) pos = snapped;
      }
      g.pos = Math.round(pos * 100) / 100;
      renderGuides();
      renderMeasure(fmtLen(g.pos), p);
    }

    function onGuideEnd(evt) {
      window.removeEventListener('pointermove', onGuideMove);
      window.removeEventListener('pointerup', onGuideEnd);
      if (!guideDrag) return;
      // Dropped outside the drawing area (e.g. back on a ruler): delete it.
      const r = els.canvasWrap.getBoundingClientRect();
      const outside = evt.clientX < r.left || evt.clientX > r.right || evt.clientY < r.top || evt.clientY > r.bottom;
      if (outside) state.guides = state.guides.filter((g) => g !== guideDrag.guide);
      guideDrag = null;
      renderMeasure(null);
      renderGuides();
    }

    function wireRulers() {
      els.rulerH.addEventListener('pointerdown', (evt) => {
        evt.preventDefault();
        const g = { axis: 'y', pos: svgPoint(evt).y };
        state.guides.push(g);
        startGuideDrag(g);
      });
      els.rulerV.addEventListener('pointerdown', (evt) => {
        evt.preventDefault();
        const g = { axis: 'x', pos: svgPoint(evt).x };
        state.guides.push(g);
        startGuideDrag(g);
      });
      els.canvasWrap.addEventListener('scroll', drawRulers);
      window.addEventListener('resize', drawRulers);
      PnP.units.onChange(drawRulers);
      els.clearGuidesBtn.addEventListener('click', () => {
        state.guides = [];
        renderGuides();
      });
    }

    // ---------- zoom / pan ----------

    function clampZoom(z) {
      return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
    }

    function setZoom(newZoom, clientX, clientY) {
      newZoom = clampZoom(newZoom);
      if (Math.abs(newZoom - state.zoom) < 0.001) return;
      const wrap = els.canvasWrap;
      const rect = wrap.getBoundingClientRect();
      const ax = clientX != null ? clientX : rect.left + rect.width / 2;
      const ay = clientY != null ? clientY : rect.top + rect.height / 2;

      const before = svg.createSVGPoint();
      before.x = ax; before.y = ay;
      const mm = before.matrixTransform(svg.getScreenCTM().inverse());

      state.zoom = newZoom;
      updateSvgSize();

      const after = svg.createSVGPoint();
      after.x = mm.x; after.y = mm.y;
      const screenPos = after.matrixTransform(svg.getScreenCTM());

      wrap.scrollLeft += screenPos.x - ax;
      wrap.scrollTop += screenPos.y - ay;
      renderOverlay();
    }

    function zoomBy(factor, clientX, clientY) {
      setZoom(state.zoom * factor, clientX, clientY);
    }

    function fitZoom() {
      const wrap = els.canvasWrap;
      const availW = Math.max(40, wrap.clientWidth - 32);
      const availH = Math.max(40, wrap.clientHeight - 32);
      const z = Math.min(availW / (state.cardW * PX_PER_MM), availH / (state.cardH * PX_PER_MM));
      state.zoom = clampZoom(z || 1);
      updateSvgSize();
      wrap.scrollLeft = 0;
      wrap.scrollTop = 0;
      renderOverlay();
    }

    els.zoomInBtn.addEventListener('click', () => zoomBy(1.25));
    els.zoomOutBtn.addEventListener('click', () => zoomBy(0.8));
    els.zoomResetBtn.addEventListener('click', () => setZoom(1));
    els.zoomFitBtn.addEventListener('click', fitZoom);

    els.canvasWrap.addEventListener('wheel', (evt) => {
      if (!(evt.ctrlKey || evt.metaKey)) return;
      evt.preventDefault();
      const factor = Math.exp(-evt.deltaY * 0.0018);
      zoomBy(factor, evt.clientX, evt.clientY);
    }, { passive: false });

    function setSnap(on) {
      snapEnabled = view.snap = on;
      els.snapBtn.setAttribute('aria-pressed', String(on));
      saveView();
    }

    function setGrid(on) {
      view.grid = on;
      els.gridBtn.setAttribute('aria-pressed', String(on));
      saveView();
      renderGrid();
    }

    els.snapBtn.addEventListener('click', () => setSnap(!snapEnabled));
    els.gridBtn.addEventListener('click', () => setGrid(!view.grid));
    els.gridSize.value = view.gridSize;
    els.gridSize.addEventListener('input', () => {
      const v = parseFloat(els.gridSize.value);
      if (!(v > 0)) return;
      view.gridSize = v;
      saveView();
      renderGrid();
    });

    // ---- space / middle-click panning ----

    let spaceDown = false;
    let panDrag = null;

    function startPanDrag(evt) {
      const wrap = els.canvasWrap;
      panDrag = { startX: evt.clientX, startY: evt.clientY, scrollLeft: wrap.scrollLeft, scrollTop: wrap.scrollTop };
      wrap.classList.add('panning');
      window.addEventListener('pointermove', onPanMove);
      window.addEventListener('pointerup', onPanEnd);
    }

    function onPanMove(evt) {
      if (!panDrag) return;
      const wrap = els.canvasWrap;
      wrap.scrollLeft = panDrag.scrollLeft - (evt.clientX - panDrag.startX);
      wrap.scrollTop = panDrag.scrollTop - (evt.clientY - panDrag.startY);
    }

    function onPanEnd() {
      panDrag = null;
      els.canvasWrap.classList.remove('panning');
      window.removeEventListener('pointermove', onPanMove);
      window.removeEventListener('pointerup', onPanEnd);
    }

    // ---------- shape rendering ----------

    function describeShape(shape) {
      const transform = `translate(${shape.x} ${shape.y}) rotate(${shape.rotation} ${shape.w / 2} ${shape.h / 2})`;
      if (shape.type === 'rect') {
        const r = Math.max(0, Math.min(shape.radius || 0, shape.w / 2, shape.h / 2));
        return { transform, tag: 'rect', attrs: { x: 0, y: 0, width: shape.w, height: shape.h, rx: r, ry: r } };
      }
      if (shape.type === 'ellipse') {
        return { transform, tag: 'ellipse', attrs: { cx: shape.w / 2, cy: shape.h / 2, rx: shape.w / 2, ry: shape.h / 2 } };
      }
      if (shape.type === 'line') {
        const p1 = shape.diag === 'tlbr' ? { x: 0, y: 0 } : { x: shape.w, y: 0 };
        const p2 = shape.diag === 'tlbr' ? { x: shape.w, y: shape.h } : { x: 0, y: shape.h };
        return { transform, tag: 'line', attrs: { x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y } };
      }
      if (shape.type === 'path') {
        return { transform, tag: 'path', attrs: { d: PathGeom.toD(localPath(shape)) } };
      }
      return null;
    }

    function round(n) {
      return typeof n === 'number' ? Math.round(n * 1000) / 1000 : n;
    }

    function createShapeElement(shape) {
      const d = describeShape(shape);
      if (!d) return null;
      const g = document.createElementNS(SVG_NS, 'g');
      g.setAttribute('transform', d.transform);
      g.setAttribute('data-id', shape.id);
      g.classList.add('shape-el');
      if (shape._preview) g.classList.add('preview');
      // Three copies of the outline: a light halo so the line reads on dark or
      // busy artwork, the line itself, and a wide invisible stroke to click.
      // Widths are screen pixels at any zoom.
      const part = (cls) => {
        const el = document.createElementNS(SVG_NS, d.tag);
        Object.entries(d.attrs).forEach(([k, v]) => el.setAttribute(k, v));
        el.setAttribute('fill', 'none');
        el.setAttribute('vector-effect', 'non-scaling-stroke');
        el.classList.add(cls);
        g.appendChild(el);
        return el;
      };
      part('shape-halo');
      const line = part('shape-line');
      line.setAttribute('stroke', state.layerColors[shape.layer]);
      const hit = part('shape-hit');
      const closed = shape.type === 'rect' || shape.type === 'ellipse' || (shape.type === 'path' && shape.closed);
      if (o.regionFill && closed) {
        line.setAttribute('fill', state.layerColors[shape.layer]);
        line.setAttribute('fill-opacity', String(o.regionFill));
        hit.style.pointerEvents = 'visible';
      }
      return g;
    }

    function renderShapes() {
      LAYER_IDS.forEach((layer) => {
        layerGroups[layer].innerHTML = '';
        layerGroups[layer].style.display = state.layerVisible[layer] ? '' : 'none';
      });
      state.shapes.forEach((shape) => {
        const el = createShapeElement(shape);
        if (!el) return;
        layerGroups[shape.layer].appendChild(el);
      });
    }

    // ---------- selection overlay ----------

    const HANDLE_DEFS = [
      { key: 'nw', local: (s) => ({ x: 0, y: 0 }) },
      { key: 'n', local: (s) => ({ x: s.w / 2, y: 0 }) },
      { key: 'ne', local: (s) => ({ x: s.w, y: 0 }) },
      { key: 'e', local: (s) => ({ x: s.w, y: s.h / 2 }) },
      { key: 'se', local: (s) => ({ x: s.w, y: s.h }) },
      { key: 's', local: (s) => ({ x: s.w / 2, y: s.h }) },
      { key: 'sw', local: (s) => ({ x: 0, y: s.h }) },
      { key: 'w', local: (s) => ({ x: 0, y: s.h / 2 }) },
    ];

    function shapeCorners(shape) {
      return [
        worldFromLocal(shape, { x: 0, y: 0 }),
        worldFromLocal(shape, { x: shape.w, y: 0 }),
        worldFromLocal(shape, { x: shape.w, y: shape.h }),
        worldFromLocal(shape, { x: 0, y: shape.h }),
      ];
    }

    function lineEndpointsWorld(shape) {
      const p1 = shape.diag === 'tlbr' ? { x: 0, y: 0 } : { x: shape.w, y: 0 };
      const p2 = shape.diag === 'tlbr' ? { x: shape.w, y: shape.h } : { x: 0, y: shape.h };
      return { p1: worldFromLocal(shape, p1), p2: worldFromLocal(shape, p2) };
    }

    const BOX_HANDLE_DEFS = [
      { key: 'nw', get: (b) => ({ x: b.x, y: b.y }) },
      { key: 'n', get: (b) => ({ x: b.x + b.w / 2, y: b.y }) },
      { key: 'ne', get: (b) => ({ x: b.x + b.w, y: b.y }) },
      { key: 'e', get: (b) => ({ x: b.x + b.w, y: b.y + b.h / 2 }) },
      { key: 'se', get: (b) => ({ x: b.x + b.w, y: b.y + b.h }) },
      { key: 's', get: (b) => ({ x: b.x + b.w / 2, y: b.y + b.h }) },
      { key: 'sw', get: (b) => ({ x: b.x, y: b.y + b.h }) },
      { key: 'w', get: (b) => ({ x: b.x, y: b.y + b.h / 2 }) },
    ];

    function groupBoundingBox(ids) {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      ids.forEach((id) => {
        const s = state.shapes.find((sh) => sh.id === id);
        if (!s) return;
        shapePoints(s).forEach((p) => {
          minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
          minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
        });
      });
      if (!isFinite(minX)) return null;
      return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
    }

    function selectedShape() {
      if (state.selectedIds.length !== 1) return null;
      return state.shapes.find((s) => s.id === state.selectedIds[0]) || null;
    }

    function addHandleCircle(key, wp, handleR, extraClass) {
      const c = document.createElementNS(SVG_NS, 'circle');
      c.setAttribute('cx', wp.x);
      c.setAttribute('cy', wp.y);
      c.setAttribute('r', handleR);
      c.setAttribute('class', extraClass ? `handle ${extraClass}` : 'handle');
      c.setAttribute('data-handle', key);
      c.setAttribute('vector-effect', 'non-scaling-stroke');
      overlayGroup.appendChild(c);
    }

    function renderOverlay() {
      if (!overlayGroup) return;
      if (state.tool === 'node') {
        overlayGroup.innerHTML = '';
        renderNodeOverlay();
      } else {
        renderSelectionOverlay();
      }
      renderDraft();
    }

    function renderSelectionOverlay() {
      overlayGroup.innerHTML = '';

      if (state.selectedIds.length > 1) {
        state.selectedIds.forEach((id) => {
          const s = state.shapes.find((sh) => sh.id === id);
          if (!s) return;
          const outline = document.createElementNS(SVG_NS, 'polygon');
          outline.setAttribute('points', shapeCorners(s).map((p) => `${p.x},${p.y}`).join(' '));
          outline.setAttribute('class', 'multi-select-outline');
          outline.setAttribute('vector-effect', 'non-scaling-stroke');
          overlayGroup.appendChild(outline);
        });

        const box = groupBoundingBox(state.selectedIds);
        if (box) {
          const groupOutline = document.createElementNS(SVG_NS, 'rect');
          groupOutline.setAttribute('x', box.x);
          groupOutline.setAttribute('y', box.y);
          groupOutline.setAttribute('width', box.w);
          groupOutline.setAttribute('height', box.h);
          groupOutline.setAttribute('class', 'group-select-outline');
          groupOutline.setAttribute('vector-effect', 'non-scaling-stroke');
          overlayGroup.appendChild(groupOutline);

          const handleR = HANDLE_R_PX / (PX_PER_MM * state.zoom);
          BOX_HANDLE_DEFS.forEach((def) => addHandleCircle(def.key, def.get(box), handleR));
          addHandleCircle('move', { x: box.x + box.w / 2, y: box.y + box.h / 2 }, handleR, 'handle-move');
        }
        return;
      }

      const shape = selectedShape();
      if (!shape) return;

      const isLine = shape.type === 'line';

      if (!isLine) {
        const corners = shapeCorners(shape);
        const outline = document.createElementNS(SVG_NS, 'polygon');
        outline.setAttribute('points', corners.map((p) => `${p.x},${p.y}`).join(' '));
        outline.setAttribute('fill', 'none');
        outline.setAttribute('stroke', '#4a90d9');
        outline.setAttribute('stroke-width', '1.25');
        outline.setAttribute('stroke-dasharray', '5,4');
        outline.setAttribute('vector-effect', 'non-scaling-stroke');
        overlayGroup.appendChild(outline);
      }

      if (state.tool !== 'select') return; // drawing: outline only, no handles

      const handleR = HANDLE_R_PX / (PX_PER_MM * state.zoom);
      const addHandle = (key, wp, extraClass) => addHandleCircle(key, wp, handleR, extraClass);

      if (isLine) {
        const { p1, p2 } = lineEndpointsWorld(shape);
        addHandle('p1', p1);
        addHandle('p2', p2);
      } else {
        HANDLE_DEFS.forEach((def) => addHandle(def.key, worldFromLocal(shape, def.local(shape))));

        const rotLocal = { x: shape.w / 2, y: -ROTATE_HANDLE_OFFSET };
        const rotWorld = worldFromLocal(shape, rotLocal);
        const nWorld = worldFromLocal(shape, { x: shape.w / 2, y: 0 });
        const connector = document.createElementNS(SVG_NS, 'line');
        connector.setAttribute('x1', nWorld.x); connector.setAttribute('y1', nWorld.y);
        connector.setAttribute('x2', rotWorld.x); connector.setAttribute('y2', rotWorld.y);
        connector.setAttribute('stroke', '#4a90d9');
        connector.setAttribute('stroke-width', '1.25');
        connector.setAttribute('vector-effect', 'non-scaling-stroke');
        overlayGroup.appendChild(connector);

        addHandle('rotate', rotWorld, 'handle-rotate');
      }

      addHandle('move', worldCenter(shape), 'handle-move');
    }

    // ---------- properties panel ----------

    function refreshProps() {
      els.arrangePanel.hidden = state.selectedIds.length === 0;
      if (state.selectedIds.length > 1) {
        els.propsEmpty.hidden = false;
        els.propsEmpty.textContent = `${state.selectedIds.length} shapes selected. Press Delete to remove.`;
        els.propsForm.hidden = true;
        return;
      }
      const shape = selectedShape();
      if (!shape) {
        els.propsEmpty.hidden = false;
        els.propsEmpty.textContent = 'No shape selected.';
        els.propsForm.hidden = true;
        return;
      }
      els.propsEmpty.hidden = true;
      els.propsForm.hidden = false;
      els.propLayer.value = shape.layer;
      els.propX.value = round(shape.x);
      els.propY.value = round(shape.y);
      els.propW.value = round(shape.w);
      els.propH.value = round(shape.h);
      els.propRot.value = round(shape.rotation);
      els.propRadiusWrap.hidden = shape.type !== 'rect';
      if (shape.type === 'rect') els.propRadius.value = round(shape.radius || 0);
      // Lines are easier to set by length and angle than by their box.
      const isLine = shape.type === 'line';
      els.propLineWrap.hidden = !isLine;
      [els.propWWrap, els.propHWrap, els.propRotWrap].forEach((w) => { w.hidden = isLine; });
      if (isLine) {
        const { p1, p2 } = lineEndpointsWorld(shape);
        els.propLen.value = round(Math.hypot(p2.x - p1.x, p2.y - p1.y));
        els.propAngle.value = round((Math.atan2(-(p2.y - p1.y), p2.x - p1.x) * 180) / Math.PI);
      }
    }

    // Length / angle edits keep the line's first end point where it is.
    function applyLineProps() {
      const shape = selectedShape();
      if (!shape || shape.type !== 'line') return;
      const { p1 } = lineEndpointsWorld(shape);
      const len = Math.max(0, parseFloat(els.propLen.value) || 0);
      const a = ((parseFloat(els.propAngle.value) || 0) * Math.PI) / 180;
      const p2 = { x: p1.x + len * Math.cos(a), y: p1.y - len * Math.sin(a) };
      const box = normBox(p1.x, p1.y, p2.x, p2.y);
      Object.assign(shape, box, { rotation: 0, diag: (p2.x - p1.x) * (p2.y - p1.y) >= 0 ? 'tlbr' : 'trbl' });
      fullRender();
      pushHistory();
    }

    function applyPropsToShape() {
      const shape = selectedShape();
      if (!shape) return;
      shape.layer = els.propLayer.value;
      shape.x = parseFloat(els.propX.value) || 0;
      shape.y = parseFloat(els.propY.value) || 0;
      shape.w = Math.max(MIN_SIZE, parseFloat(els.propW.value) || MIN_SIZE);
      shape.h = Math.max(MIN_SIZE, parseFloat(els.propH.value) || MIN_SIZE);
      shape.rotation = parseFloat(els.propRot.value) || 0;
      if (shape.type === 'rect') shape.radius = Math.max(0, parseFloat(els.propRadius.value) || 0);
      fullRender();
      pushHistory();
    }

    [els.propLayer, els.propX, els.propY, els.propW, els.propH, els.propRadius, els.propRot].forEach((el) => {
      el.addEventListener('change', applyPropsToShape);
    });
    [els.propLen, els.propAngle].forEach((el) => el.addEventListener('change', applyLineProps));

    els.deleteShapeBtn.addEventListener('click', () => {
      deleteSelected();
    });

    function deleteSelected() {
      if (!state.selectedIds.length) return;
      const idSet = new Set(state.selectedIds);
      state.shapes = state.shapes.filter((s) => !idSet.has(s.id));
      state.selectedIds = [];
      fullRender();
      pushHistory();
    }

    // ---------- clipboard ----------

    let clipboard = [];
    let pasteCount = 0;

    function copySelected() {
      if (!state.selectedIds.length) return;
      const idSet = new Set(state.selectedIds);
      clipboard = state.shapes.filter((s) => idSet.has(s.id)).map((s) => JSON.parse(JSON.stringify(s)));
      pasteCount = 0;
    }

    function cutSelected() {
      if (!state.selectedIds.length) return;
      copySelected();
      deleteSelected();
    }

    function pasteClipboard() {
      if (!clipboard.length) return;
      pasteCount += 1;
      const offset = 4 * pasteCount;
      const newIds = [];
      clipboard.forEach((c) => {
        const s = JSON.parse(JSON.stringify(c));
        s.id = state.nextId++;
        s.x += offset;
        s.y += offset;
        delete s.source;
        state.shapes.push(s);
        newIds.push(s.id);
      });
      selectShapes(newIds);
      fullRender();
      pushHistory();
    }

    function selectAll() {
      selectShapes(state.shapes.map((s) => s.id));
    }

    // ---------- tool / layer toolbar ----------

    function setTool(tool, opts = {}) {
      if (penDraft && penDraft.nodes.length >= 2) finishPen(false);
      state.tool = tool;
      [...els.toolButtons.children].forEach((b) => {
        const on = b.dataset.tool === tool;
        b.classList.toggle('active', on);
        b.setAttribute('aria-pressed', String(on));
      });
      cancelDrafts();
      if (tool !== 'node') nodeEdit = null;
      if (tool === 'node' && !opts.keepSelection) {
        // Entering the node tool with one shape selected edits that shape.
        const sel = selectedShape();
        if (sel) { startNodeEdit(sel.id); return; }
      }
      if (!opts.keepSelection) selectShape(null);
      renderSnapGuides([]);
      renderSnapPointMarker(null);
      updateCursor();
    }

    els.toolButtons.addEventListener('click', (e) => {
      const btn = e.target.closest('.tool-btn');
      if (btn) setTool(btn.dataset.tool);
    });

    els.layerBar.addEventListener('click', (e) => {
      const btn = e.target.closest('.layer-btn');
      if (!btn) return;
      state.activeLayer = btn.dataset.layer;
      els.layerBar.querySelectorAll('.layer-btn').forEach((b) => b.classList.toggle('active', b === btn));
    });

    els.layerBar.addEventListener('change', (e) => {
      const colorInput = e.target.closest('.layer-color');
      if (colorInput) {
        state.layerColors[colorInput.dataset.layer] = colorInput.value;
        renderShapes();
        renderDraft();
        return;
      }
      const cb = e.target.closest('input[data-vis]');
      if (!cb) return;
      state.layerVisible[cb.dataset.vis] = cb.checked;
      renderShapes();
    });

    function updateCursor() {
      svg.style.cursor = state.tool === 'select' || state.tool === 'node' ? 'default' : state.tool === 'trace' ? 'cell' : 'crosshair';
    }

    // ---------- drawing interactions ----------

    let drag = null; // { mode, ... }

    function onCanvasPointerDown(evt) {
      if (spaceDown || evt.button === 1) {
        evt.preventDefault();
        startPanDrag(evt);
        return;
      }

      const guideEl = evt.target.closest('.guide-hit');
      if (guideEl && (state.tool === 'select' || state.tool === 'node')) {
        evt.preventDefault();
        startGuideDrag(state.guides[parseInt(guideEl.dataset.guide, 10)]);
        return;
      }

      // Handles are only live in the select tool; drawing tools always draw.
      const handleEl = state.tool === 'select' ? evt.target.closest('.handle') : null;
      const shapeEl = evt.target.closest('.shape-el');

      if (handleEl) {
        const handleKey = handleEl.dataset.handle;
        if (state.selectedIds.length > 1) {
          if (handleKey === 'move') {
            startMoveDrag(evt);
          } else {
            startGroupHandleDrag(handleKey, evt);
          }
        } else {
          startHandleDrag(handleKey, evt);
        }
        evt.stopPropagation();
        return;
      }

      if (state.tool === 'select') {
        if (shapeEl) {
          const id = parseInt(shapeEl.dataset.id, 10);
          if (evt.shiftKey) {
            toggleSelect(id);
            return;
          }
          if (!state.selectedIds.includes(id)) selectShape(id);
          startMoveDrag(evt);
        } else {
          if (!evt.shiftKey) selectShape(null);
          startMarqueeDrag(evt);
        }
        return;
      }

      if (state.tool === 'line' || state.tool === 'rect' || state.tool === 'ellipse') {
        startCreateDrag(evt);
        return;
      }

      if (state.tool === 'node') { nodePointerDown(evt); return; }
      if (state.tool === 'pen') { penPointerDown(evt); return; }
      if (state.tool === 'freehand') { freehandPointerDown(evt); return; }
      if (state.tool === 'trace') { tracePointerDown(evt); return; }
    }

    function startMoveDrag(evt) {
      const start = svgPoint(evt);
      if (state.selectedIds.length > 1) {
        const origins = new Map();
        state.selectedIds.forEach((id) => {
          const s = state.shapes.find((sh) => sh.id === id);
          if (s) origins.set(id, { x: s.x, y: s.y });
        });
        drag = { mode: 'move-multi', ids: [...state.selectedIds], origins, start };
      } else {
        const shape = selectedShape();
        if (!shape) return;
        const origin = { x: shape.x, y: shape.y };
        drag = { mode: 'move', shape, start, origin };
      }
      window.addEventListener('pointermove', onDragMove);
      window.addEventListener('pointerup', onDragEnd);
    }

    function startHandleDrag(handleKey, evt) {
      const shape = selectedShape();
      if (!shape) return;
      if (handleKey === 'move') {
        drag = { mode: 'move', shape, start: svgPoint(evt), origin: { x: shape.x, y: shape.y } };
      } else if (handleKey === 'rotate') {
        drag = { mode: 'rotate', shape };
      } else if (shape.type === 'line' && (handleKey === 'p1' || handleKey === 'p2')) {
        const { p1, p2 } = lineEndpointsWorld(shape);
        const fixed = handleKey === 'p1' ? p2 : p1;
        drag = { mode: 'line-endpoint', shape, fixed };
      } else {
        drag = { mode: 'resize', shape, handle: handleKey, box0: { x: shape.x, y: shape.y, w: shape.w, h: shape.h } };
      }
      window.addEventListener('pointermove', onDragMove);
      window.addEventListener('pointerup', onDragEnd);
      evt.stopPropagation();
    }

    function startGroupHandleDrag(handleKey, evt) {
      const ids = [...state.selectedIds];
      const box0 = groupBoundingBox(ids);
      if (!box0) return;
      const origins = new Map();
      ids.forEach((id) => {
        const s = state.shapes.find((sh) => sh.id === id);
        if (s) origins.set(id, { x: s.x, y: s.y, w: s.w, h: s.h });
      });
      drag = { mode: 'resize-group', ids, origins, handle: handleKey, box0 };
      window.addEventListener('pointermove', onDragMove);
      window.addEventListener('pointerup', onDragEnd);
      evt.stopPropagation();
    }

    function startCreateDrag(evt) {
      let p = svgPoint(evt);
      const snapOn = snapOnFor(evt);
      const snapped = resolvePointSnap(p, [], snapOn);
      p = { x: snapped.x, y: snapped.y };
      const id = state.nextId++;
      const shape = {
        id, type: state.tool, layer: state.activeLayer,
        x: p.x, y: p.y, w: 0, h: 0, rotation: 0,
        radius: 0, diag: 'tlbr',
      };
      state.shapes.push(shape);
      drag = { mode: 'create', shape, start: p };
      window.addEventListener('pointermove', onDragMove);
      window.addEventListener('pointerup', onDragEnd);
    }

    function onDragMove(evt) {
      if (!drag) return;
      const p = svgPoint(evt);
      const snapOn = snapOnFor(evt);
      let guides = [];

      if (drag.mode === 'pen-handle') {
        const node = drag.node;
        const vx = p.x - node.x, vy = p.y - node.y;
        if (Math.hypot(vx, vy) > 0.3) {
          node.ho = { x: node.x + vx, y: node.y + vy };
          node.hi = { x: node.x - vx, y: node.y - vy };
          node.smooth = true;
        }
        renderDraft();
        return;
      }
      if (drag.mode === 'freehand') {
        const last = freehand.points[freehand.points.length - 1];
        if (Math.hypot(p.x - last.x, p.y - last.y) > 0.15) freehand.points.push(p);
        renderDraft();
        return;
      }
      if (drag.mode === 'node-move' || drag.mode === 'node-handle') {
        guides = applyNodeDrag(evt, p) || [];
        fullRender();
        renderSnapGuides(guides);
        return;
      }

      if (drag.mode === 'move-multi') {
        const rawDx = p.x - drag.start.x;
        const rawDy = p.y - drag.start.y;
        const res = snapMoveGroup(drag.ids, drag.origins, rawDx, rawDy, snapOn);
        drag.ids.forEach((id) => {
          const s = state.shapes.find((sh) => sh.id === id);
          const o = drag.origins.get(id);
          if (s && o) { s.x = o.x + res.dx; s.y = o.y + res.dy; }
        });
        guides = res.guides;
        fullRender();
        renderSnapGuides(guides);
        return;
      }

      if (drag.mode === 'resize-group') {
        const box0 = drag.box0;
        const res = resolvePointSnap(p, drag.ids, snapOn);
        guides = res.guides;
        let x1 = box0.x, y1 = box0.y, x2 = box0.x + box0.w, y2 = box0.y + box0.h;
        const hk = drag.handle;
        if (hk.includes('w')) x1 = res.x;
        if (hk.includes('e')) x2 = res.x;
        if (hk.includes('n')) y1 = res.y;
        if (hk.includes('s')) y2 = res.y;
        const box = normBox(x1, y1, x2, y2);
        const newW = Math.max(MIN_SIZE, box.w);
        const newH = Math.max(MIN_SIZE, box.h);
        // Guard against a near-zero group bbox dimension blowing the scale
        // factor up to something huge (e.g. a group of only-horizontal lines
        // has box0.h ~ 0 until you actually drag a vertical handle).
        const sx = box0.w > MIN_SIZE ? newW / box0.w : 1;
        const sy = box0.h > MIN_SIZE ? newH / box0.h : 1;
        drag.ids.forEach((id) => {
          const s = state.shapes.find((sh) => sh.id === id);
          const o = drag.origins.get(id);
          if (!s || !o) return;
          s.x = box.x + (o.x - box0.x) * sx;
          s.y = box.y + (o.y - box0.y) * sy;
          s.w = o.w === 0 ? 0 : Math.max(MIN_SIZE, o.w * sx);
          s.h = o.h === 0 ? 0 : Math.max(MIN_SIZE, o.h * sy);
        });
        fullRender();
        renderSnapGuides(guides);
        return;
      }

      const shape = drag.shape;

      if (drag.mode === 'move') {
        const rawX = drag.origin.x + (p.x - drag.start.x);
        const rawY = drag.origin.y + (p.y - drag.start.y);
        const res = snapMoveShape(shape, rawX, rawY, snapOn);
        shape.x = res.x; shape.y = res.y;
        guides = res.guides;
      } else if (drag.mode === 'create') {
        let ex = p.x, ey = p.y;
        if (evt.shiftKey && shape.type === 'line') {
          const res = angleConstrainedPoint(drag.start, p, [shape.id], snapOn);
          ex = res.point.x; ey = res.point.y;
          guides = res.guides;
        } else {
          const res = resolvePointSnap({ x: ex, y: ey }, [shape.id], snapOn);
          ex = res.x; ey = res.y;
          guides = res.guides;
        }
        const sx = drag.start.x, sy = drag.start.y;
        if (shape.type !== 'line' && evt.shiftKey) {
          // Shift: square / circle
          const m = Math.max(Math.abs(ex - sx), Math.abs(ey - sy));
          ex = sx + (ex >= sx ? m : -m);
          ey = sy + (ey >= sy ? m : -m);
        }
        // Alt: the start point is the centre
        const box = shape.type !== 'line' && evt.altKey
          ? normBox(2 * sx - ex, 2 * sy - ey, ex, ey)
          : normBox(sx, sy, ex, ey);
        shape.x = box.x; shape.y = box.y; shape.w = box.w; shape.h = box.h;
        if (shape.type === 'line') {
          shape.diag = (ex - sx) * (ey - sy) >= 0 ? 'tlbr' : 'trbl';
          renderMeasure(lineLabel(ex - sx, ey - sy), { x: ex, y: ey });
        } else {
          renderMeasure(`${fmtLen(box.w)} × ${fmtLen(box.h)}`, { x: ex, y: ey });
        }
      } else if (drag.mode === 'line-endpoint') {
        const fixed = drag.fixed;
        let moved;
        if (evt.shiftKey) {
          const res = angleConstrainedPoint(fixed, p, [shape.id], snapOn);
          moved = res.point;
          guides = res.guides;
        } else {
          const res = resolvePointSnap(p, [shape.id], snapOn, [fixed]);
          guides = res.guides;
          moved = { x: res.x, y: res.y };
        }
        const box = normBox(fixed.x, fixed.y, moved.x, moved.y);
        shape.x = box.x; shape.y = box.y;
        shape.w = box.w;
        shape.h = box.h;
        shape.diag = (fixed.x - moved.x) * (fixed.y - moved.y) >= 0 ? 'tlbr' : 'trbl';
        renderMeasure(lineLabel(moved.x - fixed.x, moved.y - fixed.y), moved);
      } else if (drag.mode === 'resize') {
        const box0 = drag.box0;
        const refShape = { x: box0.x, y: box0.y, w: box0.w, h: box0.h, rotation: shape.rotation };
        const res = resolvePointSnap(p, [shape.id], snapOn);
        guides = res.guides;
        // localFromWorld() returns a LOCAL coordinate (0..box0.w, 0..box0.h);
        // x1/x2/y1/y2 below are WORLD coordinates (box0.x/box0.y-based), so the
        // local value has to be re-based by box0.x/box0.y before mixing with
        // them — omitting that (as this used to) mixes the two coordinate
        // frames and throws the box to an unrelated position/size the moment
        // box0.x or box0.y isn't 0.
        const Lp = localFromWorld(refShape, { x: res.x, y: res.y });
        let x1 = box0.x, y1 = box0.y, x2 = box0.x + box0.w, y2 = box0.y + box0.h;
        const h = drag.handle;
        if (h.includes('w')) x1 = box0.x + Lp.x;
        if (h.includes('e')) x2 = box0.x + Lp.x;
        if (h.includes('n')) y1 = box0.y + Lp.y;
        if (h.includes('s')) y2 = box0.y + Lp.y;
        const box = normBox(x1, y1, x2, y2);
        shape.x = box.x; shape.y = box.y;
        shape.w = Math.max(MIN_SIZE, box.w);
        shape.h = Math.max(MIN_SIZE, box.h);
        renderMeasure(`${fmtLen(shape.w)} × ${fmtLen(shape.h)}`, p);
      } else if (drag.mode === 'rotate') {
        const wc = worldCenter(shape);
        let deg = (Math.atan2(p.y - wc.y, p.x - wc.x) * 180) / Math.PI + 90;
        if (evt.shiftKey) deg = Math.round(deg / 15) * 15;
        shape.rotation = ((deg % 360) + 360) % 360;
        if (shape.rotation > 180) shape.rotation -= 360;
        renderMeasure(`${round1(shape.rotation)}°`, p);
      }

      fullRender();
      renderSnapGuides(guides);
      renderMeasure(measureText, measureAt);
    }

    // ---------- live measurements ----------

    let measureText = null, measureAt = null;
    const round1 = (v) => Math.round(v * 10) / 10;
    const fmtLen = (mm) => PnP.units.format(round1(mm));

    function lineLabel(dx, dy) {
      const len = Math.hypot(dx, dy);
      const ang = (Math.atan2(-dy, dx) * 180) / Math.PI; // counter-clockwise, 0° = right
      return `${fmtLen(len)} · ${round1(ang)}°`;
    }

    // A small label next to the pointer while drawing or resizing.
    function renderMeasure(text, at) {
      measureText = text;
      measureAt = at;
      if (!overlayGroup) return;
      overlayGroup.querySelectorAll('.measure').forEach((n) => n.remove());
      if (!text || !at) return;
      const k = PX_PER_MM * state.zoom;
      const t = document.createElementNS(SVG_NS, 'text');
      t.setAttribute('x', at.x + 12 / k);
      t.setAttribute('y', at.y + 22 / k);
      t.setAttribute('font-size', 12 / k);
      t.setAttribute('class', 'measure');
      t.textContent = text;
      overlayGroup.appendChild(t);
    }

    function onDragEnd() {
      window.removeEventListener('pointermove', onDragMove);
      window.removeEventListener('pointerup', onDragEnd);
      if (drag && drag.mode === 'pen-handle') {
        drag = null;
        renderOverlay();
        return;
      }
      if (drag && drag.mode === 'freehand') {
        drag = null;
        finishFreehand();
        fullRender();
        return;
      }
      if (drag && drag.mode === 'create') {
        if (drag.shape.w < 1 && drag.shape.h < 1) {
          state.shapes = state.shapes.filter((s) => s.id !== drag.shape.id);
        } else {
          // Stay in the drawing tool; the new shape is selected so its exact
          // size can still be typed in the properties panel.
          selectShape(drag.shape.id);
        }
      }
      drag = null;
      measureText = measureAt = null;
      fullRender();
      renderSnapGuides([]);
      renderSnapPointMarker(null);
      pushHistory();
    }

    // ---------- pen tool ----------
    //
    // Click = corner node, click-drag = smooth node (drag sets the handles).
    // Click the first node to close; double-click, Enter or Esc to finish open.

    let penDraft = null; // { nodes: [{x, y, hi?, ho?}] } in card mm
    let penCursor = null;

    function closeThreshold() {
      return 8 / (PX_PER_MM * state.zoom);
    }

    function penPointerDown(evt) {
      const p = snappedPoint(evt);
      if (penDraft && penDraft.nodes.length >= 2) {
        const first = penDraft.nodes[0];
        if (Math.hypot(p.x - first.x, p.y - first.y) < closeThreshold()) {
          finishPen(true);
          return;
        }
      }
      if (!penDraft) penDraft = { nodes: [] };
      const node = { x: p.x, y: p.y };
      penDraft.nodes.push(node);
      drag = { mode: 'pen-handle', node };
      window.addEventListener('pointermove', onDragMove);
      window.addEventListener('pointerup', onDragEnd);
      renderOverlay();
    }

    function finishPen(closed) {
      if (!penDraft) return;
      const nodes = penDraft.nodes;
      // A double-click adds the same point twice; drop the duplicate.
      while (nodes.length > 1 && Math.hypot(nodes[nodes.length - 1].x - nodes[nodes.length - 2].x, nodes[nodes.length - 1].y - nodes[nodes.length - 2].y) < 0.01) nodes.pop();
      penDraft = null;
      penCursor = null;
      if (nodes.length >= (closed ? 3 : 2)) {
        const shape = makePathShape({ nodes, closed });
        state.shapes.push(shape);
        selectShape(shape.id);
        pushHistory();
      }
      fullRender();
    }

    // ---------- freehand tool ----------

    let freehand = null; // { points }

    function freehandPointerDown(evt) {
      freehand = { points: [svgPoint(evt)] };
      drag = { mode: 'freehand' };
      window.addEventListener('pointermove', onDragMove);
      window.addEventListener('pointerup', onDragEnd);
    }

    function finishFreehand() {
      const pts = freehand ? freehand.points : [];
      freehand = null;
      if (pts.length < 3) return;
      const b = PathGeom.bounds(pts);
      const first = pts[0], last = pts[pts.length - 1];
      const closed = Math.hypot(first.x - last.x, first.y - last.y) < Math.max(2, 0.08 * Math.hypot(b.w, b.h));
      const tol = Math.max(0.05, parseFloat(els.freehandSmoothing.value) || 0.4);
      const path = PathGeom.fitPath(closed ? pts.slice(0, -1) : pts, closed, tol);
      if (path.nodes.length < 2) return;
      const shape = makePathShape(path);
      state.shapes.push(shape);
      selectShape(shape.id);
      pushHistory();
    }

    // ---------- trace tool ----------
    //
    // Click an object on the reference image: everything that differs from the
    // image's background (or, for transparent images, is opaque) and touches
    // the clicked point becomes one smooth cut path.

    let traceCache = null; // { src, data, w, h }

    function referencePixels() {
      if (!state.imageDataUrl) return Promise.resolve(null);
      if (traceCache && traceCache.src === state.imageDataUrl) return Promise.resolve(traceCache);
      return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
          const s = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
          const c = document.createElement('canvas');
          c.width = Math.max(1, Math.round(img.naturalWidth * s));
          c.height = Math.max(1, Math.round(img.naturalHeight * s));
          const ctx = c.getContext('2d', { willReadFrequently: true });
          ctx.drawImage(img, 0, 0, c.width, c.height);
          traceCache = { src: state.imageDataUrl, data: ctx.getImageData(0, 0, c.width, c.height).data, w: c.width, h: c.height };
          resolve(traceCache);
        };
        img.onerror = () => resolve(null);
        img.src = state.imageDataUrl;
      });
    }

    async function tracePointerDown(evt) {
      const p = svgPoint(evt);
      const px = await referencePixels();
      if (!px) {
        PnP.toast('Add a reference image first, then click an object on it to trace its outline.', 'error');
        return;
      }
      // The reference image is stretched over the card.
      const ix = Math.floor((p.x / state.cardW) * px.w), iy = Math.floor((p.y / state.cardH) * px.h);
      if (ix < 0 || iy < 0 || ix >= px.w || iy >= px.h) return;
      const tolerance = parseFloat(els.traceTolerance.value) || 40;
      const mask = Raster.objectMask(px.data, px.w, px.h, iy * px.w + ix, tolerance);
      if (!mask) {
        PnP.toast('Nothing to trace there — try a higher tolerance.', 'error');
        return;
      }
      const sx = state.cardW / px.w, sy = state.cardH / px.h;
      const outline = Raster.traceOuter(mask, px.w, px.h).map((q) => ({ x: q.x * sx, y: q.y * sy }));
      const tol = Math.max(0.05, parseFloat(els.traceSmoothing.value) || 0.3);
      const path = PathGeom.fitPath(outline, true, tol, 45);
      if (path.nodes.length < 3) {
        PnP.toast('That region is too small to trace.', 'error');
        return;
      }
      const shape = makePathShape(path);
      state.shapes.push(shape);
      selectShape(shape.id);
      fullRender();
      pushHistory();
    }

    // ---------- transparent reference images ----------
    //
    // Images with transparent pixels get a checkerboard behind them, and
    // their transparent / opaque borders can become shapes in one go.

    const ALPHA_OPAQUE = 128;

    function pixelsHaveAlpha(px) {
      for (let i = 3; i < px.data.length; i += 4) if (px.data[i] < 250) return true;
      return false;
    }

    function showImageAlpha(hasAlpha) {
      state.imageHasAlpha = hasAlpha;
      const checker = hasAlpha && state.imageVisible;
      svg.classList.toggle('has-alpha', checker);
      bgRect.style.display = checker ? 'none' : '';
      if (els.alphaPanel) els.alphaPanel.hidden = !hasAlpha;
    }

    function touchesEdge(mask, w, h) {
      for (let x = 0; x < w; x++) if (mask[x] || mask[(h - 1) * w + x]) return true;
      for (let y = 0; y < h; y++) if (mask[y * w] || mask[y * w + w - 1]) return true;
      return false;
    }

    // Opaque regions become closed outlines; with holes, transparent regions
    // enclosed by opaque pixels do too. Regions under minArea mm² are specks.
    async function traceTransparency({ layer, holes = true, smoothing, minArea = 1 } = {}) {
      const px = await referencePixels();
      if (!px || !pixelsHaveAlpha(px)) return [];
      const { w, h } = px;
      const n = w * h;
      const opaque = new Uint8Array(n);
      for (let i = 0; i < n; i++) opaque[i] = px.data[i * 4 + 3] >= ALPHA_OPAQUE ? 1 : 0;
      const sx = state.cardW / w, sy = state.cardH / h;
      const minPx = Math.max(4, minArea / (sx * sy));
      const tol = Math.max(0.05, smoothing != null ? smoothing : parseFloat(els.traceSmoothing && els.traceSmoothing.value) || 0.3);
      const regions = Raster.components(opaque, w, h, minPx);
      if (holes) {
        const clear = opaque.map((v) => 1 - v);
        // Transparency touching the image edge is the outside, not a hole.
        Raster.components(clear, w, h, minPx).forEach((c) => { if (!touchesEdge(c.mask, w, h)) regions.push(c); });
      }
      const created = [];
      regions.forEach(({ mask }) => {
        const outline = Raster.traceOuter(mask, w, h).map((q) => ({ x: q.x * sx, y: q.y * sy }));
        const path = PathGeom.fitPath(outline, true, tol, 45);
        if (path.nodes.length < 3) return;
        const shape = makePathShape(path, layer);
        state.shapes.push(shape);
        created.push(shape.id);
      });
      if (created.length) {
        selectShapes(created);
        fullRender();
        pushHistory();
      }
      return created;
    }

    function wireAlpha() {
      if (!els.alphaTraceBtn) return;
      els.alphaTraceBtn.addEventListener('click', async () => {
        const ids = await traceTransparency({ layer: els.alphaLayer.value, holes: els.alphaHoles.checked });
        if (ids.length) PnP.toast(`Created ${ids.length} outline${ids.length === 1 ? '' : 's'}.`, 'success');
        else PnP.toast('No transparent edges found.', 'error');
      });
    }

    // ---------- node editing ----------
    //
    // The node tool edits one path: drag nodes or Bézier handles, double-click
    // a node to toggle smooth/corner, double-click the outline to add a node,
    // Delete removes the selected node. Rects, ellipses and lines are
    // converted to paths when node editing starts.

    let nodeEdit = null; // { id, sel }

    function nodeTarget() {
      return nodeEdit ? state.shapes.find((s) => s.id === nodeEdit.id) || null : null;
    }

    function startNodeEdit(id) {
      const shape = state.shapes.find((s) => s.id === id);
      if (!shape) return;
      if (shape.type !== 'path') {
        convertToPath(shape);
        pushHistory();
      }
      if (state.tool !== 'node') setTool('node', { keepSelection: true });
      nodeEdit = { id, sel: null };
      state.selectedIds = [id];
      fullRender();
    }

    function nodePointerDown(evt) {
      const nodeEl = evt.target.closest('[data-node]');
      const handleEl = evt.target.closest('[data-bez]');
      const shapeEl = evt.target.closest('.shape-el');
      const target = nodeTarget();
      if (target && (nodeEl || handleEl)) {
        const index = parseInt((nodeEl || handleEl).dataset.node, 10);
        nodeEdit.sel = index;
        drag = {
          mode: nodeEl ? 'node-move' : 'node-handle',
          which: handleEl ? handleEl.dataset.bez : null,
          index,
          frame: { x: target.x, y: target.y, w: target.w, h: target.h, rotation: target.rotation },
          path0: localPath(target),
        };
        window.addEventListener('pointermove', onDragMove);
        window.addEventListener('pointerup', onDragEnd);
        evt.stopPropagation();
        renderOverlay();
        return;
      }
      if (shapeEl) {
        const id = parseInt(shapeEl.dataset.id, 10);
        if (!target || id !== target.id) startNodeEdit(id);
        return;
      }
      if (nodeEdit) nodeEdit.sel = null;
      renderOverlay();
    }

    // Pointer position in the shape's local frame at drag start.
    function toFrameLocal(frame, p) {
      return localFromWorld(frame, p);
    }

    function applyNodeDrag(evt, p) {
      const shape = nodeTarget();
      if (!shape) return;
      const path = { closed: drag.path0.closed, nodes: drag.path0.nodes.map((n) => ({ ...n, hi: n.hi && { ...n.hi }, ho: n.ho && { ...n.ho } })) };
      const node = path.nodes[drag.index];
      let guides = [];
      if (drag.mode === 'node-move') {
        // Snap the node (to the grid, other shapes and this path's other nodes).
        const others = drag.path0.nodes.filter((_, i) => i !== drag.index).map((n) => worldFromLocal(drag.frame, n));
        const res = resolvePointSnap(p, [shape.id], snapOnFor(evt), others);
        guides = res.guides;
        const L = toFrameLocal(drag.frame, { x: res.x, y: res.y });
        const dx = L.x - node.x, dy = L.y - node.y;
        node.x += dx; node.y += dy;
        if (node.hi) { node.hi.x += dx; node.hi.y += dy; }
        if (node.ho) { node.ho.x += dx; node.ho.y += dy; }
      } else {
        const L = toFrameLocal(drag.frame, p);
        const key = drag.which, other = key === 'hi' ? 'ho' : 'hi';
        node[key] = { x: L.x, y: L.y };
        // Smooth nodes keep their handles in line (Alt breaks the link).
        if (node.smooth && node[other] && !evt.altKey) {
          const len = Math.hypot(node[other].x - node.x, node[other].y - node.y);
          const vx = node.x - L.x, vy = node.y - L.y;
          const vl = Math.hypot(vx, vy) || 1;
          node[other] = { x: node.x + (vx / vl) * len, y: node.y + (vy / vl) * len };
        } else if (evt.altKey) {
          node.smooth = false;
        }
      }
      Object.assign(shape, drag.frame);
      setLocalPath(shape, path);
      return guides;
    }

    function toggleNodeSmooth(index) {
      const shape = nodeTarget();
      if (!shape) return;
      const path = localPath(shape);
      const n = path.nodes[index];
      if (n.hi || n.ho) {
        path.nodes[index] = { x: n.x, y: n.y };
      } else {
        path.nodes[index] = PathGeom.makeSmooth(path.nodes, index, path.closed);
      }
      setLocalPath(shape, path);
      fullRender();
      pushHistory();
    }

    function insertNodeAt(p) {
      const shape = nodeTarget();
      if (!shape) return;
      const path = localPath(shape);
      const L = localFromWorld(shape, p);
      const near = PathGeom.nearest(path, L);
      if (near.seg < 0) return;
      const res = PathGeom.insertNode(path, near.seg, near.t);
      setLocalPath(shape, res);
      nodeEdit.sel = res.index;
      fullRender();
      pushHistory();
    }

    function deleteSelectedNode() {
      const shape = nodeTarget();
      if (!shape || nodeEdit.sel == null) return false;
      const path = localPath(shape);
      if (path.nodes.length <= (path.closed ? 3 : 2)) {
        PnP.toast('A path needs at least ' + (path.closed ? 3 : 2) + ' nodes.', 'error');
        return true;
      }
      path.nodes.splice(nodeEdit.sel, 1);
      nodeEdit.sel = null;
      setLocalPath(shape, path);
      fullRender();
      pushHistory();
      return true;
    }

    function renderNodeOverlay() {
      const shape = nodeTarget();
      if (!shape) return;
      const wp = worldPath(shape);
      const r = HANDLE_R_PX * 0.8 / (PX_PER_MM * state.zoom);
      const outline = document.createElementNS(SVG_NS, 'path');
      outline.setAttribute('d', PathGeom.toD(wp));
      outline.setAttribute('class', 'node-outline');
      outline.setAttribute('vector-effect', 'non-scaling-stroke');
      overlayGroup.appendChild(outline);

      // Handles for the selected node and the facing handles of its neighbours.
      const n = wp.nodes.length;
      const showHandles = new Set();
      if (nodeEdit.sel != null) {
        showHandles.add(nodeEdit.sel);
        if (wp.closed || nodeEdit.sel > 0) showHandles.add((nodeEdit.sel - 1 + n) % n);
        if (wp.closed || nodeEdit.sel < n - 1) showHandles.add((nodeEdit.sel + 1) % n);
      }
      showHandles.forEach((i) => {
        const node = wp.nodes[i];
        ['hi', 'ho'].forEach((key) => {
          const h = node[key];
          if (!h) return;
          const line = document.createElementNS(SVG_NS, 'line');
          line.setAttribute('x1', node.x); line.setAttribute('y1', node.y);
          line.setAttribute('x2', h.x); line.setAttribute('y2', h.y);
          line.setAttribute('class', 'bez-line');
          line.setAttribute('vector-effect', 'non-scaling-stroke');
          overlayGroup.appendChild(line);
          const c = document.createElementNS(SVG_NS, 'circle');
          c.setAttribute('cx', h.x); c.setAttribute('cy', h.y); c.setAttribute('r', r * 0.8);
          c.setAttribute('class', 'bez-handle');
          c.dataset.node = i;
          c.dataset.bez = key;
          c.setAttribute('vector-effect', 'non-scaling-stroke');
          overlayGroup.appendChild(c);
        });
      });
      wp.nodes.forEach((node, i) => {
        const q = document.createElementNS(SVG_NS, 'rect');
        q.setAttribute('x', node.x - r); q.setAttribute('y', node.y - r);
        q.setAttribute('width', 2 * r); q.setAttribute('height', 2 * r);
        q.setAttribute('class', 'node-handle' + (i === nodeEdit.sel ? ' selected' : '') + (node.smooth ? ' smooth' : ''));
        q.dataset.node = i;
        q.setAttribute('vector-effect', 'non-scaling-stroke');
        overlayGroup.appendChild(q);
      });
    }

    // ---------- drafts (pen / freehand previews) ----------

    function renderDraft() {
      overlayGroup.querySelectorAll('.draft').forEach((n) => n.remove());
      const color = state.layerColors[state.activeLayer];
      const addPath = (d, dashed) => {
        const el = document.createElementNS(SVG_NS, 'path');
        el.setAttribute('d', d);
        el.setAttribute('class', 'draft');
        el.setAttribute('fill', 'none');
        el.setAttribute('stroke', color);
        el.setAttribute('stroke-width', '2.5');
        if (dashed) el.setAttribute('stroke-dasharray', '1,0.6');
        el.setAttribute('vector-effect', 'non-scaling-stroke');
        overlayGroup.appendChild(el);
      };
      if (penDraft && penDraft.nodes.length) {
        addPath(PathGeom.toD({ nodes: penDraft.nodes, closed: false }), false);
        if (penCursor && !drag) {
          const last = penDraft.nodes[penDraft.nodes.length - 1];
          addPath(PathGeom.toD({ nodes: [last, { x: penCursor.x, y: penCursor.y }], closed: false }), true);
        }
        const r = HANDLE_R_PX * 0.7 / (PX_PER_MM * state.zoom);
        penDraft.nodes.forEach((node, i) => {
          const q = document.createElementNS(SVG_NS, 'rect');
          q.setAttribute('x', node.x - r); q.setAttribute('y', node.y - r);
          q.setAttribute('width', 2 * r); q.setAttribute('height', 2 * r);
          q.setAttribute('class', 'draft node-handle' + (i === 0 ? ' first' : ''));
          q.setAttribute('vector-effect', 'non-scaling-stroke');
          overlayGroup.appendChild(q);
        });
      }
      if (freehand && freehand.points.length > 1) {
        addPath('M' + freehand.points.map((p) => `${p.x} ${p.y}`).join(' L'), false);
      }
    }

    function cancelDrafts() {
      penDraft = null;
      penCursor = null;
      freehand = null;
      if (overlayGroup) {
        overlayGroup.querySelectorAll('.draft, .snap-guide, .snap-point, .measure').forEach((n) => n.remove());
      }
    }

    // Snapped pointer position for drawing tools.
    function snappedPoint(evt) {
      const raw = svgPoint(evt);
      const res = resolvePointSnap(raw, [], snapOnFor(evt), penDraft ? penDraft.nodes : []);
      return { x: res.x, y: res.y };
    }

    // Hover feedback for drawing tools: snap guides/marker, pen rubber band.
    document.addEventListener('pointermove', (evt) => {
      if (drag || panDrag || marquee || !svg || !overlayGroup) return;
      if (!['line', 'rect', 'ellipse', 'pen'].includes(state.tool)) return;
      if (!svg.contains(evt.target) && evt.target !== svg) return;
      const raw = svgPoint(evt);
      const snapped = resolvePointSnap(raw, [], snapOnFor(evt), penDraft ? penDraft.nodes : []);
      renderSnapGuides(snapped.guides);
      renderSnapPointMarker(snapped.guides.length ? { x: snapped.x, y: snapped.y } : null);
      if (state.tool === 'pen' && penDraft) {
        penCursor = { x: snapped.x, y: snapped.y };
        renderDraft();
      }
    });

    svgDblClickHandlers.push((evt) => {
      if (state.tool === 'pen' && penDraft) {
        finishPen(false);
        return;
      }
      if (state.tool === 'node') {
        const nodeEl = evt.target.closest('[data-node]');
        if (nodeEl && !evt.target.closest('[data-bez]')) { toggleNodeSmooth(parseInt(nodeEl.dataset.node, 10)); return; }
        const shapeEl = evt.target.closest('.shape-el');
        if (shapeEl && nodeTarget() && parseInt(shapeEl.dataset.id, 10) === nodeEdit.id) insertNodeAt(svgPoint(evt));
        return;
      }
      if (state.tool === 'select') {
        const shapeEl = evt.target.closest('.shape-el');
        if (shapeEl) startNodeEdit(parseInt(shapeEl.dataset.id, 10));
      }
    });

    // ---------- selection ----------

    function selectShapes(ids) {
      state.selectedIds = [...new Set(ids)];
      refreshProps();
      renderOverlay();
      renderImportList();
    }

    function selectShape(id) {
      selectShapes(id == null ? [] : [id]);
    }

    function toggleSelect(id) {
      const set = new Set(state.selectedIds);
      if (set.has(id)) set.delete(id); else set.add(id);
      selectShapes([...set]);
    }

    // ---- marquee (click-drag box selection) ----

    let marquee = null;

    function startMarqueeDrag(evt) {
      const p = svgPoint(evt);
      marquee = { start: p, additive: evt.shiftKey, base: evt.shiftKey ? [...state.selectedIds] : [] };
      window.addEventListener('pointermove', onMarqueeMove);
      window.addEventListener('pointerup', onMarqueeEnd);
    }

    function onMarqueeMove(evt) {
      if (!marquee) return;
      const p = svgPoint(evt);
      const box = normBox(marquee.start.x, marquee.start.y, p.x, p.y);
      const hits = state.shapes.filter((s) => boxesIntersect(s, box)).map((s) => s.id);
      const ids = marquee.additive ? [...new Set([...marquee.base, ...hits])] : hits;
      selectShapes(ids);
      renderMarqueeRect(box);
    }

    function onMarqueeEnd() {
      window.removeEventListener('pointermove', onMarqueeMove);
      window.removeEventListener('pointerup', onMarqueeEnd);
      marquee = null;
      renderMarqueeRect(null);
    }

    function renderMarqueeRect(box) {
      overlayGroup.querySelectorAll('.marquee-rect').forEach((n) => n.remove());
      if (!box) return;
      const r = document.createElementNS(SVG_NS, 'rect');
      r.setAttribute('x', box.x);
      r.setAttribute('y', box.y);
      r.setAttribute('width', box.w);
      r.setAttribute('height', box.h);
      r.setAttribute('class', 'marquee-rect');
      r.setAttribute('vector-effect', 'non-scaling-stroke');
      overlayGroup.appendChild(r);
    }

    // ---------- arrange: align, distribute, flip, rotate, order ----------

    // The shape's actual outline in card space (curves sampled), for bounds.
    function worldOutline(shape) {
      if (shape.type === 'line') {
        const { p1, p2 } = lineEndpointsWorld(shape);
        return [p1, p2];
      }
      const clone = convertToPath(JSON.parse(JSON.stringify(shape)));
      return PathGeom.flatten(worldPath(clone));
    }

    function bboxOf(shape) {
      return PathGeom.bounds(worldOutline(shape));
    }

    function unionBox(shapes) {
      return PathGeom.bounds(shapes.flatMap((s) => worldOutline(s)));
    }

    function selectedShapes() {
      const ids = new Set(state.selectedIds);
      return state.shapes.filter((s) => ids.has(s.id));
    }

    // One shape aligns to the card; several align to their combined bounds.
    function alignSelection(mode) {
      const shapes = selectedShapes();
      if (!shapes.length) return;
      const ref = shapes.length === 1 ? { x: 0, y: 0, w: state.cardW, h: state.cardH } : unionBox(shapes);
      shapes.forEach((s) => {
        const b = bboxOf(s);
        let dx = 0, dy = 0;
        if (mode === 'left') dx = ref.x - b.x;
        if (mode === 'hcenter') dx = ref.x + ref.w / 2 - (b.x + b.w / 2);
        if (mode === 'right') dx = ref.x + ref.w - (b.x + b.w);
        if (mode === 'top') dy = ref.y - b.y;
        if (mode === 'vcenter') dy = ref.y + ref.h / 2 - (b.y + b.h / 2);
        if (mode === 'bottom') dy = ref.y + ref.h - (b.y + b.h);
        s.x += dx; s.y += dy;
      });
      fullRender();
      pushHistory();
    }

    // Equal gaps between neighbours (needs 3+ shapes).
    function distributeSelection(axis) {
      const shapes = selectedShapes();
      if (shapes.length < 3) {
        PnP.toast('Select at least 3 shapes to distribute.', 'error');
        return;
      }
      const pos = axis === 'x' ? 'x' : 'y', size = axis === 'x' ? 'w' : 'h';
      const items = shapes.map((s) => ({ s, b: bboxOf(s) })).sort((a, b) => a.b[pos] - b.b[pos]);
      const first = items[0].b, last = items[items.length - 1].b;
      const span = last[pos] + last[size] - first[pos];
      const gap = (span - items.reduce((a, it) => a + it.b[size], 0)) / (items.length - 1);
      let cursor = first[pos];
      items.forEach((it) => {
        it.s[pos] += cursor - it.b[pos];
        cursor += it.b[size] + gap;
      });
      fullRender();
      pushHistory();
    }

    function mirrorShapeGeometry(s, axis) {
      s.rotation = s.rotation ? -s.rotation : 0;
      if (s.type === 'line') s.diag = s.diag === 'tlbr' ? 'trbl' : 'tlbr';
      if (s.type === 'path') {
        const f = axis === 'x' ? (p) => ({ ...p, fx: 1 - p.fx }) : (p) => ({ ...p, fy: 1 - p.fy });
        s.nodes = s.nodes.map((n) => {
          const o = f(n);
          if (n.hi) o.hi = f(n.hi);
          if (n.ho) o.ho = f(n.ho);
          return o;
        });
      }
    }

    // Mirror each shape and its position across the selection's centre line.
    function flipSelection(axis) {
      const shapes = selectedShapes();
      if (!shapes.length) return;
      const u = unionBox(shapes);
      const cx = u.x + u.w / 2, cy = u.y + u.h / 2;
      shapes.forEach((s) => {
        const c = worldCenter(s);
        mirrorShapeGeometry(s, axis);
        if (axis === 'x') s.x += 2 * (cx - c.x);
        else s.y += 2 * (cy - c.y);
      });
      fullRender();
      pushHistory();
    }

    function rotateShapesAround(shapes, center, deg) {
      shapes.forEach((s) => {
        const c = worldCenter(s);
        const v = rotateVec({ x: c.x - center.x, y: c.y - center.y }, deg);
        s.x += center.x + v.x - c.x;
        s.y += center.y + v.y - c.y;
        let r = (s.rotation || 0) + deg;
        r = ((r % 360) + 540) % 360 - 180;
        s.rotation = r;
      });
    }

    function rotateSelection(deg) {
      const shapes = selectedShapes();
      if (!shapes.length) return;
      const u = unionBox(shapes);
      rotateShapesAround(shapes, { x: u.x + u.w / 2, y: u.y + u.h / 2 }, deg);
      fullRender();
      pushHistory();
    }

    // Stacking order = order in state.shapes (later draws on top).
    function reorderSelection(where) {
      const ids = new Set(state.selectedIds);
      if (!ids.size) return;
      const list = state.shapes;
      if (where === 'front') state.shapes = list.filter((s) => !ids.has(s.id)).concat(list.filter((s) => ids.has(s.id)));
      else if (where === 'back') state.shapes = list.filter((s) => ids.has(s.id)).concat(list.filter((s) => !ids.has(s.id)));
      else if (where === 'forward') {
        for (let i = list.length - 2; i >= 0; i--) if (ids.has(list[i].id) && !ids.has(list[i + 1].id)) [list[i], list[i + 1]] = [list[i + 1], list[i]];
      } else if (where === 'backward') {
        for (let i = 1; i < list.length; i++) if (ids.has(list[i].id) && !ids.has(list[i - 1].id)) [list[i], list[i - 1]] = [list[i - 1], list[i]];
      }
      fullRender();
      pushHistory();
    }

    function cloneShapes(shapes, dx, dy) {
      return shapes.map((s) => {
        const c = JSON.parse(JSON.stringify(s));
        c.id = state.nextId++;
        c.x += dx; c.y += dy;
        delete c._preview;
        delete c.source;
        return c;
      });
    }

    function duplicateSelection() {
      const shapes = selectedShapes();
      if (!shapes.length) return;
      const d = gridStep() || 5;
      const copies = cloneShapes(shapes, d, d);
      state.shapes.push(...copies);
      selectShapes(copies.map((c) => c.id));
      fullRender();
      pushHistory();
    }

    // ---------- array (grid / circular copies) ----------
    //
    // Previews are real shapes flagged _preview (drawn faded); Create keeps
    // them, Cancel removes them.

    function clearArrayPreview() {
      state.shapes = state.shapes.filter((s) => !s._preview);
    }

    function arrayCopies(shapes) {
      const f = (id) => parseFloat(els[id].value) || 0;
      const copies = [];
      if (els.arrayMode.value === 'grid') {
        const rows = Math.max(1, Math.round(f('arrayRows'))), cols = Math.max(1, Math.round(f('arrayCols')));
        const u = unionBox(shapes);
        const pitch = els.arraySpacing.value === 'pitch';
        const px = pitch ? f('arrayGapX') : u.w + f('arrayGapX');
        const py = pitch ? f('arrayGapY') : u.h + f('arrayGapY');
        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            if (r === 0 && c === 0) continue;
            copies.push(...cloneShapes(shapes, c * px, r * py));
          }
        }
      } else {
        const count = Math.max(1, Math.round(f('arrayCount')));
        const total = f('arrayAngle') || 360;
        const u = unionBox(shapes);
        const center = els.arrayCenter.value === 'card'
          ? { x: state.cardW / 2, y: state.cardH / 2 }
          : els.arrayCenter.value === 'selection'
            ? { x: u.x + u.w / 2, y: u.y + u.h / 2 }
            : { x: f('arrayCx'), y: f('arrayCy') };
        const full = Math.abs(Math.abs(total) - 360) < 1e-6;
        const step = full ? total / count : total / Math.max(1, count - 1);
        for (let k = 1; k < count; k++) {
          const copy = cloneShapes(shapes, 0, 0);
          if (els.arrayRotate.checked) {
            rotateShapesAround(copy, center, k * step);
          } else {
            // Move only: rotate each copy's centre around the pivot.
            copy.forEach((c) => {
              const cc = worldCenter(c);
              const v = rotateVec({ x: cc.x - center.x, y: cc.y - center.y }, k * step);
              c.x += center.x + v.x - cc.x;
              c.y += center.y + v.y - cc.y;
            });
          }
          copies.push(...copy);
        }
      }
      return copies;
    }

    let arraySource = null;

    function updateArrayPreview() {
      if (!arraySource) return;
      clearArrayPreview();
      const grid = els.arrayMode.value === 'grid';
      els.arrayGridFields.hidden = !grid;
      els.arrayCircleFields.hidden = grid;
      els.arrayCustomCenter.hidden = els.arrayCenter.value !== 'custom';
      const copies = arrayCopies(arraySource);
      copies.forEach((c) => { c._preview = true; });
      state.shapes.push(...copies);
      renderShapes();
      els.arrayInfo.textContent = `${copies.length} cop${copies.length === 1 ? 'y' : 'ies'} will be added.`;
    }

    function openArrayDialog() {
      const shapes = selectedShapes();
      if (!shapes.length) {
        PnP.toast('Select the shape(s) to repeat first.', 'error');
        return;
      }
      arraySource = shapes;
      els.arrayDialog.showModal();
      updateArrayPreview();
    }

    function closeArrayDialog(create) {
      if (!arraySource) return;
      const previews = state.shapes.filter((s) => s._preview);
      if (create) {
        previews.forEach((s) => { delete s._preview; });
        selectShapes([...arraySource.map((s) => s.id), ...previews.map((s) => s.id)]);
        pushHistory();
      } else {
        clearArrayPreview();
      }
      arraySource = null;
      fullRender();
      if (els.arrayDialog.open) els.arrayDialog.close();
    }

    // ---------- offset path ----------
    //
    // Rasterise the selection at high resolution, grow/shrink it with an exact
    // distance transform, and trace the result back into smooth paths. Robust
    // for curves and concave corners; open paths get a band around them.

    function shapePath2D(shape) {
      if (shape.type === 'line') {
        const { p1, p2 } = lineEndpointsWorld(shape);
        return { d: `M${p1.x} ${p1.y} L${p2.x} ${p2.y}`, closed: false };
      }
      const clone = convertToPath(JSON.parse(JSON.stringify(shape)));
      const wp = worldPath(clone);
      return { d: PathGeom.toD(wp), closed: wp.closed };
    }

    function offsetSelection(dist, layerChoice) {
      const shapes = selectedShapes();
      if (!shapes.length) return 0;
      const u = unionBox(shapes);
      const margin = Math.abs(dist) + 2;
      const bx = u.x - margin, by = u.y - margin, bw = u.w + 2 * margin, bh = u.h + 2 * margin;
      const k = Math.min(20, 3000 / Math.max(bw, bh)); // px per mm
      const W = Math.ceil(bw * k), H = Math.ceil(bh * k);
      const mask = Raster.rasterize(W, H, (ctx) => {
        ctx.setTransform(k, 0, 0, k, -bx * k, -by * k);
        ctx.fillStyle = '#000';
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 1.5 / k;
        shapes.forEach((sh) => {
          const { d, closed } = shapePath2D(sh);
          const p2d = new Path2D(d);
          if (closed) ctx.fill(p2d); else ctx.stroke(p2d);
        });
      });
      const grown = Raster.offsetMask(mask, W, H, dist * k);
      const comps = Raster.components(grown, W, H, Math.max(4, (0.5 * k) ** 2));
      const layer = layerChoice === 'same' ? shapes[0].layer : layerChoice;
      const created = [];
      comps.forEach(({ mask: m }) => {
        const pts = Raster.traceOuter(m, W, H).map((q) => ({ x: bx + q.x / k, y: by + q.y / k }));
        const path = PathGeom.fitPath(pts, true, Math.max(0.03, 0.6 / k), 35);
        if (path.nodes.length < 3) return;
        const shape = makePathShape(path, layer);
        state.shapes.push(shape);
        created.push(shape.id);
      });
      if (created.length) {
        selectShapes(created);
        fullRender();
        pushHistory();
      }
      return created.length;
    }

    function wireArrange() {
      els.arrangePanel.addEventListener('click', (e) => {
        const b = e.target.closest('button[data-arrange]');
        if (!b) return;
        const [kind, arg] = b.dataset.arrange.split(':');
        if (kind === 'align') alignSelection(arg);
        else if (kind === 'distribute') distributeSelection(arg);
        else if (kind === 'flip') flipSelection(arg);
        else if (kind === 'rotate') rotateSelection(parseFloat(arg));
        else if (kind === 'order') reorderSelection(arg);
        else if (kind === 'duplicate') duplicateSelection();
        else if (kind === 'array') openArrayDialog();
        else if (kind === 'offset') {
          if (!state.selectedIds.length) return;
          els.offsetDialog.showModal();
        } else if (kind === 'nodes') {
          const sel = selectedShape();
          if (sel) startNodeEdit(sel.id);
        }
      });
      ['arrayMode', 'arrayRows', 'arrayCols', 'arrayGapX', 'arrayGapY', 'arraySpacing', 'arrayCount', 'arrayAngle', 'arrayCenter', 'arrayCx', 'arrayCy', 'arrayRotate']
        .forEach((id) => {
          els[id].addEventListener('input', updateArrayPreview);
          els[id].addEventListener('change', updateArrayPreview);
        });
      els.arrayCreate.addEventListener('click', () => closeArrayDialog(true));
      els.arrayCancel.addEventListener('click', () => closeArrayDialog(false));
      els.arrayDialog.addEventListener('cancel', () => closeArrayDialog(false));
      els.offsetCreate.addEventListener('click', () => {
        const n = offsetSelection(parseFloat(els.offsetDist.value) || 0, els.offsetLayer.value);
        els.offsetDialog.close();
        PnP.toast(n ? `Offset created ${n} path${n === 1 ? '' : 's'}.` : 'Nothing left after offsetting — try a smaller inward distance.', n ? 'success' : 'error');
      });
      els.offsetCancel.addEventListener('click', () => els.offsetDialog.close());
    }

    // ---------- SVG import ----------
    //
    // Geometry elements become editable paths in card millimetres. The file is
    // laid out off-screen so the browser resolves units, viewBox and
    // transforms (getCTM), then everything maps from CSS px to mm.

    const MM_PER_PX = 25.4 / 96;

    function elementPathData(el) {
      const n = (v) => (v && v.baseVal ? v.baseVal.value : 0);
      const tag = el.tagName.toLowerCase();
      if (tag === 'path') return el.getAttribute('d') || '';
      if (tag === 'rect') {
        const x = n(el.x), y = n(el.y), w = n(el.width), h = n(el.height);
        let rx = n(el.rx), ry = n(el.ry);
        if (!el.hasAttribute('rx')) rx = ry;
        if (!el.hasAttribute('ry')) ry = rx;
        rx = Math.min(rx, w / 2); ry = Math.min(ry, h / 2);
        if (!rx || !ry) return `M${x} ${y} H${x + w} V${y + h} H${x} Z`;
        return `M${x + rx} ${y} H${x + w - rx} A${rx} ${ry} 0 0 1 ${x + w} ${y + ry} V${y + h - ry} A${rx} ${ry} 0 0 1 ${x + w - rx} ${y + h} H${x + rx} A${rx} ${ry} 0 0 1 ${x} ${y + h - ry} V${y + ry} A${rx} ${ry} 0 0 1 ${x + rx} ${y} Z`;
      }
      if (tag === 'circle' || tag === 'ellipse') {
        const cx = n(el.cx), cy = n(el.cy);
        const rx = tag === 'circle' ? n(el.r) : n(el.rx), ry = tag === 'circle' ? n(el.r) : n(el.ry);
        return `M${cx + rx} ${cy} A${rx} ${ry} 0 1 1 ${cx - rx} ${cy} A${rx} ${ry} 0 1 1 ${cx + rx} ${cy} Z`;
      }
      if (tag === 'line') return `M${n(el.x1)} ${n(el.y1)} L${n(el.x2)} ${n(el.y2)}`;
      if (tag === 'polyline' || tag === 'polygon') {
        const pts = (el.getAttribute('points') || '').trim().split(/[\s,]+/).map(parseFloat);
        let d = '';
        for (let i = 0; i + 1 < pts.length; i += 2) d += `${i ? 'L' : 'M'}${pts[i]} ${pts[i + 1]} `;
        return tag === 'polygon' ? `${d}Z` : d;
      }
      return '';
    }

    function hexOf(color) {
      const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(color || '');
      if (!m) return null;
      return '#' + [m[1], m[2], m[3]].map((v) => (+v).toString(16).padStart(2, '0')).join('');
    }

    // Layer from a matching stroke colour or a cut/score/emboss group name.
    function importLayerFor(el) {
      const stroke = hexOf(getComputedStyle(el).stroke);
      const byColor = Object.keys(state.layerColors).find((k) => state.layerColors[k].toLowerCase() === stroke);
      if (byColor) return byColor;
      for (let a = el; a && a.getAttribute; a = a.parentNode) {
        const name = `${a.getAttribute('id') || ''} ${a.getAttribute('inkscape:label') || ''}`.toLowerCase();
        const hit = o.layers.find((l) => name.includes(l.id.toLowerCase()) || name.includes(l.label.toLowerCase().split('/')[0]));
        if (hit) return hit.id;
      }
      return state.activeLayer;
    }

    // Imported shapes remember their file as source: { id, name }, so the
    // import list can select or remove each file's shapes, even after undo
    // or reloading a project. Copies drop it (they are new shapes).
    function nextImportId() {
      return state.shapes.reduce((m, s) => Math.max(m, (s.source && s.source.id) || 0), 0) + 1;
    }

    function importSvgText(text, name = 'SVG') {
      const source = { id: nextImportId(), name };
      const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
      const root = doc.documentElement;
      if (!root || root.nodeName.toLowerCase() !== 'svg' || doc.querySelector('parsererror')) {
        throw new Error('This file is not a readable SVG.');
      }
      const svgEl = document.importNode(root, true);
      // Without an explicit size, one user unit is one CSS pixel.
      const vb = svgEl.viewBox && svgEl.viewBox.baseVal;
      if (!svgEl.getAttribute('width') && vb && vb.width) svgEl.setAttribute('width', vb.width);
      if (!svgEl.getAttribute('height') && vb && vb.height) svgEl.setAttribute('height', vb.height);
      const host = document.createElement('div');
      host.style.cssText = 'position:absolute;left:-100000px;top:0;visibility:hidden;';
      host.appendChild(svgEl);
      document.body.appendChild(host);
      const created = [];
      try {
        svgEl.querySelectorAll('path, rect, circle, ellipse, line, polyline, polygon').forEach((el) => {
          if (el.closest('defs, clipPath, mask, symbol, marker, pattern')) return;
          const d = elementPathData(el);
          if (!d) return;
          const m = el.getCTM();
          if (!m) return;
          const layer = importLayerFor(el);
          const map = (p) => ({ x: (m.a * p.x + m.c * p.y + m.e) * MM_PER_PX, y: (m.b * p.x + m.d * p.y + m.f) * MM_PER_PX });
          PathGeom.parseD(d).forEach((sub) => {
            const path = PathGeom.mapPath(sub, map);
            if (path.nodes.length < 2) return;
            const b = PathGeom.bounds(PathGeom.flatten(path));
            if (b.w < 0.01 && b.h < 0.01) return;
            const shape = makePathShape(path, layer);
            shape.source = { ...source };
            state.shapes.push(shape);
            created.push(shape.id);
          });
        });
      } finally {
        host.remove();
      }
      return created;
    }

    async function importSvgFiles(files) {
      const ids = [];
      for (const file of files) {
        try {
          const created = importSvgText(await file.text(), file.name);
          if (!created.length) PnP.toast(`No shapes found in ${file.name}.`, 'error');
          ids.push(...created);
        } catch (err) {
          PnP.toast(`${file.name}: ${err.message}`, 'error');
        }
      }
      if (!ids.length) return;
      selectShapes(ids);
      fullRender();
      pushHistory();
      PnP.toast(`Imported ${ids.length} shape${ids.length === 1 ? '' : 's'}.`, 'success');
    }

    function wireImport() {
      PnP.dropzone(els.importSvgDrop, {
        input: els.importSvgInput,
        accept: ['image/svg+xml', '.svg'],
        onFiles: importSvgFiles,
      });
      els.importList.addEventListener('click', (evt) => {
        const btn = evt.target.closest('[data-import-action]');
        if (!btn) return;
        const { importAction: action, importId, shapeId } = btn.dataset;
        const ids = shapeId
          ? [+shapeId]
          : state.shapes.filter((s) => s.source && s.source.id === +importId).map((s) => s.id);
        if (action === 'select') {
          if (state.tool !== 'select') setTool('select');
          selectShapes(ids);
        } else if (action === 'remove') {
          const idSet = new Set(ids);
          state.shapes = state.shapes.filter((s) => !idSet.has(s.id));
          state.selectedIds = state.selectedIds.filter((id) => !idSet.has(id));
          fullRender();
          pushHistory();
        }
      });
      els.importList.addEventListener('toggle', (evt) => {
        const id = +evt.target.dataset.importId;
        if (evt.target.open) openImports.add(id); else openImports.delete(id);
      }, true);
    }

    const openImports = new Set(); // import ids whose element list is expanded

    const SHAPE_NAMES = { rect: 'Rectangle', ellipse: 'Ellipse', line: 'Line', path: 'Path' };

    // One row per imported file (select all / remove all), expandable to one
    // row per shape. Rebuilt on every render; selection is highlighted.
    function renderImportList() {
      if (!els.importList) return;
      const groups = new Map();
      state.shapes.forEach((s) => {
        if (!s.source || s._preview) return;
        if (!groups.has(s.source.id)) groups.set(s.source.id, { name: s.source.name, shapes: [] });
        groups.get(s.source.id).shapes.push(s);
      });
      const selected = new Set(state.selectedIds);
      const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
      const layerLabel = (id) => (o.layers.find((l) => l.id === id) || { label: id }).label;
      els.importList.innerHTML = [...groups].map(([id, g]) => {
        const allSel = g.shapes.every((s) => selected.has(s.id));
        const rows = g.shapes.map((s, i) => `
            <div class="import-row${selected.has(s.id) ? ' selected' : ''}">
              <span class="import-swatch" style="background:${state.layerColors[s.layer]}"></span>
              <button type="button" class="import-name" data-import-action="select" data-shape-id="${s.id}" title="Select">${SHAPE_NAMES[s.type] || s.type} ${i + 1} <span class="import-layer">${esc(layerLabel(s.layer))}</span></button>
              <button type="button" class="remove-btn" data-import-action="remove" data-shape-id="${s.id}" title="Remove this shape" aria-label="Remove this shape">&times;</button>
            </div>`).join('');
        return `
          <details class="import-file${allSel ? ' selected' : ''}" data-import-id="${id}"${openImports.has(id) ? ' open' : ''}>
            <summary>
              <button type="button" class="import-name" data-import-action="select" data-import-id="${id}" title="Select every shape from this file">${esc(g.name)}</button>
              <span class="import-count">${g.shapes.length}</span>
              <button type="button" class="remove-btn" data-import-action="remove" data-import-id="${id}" title="Remove every shape from this file" aria-label="Remove every shape from this file">&times;</button>
            </summary>
            <div class="import-rows">${rows}</div>
          </details>`;
      }).join('');
    }

    // ---------- full render ----------

    function fullRender() {
      renderShapes();
      renderOverlay();
      refreshProps();
      renderImportList();
    }

    // ---------- history ----------

    function snapshot() {
      return JSON.stringify({ shapes: state.shapes.filter((s) => !s._preview), nextId: state.nextId });
    }

    function pushHistory() {
      const snap = snapshot();
      if (history[historyIndex] === snap) return;
      history = history.slice(0, historyIndex + 1);
      history.push(snap);
      if (history.length > 100) history.shift();
      historyIndex = history.length - 1;
      changeListeners.forEach((fn) => fn());
    }

    function restoreSnapshot(snap) {
      const data = JSON.parse(snap);
      state.shapes = data.shapes;
      state.nextId = data.nextId;
      state.selectedIds = [];
      fullRender();
    }

    const changeListeners = [];

    function undo() {
      if (historyIndex <= 0) return;
      historyIndex--;
      restoreSnapshot(history[historyIndex]);
      changeListeners.forEach((fn) => fn());
    }

    function redo() {
      if (historyIndex >= history.length - 1) return;
      historyIndex++;
      restoreSnapshot(history[historyIndex]);
      changeListeners.forEach((fn) => fn());
    }

    els.undoBtn.addEventListener('click', undo);
    els.redoBtn.addEventListener('click', redo);

    window.addEventListener('keyup', (evt) => {
      if (evt.key === ' ') {
        spaceDown = false;
        els.canvasWrap.classList.remove('pan-ready');
      }
    });

    // ---------- keyboard ----------

    window.addEventListener('keydown', (evt) => {
      // Shortcuts only pause while typing: checkboxes, buttons, sliders and
      // colour pickers keep focus after a click but take no letter keys.
      const active = document.activeElement;
      const tag = active && active.tagName;
      const typing = tag === 'INPUT' && !['checkbox', 'radio', 'range', 'button', 'color', 'file', 'submit'].includes(active.type);
      const inField = typing || tag === 'SELECT' || tag === 'TEXTAREA' || (active && active.isContentEditable);

      if ((evt.ctrlKey || evt.metaKey) && evt.key.toLowerCase() === 'z') {
        evt.preventDefault();
        if (evt.shiftKey) redo(); else undo();
        return;
      }
      if ((evt.ctrlKey || evt.metaKey) && evt.key.toLowerCase() === 'y') {
        evt.preventDefault();
        redo();
        return;
      }
      if ((evt.ctrlKey || evt.metaKey) && (evt.key === '=' || evt.key === '+')) {
        evt.preventDefault();
        zoomBy(1.25);
        return;
      }
      if ((evt.ctrlKey || evt.metaKey) && evt.key === '-') {
        evt.preventDefault();
        zoomBy(0.8);
        return;
      }
      if ((evt.ctrlKey || evt.metaKey) && evt.key === '0') {
        evt.preventDefault();
        setZoom(1);
        return;
      }
      if (!inField && evt.key === ' ' && !spaceDown) {
        spaceDown = true;
        evt.preventDefault();
        els.canvasWrap.classList.add('pan-ready');
        return;
      }
      if (inField) return;

      if (evt.shiftKey && evt.key === '1') {
        evt.preventDefault();
        fitZoom();
        return;
      }

      if ((evt.ctrlKey || evt.metaKey) && evt.key.toLowerCase() === 'a') {
        evt.preventDefault();
        selectAll();
        return;
      }
      if ((evt.ctrlKey || evt.metaKey) && evt.key.toLowerCase() === 'c') {
        evt.preventDefault();
        copySelected();
        return;
      }
      if ((evt.ctrlKey || evt.metaKey) && evt.key.toLowerCase() === 'x') {
        evt.preventDefault();
        cutSelected();
        return;
      }
      if ((evt.ctrlKey || evt.metaKey) && evt.key.toLowerCase() === 'd') {
        evt.preventDefault();
        duplicateSelection();
        return;
      }
      if ((evt.ctrlKey || evt.metaKey) && (evt.key === ']' || evt.key === '[')) {
        evt.preventDefault();
        reorderSelection(evt.key === ']' ? (evt.shiftKey ? 'front' : 'forward') : (evt.shiftKey ? 'back' : 'backward'));
        return;
      }
      if ((evt.ctrlKey || evt.metaKey) && evt.key.toLowerCase() === 'v') {
        evt.preventDefault();
        pasteClipboard();
        return;
      }

      if (evt.key === 'Escape') {
        // Esc finishes an open pen path, then leaves the tool.
        if (penDraft) { if (penDraft.nodes.length >= 2) finishPen(false); else { cancelDrafts(); renderOverlay(); } return; }
        if (state.tool === 'node') { const id = nodeEdit && nodeEdit.id; setTool('select'); if (id) selectShape(id); return; }
        if (state.tool !== 'select') { setTool('select'); return; }
        selectShape(null);
        return;
      }
      if (evt.shiftKey && !evt.ctrlKey && !evt.metaKey && (evt.key === 'H' || evt.key === 'V') && state.selectedIds.length) {
        evt.preventDefault();
        flipSelection(evt.key === 'H' ? 'x' : 'y');
        return;
      }
      if (!evt.ctrlKey && !evt.metaKey && !evt.altKey) {
        if (evt.key === 'Enter') {
          if (penDraft) { evt.preventDefault(); finishPen(false); return; }
          const sel = selectedShape();
          if (sel && state.tool === 'select') { evt.preventDefault(); startNodeEdit(sel.id); return; }
        }
        const toolKeys = { v: 'select', a: 'node', l: 'line', r: 'rect', e: 'ellipse', p: 'pen', f: 'freehand', t: 'trace' };
        const k = evt.key.toLowerCase();
        if (toolKeys[k]) { evt.preventDefault(); setTool(toolKeys[k]); return; }
        if (k === 'g') { evt.preventDefault(); setGrid(!view.grid); return; }
        if (k === 's') { evt.preventDefault(); setSnap(!snapEnabled); return; }
      }
      if ((evt.key === 'Delete' || evt.key === 'Backspace') && state.tool === 'node' && nodeEdit && nodeEdit.sel != null) {
        evt.preventDefault();
        deleteSelectedNode();
        return;
      }
      if ((evt.key === 'Delete' || evt.key === 'Backspace') && state.selectedIds.length) {
        evt.preventDefault();
        deleteSelected();
        return;
      }
      if (state.selectedIds.length && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(evt.key)) {
        evt.preventDefault();
        const step = evt.shiftKey ? 1 : 0.1;
        let dx = 0, dy = 0;
        if (evt.key === 'ArrowUp') dy = -step;
        if (evt.key === 'ArrowDown') dy = step;
        if (evt.key === 'ArrowLeft') dx = -step;
        if (evt.key === 'ArrowRight') dx = step;
        state.selectedIds.forEach((id) => {
          const s = state.shapes.find((sh) => sh.id === id);
          if (s) { s.x += dx; s.y += dy; }
        });
        fullRender();
        pushHistory();
      }
    });

    // ---------- export ----------

    function buildExportSVG(layers, mirror) {
      const fmt = (n) => Math.round(n * 1000) / 1000;
      // Flat paths with rotation and mirroring baked in: Cricut Design Space
      // mis-scales anything under a transform attribute.
      const content = state.shapes
        .filter((s) => layers.includes(s.layer))
        .map((s) => {
          let path = PathGeom.shapePath(s);
          if (!path) return '';
          if (mirror) path = PathGeom.mapPath(path, (p) => ({ x: state.cardW - p.x, y: p.y }));
          return `<path d="${PathGeom.toD(path, fmt)}" fill="none" stroke="${state.layerColors[s.layer]}" stroke-width="0.15"/>`;
        })
        .join('\n');
      return `<svg xmlns="${SVG_NS}" width="${fmt(state.cardW)}mm" height="${fmt(state.cardH)}mm" viewBox="0 0 ${fmt(state.cardW)} ${fmt(state.cardH)}">\n${content}\n</svg>`;
    }

    // ---------- init ----------

    buildCanvas();
    wireArrange();
    wireRulers();
    if (o.importSvg) wireImport();
    wireAlpha();
    setSnap(view.snap);
    setGrid(view.grid);
    updateCursor();
    fullRender();
    pushHistory();


    // ---------------------------------------------------------------- detect all

    // Every separate object on the reference image becomes a traced region
    // (anything that differs from the image background, larger than minArea mm²).
    async function detectObjects({ tolerance = 40, smoothing = 0.3, minArea = 25, layer } = {}) {
      const px = await referencePixels();
      if (!px) return [];
      const mask = Raster.foregroundMask(px.data, px.w, px.h, tolerance);
      const sx = state.cardW / px.w, sy = state.cardH / px.h;
      const minPx = Math.max(4, minArea / (sx * sy));
      const created = [];
      Raster.components(mask, px.w, px.h, minPx).forEach(({ mask: m }) => {
        const outline = Raster.traceOuter(m, px.w, px.h).map((q) => ({ x: q.x * sx, y: q.y * sy }));
        const path = PathGeom.fitPath(outline, true, Math.max(0.05, smoothing), 45);
        if (path.nodes.length < 3) return;
        const shape = makePathShape(path, layer);
        state.shapes.push(shape);
        created.push(shape.id);
      });
      if (created.length) {
        selectShapes(created);
        fullRender();
        pushHistory();
      }
      return created;
    }

    // ---------------------------------------------------------------- api

    const api = {
      get state() { return state; },
      setDocSize(w, h) {
        state.cardW = w;
        state.cardH = h;
        updateSvgSize();
        fullRender();
      },
      setImage(url) {
        state.imageDataUrl = url || null;
        traceCache = null;
        if (url) imageEl.setAttribute('href', url);
        else imageEl.removeAttribute('href');
        showImageAlpha(false);
        // Check for transparency once the pixels are decoded (unless the
        // image changed again meanwhile).
        if (url) referencePixels().then((px) => { if (px && state.imageDataUrl === url) showImageAlpha(pixelsHaveAlpha(px)); });
      },
      setImageVisible(visible) {
        state.imageVisible = visible;
        imageEl.style.display = visible ? '' : 'none';
        showImageAlpha(state.imageHasAlpha);
      },
      getShapes() {
        return JSON.parse(JSON.stringify(state.shapes.filter((s) => !s._preview)));
      },
      // Replace every shape (e.g. loading a project or switching pages).
      // history: a getHistory() result to restore that document's undo stack.
      setShapes(shapes, { resetHistory = false, history: saved = null } = {}) {
        state.shapes = JSON.parse(JSON.stringify(shapes || [])).map(migrateShape);
        state.nextId = state.shapes.reduce((m, s) => Math.max(m, s.id || 0), 0) + 1;
        state.selectedIds = [];
        if (nodeEdit) nodeEdit = null;
        if (saved && saved.entries && saved.entries[saved.index]) {
          history = saved.entries.slice();
          historyIndex = saved.index;
          state.nextId = Math.max(state.nextId, JSON.parse(history[historyIndex]).nextId || 0);
          fullRender();
          changeListeners.forEach((fn) => fn());
          return;
        }
        if (resetHistory) { history = []; historyIndex = -1; }
        fullRender();
        pushHistory();
      },
      // The undo stack, to keep one per document when the host switches between them.
      getHistory: () => ({ entries: history.slice(), index: historyIndex }),
      // Add shapes (ids are assigned); returns the new ids and selects them.
      addShapes(shapes) {
        const ids = shapes.map((s) => {
          const full = { rotation: 0, radius: 0, diag: 'tlbr', ...JSON.parse(JSON.stringify(s)), id: state.nextId++ };
          state.shapes.push(migrateShape(full));
          return full.id;
        });
        selectShapes(ids);
        fullRender();
        pushHistory();
        return ids;
      },
      select: (ids) => selectShapes(ids),
      get guides() { return state.guides; },
      setGuides(guides) {
        state.guides = Array.isArray(guides) ? guides : [];
        renderGuides();
      },
      get layerColors() { return { ...state.layerColors }; },
      setLayerColors(colors) {
        Object.assign(state.layerColors, colors || {});
        document.querySelectorAll('#layerBar .layer-color').forEach((input) => {
          input.value = state.layerColors[input.dataset.layer];
        });
        renderShapes();
      },
      exportSvg: (layers, mirror) => buildExportSVG(layers || LAYER_IDS, mirror),
      importSvg(text, name) {
        const ids = importSvgText(text, name);
        if (ids.length) { selectShapes(ids); fullRender(); pushHistory(); }
        return ids;
      },
      detectObjects,
      traceTransparency,
      get hasTransparency() { return state.imageHasAlpha; },
      fit: () => fitZoom(),
      setTool: (tool) => setTool(tool),
      onChange: (fn) => changeListeners.push(fn),
      // A shape as a path: its box/rotation frame, local-frame path and card-space path.
      geometry(shape) {
        const clone = convertToPath(JSON.parse(JSON.stringify(shape)));
        return {
          frame: { x: clone.x, y: clone.y, w: clone.w, h: clone.h, rotation: clone.rotation || 0 },
          local: localPath(clone),
          world: worldPath(clone),
        };
      },
    };
    return api;
    }

  return { create };
})();
