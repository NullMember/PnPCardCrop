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
// Zoom variables
let startX, startY, zoomX = 0, zoomY = 0;
let isDragging = false;

// 1mm = 72/25.4 pt (the native PDF unit)
const MM_TO_PT = 72 / 25.4;
const PT_TO_MM = 25.4 / 72;

const PAGE_PRESETS = {
    a4: { w: 210, h: 297 },
    letter: { w: 215.9, h: 279.4 },
};

const CARD_PRESETS = {
    poker: { w: 63, h: 88 },
    bridge: { w: 58, h: 91 },
    miniAmerican: { w: 41, h: 63 },
    miniEuropean: { w: 44, h: 68 },
    tarot: { w: 70, h: 121 },
    square: { w: 70, h: 70 },
};

// Load the uploaded PDF using pdf.js
document.getElementById('pdfFile').addEventListener('change', async (event) => {
    const file = event.target.files[0];
    if (file) {
        const fileReader = new FileReader();
        fileReader.onload = async function () {
            pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://mozilla.github.io/pdf.js/build/pdf.worker.mjs';
            // Load the PDF file using pdf.js for rendering page previews
            const pdfData = new Uint8Array(this.result);
            const loadingTask = pdfjsLib.getDocument({ data: pdfData });
            pdf = await loadingTask.promise;

            const startingPage = parseInt(document.getElementById('startingPage').value, 10) || 1;

            await autoDetectPageSize(startingPage);

            // Render the first page of the PDF
            await renderPage(pdf, startingPage);

            // Store the loaded PDF for cropping using PDFLib
            const pdfBytes = await file.arrayBuffer();
            pdfDoc = await PDFLib.PDFDocument.load(pdfBytes);

            // Draw the grid after rendering the PDF
            renderPreview();
        };
        fileReader.readAsArrayBuffer(file);
    }
});

document.getElementById('startingPage').addEventListener('input', async (event) => {
    if (!pdfDoc) return;

    const startingPage = parseInt(event.target.value, 10) || 1;
    await autoDetectPageSize(startingPage);
    await renderPage(pdf, startingPage);
    renderPreview();
});

// Detect the page size (in mm) from the loaded PDF and select the matching preset
async function autoDetectPageSize(pageNumber) {
    if (!pdf) return;

    const nativePage = await pdf.getPage(pageNumber);
    const viewport = nativePage.getViewport({ scale: 1 });
    const wMM = viewport.width * PT_TO_MM;
    const hMM = viewport.height * PT_TO_MM;
    const ratio = Math.max(wMM, hMM) / Math.min(wMM, hMM);

    let bestKey = 'custom';
    let bestDiff = Infinity;
    for (const [key, preset] of Object.entries(PAGE_PRESETS)) {
        const presetRatio = Math.max(preset.w, preset.h) / Math.min(preset.w, preset.h);
        const diff = Math.abs(ratio - presetRatio);
        if (diff < bestDiff) {
            bestDiff = diff;
            bestKey = key;
        }
    }
    if (bestDiff > 0.05) bestKey = 'custom';

    pageSizePresetSelect.value = bestKey;
    pageWidthInput.value = wMM.toFixed(1);
    pageHeightInput.value = hMM.toFixed(1);
}

// Page size preset handling
pageSizePresetSelect.addEventListener('change', () => {
    const key = pageSizePresetSelect.value;
    if (key === 'custom') return;
    const preset = PAGE_PRESETS[key];
    const currentPortrait = parseFloat(pageWidthInput.value) <= parseFloat(pageHeightInput.value);
    const w = Math.min(preset.w, preset.h);
    const h = Math.max(preset.w, preset.h);
    pageWidthInput.value = currentPortrait ? w : h;
    pageHeightInput.value = currentPortrait ? h : w;
    renderPreview();
});

[pageWidthInput, pageHeightInput].forEach((el) => {
    el.addEventListener('input', () => {
        pageSizePresetSelect.value = 'custom';
        renderPreview();
    });
});

// Card size preset handling
cardSizePresetSelect.addEventListener('change', () => {
    const key = cardSizePresetSelect.value;
    if (key === 'custom') return;
    const preset = CARD_PRESETS[key];
    cardWidthInput.value = preset.w;
    cardHeightInput.value = preset.h;
    renderPreview();
});

[cardWidthInput, cardHeightInput].forEach((el) => {
    el.addEventListener('input', () => {
        cardSizePresetSelect.value = 'custom';
        renderPreview();
    });
});

// Add event listeners for live preview updates
[
    'rows', 'columns', 'rowSpacing', 'columnSpacing',
].forEach((id) => {
    document.getElementById(id).addEventListener('input', renderPreview);
});

async function renderPage(pdf, pageNumber) {
    const page = await pdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1 });

    // Set canvas size
    scale = Math.min(previewCanvas.width / viewport.width, previewCanvas.height / viewport.height);
    const scaledViewport = page.getViewport({ scale: scale });
    previewCanvas.width = scaledViewport.width;
    previewCanvas.height = scaledViewport.height;
    zoomCanvas.width = scaledViewport.width / 5;
    zoomCanvas.height = scaledViewport.height / 5;

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
    // Draw the blue zoom rect
    // Zoom rect is /4 of the size of the preview canvas because were zooming in 4x
    drawZoomRect(context, zoomX, zoomY, zoomCanvas.width / 4, zoomCanvas.height / 4);

    // Draw the zoomed in area
    let zoomCtx = zoomCanvas.getContext("2d");
    zoomCtx.fillStyle = "white";
    zoomCtx.fillRect(0, 0, zoomCanvas.width, zoomCanvas.height);
    // 4x zoom
    zoomCtx.drawImage(previewCanvas, zoomX, zoomY, 100, 100, 0, 0, 400, 400);
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
    const marginX = (previewCanvas.width - gridWidth) / 2;
    const marginY = (previewCanvas.height - gridHeight) / 2;

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

previewCanvas.addEventListener("mousedown", function(e) {
    isDragging = true;
    startX = e.offsetX;
    startY = e.offsetY;
});

previewCanvas.addEventListener("mouseup", function() {
    isDragging = false;
});

previewCanvas.addEventListener("mousemove", function(e){
    if (isDragging) {
        zoomX += (e.offsetX - startX);
        zoomY += (e.offsetY - startY);
        startX = (e.offsetX);
        startY = (e.offsetY);
    }

    zoomCanvas.style.top = e.pageY + 20 + "px"
    zoomCanvas.style.left = e.pageX + 20 + "px"
    zoomCanvas.style.display = "block";

    renderPreview();
});

previewCanvas.addEventListener("mouseout", function(){
    //zoomCanvas.style.display = "none";
    isDragging = false;
});

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
        alert('Please upload a PDF and set the card size and grid parameters.');
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

    const pdfLibPages = pdfDoc.getPages().slice(startingPage - 1);
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
            const marginX = (width - gridWidth) / 2;
            const marginY = (height - gridHeight) / 2;

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
                            frontZip.file(`front_${String(currentIndex).padStart(4, '0')}.png`, blob);
                            resolve();
                        }, 'image/png');
                    })
                );

                const backCanvas = backCells[posIndex];
                pageRenderPromises.push(
                    new Promise(resolve => {
                        backCanvas.toBlob((blob) => {
                            backZip.file(`back_${String(currentIndex).padStart(4, '0')}.png`, blob);
                            resolve();
                        }, 'image/png');
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
        const marginX = (width - gridWidth) / 2;
        const marginY = (height - gridHeight) / 2;

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
                                frontZip.file(`card_${String(currentCardCount).padStart(4, '0')}.png`, blob);
                                resolve();
                            }, 'image/png');
                        })
                    );
                    cardCount++;
                }
                else if (isDuplex) {
                    if (pageIndex % 2 === 0) {
                        const currentFrontCount = frontCardCount;
                        pageRenderPromises.push(
                            new Promise(resolve => {
                                canvas.toBlob((blob) => {
                                    frontZip.file(`front_${String(currentFrontCount).padStart(4, '0')}.png`, blob);
                                    resolve();
                                }, 'image/png');
                            })
                        );
                        frontCardCount++;
                    }
                    else {
                        const x0Back = marginX + ((columns - 1) - col) * (cardWidth + columnSpacing);
                        const scaledXBack = x0Back * scaleRatioX;
                        ctx.clearRect(0, 0, canvas.width, canvas.height);
                        ctx.drawImage(pageCanvas, scaledXBack, scaledY, scaledWidth, scaledHeight, 0, 0, canvas.width, canvas.height);
                        const currentBackCount = backCardCount;
                        pageRenderPromises.push(
                            new Promise(resolve => {
                                canvas.toBlob((blob) => {
                                    backZip.file(`back_${String(currentBackCount).padStart(4, '0')}.png`, blob);
                                    resolve();
                                }, 'image/png');
                            })
                        );
                        backCardCount++;
                    }
                }
                else if (isDuplexShort) {
                    if (pageIndex % 2 === 0) {
                        const currentFrontCount = frontCardCount;
                        pageRenderPromises.push(
                            new Promise(resolve => {
                                canvas.toBlob((blob) => {
                                    frontZip.file(`front_${String(currentFrontCount).padStart(4, '0')}.png`, blob);
                                    resolve();
                                }, 'image/png');
                            })
                        );
                        frontCardCount++;
                    }
                    else {
                        const x0Back = marginX + ((columns - 1) - col) * (cardWidth + columnSpacing);
                        const scaledXBack = x0Back * scaleRatioX;
                        ctx.clearRect(0, 0, canvas.width, canvas.height);
                        ctx.drawImage(pageCanvas, scaledXBack, scaledY, scaledWidth, scaledHeight, 0, 0, canvas.width, canvas.height);

                        // Rotate canvas 180 degrees for short edge duplex
                        const rotatedCanvas = document.createElement('canvas');
                        rotatedCanvas.width = canvas.width;
                        rotatedCanvas.height = canvas.height;
                        const rotatedCtx = rotatedCanvas.getContext('2d');
                        rotatedCtx.translate(canvas.width / 2, canvas.height / 2);
                        rotatedCtx.rotate(Math.PI);
                        rotatedCtx.drawImage(canvas, -canvas.width / 2, -canvas.height / 2);

                        const currentBackCount = backCardCount;
                        pageRenderPromises.push(
                            new Promise(resolve => {
                                rotatedCanvas.toBlob((blob) => {
                                    backZip.file(`back_${String(currentBackCount).padStart(4, '0')}.png`, blob);
                                    resolve();
                                }, 'image/png');
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
                                    frontZip.file(`front_${String(currentFrontCount).padStart(4, '0')}.png`, blob);
                                    resolve();
                                }, 'image/png');
                            })
                        );
                        frontCardCount++;
                    }
                    else {
                        const currentBackCount = backCardCount;
                        pageRenderPromises.push(
                            new Promise(resolve => {
                                canvas.toBlob((blob) => {
                                    backZip.file(`back_${String(currentBackCount).padStart(4, '0')}.png`, blob);
                                    resolve();
                                }, 'image/png');
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
                                    frontZip.file(`front_${String(currentFrontCount).padStart(4, '0')}.png`, blob);
                                    resolve();
                                }, 'image/png');
                            })
                        );
                        frontCardCount++;
                    }
                    else {
                        const currentBackCount = backCardCount;
                        pageRenderPromises.push(
                            new Promise(resolve => {
                                canvas.toBlob((blob) => {
                                    backZip.file(`back_${String(currentBackCount).padStart(4, '0')}.png`, blob);
                                    resolve();
                                }, 'image/png');
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
