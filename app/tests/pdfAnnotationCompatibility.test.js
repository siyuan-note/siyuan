const assert = require("node:assert/strict");
const {readFileSync, mkdtempSync, rmSync} = require("node:fs");
const path = require("node:path");
const os = require("node:os");

async function runElectron() {
    const {app, BrowserWindow} = require("electron");
    app.setPath("userData", process.argv[2]);
    await app.whenReady();
    const win = new BrowserWindow({show: false});
    let exitCode = 0;
    try {
        await win.loadURL("data:text/html,<html><body></body></html>");
        const moduleUrl = source => "data:text/javascript;base64," + Buffer.from(source).toString("base64");
        const treeUrl = moduleUrl(await require("./pdfViewerBundle.cjs")());
        const runtimeUrl = moduleUrl(readFileSync(path.join(__dirname, "../stage/protyle/js/pdf/pdf.min.mjs"), "utf8"));
        const result = await win.webContents.executeJavaScript(`(async () => {
            window.pdfjsLib = await import(${JSON.stringify(runtimeUrl)});
            const {AnnotationLayer} = window.pdfjsLib;
            window.siyuan = {languages: new Proxy({}, {get: (_, key) => key}), storage: {}};
            const {StructTreeLayerBuilder} = await import(${JSON.stringify(treeUrl)});
            const tree = {role: "Document", children: [
                {role: "Link", alt: "Link label", children: [{type: "annotation", id: "annot-1"}]},
                {role: "P", children: [{type: "content", id: "text-1"},
                    {role: "Annot", children: [{type: "annotation", id: "annot-2"}]}]}
            ]};
            const results = [];
            for (const value of [tree, null, new Error("Structure unavailable")]) {
                let reads = 0;
                const builder = new StructTreeLayerBuilder({async getStructTree() {
                    reads++;
                    if (value instanceof Error) { throw value; }
                    return value;
                }});
                const div = document.createElement("div");
                document.body.append(div);
                const layer = new AnnotationLayer({
                    div, structTreeLayer: builder,
                    accessibilityManager: {addPointerInTextLayer() {}},
                    annotationStorage: {}, linkService: {}, page: {},
                    viewport: {rawDims: {pageWidth: 100, pageHeight: 100}, rotation: 0}
                });
                await layer.render({annotations: []});
                const ids = await builder.getAnnotationIds();
                const attrs = await builder.getAriaAttributes("annot-1");
                results.push({ids: ids === null ? null : [...ids], label: attrs?.get("aria-label") ?? null, reads});
                div.remove();
            }
            return results;
        })()`);
        assert.deepEqual(result, [
            {ids: ["annot-1", "annot-2"], label: "Link label", reads: 1},
            {ids: [], label: null, reads: 1},
            {ids: null, label: null, reads: 1},
        ]);
        const {transpileModule, ModuleKind, ScriptTarget} = require("typescript");
        const transpile = source => transpileModule(source, {
            compilerOptions: {module: ModuleKind.ESNext, target: ScriptTarget.ES2022},
        }).outputText;
        const assetModule = name => moduleUrl(transpile(readFileSync(path.join(__dirname, `../src/asset/${name}.ts`), "utf8")));
        const annoSource = readFileSync(path.join(__dirname, "../src/asset/anno.ts"), "utf8");
        const section = (start, end) => {
            const offset = annoSource.indexOf(start);
            const limit = annoSource.indexOf(end, offset);
            assert.ok(offset >= 0 && limit > offset);
            return annoSource.slice(offset, limit);
        };
        const annotationCode = transpile(section("const showHighlight =", "export const hlPDFRect") +
            section("async function getRectImgData", "const removeAnno ="));
        const workerUrl = moduleUrl(readFileSync(path.join(__dirname, "../stage/protyle/js/pdf/pdf.worker.min.mjs"), "utf8"));
        const coordinates = await win.webContents.executeJavaScript(`(async () => {
            const {getDocument} = await import(${JSON.stringify(runtimeUrl)});
            globalThis.pdfjsWorker = await import(${JSON.stringify(workerUrl)});
            const {pdfRectToViewport} = await import(${JSON.stringify(assetModule("pdfCoordinates"))});
            const {isPdfRectAnnotation, mergePdfTextAnnotationRects} = await import(${JSON.stringify(assetModule("pdfTextAnnotation"))});
            const {getCaptureCanvasBounds, getCaptureDisplayWidth, getLimitedCaptureScale,
                PDF_RECT_CAPTURE_SCALE, PDF_RECT_DISPLAY_SCALE} = await import(${JSON.stringify(assetModule("pdfRectCapture"))});
            ${annotationCode}
            const stream = "1 0 0 rg 10 20 200 300 re f";
            const objects = [
                "<< /Type /Catalog /Pages 2 0 R >>",
                "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
                "<< /Type /Page /Parent 2 0 R /MediaBox [10 20 210 320] /Resources << >> /Contents 4 0 R >>",
                "<< /Length " + stream.length + " >>\\nstream\\n" + stream + "\\nendstream"
            ];
            let source = "%PDF-1.7\\n";
            const offsets = [0];
            objects.forEach((object, i) => {
                offsets.push(source.length);
                source += (i + 1) + " 0 obj\\n" + object + "\\nendobj\\n";
            });
            const xref = source.length;
            source += "xref\\n0 5\\n0000000000 65535 f \\n";
            source += offsets.slice(1).map(offset => String(offset).padStart(10, "0") + " 00000 n \\n").join("");
            source += "trailer\\n<< /Size 5 /Root 1 0 R >>\\nstartxref\\n" + xref + "\\n%%EOF";
            const task = getDocument({data: new TextEncoder().encode(source)});
            const pdfDocument = await task.promise;
            try {
                const pdfPage = await pdfDocument.getPage(1);
                const rect = [30, 60, 80, 100];
                const results = [];
                for (const rotation of [0, 90, 180, 270]) {
                    for (const scale of [0.5, 1, 2]) {
                        const viewport = pdfPage.getViewport({rotation, scale, offsetX: 7, offsetY: 11});
                        const bounds = pdfRectToViewport(viewport, rect);
                        const roundTrip = viewport.convertToPdfPoint(bounds[0], bounds[1])
                            .concat(viewport.convertToPdfPoint(bounds[2], bounds[3]));
                        const textDiv = document.createElement("div");
                        textDiv.append(document.createElement("span"));
                        const pageDiv = document.createElement("div");
                        pageDiv.append(textDiv);
                        document.body.append(pageDiv);
                        const pageView = {viewport, rotation, pdfPageRotate: 0, textLayer: {div: textDiv}};
                        const pdf = {pdfDocument, pdfViewer: {getPageView() { return pageView; }}};
                        const mark = showHighlight({index: 0, coords: [rect], id: "test", color: "red",
                            content: "marked text", type: "a", mode: "text"}, pdf);
                        const style = mark.firstElementChild.style;
                        const highlight = [style.left, style.top, style.width, style.height].map(parseFloat);
                        const captured = await getRectImgData(pdf, 1, rect);
                        const bitmap = await createImageBitmap(captured.blob);
                        const canvas = document.createElement("canvas");
                        canvas.width = bitmap.width;
                        canvas.height = bitmap.height;
                        const ctx = canvas.getContext("2d");
                        ctx.drawImage(bitmap, 0, 0);
                        const pixel = [...ctx.getImageData(canvas.width / 2, canvas.height / 2, 1, 1).data];
                        results.push({rotation, scale, bounds, roundTrip, highlight,
                            capture: [bitmap.width, bitmap.height], displayWidth: captured.displayWidth, pixel});
                        bitmap.close();
                        pageDiv.remove();
                    }
                }
                return results;
            } finally {
                await task.destroy();
            }
        })()`);
        const expectedBounds = {
            0: [20, 260, 70, 220], 90: [40, 20, 80, 70],
            180: [180, 40, 130, 80], 270: [260, 180, 220, 130],
        };
        assert.equal(coordinates.length, 12);
        for (const item of coordinates) {
            const {rotation, scale} = item;
            assert.deepEqual(item.bounds, expectedBounds[rotation].map((value, i) => value * scale + (i % 2 ? 11 : 7)));
            assert.deepEqual(item.roundTrip, [30, 60, 80, 100]);
            assert.deepEqual(item.highlight, [20 * scale + 7, 220 * scale + 11, 50 * scale, 40 * scale]);
            assert.deepEqual(item.capture, rotation % 180 ? [160, 200] : [200, 160]);
            assert.equal(item.displayWidth, rotation % 180 ? 80 : 100);
            assert.deepEqual(item.pixel, [255, 0, 0, 255]);
        }
        const css = require("sass").compile(path.join(__dirname, "../src/assets/scss/pdf/_pdf.scss")).css;
        await win.webContents.insertCSS(css + ".testViewer {position:absolute; top:0; left:0; width:780px; height:560px;} .hidden,.fn__none {display:none !important;}");
        const viewerResults = await win.webContents.executeJavaScript(`(async () => {
            const {webViewerLoad, getPdfViewerHTML} = await import(${JSON.stringify(treeUrl)});
            const errors = [];
            const originalConsoleError = console.error;
            console.error = (...args) => errors.push(args.map(String).join(" "));
            const onError = event => errors.push(String(event.error || event.reason || event.message));
            window.addEventListener("error", onError);
            window.addEventListener("unhandledrejection", onError);
            const waitFor = (bus, name, predicate = () => true) => new Promise((resolve, reject) => {
                const ac = new AbortController();
                const timer = setTimeout(() => { ac.abort(); reject(new Error("Timeout: " + name)); }, 8000);
                bus.on(name, data => {
                    if (predicate(data)) { clearTimeout(timer); ac.abort(); resolve(data); }
                }, {signal: ac.signal});
            });
            const stream = "BT /F1 18 Tf 25 200 Td (Hello PDF upgrade) Tj ET";
            const objects = [
                "<< /Type /Catalog /Pages 2 0 R /AcroForm << /Fields [8 0 R 9 0 R] /DA (/F1 12 Tf 0 g) /DR << /Font << /F1 5 0 R >> >> >> >>",
                "<< /Type /Pages /Kids [3 0 R 6 0 R] /Count 2 >>",
                "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 400] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R /Annots [7 0 R 8 0 R 9 0 R] >>",
                "<< /Length " + stream.length + " >>\\nstream\\n" + stream + "\\nendstream",
                "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
                "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 400] /UserUnit 2 /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
                "<< /Type /Annot /Subtype /Link /Rect [25 180 220 220] /Border [0 0 0] /A << /S /URI /URI (https://example.com/) >> >>",
                "<< /Type /Annot /Subtype /Widget /FT /Btn /T (check) /V /Yes /AS /Yes /Rect [25 120 45 140] /P 3 0 R >>",
                "<< /Type /Annot /Subtype /Widget /FT /Tx /T (text) /V (form text) /Rect [60 120 220 140] /P 3 0 R >>"
            ];
            let source = "%PDF-1.7\\n";
            const offsets = [0];
            objects.forEach((object, i) => {
                offsets.push(source.length);
                source += (i + 1) + " 0 obj\\n" + object + "\\nendobj\\n";
            });
            const xref = source.length;
            source += "xref\\n0 " + (objects.length + 1) + "\\n0000000000 65535 f \\n";
            source += offsets.slice(1).map(offset => String(offset).padStart(10, "0") + " 00000 n \\n").join("");
            source += "trailer\\n<< /Size " + (objects.length + 1) + " /Root 1 0 R >>\\nstartxref\\n" + xref + "\\n%%EOF";
            const url = URL.createObjectURL(new Blob([source], {type: "application/pdf"}));
            const viewers = [];
            try {
                for (let i = 0; i < 2; i++) {
                    const element = document.createElement("div");
                    element.className = "testViewer fn__flex-1";
                    if (i === 0) element.classList.add("fn__none");
                    element.innerHTML = getPdfViewerHTML();
                    document.body.append(element);
                    const pdf = webViewerLoad(url, element, "test-" + i, null, true);
                    viewers.push({pdf, element});
                    await pdf.initializedPromise;
                    const textRendered = waitFor(pdf.eventBus, "textlayerrendered");
                    const annotationRendered = waitFor(pdf.eventBus, "annotationlayerrendered");
                    if (i === 0) {
                        await waitFor(pdf.eventBus, "documentinit");
                        await new Promise(resolve => setTimeout(resolve, 50));
                        element.classList.remove("fn__none");
                    }
                    for (const event of await Promise.all([textRendered, annotationRendered])) {
                        if (event.error) throw event.error;
                    }
                    const page = pdf.pdfViewer.getPageView(0);
                    if (!page.textLayer.div.textContent.includes("Hello PDF upgrade")) throw new Error("Missing text layer");
                    if (!page.div.querySelector('a[href="https://example.com/"]')) throw new Error("Missing PDF link");
                    if (page.textLayer.div.dataset.highlightRestored !== "true") throw new Error("Missing annotation hook");
                    const span = page.textLayer.div.querySelector("span");
                    if (!(parseFloat(getComputedStyle(span).fontSize) > 0)) throw new Error("Invalid text size");
                    const checkbox = page.div.querySelector('input[type="checkbox"]');
                    if (!checkbox?.checked) throw new Error("Missing checked PDF form field");
                    checkbox.click();
                    if (checkbox.closest("section").dataset.pdfChecked !== "false") throw new Error("Form appearance not updated");
                    if (page.div.querySelector('input[type="text"]').value !== "form text") throw new Error("Missing text field value");
                }
                const {pdf, element} = viewers[1];
                const firstScale = viewers[0].pdf.pdfViewer.currentScale;
                let rendered = waitFor(pdf.eventBus, "pagerendered");
                pdf.zoomIn();
                await rendered;
                if (viewers[0].pdf.pdfViewer.currentScale !== firstScale) throw new Error("Shared zoom state");
                rendered = waitFor(pdf.eventBus, "pagerendered");
                pdf.rotatePages(90);
                await rendered;
                const found = waitFor(pdf.eventBus, "updatefindmatchescount", data => data.matchesCount.total === 2);
                pdf.eventBus.dispatch("find", {source: null, type: "", query: "Hello", caseSensitive: false,
                    entireWord: true, highlightAll: true, findPrevious: false, matchDiacritics: false});
                await found;
                pdf.pdfSidebar.switchView(1, true);
                await new Promise(resolve => setTimeout(resolve, 100));
                const thumbnail = pdf.pdfThumbnailViewer.getThumbnail(0);
                if (thumbnail.renderingState === 0) await thumbnail.draw();
                if (!thumbnail.image.src.startsWith("blob:")) throw new Error("Missing thumbnail image");
                if (parseFloat(getComputedStyle(thumbnail.image).width) !== thumbnail.canvasWidth) throw new Error("Invalid thumbnail width");
                await pdf.pdfDocumentProperties.open();
                if (element.querySelector("#pageCountField").textContent !== "2") throw new Error("Missing document properties");
                await pdf.pdfDocumentProperties.close();
                const secondPage = pdf.pdfViewer.getPageView(1);
                rendered = secondPage.textLayer?.div.dataset.highlightRestored === "true"
                    ? Promise.resolve() : waitFor(pdf.eventBus, "textlayerrendered", data => data.pageNumber === 2);
                pdf.pdfLinkService.goToPage(2);
                await rendered;
                if (Number(getComputedStyle(secondPage.div).getPropertyValue("--user-unit")) !== 2) {
                    throw new Error("Missing PDF UserUnit scale");
                }
                element.style.width = "375px";
                pdf.pdfViewer.currentScaleValue = "page-width";
                const scaleBeforePinch = pdf.pdfViewer.currentScale;
                pdf.touchPinchCallback([180, 200], 100, 150, 0, 0);
                pdf.touchPinchEndCallback();
                if (!(pdf.pdfViewer.currentScale > scaleBeforePinch)) throw new Error("Pinch zoom failed");
                const waitUntil = async predicate => {
                    for (let i = 0; i < 160; i++) {
                        if (predicate()) return;
                        await new Promise(resolve => setTimeout(resolve, 25));
                    }
                    throw new Error("Deferred PDF navigation timed out");
                };
                pdf.pdfSidebar.close();
                pdf.rotatePages(-90);
                pdf.pdfLinkService.goToPage(1);
                element.classList.add("fn__none");
                pdf.pdfLinkService.setHash("page=1&zoom=150,0,50");
                pdf.pdfLinkService.setHash("page=2&zoom=150,0,100");
                await new Promise(resolve => setTimeout(resolve, 50));
                element.classList.remove("fn__none");
                await waitUntil(() => pdf.pdfViewer.currentPageNumber === 2 &&
                    pdf.pdfViewer.currentScale === 1.5 && pdf.pdfViewer.container.scrollTop > 0);
                const deferredTop = pdf.pdfViewer.container.scrollTop;
                pdf.pdfLinkService.setHash("page=2&zoom=150,0,100");
                if (Math.abs(pdf.pdfViewer.container.scrollTop - deferredTop) > 1) {
                    throw new Error("Deferred PDF destination differs from visible navigation");
                }
                element.classList.add("fn__none");
                pdf.pdfLinkService.setHash("page=1&zoom=200,0,50");
                await pdf.destroy();
                element.classList.remove("fn__none");
                await new Promise(resolve => setTimeout(resolve, 100));
                return {count: viewers.length, pages: viewers[0].pdf.pagesCount, errors};
            } finally {
                for (const {pdf, element} of viewers) { await pdf.destroy(); element.remove(); }
                URL.revokeObjectURL(url);
                window.removeEventListener("error", onError);
                window.removeEventListener("unhandledrejection", onError);
                console.error = originalConsoleError;
            }
        })()`);
        assert.deepEqual(viewerResults, {count: 2, pages: 2, errors: []});
    } catch (error) {
        console.error(error);
        exitCode = 1;
    } finally {
        win.destroy();
        app.exit(exitCode);
    }
}

if (process.versions.electron && process.type === "browser") {
    runElectron().catch(error => {
        console.error(error);
        require("electron").app.exit(1);
    });
} else {
    require("node:test").it("renders PDF annotation layers, highlights and rotated rectangle captures with the bundled runtime", {
        skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
        timeout: 60000,
    }, async () => {
        const env = {...process.env};
        delete env.ELECTRON_RUN_AS_NODE;
        const profile = mkdtempSync(path.join(os.tmpdir(), "siyuan-pdf-annotation-"));
        try {
            await require("node:util").promisify(require("node:child_process").execFile)(
                require("electron"), [__filename, profile], {env, windowsHide: true, timeout: 55000});
        } finally {
            rmSync(profile, {recursive: true, force: true});
        }
    });
}
