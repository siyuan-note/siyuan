const assert = require("node:assert/strict");
const {readFileSync, mkdtempSync, rmSync} = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {transpileModule, ModuleKind, ScriptTarget} = require("typescript");

const sources = () => {
    const compile = name => transpileModule(readFileSync(path.join(__dirname, "../src", name), "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
    }).outputText;
    return {
        preview: compile("config/assetPreview.ts"),
        assets: compile("config/assets.ts") + "\nexports.assets = assets;",
        media: compile("asset/renderAssets.ts"),
        previewPath: compile("asset/previewPath.ts"),
        escape: compile("util/escape.ts"),
        viewer: compile("asset/pdf/viewer.js"),
        viewerTemplate: compile("asset/pdf/viewerTemplate.ts"),
        pdfTheme: compile("asset/pdfViewer.ts"),
        mobilePDF: compile("mobile/pdf.ts"),
        highlight: compile("protyle/render/highlightRender.ts"),
        languages: JSON.parse(readFileSync(path.join(__dirname, "../appearance/langs/en.json"), "utf8")),
        styles: ["base", "mobile"].map(name => require("sass").compile(
            path.join(__dirname, `../src/assets/scss/${name}.scss`), {logger: {warn() {}, debug() {}}}).css),
        themes: ["daylight", "midnight"].map(name => readFileSync(
            path.join(__dirname, `../appearance/themes/${name}/theme.css`), "utf8")),
    };
};

const runCases = async source => {
    const check = require("node:assert/strict");
    const load = (code, modules = {}) => {
        const exports = {};
        new Function("require", "exports", code)(name => modules[name] || {}, exports);
        return exports;
    };
    const settle = () => new Promise(resolve => setTimeout(resolve, 10));
    const deferred = () => {
        let resolve;
        const promise = new Promise(done => { resolve = done; });
        return {promise, resolve};
    };
    const Constants = {SIYUAN_ASSETS_IMAGE: [".png"], SIYUAN_ASSETS_AUDIO: [".mp3"], SIYUAN_ASSETS_VIDEO: [".mp4"],
        LOCAL_PDFTHEME: "pdfTheme"};
    let mobile = false;
    window.siyuan = {languages: source.languages, config: {appearance: {mode: 0}, editor: {}},
        storage: {pdfTheme: {light: "light", dark: "dark"}}};
    const viewerTemplate = load(source.viewerTemplate, {
        "../../protyle/util/compatibility": {updateHotkeyTip: value => value},
    });
    const pdfTheme = load(source.pdfTheme, {
        "../constants": {Constants}, "../protyle/util/compatibility": {setStorageVal: () => {}},
    });
    const highlight = load(source.highlight, {
        "../util/addScript": {addScript: () => Promise.resolve()},
        "../../constants": {Constants}, "./util": {setCodeTheme() {}},
        "./foldedContent": {isFoldedRenderContent: () => false},
    });
    const pathName = {getAssetExtension: value => require("node:path").extname(value.split(/[?#]/)[0])};
    const previewPath = load(source.previewPath);
    const escape = load(source.escape);
    const media = load(source.media, {"../constants": {Constants}, "../util/pathName": pathName,
        "../util/escape": escape, "./previewPath": previewPath});
    const pdfCalls = [];
    let destroyed = 0;
    let loaded = 0;
    const viewer = {webViewerLoad: (...args) => {
        pdfCalls.push(args);
        return {destroy: async () => { destroyed++; }};
    }};
    let pdfModule = Promise.resolve(viewer);
    const previewAPI = load(source.preview, {
        "../asset/renderAssets": media,
        "../asset/previewPath": previewPath,
        "../asset/pdfViewer": {loadPdfViewerModule: () => { loaded++; return pdfModule; }, bindPdfTheme: pdfTheme.bindPdfTheme},
        "../asset/pdf/viewerTemplate": viewerTemplate,
        "../constants": {Constants},
        "../util/pathName": pathName,
        "../util/functions": {isMobile: () => mobile},
        "../protyle/render/highlightRender": highlight,
    });
    const container = document.createElement("div");
    document.body.append(container);
    const preview = new previewAPI.AssetPreview(container);
    const requests = [];
    let responseText = "";
    window.fetch = async (url, options) => {
        requests.push({url, ...options});
        return new Response(responseText);
    };
    responseText = "# Heading\n\n**Bold**\n\n```js\nconst x = 1;\n```\n\n![image](same.png)";
    preview.show("assets/readme.md", "box/doc/assets/readme.md");
    await settle();
    check.equal(container.querySelector("h1").textContent, "Heading");
    check.equal(container.querySelector("strong").textContent, "Bold");
    check.equal(container.querySelector("pre").dataset.language, "js");
    check.ok(container.querySelector(".hljs-keyword"));
    const imageURL = new URL(container.querySelector("img").src);
    check.equal(imageURL.searchParams.get("dataPath"), "box/doc/assets/same.png");
    check.equal(new URL(requests[0].url).searchParams.get("dataPath"), "box/doc/assets/readme.md");

    responseText = "<style>body{display:none}</style><script>window.executed=true</script>" +
        '<h2 onclick="window.executed=true" id="removeAll" class="item" data-type="clear">HTML</h2>' +
        '<form><button>Delete</button></form><a href="javascript:alert(1)">Link</a>' +
        '<pre><code class="language-js"><span>const </span><span>x = 1;</span></code></pre>' +
        '<img src="data:image/png;base64," onerror="window.executed=true">';
    preview.show("assets/page.html", "assets/page.html");
    await settle();
    check.equal(container.querySelector("h2").outerHTML, "<h2>HTML</h2>");
    check.equal(container.querySelector("script, style, button, form, [onclick], [onerror], [data-type]"), null);
    check.equal(container.querySelector("a").hasAttribute("href"), false);
    check.equal(window.executed, undefined);
    check.equal(container.querySelector("code").textContent, "const x = 1;\n");
    check.ok(container.querySelector(".hljs-keyword"));

    responseText = "<tag>literal</tag>\nconst x = 1;";
    preview.show("assets/code.ts", "assets/code.ts");
    await settle();
    check.equal(container.querySelector("code").textContent, responseText + "\n");
    check.equal(container.querySelector("tag"), null);
    check.equal(container.querySelector("pre").dataset.language, "ts");
    responseText = "x".repeat(70000);
    preview.show("assets/large.txt", "assets/large.txt");
    await settle();
    check.equal(container.querySelector("code").textContent.length, 65537);
    check.match(container.textContent, /Only the beginning/);

    const count = requests.length;
    preview.show("assets/skipped.txt", "assets/skipped.txt", 30);
    preview.show("assets/current.txt", "assets/current.txt");
    await new Promise(resolve => setTimeout(resolve, 50));
    check.equal(requests.length, count + 1);
    const pending = deferred();
    window.fetch = (url, options) => {
        requests.push({url, ...options});
        return pending.promise;
    };
    preview.show("assets/stale.txt", "assets/stale.txt");
    await settle();
    const staleSignal = requests.at(-1).signal;
    preview.show("assets/image.png", "assets/image.png");
    check.equal(staleSignal.aborted, true);
    pending.resolve(new Response("stale"));
    await settle();
    check.ok(container.querySelector("img"));
    check.doesNotMatch(container.textContent, /stale/);

    const pdfPending = deferred();
    pdfModule = pdfPending.promise;
    preview.show("assets/book.pdf", "box/assets/book.pdf");
    check.equal(loaded, 0);
    container.querySelector("button").click();
    check.equal(loaded, 1);
    check.equal(container.querySelector("button").disabled, true);
    preview.clear();
    pdfPending.resolve(viewer);
    await settle();
    check.equal(pdfCalls.length, 0);
    for (const isMobile of [false, true]) {
        mobile = isMobile;
        preview.show("assets/book.pdf", "box/assets/book.pdf");
        container.querySelector("button").click();
        await settle();
        check.equal(pdfCalls.at(-1)[4], true);
        check.equal(new URL(pdfCalls.at(-1)[0]).searchParams.get("dataPath"), "box/assets/book.pdf");
        check.equal(container.firstElementChild.classList.contains("pdf-viewer--mobile"), isMobile);
        preview.clear();
    }
    check.equal(destroyed, 2);
    const themed = document.createElement("div");
    themed.innerHTML = viewerTemplate.getPdfViewerHTML();
    for (const mode of [0, 1]) {
        window.siyuan.config.appearance.mode = mode;
        pdfTheme.bindPdfTheme(themed);
        check.equal(themed.firstElementChild.classList.contains("pdf__outer--dark"), mode === 1);
    }
    themed.querySelector("#pdfLight").click();
    check.equal(window.siyuan.storage.pdfTheme.dark, "light");
    check.equal(themed.firstElementChild.classList.contains("pdf__outer--dark"), false);

    const read = async response => {
        window.fetch = async (_url, options) => {
            check.equal(options.headers.Range, "bytes=0-65536");
            return response;
        };
        return previewAPI.readAssetPreviewText("http://localhost/assets/file.txt", new AbortController().signal);
    };
    check.deepEqual(await read(new Response("")), {text: "", truncated: false});
    check.deepEqual(await read(new Response(null, {status: 416, headers: {"Content-Range": "bytes */0"}})),
        {text: "", truncated: false});
    const large = await read(new Response("x".repeat(1024 * 1024)));
    check.equal(large.text.length, 65536);
    check.equal(large.truncated, true);
    check.equal((await read(new Response(new Uint8Array([255, 254, 65, 0])))).text, "A");
    check.equal((await read(new Response(new Uint8Array([254, 255, 0, 65])))).text, "A");
    await check.rejects(read(new Response(new Uint8Array([0, 1, 2, 3]))));
    await check.rejects(read(new Response(new Uint8Array([255, 0, 255]))));
    await check.rejects(read(new Response("missing", {status: 404})));
    preview.show("assets/missing.txt", "assets/missing.txt");
    await settle();
    check.equal(container.textContent, source.languages.assetPreviewFailed);
    let canceled = false;
    await read(new Response(new ReadableStream({
        pull(controller) { controller.enqueue(new Uint8Array(65537).fill(65)); },
        cancel() { canceled = true; },
    })));
    check.equal(canceled, true);

    let model;
    const mobileAPI = load(source.mobilePDF, {
        "../util/escape": escape,
        "../asset/pdf/viewerTemplate": viewerTemplate,
        "../util/pathName": {getDisplayName: value => value, getAssetPathWithoutQuery: value => value.split("?")[0]},
        "./menu/model": {openModel: options => { model = options; }},
        "../asset/pdfViewer": {loadPdfViewerModule: () => Promise.resolve(viewer), bindPdfTheme: pdfTheme.bindPdfTheme},
    });
    mobileAPI.openMobilePDF("assets/normal.pdf");
    const mobilePanel = document.createElement("div");
    mobilePanel.innerHTML = model.html;
    document.body.append(mobilePanel);
    model.bindEvent(mobilePanel);
    await settle();
    check.equal(pdfCalls.at(-1)[0], "http://localhost/assets/normal.pdf");
    check.equal(pdfCalls.at(-1)[4], undefined);
    model.destroyCallback();
    mobilePanel.remove();
    check.equal(destroyed, 3);

    window.fetch = async () => new Response("Settings preview\n".repeat(200));
    const style = document.createElement("style");
    const theme = document.createElement("style");
    document.head.append(style, theme);
    for (const isMobile of [false, true]) {
        mobile = isMobile;
        const assetsAPI = load(source.assets, {
            "../util/escape": escape,
            "./assetPreview": previewAPI,
            "../constants": {Constants},
            "../util/functions": {isMobile: () => mobile, isBrowser: () => true},
            "../util/hostCapabilities": {getHostCapabilities: () => ({localFileSystem: false})},
            "../protyle/util/hasClosest": {hasClosestByClassName: (element, name) => element.closest("." + name)},
            "./ocr": {mountOCRSettings: () => () => {}},
            "../protyle": {Protyle: class {
                constructor(_app, element) { this.protyle = {element}; }
                destroy() {}
            }},
            "../protyle/util/onGet": {disabledProtyle: () => {}},
            "../protyle/ui/initUI": {removeLoading: () => {}},
            "../util/fetch": {fetchPost: (url, _data, callback) => {
                if (url.endsWith("getUnusedAssets")) callback({data: [{item: "assets/note.txt", path: "assets/note.txt"}]});
            }},
        });
        const root = document.createElement("div");
        root.className = isMobile ? "config config--mobile" : "config";
        root.style.cssText = `width:${isMobile ? 360 : 800}px;height:600px;`;
        style.textContent = source.styles[isMobile ? 1 : 0];
        document.body.append(root);
        await assetsAPI.mountAssetsTab(root, undefined, {});
        const item = root.querySelector('[data-tab-type="unrefAssets"]');
        const panel = root.querySelector(".config-assets__preview");
        item.dispatchEvent(new MouseEvent(isMobile ? "click" : "mouseover", {bubbles: true}));
        await new Promise(resolve => setTimeout(resolve, 300));
        check.match(panel.textContent, /Settings preview/);
        for (const themeCSS of source.themes) {
            theme.textContent = themeCSS;
            panel.style.fontSize = "32px";
            const bounds = panel.getBoundingClientRect();
            const documentBounds = panel.querySelector(".config-assets__document").getBoundingClientRect();
            check.ok(bounds.height > 0 && bounds.bottom <= root.getBoundingClientRect().bottom + 1,
                `preview stays inside settings: ${JSON.stringify(bounds)}`);
            check.ok(documentBounds.top >= bounds.top && documentBounds.bottom <= bounds.bottom + 1);
            check.ok(documentBounds.width <= bounds.width);
        }
        const embedded = new previewAPI.AssetPreview(panel);
        embedded.show("assets/layout.pdf", "assets/layout.pdf");
        panel.querySelector("button").click();
        await settle();
        const pdfBounds = panel.querySelector("#mainContainer").getBoundingClientRect();
        const panelBounds = panel.getBoundingClientRect();
        check.ok(pdfBounds.width > 0 && pdfBounds.height > 0);
        check.ok(pdfBounds.left >= panelBounds.left && pdfBounds.right <= panelBounds.right + 1);
        check.ok(pdfBounds.top >= panelBounds.top && pdfBounds.bottom <= panelBounds.bottom + 1);
        embedded.clear();
        if (isMobile) {
            item.click();
            check.equal(panel.classList.contains("fn__none"), true);
            item.click();
            await settle();
        }
        root.classList.add("fn__none");
        await settle();
        check.equal(panel.textContent, "");
        check.equal(panel.hasAttribute("data-item"), false);
        assetsAPI.unmountAssetsTab(root);
        root.remove();
    }
    style.remove();
    theme.remove();

    let annotations = 0;
    let registrations = 0;
    let cleanup = 0;
    const application = class {
        run(config) { this.appConfig = config; return Promise.resolve(); }
        destroy() { return Promise.resolve(); }
    };
    const viewerAPI = load(source.viewer, {
        "./ui_utils.js": {RenderingStates: {}, ScrollMode: {}, SpreadMode: {}, TextLayerMode: {}},
        "./app_options.js": {AppOptions: {set() {}}},
        "./pdf_link_service.js": {LinkTarget: {}},
        "./app.js": {PDFViewerApplication: application},
        "../../constants": {Constants: {PROTYLE_CDN: "/stage/protyle"}},
        "../anno": {initAnno: () => annotations++, destroyAnno: () => cleanup++},
        "../annoRuntime": {registerPdfInstance: () => registrations++},
        "./pdfjs": {AnnotationEditorType: {DISABLE: 0}},
    });
    const viewerElement = document.createElement("div");
    viewerElement.innerHTML = '<button id="rectAnno"></button>';
    const readonly = viewerAPI.webViewerLoad("assets/book.pdf?dataPath=box%2Fassets%2Fbook.pdf", viewerElement,
        undefined, undefined, true);
    check.equal(annotations, 0);
    check.equal(registrations, 1);
    check.equal(viewerElement.querySelector("button").classList.contains("fn__none"), true);
    await readonly.destroy();
    await readonly.destroy();
    check.equal(cleanup, 1);
    await viewerAPI.webViewerLoad("assets/normal.pdf", viewerElement).destroy();
    check.equal(annotations, 1);
    preview.clear();
    return "Asset preview cases passed";
};

const run = async () => {
    const {app, BrowserWindow} = require("electron");
    app.setPath("userData", process.argv[2]);
    app.commandLine.appendSwitch("disable-gpu");
    await app.whenReady();
    const win = new BrowserWindow({show: false, webPreferences: {
        nodeIntegration: true, contextIsolation: false, offscreen: true,
    }});
    let code = 0;
    try {
        await win.loadURL('data:text/html,<html><head><base id="baseURL" href="http://localhost"></head><body></body></html>');
        for (const script of ["lute/lute.min.js", "protyle-html.js", "highlight.js/highlight.min.js"]) {
            await win.webContents.executeJavaScript(readFileSync(path.join(__dirname, "../stage/protyle/js", script), "utf8"));
        }
        const result = await win.webContents.executeJavaScript(`(${runCases.toString()})(${JSON.stringify(sources())})`);
        assert.equal(result, "Asset preview cases passed");
        console.log(result);
    } catch (error) {
        console.error(error);
        code = 1;
    } finally {
        win.destroy();
        app.exit(code);
    }
};

if (process.versions.electron && process.type === "browser") {
    run().catch(error => { console.error(error); require("electron").app.exit(1); });
} else {
    require("node:test").test("unreferenced asset previews on desktop and mobile", {
        skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
        timeout: 45000,
    }, async () => {
        const profile = mkdtempSync(path.join(os.tmpdir(), "siyuan-asset-preview-test-"));
        const env = {...process.env};
        delete env.ELECTRON_RUN_AS_NODE;
        try {
            const {stdout} = await require("node:util").promisify(require("node:child_process").execFile)(
                require("electron"), [__filename, profile], {env, windowsHide: true, timeout: 40000});
            assert.match(stdout, /Asset preview cases passed/);
        } finally {
            assert.ok(path.resolve(profile).startsWith(path.resolve(os.tmpdir()) + path.sep));
            rmSync(profile, {recursive: true, force: true});
        }
    });
}
