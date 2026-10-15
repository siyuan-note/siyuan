const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

async function runElectron() {
    const {app, BrowserWindow} = require("electron");
    app.setPath("userData", process.argv[2]);
    await app.whenReady();
    const win = new BrowserWindow({show: false, width: 1000, height: 900, webPreferences: {backgroundThrottling: false}});
    let code = 0;
    try {
        await win.loadURL("data:text/html,<html><body></body></html>");
        const moduleUrl = source => "data:text/javascript;base64," + Buffer.from(source).toString("base64");
        const bundle = moduleUrl(await require("./pdfViewerBundle.cjs")({annotations: true}));
        const runtime = moduleUrl(fs.readFileSync(path.join(__dirname, "../stage/protyle/js/pdf/pdf.min.mjs")));
        const worker = moduleUrl(fs.readFileSync(path.join(__dirname, "../stage/protyle/js/pdf/pdf.worker.min.mjs")));
        const sampleDir = process.env.SIYUAN_PDF_REGRESSION_ASSETS;
        const samples = sampleDir ? ["fyp4yx6.pdf", "wnbw5z1.pdf"].map(suffix => ({
            suffix,
            data: fs.readFileSync(path.join(sampleDir, fs.readdirSync(sampleDir).find(name => name.endsWith(suffix)))).toString("base64"),
        })) : [];
        const css = require("sass").compile(path.join(__dirname, "../src/assets/scss/pdf/_pdf.scss")).css;
        await win.webContents.insertCSS(css + ".fn__none,.hidden{display:none!important}.fn__hidden{visibility:hidden}svg{width:14px;height:14px}.testViewer{position:absolute;inset:0}.pdf__util{position:fixed}.fn__flex{display:flex}.fn__flex-1{flex:1;min-height:0}.fn__flex-column{display:flex;flex-direction:column}");
        const result = await win.webContents.executeJavaScript(`(async () => {
            window.pdfjsLib = await import(${JSON.stringify(runtime)});
            globalThis.pdfjsWorker = await import(${JSON.stringify(worker)});
            window.siyuan = {languages: new Proxy({}, {get: (_, key) => key}), storage: {pdf: {}}};
            let nextID = 0;
            window.Lute = {NewNodeID: () => "20261010120000-" + String(++nextID).padStart(7, "0")};
            const {getPdfViewerHTML, webViewerLoad, getPdfSelectionText, PDFViewer, PDFThumbnailViewer, TextLayerBuilder} = await import(${JSON.stringify(bundle)});
            const errors = [];
            console.error = (...args) => errors.push(args.map(String).join(" "));
            window.addEventListener("error", event => errors.push(String(event.error)));
            window.addEventListener("unhandledrejection", event => errors.push(String(event.reason)));
            const wait = () => new Promise(resolve => setTimeout(resolve, 30));
            const extracted = [];
            for (const html of [
                '<span>Fol-</span><br><span>lowing</span>',
                '<span class="markedContent"><span>Fol-</span><br><span><span class="highlight">low</span>ing</span></span>',
                '<span>one</span><br><span>word</span>',
                '<span>中文</span><br><span>换行</span>',
                '<span>well-known</span>',
            ]) {
                const div = document.createElement("div"); div.innerHTML = html;
                const range = document.createRange(); range.selectNodeContents(div);
                extracted.push(getPdfSelectionText(range));
                if (div.innerHTML !== html) throw new Error("Selection DOM was modified");
            }
            const stream = "BT /F1 12 Tf 25 300 Td (by) Tj 17 0 Td (asymmetrically) Tj 83 0 Td (texturing) Tj ET";
            const objects = [
                "<< /Type /Catalog /Pages 2 0 R >>",
                "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
                "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 500] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
                "<< /Length " + stream.length + " >>\\nstream\\n" + stream + "\\nendstream",
                "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
            ];
            let source = "%PDF-1.7\\n";
            const offsets = [0];
            objects.forEach((object, index) => {offsets.push(source.length); source += (index + 1) + " 0 obj\\n" + object + "\\nendobj\\n";});
            const xref = source.length;
            source += "xref\\n0 6\\n0000000000 65535 f \\n" + offsets.slice(1).map(offset => String(offset).padStart(10, "0") + " 00000 n \\n").join("");
            source += "trailer\\n<< /Size 6 /Root 1 0 R >>\\nstartxref\\n" + xref + "\\n%%EOF";
            const url = URL.createObjectURL(new Blob([source], {type: "application/pdf"}));
            const element = document.createElement("div"); element.className = "testViewer fn__flex-1";
            element.innerHTML = getPdfViewerHTML(); document.body.append(element);
            const pdf = webViewerLoad(url, element, 1);
            await pdf.initializedPromise;
            await new Promise((resolve, reject) => {
                const timer = setTimeout(() => reject(new Error("Text layer timeout")), 8000);
                pdf.eventBus.on("textlayerrendered", event => {clearTimeout(timer); event.error ? reject(event.error) : resolve();});
            });
            await wait();
            const page = pdf.pdfViewer.getPageView(0);
            const rect = page.canvas.getBoundingClientRect();
            const target = page.textLayer.div;
            const defaultContent = await page.pdfPage.getTextContent();
            if (!defaultContent.items.some(item => item.str?.includes("by asymmetrically texturing"))) {
                throw new Error("Default text extraction unexpectedly changed");
            }
            const word = [...target.querySelectorAll("span")].find(span => span.textContent === "asymmetrically");
            if (!word || Math.abs(word.getBoundingClientRect().left - rect.left - 42 * page.viewport.scale) > 0.3) {
                throw new Error("Word position was lost by combining text items");
            }
            for (const pointerType of ["mouse", "touch"]) {
                window.pdfTestMobile = pointerType === "touch";
                element.querySelector("#rectAnno").click();
                const send = (type, x, y) => target.dispatchEvent(new PointerEvent(type, {
                    pointerId: 1, isPrimary: true, pointerType, button: 0, buttons: type === "pointerup" ? 0 : 1,
                    clientX: rect.left + x, clientY: rect.top + y, bubbles: true, cancelable: true,
                }));
                send("pointerdown", 40, 80); send("pointermove", 200, 150); send("pointerup", 200, 150);
                target.dispatchEvent(new MouseEvent("click", {bubbles: true}));
                await wait();
                const menu = element.querySelector(".pdf__util");
                if (menu.classList.contains("fn__none")) throw new Error(pointerType + " rectangle menu hidden");
                if (!element.querySelector(".pdf__rect--selected .pdf__rect-resize")) throw new Error("Missing selected rectangle");
            }
            // 页面加载在关闭后成功或失败，都不能把失效视图送进渲染队列。
            let staleDraws = 0;
            for (const rejectPending of [false, true]) {
                const controller = new AbortController();
                const bus = pdf.eventBus;
                const pending = Promise.withResolvers();
                const fakeView = {id: 2, pdfPage: null, setPdfPage() {throw new Error("Stale page installed");}};
                const queue = {getHighestPriority: () => fakeView, renderView: () => staleDraws++};
                const container = document.createElement("div"); container.style.position = "absolute";
                const viewer = document.createElement("div");container.append(viewer);document.body.append(container);
                for (const Viewer of [PDFViewer, PDFThumbnailViewer]) {
                    const instance = new Viewer({container, viewer, eventBus: bus, renderingQueue: queue,
                        linkService: {}, abortSignal: controller.signal});
                    instance.pdfDocument = {getPage: () => pending.promise};
                    instance.forceRendering({views: [], first: null, last: null});
                    instance.pdfDocument = null;
                }
                controller.abort();
                rejectPending ? pending.reject(new Error("Transport destroyed")) : pending.resolve({});
                await wait();container.remove();
            }
            pdf.appConfig.mainContainer.dispatchEvent(new Event("scroll"));
            // 手动复制尚在等待截图时关闭阅读器，不能再读取已销毁的页面。
            window.pdfTestMobile = false;
            element.querySelector('.pdf__util [data-type="copy"]').click();
            await pdf.destroy(); element.remove(); await wait();
            const immediate = document.createElement("div"); immediate.className = "testViewer";
            immediate.innerHTML = getPdfViewerHTML();document.body.append(immediate);
            await webViewerLoad(url, immediate, 1).destroy(); immediate.remove();await wait();
            URL.revokeObjectURL(url);
            const sharedTask = window.pdfjsLib.getDocument({data: new TextEncoder().encode(source)});
            const sharedDocument = await sharedTask.promise;
            const sharedPage = await sharedDocument.getPage(1);
            const controller = new AbortController();
            const firstLayer = new TextLayerBuilder({pdfPage: sharedPage, abortSignal: controller.signal});
            const secondLayer = new TextLayerBuilder({pdfPage: sharedPage});
            document.body.append(firstLayer.div, secondLayer.div);
            await firstLayer.render({viewport: sharedPage.getViewport({scale: 1})});
            await secondLayer.render({viewport: sharedPage.getViewport({scale: 1})});
            controller.abort();firstLayer.cancel();firstLayer.div.remove();
            secondLayer.div.dispatchEvent(new MouseEvent("mousedown", {bubbles: true}));
            if (!secondLayer.div.classList.contains("selecting")) throw new Error("Missing selection start");
            document.dispatchEvent(new PointerEvent("pointerup"));
            if (secondLayer.div.classList.contains("selecting")) throw new Error("Closing a PDF disabled another PDF's selection listeners");
            secondLayer.cancel();secondLayer.div.remove();await sharedTask.destroy();
            const sampleResults = [];
            for (const sample of ${JSON.stringify(samples)}) {
                const task = window.pdfjsLib.getDocument({data: Uint8Array.from(atob(sample.data), c => c.charCodeAt(0))});
                const documentProxy = await task.promise;
                const page = await documentProxy.getPage(sample.suffix === "fyp4yx6.pdf" ? 3 : 1);
                const viewport = page.getViewport({scale: 1.5});
                const owner = document.createElement("div");owner.className = "page";
                owner.style.cssText = "position:absolute;left:0;top:0;width:" + viewport.width + "px;height:" + viewport.height + "px;--scale-factor:1.5;--total-scale-factor:1.5";
                document.body.append(owner);
                const canvas = document.createElement("canvas");canvas.width=viewport.width;canvas.height=viewport.height;owner.append(canvas);
                await page.render({canvas, viewport}).promise;
                const builder = new TextLayerBuilder({pdfPage: page});owner.append(builder.div);
                await builder.render({viewport});
                const spans = [...builder.div.querySelectorAll("span")];
                const range = document.createRange();
                if (sample.suffix === "fyp4yx6.pdf") {
                    const first = spans.find(span => span.textContent === "Fol-");
                    const last = spans.find(span => span.textContent === "lowing");
                    range.setStart(first.firstChild, 0);range.setEnd(last.firstChild, 6);
                    sampleResults.push(getPdfSelectionText(range));
                } else {
                    // 参考坐标来自样本中的 PDF 字符位置，不使用待测文字层反推坐标。
                    const start = document.caretRangeFromPoint(415.331 * 1.5 + 0.5, 480 * 1.5);
                    const end = document.caretRangeFromPoint(508.690 * 1.5 - 0.5, 480 * 1.5);
                    range.setStart(start.startContainer, start.startOffset);range.setEnd(end.startContainer, end.startOffset);
                    const selection = window.getSelection();selection.removeAllRanges();selection.addRange(range);
                    const clipboardData = new DataTransfer();
                    builder.div.dispatchEvent(new ClipboardEvent("copy", {clipboardData, bubbles: true, cancelable: true}));
                    sampleResults.push(clipboardData.getData("text/plain"));
                    selection.removeAllRanges();
                }
                builder.cancel();owner.remove();await task.destroy();
            }
            return {extracted, annotations: Object.keys(window.pdfSavedAnnotations).length, staleDraws, errors, sampleResults};
        })()`);
        assert.deepEqual(result.extracted, ["Following", "Following", "one word", "中文换行", "well-known"]);
        assert.equal(result.annotations, 2);
        assert.equal(result.staleDraws, 0);
        assert.deepEqual(result.errors, []);
        assert.deepEqual(result.sampleResults, samples.length ? ["Following", "by asymmetrically texturing"] : []);
    } catch (error) {
        console.error(error);
        code = 1;
    } finally {
        win.destroy();
        app.exit(code);
    }
}

if (process.versions.electron && process.type === "browser") {
    runElectron().catch(error => {console.error(error); require("electron").app.exit(1);});
} else {
    require("node:test").it("preserves PDF annotation menus, nested selection text and viewer teardown", {
        skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
        timeout: 60000,
    }, async () => {
        const profile = fs.mkdtempSync(path.join(os.tmpdir(), "siyuan-pdf-interactions-"));
        const env = {...process.env}; delete env.ELECTRON_RUN_AS_NODE;
        try {
            await require("node:util").promisify(require("node:child_process").execFile)(require("electron"),
                [__filename, profile], {env, timeout: 55000});
        } finally {
            fs.rmSync(profile, {recursive: true, force: true});
        }
    });
}
