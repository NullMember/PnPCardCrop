// Freeform crop: draw or detect any-shaped regions on scanned pages and export
// each as a PNG with a transparent background. Uses the shared PnPTools vector
// editor; each region's own box is exported upright, so a rotated rectangle
// straightens a tilted card.

(() => {
  const $ = (id) => document.getElementById(id);
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

  const state = {
    files: [],   // source File objects (for projects)
    pages: [],   // { name, fileIndex, pageNo, url, pxW, pxH, dpi, shapes, thumb }
    current: -1,
  };

  const editor = PnPEditor.create({
    stage: $('editorStage'),
    props: $('editorProps'),
    options: $('editorOptions'),
    layers: [{ id: 'crop', label: 'Crop', color: '#e03131' }],
    tools: ['select', 'node', 'rect', 'ellipse', 'pen', 'freehand', 'trace'],
    docSize: { w: 210, h: 297 },
    viewKey: 'pnp:PnPCardCrop-freeform:view',
    regionFill: 0.14,
    docName: 'page',
  });

  function setStatus(message, type = 'info') {
    const el = $('status');
    el.hidden = !message;
    el.textContent = message || '';
    el.className = `status ${type}`;
  }

  // ---------- pages ----------

  const mmSize = (page) => ({ w: (page.pxW / page.dpi) * 25.4, h: (page.pxH / page.dpi) * 25.4 });

  function saveCurrentShapes() {
    if (state.current >= 0) state.pages[state.current].shapes = editor.getShapes();
  }

  function showPage(index) {
    saveCurrentShapes();
    state.current = index;
    const page = state.pages[index];
    const { w, h } = mmSize(page);
    editor.setDocSize(w, h);
    editor.setImage(page.url);
    editor.setShapes(page.shapes || [], { resetHistory: true });
    editor.fit();
    renderPageList();
    updateCounts();
  }

  function renderPageList() {
    const list = $('pageList');
    list.innerHTML = '';
    state.pages.forEach((page, i) => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'page-item' + (i === state.current ? ' current' : '');
      item.title = page.name;
      const img = document.createElement('img');
      img.src = page.thumb;
      img.alt = '';
      const label = document.createElement('span');
      const n = i === state.current ? editor.getShapes().length : (page.shapes || []).length;
      label.textContent = `${page.name}${n ? ` · ${n}` : ''}`;
      item.append(img, label);
      item.addEventListener('click', () => { if (i !== state.current) showPage(i); });
      list.append(item);
    });
  }

  function totalRegions() {
    saveCurrentShapes();
    return state.pages.reduce((n, p) => n + closedRegions(p.shapes || []).length, 0);
  }

  function updateCounts() {
    const here = state.current >= 0 ? closedRegions(editor.getShapes()).length : 0;
    const total = totalRegions();
    $('regionCount').textContent = state.pages.length
      ? `${here} region${here === 1 ? '' : 's'} on this page · ${total} in total`
      : 'Add a scan to start.';
    $('downloadBtn').disabled = total === 0;
    sendMenu.setEnabled(total > 0);
  }

  // Only closed shapes enclose something to crop.
  function closedRegions(shapes) {
    return shapes.filter((s) => s.type === 'rect' || s.type === 'ellipse' || (s.type === 'path' && s.closed));
  }

  function thumbOf(canvasOrImg) {
    const c = document.createElement('canvas');
    const s = Math.min(1, 160 / Math.max(canvasOrImg.width, canvasOrImg.height));
    c.width = Math.max(1, Math.round(canvasOrImg.width * s));
    c.height = Math.max(1, Math.round(canvasOrImg.height * s));
    c.getContext('2d').drawImage(canvasOrImg, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.8);
  }

  function loadImageEl(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Could not read the image.'));
      img.src = url;
    });
  }

  async function addFiles(files) {
    files = [...files].filter((f) => f.type.startsWith('image/') || f.type === 'application/pdf');
    if (!files.length) return;
    const first = state.pages.length;
    setStatus('Loading…', 'processing');
    for (const file of files) {
      const fileIndex = state.files.length;
      state.files.push(file);
      const base = file.name.replace(/\.[^.]+$/, '');
      try {
        if (file.type === 'application/pdf') {
          const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
          const dpi = parseFloat($('pdfDpi').value) || 300;
          for (let n = 1; n <= pdf.numPages; n++) {
            setStatus(`Rendering ${file.name}, page ${n} of ${pdf.numPages}…`, 'processing');
            const page = await pdf.getPage(n);
            const vp = page.getViewport({ scale: dpi / 72 });
            const c = document.createElement('canvas');
            c.width = Math.round(vp.width);
            c.height = Math.round(vp.height);
            await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
            const blob = await PnP.canvasToBlob(c, 'image/png');
            state.pages.push({ name: pdf.numPages > 1 ? `${base} p${n}` : base, fileIndex, pageNo: n, url: URL.createObjectURL(blob), pxW: c.width, pxH: c.height, dpi, shapes: [], thumb: thumbOf(c) });
          }
        } else {
          const url = URL.createObjectURL(file);
          const img = await loadImageEl(url);
          const dpi = (await PnP.readImageDpi(file)) || parseFloat($('scanDpi').value) || 300;
          state.pages.push({ name: base, fileIndex, pageNo: 0, url, pxW: img.naturalWidth, pxH: img.naturalHeight, dpi, shapes: [], thumb: thumbOf(img) });
        }
      } catch (err) {
        console.error(err);
        PnP.toast(`Could not open ${file.name}: ${err.message}`, 'error');
      }
    }
    setStatus('');
    if (state.pages.length > first) showPage(first);
  }

  // ---------- detection ----------

  $('detectBtn').addEventListener('click', async () => {
    if (state.current < 0) {
      PnP.toast('Add a scan first.', 'error');
      return;
    }
    const ids = await editor.detectObjects({
      tolerance: parseFloat($('traceTolerance').value) || 40,
      smoothing: parseFloat($('traceSmoothing').value) || 0.3,
      minArea: parseFloat($('minArea').value) || 40,
    });
    PnP.toast(ids.length ? `Found ${ids.length} object${ids.length === 1 ? '' : 's'}.` : 'No objects found — try a lower tolerance, or a scan with a plain background.', ids.length ? 'success' : 'error');
  });

  // ---------- export ----------

  // One region as a PNG: the region's own (unrotated) box at the scan's
  // resolution, image outside the outline made transparent.
  async function renderRegion(page, img, shape, marginMm) {
    const k = page.dpi / 25.4; // px per mm
    const g = editor.geometry(shape);
    const { w, h, rotation } = g.frame;
    const cx = g.frame.x + w / 2, cy = g.frame.y + h / 2;
    const W = Math.max(1, Math.round((w + 2 * marginMm) * k));
    const H = Math.max(1, Math.round((h + 2 * marginMm) * k));
    const docW = page.pxW / k, docH = page.pxH / k;

    const out = document.createElement('canvas');
    out.width = W;
    out.height = H;
    const ctx = out.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    // Local frame (origin at the box's top-left, margin added) <- card space
    ctx.setTransform(k, 0, 0, k, 0, 0);
    ctx.translate(marginMm + w / 2, marginMm + h / 2);
    ctx.rotate((-(rotation || 0) * Math.PI) / 180);
    ctx.translate(-cx, -cy);
    ctx.drawImage(img, 0, 0, docW, docH);

    // Mask: the outline (grown by the margin), in the same local frame.
    const mask = document.createElement('canvas');
    mask.width = W;
    mask.height = H;
    const mctx = mask.getContext('2d');
    mctx.setTransform(k, 0, 0, k, marginMm * k, marginMm * k);
    const outline = new Path2D(PathGeom.toD(g.local));
    mctx.fill(outline);
    if (marginMm > 0) {
      mctx.lineJoin = 'round';
      mctx.lineWidth = 2 * marginMm;
      mctx.stroke(outline);
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'destination-in';
    ctx.drawImage(mask, 0, 0);

    const blob = await PnP.canvasToBlob(out, 'image/png');
    return PnP.setPngDpi(blob, page.dpi);
  }

  async function exportItems() {
    saveCurrentShapes();
    const margin = Math.max(0, parseFloat($('cropMargin').value) || 0);
    const items = [];
    for (const page of state.pages) {
      const regions = closedRegions(page.shapes || []);
      if (!regions.length) continue;
      const img = await loadImageEl(page.url);
      // Name regions top-to-bottom, left-to-right, as they sit on the page.
      const ordered = regions
        .map((s) => ({ s, c: { x: s.x + s.w / 2, y: s.y + s.h / 2 } }))
        .sort((a, b) => (Math.abs(a.c.y - b.c.y) > 10 ? a.c.y - b.c.y : a.c.x - b.c.x));
      for (let i = 0; i < ordered.length; i++) {
        setStatus(`Exporting ${page.name}: ${i + 1} of ${ordered.length}…`, 'processing');
        const blob = await renderRegion(page, img, ordered[i].s, margin);
        items.push({ name: `${page.name.replace(/[\\/:*?"<>|]/g, '_')}-${String(i + 1).padStart(2, '0')}.png`, blob });
      }
    }
    setStatus('');
    return items;
  }

  $('downloadBtn').addEventListener('click', async () => {
    const btn = $('downloadBtn');
    btn.disabled = true;
    try {
      const items = await exportItems();
      const zip = await PnP.zip.create(items.map((it) => ({ name: it.name, data: it.blob })));
      PnP.downloadBlob(zip, 'freeform-crops.zip');
      setStatus(`Exported ${items.length} piece${items.length === 1 ? '' : 's'}.`, 'success');
    } catch (err) {
      console.error(err);
      setStatus(`Export failed: ${err.message}`, 'error');
    } finally {
      btn.disabled = false;
    }
  });

  const sendMenu = PnP.sendMenu($('sendSlot'), {
    from: 'Freeform crop',
    targets: ['PnPLayout', 'PnPAlign', 'PnPBleed', 'PnPTuckBox'],
    getItems: exportItems,
  });

  // ---------- wiring ----------

  editor.onChange(() => { updateCounts(); renderPageList(); });

  PnP.dropzone($('dropZone'), {
    input: $('fileInput'),
    accept: ['image/*', 'application/pdf', '.pdf'],
    onFiles: addFiles,
  });

  let projectFiles = [];
  PnP.init({
    tool: 'PnPCardCrop',
    settingsKey: 'PnPCardCrop-freeform',
    project: {
      fileName: () => 'freeform-crop',
      getFiles: () => state.files.map((f) => ({ name: f.name, blob: f })),
      getState: () => {
        saveCurrentShapes();
        return { pages: state.pages.map((p) => ({ fileIndex: p.fileIndex, pageNo: p.pageNo, shapes: p.shapes })), current: state.current };
      },
      setFiles: (files) => { projectFiles = files; },
      setState: async (saved) => {
        state.files = [];
        state.pages = [];
        state.current = -1;
        await addFiles(projectFiles);
        if (saved && saved.pages) {
          saved.pages.forEach((sp) => {
            const page = state.pages.find((p) => p.fileIndex === sp.fileIndex && p.pageNo === sp.pageNo);
            if (page) page.shapes = sp.shapes || [];
          });
          if (state.pages.length) {
            state.current = -1;
            showPage(Math.min(saved.current || 0, state.pages.length - 1));
          }
        }
      },
    },
    hasUnsavedWork: () => totalRegions() > 0,
  });

  PnP.handoff.receive((items) => addFiles(PnP.itemsToFiles(items)));
  updateCounts();
})();
