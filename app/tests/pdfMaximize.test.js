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
        const moduleURL = source => "data:text/javascript;base64," + Buffer.from(source).toString("base64");
        const bundle = moduleURL(await require("./pdfViewerBundle.cjs")());
        const runtime = moduleURL(fs.readFileSync(path.join(__dirname, "../stage/protyle/js/pdf/pdf.min.mjs")));
        const worker = moduleURL(fs.readFileSync(path.join(__dirname, "../stage/protyle/js/pdf/pdf.worker.min.mjs")));
        const css = require("sass").compile(path.join(__dirname, "../src/assets/scss/pdf/_pdf.scss")).css;
        await win.webContents.insertCSS(css + ".fn__none,.hidden{display:none!important}.fn__hidden{visibility:hidden}svg{width:14px;height:14px}body{margin:0}.fn__flex-1{flex:1;min-height:0}");
        await win.webContents.executeJavaScript(`(async () => {
            window.pdfjsLib = await import(${JSON.stringify(runtime)});
            globalThis.pdfjsWorker = await import(${JSON.stringify(worker)});
            window.siyuan = {languages: new Proxy({}, {get: (_, key) => key}), storage: {}};
            const {getPdfViewerHTML, webViewerLoad} = await import(${JSON.stringify(bundle)});
            const check = (value, message) => {if (!value) throw new Error(message);};
            const wait = () => new Promise(resolve => setTimeout(resolve, 50));
            const toolbar = document.createElement("div");
            toolbar.id = "toolbar"; toolbar.style.height = "32px"; document.body.append(toolbar);
            const notes = document.createElement("div"); notes.textContent = "Keep notes and split";
            notes.style.cssText = "position:absolute;top:32px;left:0;width:400px;height:600px";
            document.body.append(notes);
            const element = document.createElement("div");
            element.style.cssText = "position:absolute;top:32px;left:400px;width:400px;height:600px";
            element.innerHTML = getPdfViewerHTML(); document.body.append(element);
            const button = element.querySelector("#pdfMaximize");
            const more = element.querySelector("#secondaryToolbarToggleButton");
            check(button.nextElementSibling === more, "maximize must immediately precede more tools");
            check(button.disabled && getComputedStyle(button).display !== "none",
                "maximize must occupy its slot before PDF initialization");
            const toolbarPositions = () => ["pdfMaximize", "secondaryToolbarToggleButton", "sidebarToggleButton",
                "viewFindButton", "pageNumber"].map(id => {
                    const rect = element.querySelector("#" + id).getBoundingClientRect();
                    return [id, rect.x, rect.y, rect.width, rect.height];
                });
            const initialPositions = JSON.stringify(toolbarPositions());
            await wait();
            check(JSON.stringify(toolbarPositions()) === initialPositions, "delayed initialization must preserve toolbar layout");
            button.click();
            check(!element.querySelector(".pdf__outer").classList.contains("pdf__outer--maximized"),
                "uninitialized maximize remains disabled");
            const stream = "BT /F1 12 Tf 25 300 Td (PDF pane text) Tj ET";
            const page = "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 500] /Resources << /Font << /F1 7 0 R >> >> /Contents 6 0 R >>";
            const objects = ["<< /Type /Catalog /Pages 2 0 R >>",
                "<< /Type /Pages /Kids [3 0 R 4 0 R 5 0 R] /Count 3 >>", page, page, page,
                "<< /Length " + stream.length + " >>\\nstream\\n" + stream + "\\nendstream",
                "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"];
            let source = "%PDF-1.7\\n";
            const offsets = [0];
            objects.forEach((object, i) => {offsets.push(source.length); source += (i + 1) + " 0 obj\\n" + object + "\\nendobj\\n";});
            const xref = source.length;
            source += "xref\\n0 8\\n0000000000 65535 f \\n" +
                offsets.slice(1).map(offset => String(offset).padStart(10, "0") + " 00000 n \\n").join("") +
                "trailer\\n<< /Size 8 /Root 1 0 R >>\\nstartxref\\n" + xref + "\\n%%EOF";
            const url = URL.createObjectURL(new Blob([source], {type: "application/pdf"}));
            const pdf = webViewerLoad(url, element, 1);
            check(!button.disabled && getComputedStyle(button).display !== "none", "binding enables the existing maximize button");
            check(JSON.stringify(toolbarPositions()) === initialPositions, "binding maximize must not shift toolbar controls");
            await pdf.initializedPromise;
            for (let i = 0; i < 160 && !pdf.pdfViewer.getPageView(0)?.textLayer?.div.textContent; i++) await wait();
            check(pdf.pdfViewer.getPageView(0)?.textLayer?.div.textContent.includes("PDF pane text"), "PDF did not render");
            const documentInstance = pdf.pdfDocument;
            const outer = element.querySelector(".pdf__outer");
            const originalLayout = element.style.cssText;
            const originalNotes = notes.outerHTML;
            const position = () => ({...pdf.pdfViewer._location});
            const assertPosition = (expected, label) => {
                const actual = position();
                check(actual.pageNumber === expected.pageNumber && Math.abs(actual.top - expected.top) < 2,
                    label + ": " + JSON.stringify({expected, actual}));
            };
            for (const scale of ["page-width", "1.5"]) {
                pdf.pdfViewer.currentScaleValue = scale;
                pdf.pdfViewer.scrollPageIntoView({pageNumber: 2, destArray: [null, {name: "XYZ"}, 0, 450, null],
                    ignoreDestinationZoom: true});
                // 等待滚动事件更新阅读位置，避免用上一页的位置作为最大化前的基准。
                for (let i = 0; i < 40 && (position()?.pageNumber !== 2 || Math.abs(position().top - 450) >= 2); i++) await wait();
                check(position()?.pageNumber === 2 && Math.abs(position().top - 450) < 2, "initial reading position did not settle");
                const before = position();
                for (let i = 0; i < 3; i++) {
                    button.click(); await wait();
                    check(outer.classList.contains("pdf__outer--maximized"), "maximize state missing");
                    check(button.getAttribute("aria-label") === "restore" && button.getAttribute("aria-pressed") === "true", "restore entry missing");
                    const rect = outer.getBoundingClientRect();
                    check(rect.left === 0 && rect.top === 32 && rect.width === document.documentElement.clientWidth,
                        "pane did not fill available width");
                    check(pdf.pdfDocument === documentInstance, "PDF was reloaded");
                    assertPosition(before, "maximize");
                    button.click(); await wait();
                    assertPosition(before, "restore");
                    check(outer.clientWidth === 400 && element.style.cssText === originalLayout && notes.outerHTML === originalNotes,
                        "split layout changed");
                }
            }
            pdf.pdfViewer.currentScaleValue = "page-width";
            button.click(); await wait();
            const anchor = position();
            window.pdfPaneFixture = {pdf, element, outer, button, anchor, assertPosition, wait, check, url,
                getPdfViewerHTML, webViewerLoad};
        })()`);
        for (const [width, height] of [[480, 900], [1100, 600], [800, 800]]) {
            win.setSize(width, height);
            await win.webContents.executeJavaScript(`(async () => {
                const f = window.pdfPaneFixture;
                await f.wait(); await f.wait();
                f.assertPosition(f.anchor, "viewport resize");
                f.check(f.outer.clientWidth === document.documentElement.clientWidth,
                    "viewport width not followed: " + JSON.stringify({pane: f.outer.clientWidth,
                        viewport: document.documentElement.clientWidth, window: innerWidth}));
            })()`);
        }
        await win.webContents.executeJavaScript(`(async () => {
            const f = window.pdfPaneFixture;
            f.element.classList.add("fn__none"); await f.wait();
            f.check(!f.outer.classList.contains("pdf__outer--maximized"), "hidden tab retained maximize state");
            f.element.classList.remove("fn__none"); await f.wait();
            f.button.click();
            await f.pdf.destroy();
            f.check(!f.outer.classList.contains("pdf__outer--maximized"), "destroy retained maximize state");
            for (const mobile of [false, true]) {
                const element = document.createElement("div");
                if (mobile) element.className = "pdf-viewer--mobile";
                element.innerHTML = f.getPdfViewerHTML({maximize: false}); document.body.append(element);
                f.check(getComputedStyle(element.querySelector("#pdfMaximize")).display === "none",
                    "preview and standalone mobile must hide maximize before initialization");
                const pdf = f.webViewerLoad(f.url, element, 1, undefined, !mobile);
                f.check(element.querySelector("#pdfMaximize").classList.contains("fn__none"),
                    "preview or standalone mobile viewer exposed redundant maximize");
                await pdf.destroy(); element.remove();
            }
            URL.revokeObjectURL(f.url);
        })()`);
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
    require("node:test").it("PDF panes maximize and restore without losing reading position or split layout", {
        skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
        timeout: 60000,
    }, async () => {
        const profile = fs.mkdtempSync(path.join(os.tmpdir(), "siyuan-pdf-maximize-"));
        const env = {...process.env}; delete env.ELECTRON_RUN_AS_NODE;
        try {
            await require("node:util").promisify(require("node:child_process").execFile)(require("electron"),
                [__filename, profile], {env, timeout: 55000, windowsHide: true});
        } finally {
            assert.equal(path.dirname(path.resolve(profile)), path.resolve(os.tmpdir()));
            assert.ok(path.basename(profile).startsWith("siyuan-pdf-maximize-"));
            fs.rmSync(profile, {recursive: true, force: true, maxRetries: 5, retryDelay: 100});
        }
    });
}
