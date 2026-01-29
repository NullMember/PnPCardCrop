const cropForm = document.getElementById('cropForm');
const previewCanvas = document.getElementById('previewCanvas');
const zoomCanvas = document.getElementById('zoomCanvas');
const pdfStatus = document.getElementById('status');
let pdf = null;
let pdfDoc = null;
let scale = 1;
let pdfRendered = false;
let page = null;
let previewImage = null;
// Zoom variables
let startX, startY, zoomX = 0, zoomY = 0;
let isDragging = false;

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
    await renderPage(pdf, startingPage);
    renderPreview();
});

// Add event listeners for live preview updates
[
    'rows', 'columns', 'topMargin', 'bottomMargin',
    'leftMargin', 'rightMargin', 'rowMargin', 'columnMargin',
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
    const topMargin = parseFloat(document.getElementById('topMargin').value) || 0;
    const bottomMargin = parseFloat(document.getElementById('bottomMargin').value) || 0;
    const leftMargin = parseFloat(document.getElementById('leftMargin').value) || 0;
    const rightMargin = parseFloat(document.getElementById('rightMargin').value) || 0;
    const rowMargin = parseFloat(document.getElementById('rowMargin').value) || 0;
    const columnMargin = parseFloat(document.getElementById('columnMargin').value) || 0;

    const context = previewCanvas.getContext('2d');

    // Clear the canvas and redraw the PDF page
    context.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
    context.drawImage(previewImage, 0, 0);

    // Draw the grid
    drawGrid(context, rows, columns, topMargin, bottomMargin, leftMargin, rightMargin, rowMargin, columnMargin);
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

// Function to draw the grid
function drawGrid(context, rows, columns, topMargin, bottomMargin, leftMargin, rightMargin, rowMargin, columnMargin) {
    context.strokeStyle = 'red';
    context.lineWidth = 1;

    const cardWidth = (previewCanvas.width - leftMargin * scale - rightMargin * scale - (columns - 1) * columnMargin * scale) / columns;
    const cardHeight = (previewCanvas.height - topMargin * scale - bottomMargin * scale - (rows - 1) * rowMargin * scale) / rows;

    for (let col = 0; col < columns; col++) {
        const xStart = leftMargin * scale + col * (cardWidth + columnMargin * scale);
        const xEnd = xStart + cardWidth;

        context.beginPath();
        context.moveTo(xStart, topMargin * scale);
        context.lineTo(xStart, previewCanvas.height - bottomMargin * scale);
        context.stroke();

        context.beginPath();
        context.moveTo(xEnd, topMargin * scale);
        context.lineTo(xEnd, previewCanvas.height - bottomMargin * scale);
        context.stroke();
    }

    for (let row = 0; row < rows; row++) {
        const yStart = topMargin * scale + row * (cardHeight + rowMargin * scale);
        const yEnd = yStart + cardHeight;

        context.beginPath();
        context.moveTo(leftMargin * scale, yStart);
        context.lineTo(previewCanvas.width - rightMargin * scale, yStart);
        context.stroke();

        context.beginPath();
        context.moveTo(leftMargin * scale, yEnd);
        context.lineTo(previewCanvas.width - rightMargin * scale, yEnd);
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
    const isDuplex = document.getElementById('page_duplex').checked;
    const isDuplexShort = document.getElementById('page_duplex_short').checked;
    const isFoldVertical = document.getElementById('page_fold_vertical').checked;
    const isFoldHorizontal = document.getElementById('page_fold_horizontal').checked;
    const rows = parseInt(document.getElementById('rows').value, 10);
    const columns = parseInt(document.getElementById('columns').value, 10);
    const topMargin = parseFloat(document.getElementById('topMargin').value);
    const bottomMargin = parseFloat(document.getElementById('bottomMargin').value);
    const leftMargin = parseFloat(document.getElementById('leftMargin').value);
    const rightMargin = parseFloat(document.getElementById('rightMargin').value);
    const rowMargin = parseFloat(document.getElementById('rowMargin').value);
    const columnMargin = parseFloat(document.getElementById('columnMargin').value);

    if (!pdfDoc || !rows || !columns) {
        alert('Please upload a PDF and set the grid parameters.');
        return;
    }

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

    for (let pageIndex = 0; pageIndex < pdfLibPages.length; pageIndex++) {
        const pdfLibPage = pdfLibPages[pageIndex];
        const { width, height } = pdfLibPage.getSize();
        const totalRowMargin = rowMargin * (rows - 1);
        const totalColumnMargin = columnMargin * (columns - 1);
        const cardWidth = (width - leftMargin - rightMargin - totalColumnMargin) / columns;
        const cardHeight = (height - topMargin - bottomMargin - totalRowMargin) / rows;

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

        for (let row = 0; row < rows; row++) {
            for (let col = 0; col < columns; col++) {
                const x0 = leftMargin + col * (cardWidth + columnMargin);
                const y0 = height - topMargin - (row + 1) * (cardHeight + rowMargin);

                // Create a canvas for the card at the specified DPI
                const canvas = document.createElement('canvas');
                canvas.width = cardWidth * dpiScale;
                canvas.height = cardHeight * dpiScale;
                const ctx = canvas.getContext('2d');

                // Calculate scaled coordinates based on pdf.js render scale
                // Note: PDF coordinates have origin at bottom-left, canvas has origin at top-left
                const scaleRatio = viewport.width / width;
                const scaledX = x0 * scaleRatio;
                const scaledWidth = cardWidth * scaleRatio;
                const scaledHeight = cardHeight * scaleRatio;
                // Invert Y coordinate: canvas Y = viewport.height - (PDF y + height)
                const scaledY = viewport.height - (y0 + cardHeight) * scaleRatio;

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
                    if (currentPage % 2 === 0) {
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
                        const x0Back = leftMargin + ((columns - 1) - col) * (cardWidth + columnMargin);
                        const scaledXBack = x0Back * scaleRatio;
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
                    if (currentPage % 2 === 0) {
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
                        const x0Back = leftMargin + ((columns - 1) - col) * (cardWidth + columnMargin);
                        const scaledXBack = x0Back * scaleRatio;
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
                }
            }
        }
        currentPage++;
    }

    // Wait for all blobs to be added to zip
    await Promise.all(pageRenderPromises);

    // Generate and download zip files
    if (isDuplex || isDuplexShort || isFoldVertical || isFoldHorizontal) {
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
 