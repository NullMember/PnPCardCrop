const cropForm = document.getElementById('cropForm');
const previewCanvas = document.getElementById('previewCanvas');
const zoomCanvas = document.getElementById('zoomCanvas');
const pdfStatus = document.getElementById('status');
const pageSizePresetSelect = document.getElementById('pageSizePreset');
const pageWidthInput = document.getElementById('pageWidth');
const pageHeightInput = document.getElementById('pageHeight');
const cardSizePresetSelect = document.getElementById('cardSizePreset');
const cardWidthInput = document.getElementById('cardWidth');
const cardHeightInput = document.getElementById('cardHeight');
let pdf = null;
let pdfDoc = null;
let scale = 1;
let pdfRendered = false;
let page = null;
let previewImage = null;
// Detail view: a ZOOM_FACTOR magnification of the blue box on the preview.
// zoomX/zoomY are the box's top-left corner, in preview-canvas pixels.
const ZOOM_FACTOR = 4;
let zoomX = 0, zoomY = 0;
let isDragging = false;

// 1mm = 72/25.4 pt (the native PDF unit)
const MM_TO_PT = 72 / 25.4;
const PT_TO_MM = 25.4 / 72;

let sourceFiles = []; // the loaded PDF or images, kept for project saving
let lastCrop = null;  // { front: [{ name, blob }], back: [...] } from the last Crop run

pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

const PREVIEW_BOX_W = 1080;
const PREVIEW_BOX_H = 1528;

// Images stand in for PDF pages: `pdf` / `pdfDoc` only need page sizes (in
// points) and rendering to a canvas, so each image becomes a page of that
// interface and every layout mode works unchanged. Page size comes from the
// DPI stored in the image, or the "Image DPI" setting.
async function imageDocument(files) {
    const fallbackDpi = parseFloat(document.getElementById('imageDpi').value) || 300;
    const pages = [];
    for (const file of files) {
        const url = URL.createObjectURL(file);
        const img = await new Promise((resolve, reject) => {
            const el = new Image();
            el.onload = () => resolve(el);
            el.onerror = () => reject(new Error(`${file.name} is not an image this browser can read`));
            el.src = url;
        });
        const dpi = (await PnP.readImageDpi(file)) || fallbackDpi;
        pages.push({ img, width: (img.naturalWidth / dpi) * 72, height: (img.naturalHeight / dpi) * 72 });
    }
    const pageApi = (p) => ({
        getViewport: ({ scale }) => ({ width: p.width * scale, height: p.height * scale, scale }),
        render: ({ canvasContext, viewport }) => {
            canvasContext.drawImage(p.img, 0, 0, viewport.width, viewport.height);
            return { promise: Promise.resolve() };
        },
    });
    return {
        pdf: { numPages: pages.length, getPage: async (n) => pageApi(pages[n - 1]) },
        pdfDoc: {
            getPageCount: () => pages.length,
            getPages: () => pages.map((p) => ({ getSize: () => ({ width: p.width, height: p.height }) })),
        },
    };
}

// Load a PDF (pdf.js renders, pdf-lib gives page geometry) or a set of images
// (one page each, in name order).
async function loadSource(files) {
    files = [...files];
    const pdfs = files.filter((f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name));
    const images = files.filter((f) => f.type.startsWith('image/'));
    if (pdfs.length) {
        if (pdfs.length > 1 || images.length) PnP.toast(`Using ${pdfs[0].name}; add images on their own, or one PDF at a time.`, 'info');
        const pdfBytes = await pdfs[0].arrayBuffer();
        // pdf.js may transfer (detach) the buffer it is given, so hand it a copy
        pdf = await pdfjsLib.getDocument({ data: new Uint8Array(pdfBytes.slice(0)) }).promise;
        pdfDoc = await PDFLib.PDFDocument.load(pdfBytes);
        sourceFiles = [pdfs[0]];
        document.getElementById('pdfFileName').textContent = `${pdfs[0].name} · ${pdf.numPages} page(s)`;
    } else if (images.length) {
        images.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
        ({ pdf, pdfDoc } = await imageDocument(images));
        sourceFiles = images;
        document.getElementById('pdfFileName').textContent = images.length === 1
            ? `${images[0].name} · 1 page`
            : `${images.length} images · ${images.length} pages`;
    } else {
        throw new Error('Add a PDF or image files.');
    }

    const startingPageInput = document.getElementById('startingPage');
    startingPageInput.max = pdf.numPages;
    const startingPage = Math.min(parseInt(startingPageInput.value, 10) || 1, pdf.numPages);
    startingPageInput.value = startingPage;

    await autoDetectPageSize(startingPage);
    await showPreviewPage(startingPage);
}

// Image page sizes depend on the DPI setting, so reload images when it changes.
document.getElementById('imageDpi').addEventListener('change', () => {
    if (sourceFiles.length && sourceFiles[0].type.startsWith('image/')) loadSource(sourceFiles);
});

document.getElementById('startingPage').addEventListener('input', async (event) => {
    if (!pdfDoc) return;

    const startingPage = Math.min(parseInt(event.target.value, 10) || 1, pdf.numPages);
    await autoDetectPageSize(startingPage);
    await showPreviewPage(startingPage);
});

// ---- Preview page navigation ----

let previewPage = 1;

async function showPreviewPage(pageNumber) {
    if (!pdf) return;
    previewPage = Math.max(1, Math.min(pageNumber, pdf.numPages));
    await renderPage(pdf, previewPage);
    renderPreview();
    updatePager();
}

function updatePager() {
    const label = document.getElementById('previewPageLabel');
    if (!pdf) return;
    const layout = currentLayout();
    let role = '';
    if (isBackPageNumber(previewPage)) role = ' · back (mirrored grid)';
    else if (layout === 'back_last' && previewPage === (parseInt(document.getElementById('endPage').value, 10) || pdf.numPages)) role = ' · backs';
    label.textContent = `Page ${previewPage} of ${pdf.numPages}${role}`;
    document.getElementById('prevPageBtn').disabled = previewPage <= 1;
    document.getElementById('nextPageBtn').disabled = previewPage >= pdf.numPages;
}

document.getElementById('prevPageBtn').addEventListener('click', () => showPreviewPage(previewPage - 1));
document.getElementById('nextPageBtn').addEventListener('click', () => showPreviewPage(previewPage + 1));
document.querySelectorAll('input[name="page_layout"]').forEach((radio) => radio.addEventListener('change', () => {
    renderPreview();
    updatePager();
}));
document.getElementById('endPage').addEventListener('input', updatePager);

// Detect the page size (in mm) from the loaded PDF and select the matching preset
async function autoDetectPageSize(pageNumber) {
    if (!pdf) return;

    const nativePage = await pdf.getPage(pageNumber);
    const viewport = nativePage.getViewport({ scale: 1 });
    const wMM = viewport.width * PT_TO_MM;
    const hMM = viewport.height * PT_TO_MM;

    // Snap to a known paper size when the PDF is within 1 mm of it
    const known = PnP.presets.paper.find((p) => Math.abs(p.w - wMM) < 1 && Math.abs(p.h - hMM) < 1);
    pageWidthInput.value = known ? known.w : wMM.toFixed(1);
    pageHeightInput.value = known ? known.h : hMM.toFixed(1);
    pagePreset.sync();
}

// Shared presets keep the selects and the mm inputs in sync
const pagePreset = PnP.bindPreset(pageSizePresetSelect, pageWidthInput, pageHeightInput, 'paper');
PnP.bindPreset(cardSizePresetSelect, cardWidthInput, cardHeightInput, 'card');

[pageWidthInput, pageHeightInput, cardWidthInput, cardHeightInput].forEach((el) => {
    el.addEventListener('input', renderPreview);
});

// Add event listeners for live preview updates
[
    'rows', 'columns', 'rowSpacing', 'columnSpacing', 'offsetX', 'offsetY',
].forEach((id) => {
    document.getElementById(id).addEventListener('input', renderPreview);
});

async function renderPage(pdf, pageNumber) {
    const page = await pdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1 });

    // Fit the page into a fixed box, so mixed portrait/landscape pages keep full size
    scale = Math.min(PREVIEW_BOX_W / viewport.width, PREVIEW_BOX_H / viewport.height);
    const scaledViewport = page.getViewport({ scale: scale });
    previewCanvas.width = scaledViewport.width;
    previewCanvas.height = scaledViewport.height;
    clampZoomRect();

    // Render page into canvas
    const context = previewCanvas.getContext('2d');
    const renderContext = {
        canvasContext: context,
        viewport: scaledViewport,
    };
    await page.render(renderContext).promise;
    // Store rendered pdf as bitmap
    previewImage = await createImageBitmap(previewCanvas);
    // Mark PDF as rendered
    pdfRendered = true;
}

// Function to overlay the grid without clearing the PDF
async function renderPreview() {
    if (!pdfRendered) return;

    const rows = parseInt(document.getElementById('rows').value, 10) || 1;
    const columns = parseInt(document.getElementById('columns').value, 10) || 1;
    const cardWidthMM = parseFloat(cardWidthInput.value) || 0;
    const cardHeightMM = parseFloat(cardHeightInput.value) || 0;
    const rowSpacingMM = parseFloat(document.getElementById('rowSpacing').value) || 0;
    const columnSpacingMM = parseFloat(document.getElementById('columnSpacing').value) || 0;

    const context = previewCanvas.getContext('2d');

    // Clear the canvas and redraw the PDF page
    context.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
    context.drawImage(previewImage, 0, 0);

    // Draw the grid
    drawGrid(context, rows, columns, cardWidthMM, cardHeightMM, rowSpacingMM, columnSpacingMM);
    // Copy the magnified area before the blue box is drawn over it
    const zoomW = zoomCanvas.width / ZOOM_FACTOR;
    const zoomH = zoomCanvas.height / ZOOM_FACTOR;
    const zoomCtx = zoomCanvas.getContext('2d');
    zoomCtx.imageSmoothingEnabled = false;
    zoomCtx.fillStyle = 'white';
    zoomCtx.fillRect(0, 0, zoomCanvas.width, zoomCanvas.height);
    zoomCtx.drawImage(previewCanvas, zoomX, zoomY, zoomW, zoomH, 0, 0, zoomCanvas.width, zoomCanvas.height);

    drawZoomRect(context, zoomX, zoomY, zoomW, zoomH);
}

// Function to draw the grid, centered on the page
function drawGrid(context, rows, columns, cardWidthMM, cardHeightMM, rowSpacingMM, columnSpacingMM) {
    context.strokeStyle = 'red';
    context.lineWidth = 1;

    // pixels per mm, at the current preview scale (canvas px per pt)
    const pxPerMM = scale * MM_TO_PT;
    const cardWidth = cardWidthMM * pxPerMM;
    const cardHeight = cardHeightMM * pxPerMM;
    const rowSpacing = rowSpacingMM * pxPerMM;
    const columnSpacing = columnSpacingMM * pxPerMM;

    const gridWidth = columns * cardWidth + (columns - 1) * columnSpacing;
    const gridHeight = rows * cardHeight + (rows - 1) * rowSpacing;
    // Same offset (and back-page mirroring) as the actual crop
    const off = gridOffsetMm(isBackPageNumber(previewPage), previewCanvas.width / scale, previewCanvas.height / scale);
    const marginX = (previewCanvas.width - gridWidth) / 2 + off.x * pxPerMM;
    const marginY = (previewCanvas.height - gridHeight) / 2 + off.y * pxPerMM;

    for (let col = 0; col < columns; col++) {
        const xStart = marginX + col * (cardWidth + columnSpacing);
        const xEnd = xStart + cardWidth;

        context.beginPath();
        context.moveTo(xStart, marginY);
        context.lineTo(xStart, marginY + gridHeight);
        context.stroke();

        context.beginPath();
        context.moveTo(xEnd, marginY);
        context.lineTo(xEnd, marginY + gridHeight);
        context.stroke();
    }

    for (let row = 0; row < rows; row++) {
        const yStart = marginY + row * (cardHeight + rowSpacing);
        const yEnd = yStart + cardHeight;

        context.beginPath();
        context.moveTo(marginX, yStart);
        context.lineTo(marginX + gridWidth, yStart);
        context.stroke();

        context.beginPath();
        context.moveTo(marginX, yEnd);
        context.lineTo(marginX + gridWidth, yEnd);
        context.stroke();
    }
}

function drawZoomRect(context, x, y, width, height) {
    context.strokeStyle = 'blue';
    context.lineWidth = 1;
    context.beginPath();
    context.rect(x, y, width, height);
    context.stroke();
}

function clampZoomRect() {
    const zoomW = zoomCanvas.width / ZOOM_FACTOR;
    const zoomH = zoomCanvas.height / ZOOM_FACTOR;
    zoomX = Math.max(0, Math.min(zoomX, previewCanvas.width - zoomW));
    zoomY = Math.max(0, Math.min(zoomY, previewCanvas.height - zoomH));
}

// Centre the blue box on the pointer. The canvas is scaled down by CSS, so
// convert from on-screen pixels to canvas pixels first.
function moveZoomRectTo(e) {
    const rect = previewCanvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (previewCanvas.width / rect.width);
    const y = (e.clientY - rect.top) * (previewCanvas.height / rect.height);
    zoomX = x - zoomCanvas.width / ZOOM_FACTOR / 2;
    zoomY = y - zoomCanvas.height / ZOOM_FACTOR / 2;
    clampZoomRect();
    renderPreview();
}

// ---- Dragging on the preview: detail box or grid ----

let dragMode = 'detail';
let gridDrag = null;

document.getElementById('dragMode').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-mode]');
    if (!btn) return;
    dragMode = btn.dataset.mode;
    document.querySelectorAll('#dragMode button').forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
    previewCanvas.classList.toggle('drag-grid', dragMode === 'grid');
});

function setOffsets(x, y) {
    const round = (v) => Math.round(v * 10) / 10;
    [['offsetX', x], ['offsetY', y]].forEach(([id, v]) => {
        const el = document.getElementById(id);
        el.value = round(v);
        el.dispatchEvent(new Event('input', { bubbles: true }));
    });
}

// Screen movement -> offset change. On a mirrored back page the grid moves
// opposite to the stored (front-page) offset along the mirrored axis.
function applyGridDrag(e) {
    const rect = previewCanvas.getBoundingClientRect();
    const mmPerScreenPx = (previewCanvas.width / rect.width) / (scale * MM_TO_PT);
    let dx = (e.clientX - gridDrag.x) * mmPerScreenPx;
    let dy = (e.clientY - gridDrag.y) * mmPerScreenPx;
    if (isBackPageNumber(previewPage)) {
        if (backFlipsLeftRight(previewCanvas.width / scale, previewCanvas.height / scale)) dx = -dx;
        else dy = -dy;
    }
    setOffsets(gridDrag.offX + dx, gridDrag.offY + dy);
}

previewCanvas.addEventListener('pointerdown', (e) => {
    if (!pdfRendered) return;
    isDragging = true;
    previewCanvas.setPointerCapture(e.pointerId);
    if (dragMode === 'grid') {
        gridDrag = { x: e.clientX, y: e.clientY, offX: mmValue('offsetX'), offY: mmValue('offsetY') };
    } else {
        moveZoomRectTo(e);
    }
});

previewCanvas.addEventListener('pointermove', (e) => {
    if (!isDragging) return;
    if (dragMode === 'grid') applyGridDrag(e);
    else moveZoomRectTo(e);
});

previewCanvas.addEventListener('pointerup', () => {
    isDragging = false;
});

previewCanvas.addEventListener('pointercancel', () => {
    isDragging = false;
});

// Add a cropped card to its zip and remember it for "Send to"
function recordCard(zip, list, name, blob) {
    zip.file(name, blob);
    list.push({ name, blob });
}

function currentLayout() {
    return document.querySelector('input[name="page_layout"]:checked').value;
}

function mmValue(id) {
    return parseFloat(document.getElementById(id).value) || 0;
}

// Grid offset (mm, +x right, +y down). Duplex back pages are mirror images
// of their front page, so the offset is mirrored with them.
// Whether a duplex back page is the front mirrored left-right (true) or
// top-bottom (false). Printers turn landscape pages 90° onto portrait paper,
// so a long-edge flip is left-right only for portrait pages.
function backFlipsLeftRight(width, height) {
    const portrait = width <= height;
    return (currentLayout() === 'duplex') === portrait;
}

function gridOffsetMm(isBackPage, width, height) {
    let x = mmValue('offsetX');
    let y = mmValue('offsetY');
    if (isBackPage) {
        if (backFlipsLeftRight(width, height)) x = -x;
        else y = -y;
    }
    return { x, y };
}

// Bottom-left corner of the card grid in PDF points (origin bottom-left).
function gridMarginsPt(width, height, gridWidth, gridHeight, isBackPage) {
    const off = gridOffsetMm(isBackPage, width, height);
    return {
        marginX: (width - gridWidth) / 2 + off.x * MM_TO_PT,
        marginY: (height - gridHeight) / 2 - off.y * MM_TO_PT,
    };
}

// Is this page (1-based) a back page under the current layout?
function isBackPageNumber(pageNumber) {
    const layout = currentLayout();
    const first = parseInt(document.getElementById('startingPage').value, 10) || 1;
    return (layout === 'duplex' || layout === 'duplex_short') && (pageNumber - first) % 2 === 1;
}

const OUTPUT_FORMATS = {
    png: { type: 'image/png', ext: 'png' },
    jpeg: { type: 'image/jpeg', ext: 'jpg' },
    webp: { type: 'image/webp', ext: 'webp' },
};

// Form submission for cropping the PDF
cropForm.addEventListener('submit', async (event) => {
    event.preventDefault();

    const startingPage = parseInt(document.getElementById('startingPage').value, 10) || 1;
    const dpi = parseInt(document.getElementById('dpi').value, 10) || 288;
    const dpiScale = dpi / 72; // PDF is 72 DPI by default
    const isNoBack = document.getElementById('page_no_back').checked;
    const isBackLast = document.getElementById('page_back_last').checked;
    const isDuplex = document.getElementById('page_duplex').checked;
    const isDuplexShort = document.getElementById('page_duplex_short').checked;
    const isFoldVertical = document.getElementById('page_fold_vertical').checked;
    const isFoldHorizontal = document.getElementById('page_fold_horizontal').checked;
    const rows = parseInt(document.getElementById('rows').value, 10);
    const columns = parseInt(document.getElementById('columns').value, 10);
    const cardWidthMM = parseFloat(cardWidthInput.value);
    const cardHeightMM = parseFloat(cardHeightInput.value);
    const rowSpacingMM = parseFloat(document.getElementById('rowSpacing').value) || 0;
    const columnSpacingMM = parseFloat(document.getElementById('columnSpacing').value) || 0;

    if (!pdfDoc || !rows || !columns || !cardWidthMM || !cardHeightMM) {
        alert('Please add a PDF or images and set the card size and grid parameters.');
        return;
    }

    // Card size and spacing in native PDF units (pt)
    const cardWidth = cardWidthMM * MM_TO_PT;
    const cardHeight = cardHeightMM * MM_TO_PT;
    const rowSpacing = rowSpacingMM * MM_TO_PT;
    const columnSpacing = columnSpacingMM * MM_TO_PT;

    pdfStatus.textContent = 'Processing...';
    pdfStatus.classList.remove('success');
    pdfStatus.classList.add('processing');

    const frontZip = new JSZip();
    const backZip = new JSZip();
    lastCrop = { front: [], back: [] };
    sendMenu.setEnabled(false);

    const endPage = parseInt(document.getElementById('endPage').value, 10) || pdfDoc.getPageCount();
    if (endPage < startingPage) {
        alert('The last page must not be before the first page.');
        return;
    }
    const pdfLibPages = pdfDoc.getPages().slice(startingPage - 1, endPage);
    const fmt = OUTPUT_FORMATS[document.getElementById('outputFormat').value] || OUTPUT_FORMATS.png;
    let currentPage = 0;
    let cardCount = 0;
    let frontCardCount = 0;
    let backCardCount = 0;
    const pageRenderPromises = [];

    if (isBackLast) {
        if (pdfLibPages.length < 2) {
            alert('Back Face in Last Page requires at least one front page plus a final back page.');
            return;
        }

        const gridWidth = columns * cardWidth + (columns - 1) * columnSpacing;
        const gridHeight = rows * cardHeight + (rows - 1) * rowSpacing;

        // Crops one page into its grid cells, in top-to-bottom, left-to-right order
        const cropCells = async (pageIndexInDoc) => {
            const pdfLibPage = pdfLibPages[pageIndexInDoc];
            const { width, height } = pdfLibPage.getSize();
            const { marginX, marginY } = gridMarginsPt(width, height, gridWidth, gridHeight, false);

            const pdfPage = await pdf.getPage(startingPage + pageIndexInDoc);
            const viewport = pdfPage.getViewport({ scale: dpiScale });
            const pageCanvas = document.createElement('canvas');
            pageCanvas.width = viewport.width;
            pageCanvas.height = viewport.height;
            const pageCtx = pageCanvas.getContext('2d');
            await pdfPage.render({ canvasContext: pageCtx, viewport }).promise;

            const scaleRatioX = viewport.width / width;
            const scaleRatioY = viewport.height / height;

            const cells = [];
            for (let row = rows - 1; row >= 0; row--) {
                for (let col = 0; col < columns; col++) {
                    const x0 = marginX + col * (cardWidth + columnSpacing);
                    const y0 = marginY + row * (cardHeight + rowSpacing);
                    const scaledX = x0 * scaleRatioX;
                    const scaledWidth = cardWidth * scaleRatioX;
                    const scaledHeight = cardHeight * scaleRatioY;
                    const scaledY = viewport.height - (y0 + cardHeight) * scaleRatioY;

                    const canvas = document.createElement('canvas');
                    canvas.width = cardWidth * dpiScale;
                    canvas.height = cardHeight * dpiScale;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(pageCanvas, scaledX, scaledY, scaledWidth, scaledHeight, 0, 0, canvas.width, canvas.height);
                    cells.push(canvas);
                }
            }
            return cells;
        };

        const lastPageIndex = pdfLibPages.length - 1;
        // Each grid cell on the last page is the back face for every front card at that same grid position
        const backCells = await cropCells(lastPageIndex);

        for (let pageIndex = 0; pageIndex < lastPageIndex; pageIndex++) {
            const frontCells = await cropCells(pageIndex);

            for (let posIndex = 0; posIndex < frontCells.length; posIndex++) {
                const currentIndex = cardCount;
                const frontCanvas = frontCells[posIndex];
                pageRenderPromises.push(
                    new Promise(resolve => {
                        frontCanvas.toBlob((blob) => {
                            recordCard(frontZip, lastCrop.front, `front_${String(currentIndex).padStart(4, '0')}.${fmt.ext}`, blob);
                            resolve();
                        }, fmt.type, 0.95);
                    })
                );

                const backCanvas = backCells[posIndex];
                pageRenderPromises.push(
                    new Promise(resolve => {
                        backCanvas.toBlob((blob) => {
                            recordCard(backZip, lastCrop.back, `back_${String(currentIndex).padStart(4, '0')}.${fmt.ext}`, blob);
                            resolve();
                        }, fmt.type, 0.95);
                    })
                );
                cardCount++;
            }
            currentPage++;
        }
    }
    else {
    for (let pageIndex = 0; pageIndex < pdfLibPages.length; pageIndex++) {
        const pdfLibPage = pdfLibPages[pageIndex];
        const { width, height } = pdfLibPage.getSize();

        // Center the card grid on the page
        const gridWidth = columns * cardWidth + (columns - 1) * columnSpacing;
        const gridHeight = rows * cardHeight + (rows - 1) * rowSpacing;
        const isBackPage = (isDuplex || isDuplexShort) && pageIndex % 2 === 1;
        const { marginX, marginY } = gridMarginsPt(width, height, gridWidth, gridHeight, isBackPage);

        // Use pdf.js to render the page at native resolution
        const pdfPage = await pdf.getPage(startingPage + pageIndex);
        const viewport = pdfPage.getViewport({ scale: dpiScale });

        const pageCanvas = document.createElement('canvas');
        pageCanvas.width = viewport.width;
        pageCanvas.height = viewport.height;
        const pageCtx = pageCanvas.getContext('2d');

        const renderContext = {
            canvasContext: pageCtx,
            viewport: viewport,
        };
        await pdfPage.render(renderContext).promise;

        for (let row = rows - 1; row >= 0; row--) {
            for (let col = 0; col < columns; col++) {
                const x0 = marginX + col * (cardWidth + columnSpacing);
                const y0 = marginY + row * (cardHeight + rowSpacing);

                // Create a canvas for the card at the specified DPI
                const canvas = document.createElement('canvas');
                canvas.width = cardWidth * dpiScale;
                canvas.height = cardHeight * dpiScale;
                const ctx = canvas.getContext('2d');

                // Calculate scaled coordinates based on pdf.js render scale
                // Note: PDF coordinates have origin at bottom-left, canvas has origin at top-left
                const scaleRatioX = viewport.width / width;
                const scaleRatioY = viewport.height / height;
                const scaledX = x0 * scaleRatioX;
                const scaledWidth = cardWidth * scaleRatioX;
                const scaledHeight = cardHeight * scaleRatioY;
                // Invert Y coordinate: canvas Y = viewport.height - (PDF y + height)
                const scaledY = viewport.height - (y0 + cardHeight) * scaleRatioY;

                // Copy the cropped region to the card canvas
                ctx.drawImage(pageCanvas, scaledX, scaledY, scaledWidth, scaledHeight, 0, 0, canvas.width, canvas.height);

                // Convert canvas to PNG blob
                const cardFileName = `card_${String(cardCount).padStart(4, '0')}.png`;

                if (isNoBack) {
                    const currentCardCount = cardCount;
                    pageRenderPromises.push(
                        new Promise(resolve => {
                            canvas.toBlob((blob) => {
                                recordCard(frontZip, lastCrop.front, `card_${String(currentCardCount).padStart(4, '0')}.${fmt.ext}`, blob);
                                resolve();
                            }, fmt.type, 0.95);
                        })
                    );
                    cardCount++;
                }
                else if (isDuplex || isDuplexShort) {
                    if (pageIndex % 2 === 0) {
                        const currentFrontCount = frontCardCount;
                        pageRenderPromises.push(
                            new Promise(resolve => {
                                canvas.toBlob((blob) => {
                                    recordCard(frontZip, lastCrop.front, `front_${String(currentFrontCount).padStart(4, '0')}.${fmt.ext}`, blob);
                                    resolve();
                                }, fmt.type, 0.95);
                            })
                        );
                        frontCardCount++;
                    }
                    else {
                        // The back of front card (row, col) sits at the mirrored position:
                        // mirrored column when the sheet turns left-right (backs upright),
                        // mirrored row when it turns top-bottom (backs upside down).
                        const leftRight = backFlipsLeftRight(width, height);
                        const xBack = leftRight ? marginX + ((columns - 1) - col) * (cardWidth + columnSpacing) : x0;
                        const yBack = leftRight ? y0 : marginY + ((rows - 1) - row) * (cardHeight + rowSpacing);
                        ctx.clearRect(0, 0, canvas.width, canvas.height);
                        ctx.drawImage(pageCanvas, xBack * scaleRatioX, viewport.height - (yBack + cardHeight) * scaleRatioY, scaledWidth, scaledHeight, 0, 0, canvas.width, canvas.height);

                        let backCanvas = canvas;
                        if (!leftRight) {
                            backCanvas = document.createElement('canvas');
                            backCanvas.width = canvas.width;
                            backCanvas.height = canvas.height;
                            const rotatedCtx = backCanvas.getContext('2d');
                            rotatedCtx.translate(canvas.width / 2, canvas.height / 2);
                            rotatedCtx.rotate(Math.PI);
                            rotatedCtx.drawImage(canvas, -canvas.width / 2, -canvas.height / 2);
                        }

                        const currentBackCount = backCardCount;
                        pageRenderPromises.push(
                            new Promise(resolve => {
                                backCanvas.toBlob((blob) => {
                                    recordCard(backZip, lastCrop.back, `back_${String(currentBackCount).padStart(4, '0')}.${fmt.ext}`, blob);
                                    resolve();
                                }, fmt.type, 0.95);
                            })
                        );
                        backCardCount++;
                    }
                }
                else if(isFoldVertical) {
                    if (col % 2 === 0) {
                        const currentFrontCount = frontCardCount;
                        pageRenderPromises.push(
                            new Promise(resolve => {
                                canvas.toBlob((blob) => {
                                    recordCard(frontZip, lastCrop.front, `front_${String(currentFrontCount).padStart(4, '0')}.${fmt.ext}`, blob);
                                    resolve();
                                }, fmt.type, 0.95);
                            })
                        );
                        frontCardCount++;
                    }
                    else {
                        const currentBackCount = backCardCount;
                        pageRenderPromises.push(
                            new Promise(resolve => {
                                canvas.toBlob((blob) => {
                                    recordCard(backZip, lastCrop.back, `back_${String(currentBackCount).padStart(4, '0')}.${fmt.ext}`, blob);
                                    resolve();
                                }, fmt.type, 0.95);
                            })
                        );
                        backCardCount++;
                    }
                    cardCount++;
                }
                else if(isFoldHorizontal) {
                    if (row % 2 === 0) {
                        const currentFrontCount = frontCardCount;
                        pageRenderPromises.push(
                            new Promise(resolve => {
                                canvas.toBlob((blob) => {
                                    recordCard(frontZip, lastCrop.front, `front_${String(currentFrontCount).padStart(4, '0')}.${fmt.ext}`, blob);
                                    resolve();
                                }, fmt.type, 0.95);
                            })
                        );
                        frontCardCount++;
                    }
                    else {
                        const currentBackCount = backCardCount;
                        pageRenderPromises.push(
                            new Promise(resolve => {
                                canvas.toBlob((blob) => {
                                    recordCard(backZip, lastCrop.back, `back_${String(currentBackCount).padStart(4, '0')}.${fmt.ext}`, blob);
                                    resolve();
                                }, fmt.type, 0.95);
                            })
                        );
                        backCardCount++;
                    }
                    cardCount++;
                }
            }
        }
        currentPage++;
    }
    }

    // Wait for all blobs to be added to zip
    await Promise.all(pageRenderPromises);
    const byName = (a, b) => a.name.localeCompare(b.name);
    lastCrop.front.sort(byName);
    lastCrop.back.sort(byName);
    sendMenu.setEnabled(lastCrop.front.length + lastCrop.back.length > 0);

    // Generate and download zip files
    if (isDuplex || isDuplexShort || isFoldVertical || isFoldHorizontal || isBackLast) {
        const frontBytes = await frontZip.generateAsync({ type: 'blob' });
        const backBytes = await backZip.generateAsync({ type: 'blob' });

        const frontUrl = URL.createObjectURL(frontBytes);
        const frontLink = document.getElementById('downloadFrontLink');
        frontLink.href = frontUrl;
        frontLink.classList.add('show');

        const backUrl = URL.createObjectURL(backBytes);
        const backLink = document.getElementById('downloadBackLink');
        backLink.href = backUrl;
        backLink.classList.add('show');

        pdfStatus.textContent = '✓ Done! Click the links to download your files.';
        pdfStatus.classList.remove('processing');
        pdfStatus.classList.add('success');
    }
    else {
        const outputBytes = await frontZip.generateAsync({ type: 'blob' });

        const url = URL.createObjectURL(outputBytes);
        const link = document.getElementById('downloadLink');
        link.href = url;
        link.classList.add('show');

        pdfStatus.textContent = '✓ Done! Click the link to download your file.';
        pdfStatus.classList.remove('processing');
        pdfStatus.classList.add('success');
    }
});

// ---- Shared PnPTools wiring --------------------------------------------------

PnP.dropzone(document.getElementById('pdfDropZone'), {
    input: document.getElementById('pdfFile'),
    accept: ['application/pdf', '.pdf', 'image/*'],
    onFiles: (files) => loadSource(files).catch((err) => {
        console.error(err);
        PnP.toast(`Could not open the file: ${err.message}`, 'error');
    }),
});

const sendMenu = PnP.sendMenu(document.getElementById('sendSlot'), {
    from: 'CardCrop',
    targets: ['PnPAlign', 'PnPBleed', 'PnPLayout', 'PnPBooklet'],
    getItems: () => [
        ...lastCrop.front.map((c) => ({ ...c, role: 'front' })),
        ...lastCrop.back.map((c) => ({ ...c, role: 'back' })),
    ],
});
sendMenu.setEnabled(false);

PnP.init({
    tool: 'PnPCardCrop',
    offlineFiles: [pdfjsLib.GlobalWorkerOptions.workerSrc],
    settingsRoot: cropForm,
    project: {
        getFiles: () => sourceFiles.map((f) => ({ name: f.name, blob: f })),
        setFiles: (files) => (files.length ? loadSource(files) : null),
    },
    hasUnsavedWork: () => sourceFiles.length > 0,
});

// ---- Centre the grid on the page's printed content ----

document.getElementById('centerOnArtBtn').addEventListener('click', () => {
    if (!previewImage) {
        PnP.toast('Add a PDF or images first.', 'error');
        return;
    }
    const w = previewImage.width, h = previewImage.height;
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(previewImage, 0, 0);
    const d = ctx.getImageData(0, 0, w, h).data;
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const i = (y * w + x) * 4;
            // Anything clearly darker than paper white counts as artwork
            if (d[i + 3] > 0 && (d[i] < 235 || d[i + 1] < 235 || d[i + 2] < 235)) {
                if (x < x0) x0 = x;
                if (x > x1) x1 = x;
                if (y < y0) y0 = y;
                if (y > y1) y1 = y;
            }
        }
    }
    if (x1 < 0) {
        PnP.toast('No artwork found on this page.', 'error');
        return;
    }
    const pxPerMM = scale * MM_TO_PT;
    let dx = ((x0 + x1) / 2 - w / 2) / pxPerMM;
    let dy = ((y0 + y1) / 2 - h / 2) / pxPerMM;
    if (isBackPageNumber(previewPage)) {
        if (backFlipsLeftRight(w / scale, h / scale)) dx = -dx;
        else dy = -dy;
    }
    setOffsets(dx, dy);
    PnP.toast(`Grid centred on the artwork (offset ${dx.toFixed(1)}, ${dy.toFixed(1)} mm).`, 'success');
});
