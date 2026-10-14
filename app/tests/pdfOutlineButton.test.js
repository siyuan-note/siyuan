const assert = require("node:assert/strict");
const {readFileSync, mkdtempSync, rmSync} = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const cases = async (moduleURL, runtimeURL, configSource, mobile) => {
    const check = require("node:assert/strict");
    window.pdfjsLib = await import(runtimeURL);
    window.siyuan = {languages: new Proxy({}, {get: (_, key) => key}), storage: {}};
    const {PDFSidebar, PDFOutlineViewer, EventBus, SidebarView, getPdfViewerHTML} = await import(moduleURL);
    const root = document.createElement("div");
    root.className = mobile ? "pdf-viewer--mobile" : "";
    root.style.cssText = "height:600px;width:100%;--sidebar-width:200px";
    root.innerHTML = getPdfViewerHTML();
    document.body.append(root);
    const config = new Function(configSource + "\nreturn getViewerConfiguration;")()(root);
    const eventBus = new EventBus();
    const l10n = {pause() {}, resume() {}};
    const sidebar = new PDFSidebar({elements: config.sidebar, eventBus, l10n});
    sidebar.onToggled = sidebar.onUpdateThumbnails = () => {};
    const outlineViewer = new PDFOutlineViewer({container: config.sidebar.outlineView, eventBus, l10n,
        linkService: {getDestinationHash: dest => "#page=" + (dest[0] + 1)}});
    const options = root.querySelector("#outlineOptionsContainer");
    const button = root.querySelector("#currentOutlineItem");
    const visible = () => button.checkVisibility({visibilityProperty: true});
    check.equal(visible(), false);
    sidebar.setInitialView(SidebarView.OUTLINE);
    check.equal(visible(), true, "outline navigation button must be visible in the outline view");
    check.equal(button.disabled, true, "page loading still gates navigation");
    outlineViewer.render({pdfDocument: {loadingParams: {disableAutoFetch: false}},
        outline: Array.from({length: 60}, (_, index) => ({title: `Chapter ${index + 1}`, dest: [index], items: []}))});
    check.equal(button.disabled, true);
    eventBus.dispatch("pagesloaded", {pagesCount: 60});
    await Promise.resolve();
    check.equal(button.disabled, false);
    button.focus();
    check.equal(document.activeElement, button, "the enabled visible button accepts keyboard focus");
    const toolbar = root.querySelector("#toolbarSidebar").getBoundingClientRect();
    const rect = button.getBoundingClientRect();
    check.ok(rect.left >= toolbar.left && rect.right <= toolbar.right, "button fits the sidebar toolbar");
    eventBus.dispatch("pagechanging", {pageNumber: 50});
    button.click();
    await new Promise(resolve => setTimeout(resolve, 0));
    const selected = root.querySelector("#outlineView .treeItem.selected");
    check.equal(selected?.textContent, "Chapter 50");
    const content = root.querySelector("#outlineView");
    check.ok(content.scrollTop > 0, "current outline item scrolls into view");
    const selectedRect = selected.getBoundingClientRect();
    const contentRect = content.getBoundingClientRect();
    check.ok(selectedRect.top >= contentRect.top && selectedRect.bottom <= contentRect.bottom);
    for (const view of [SidebarView.THUMBS, SidebarView.ATTACHMENTS, SidebarView.LAYERS]) {
        sidebar.switchView(view);
        check.equal(visible(), false, `hidden in sidebar view ${view}`);
        check.equal(options.offsetWidth, 0, "hidden options must not reserve toolbar space");
        button.blur();
        button.focus();
        check.notEqual(document.activeElement, button);
        sidebar.switchView(SidebarView.OUTLINE);
        check.equal(visible(), true);
    }
    sidebar.close();
    check.equal(visible(), false, "closing the sidebar immediately hides its outline options");
    sidebar.open();
    check.equal(visible(), true, "reopening restores outline options");
    sidebar.reset();
    check.equal(visible(), false);
    check.equal(button.disabled, true);
    sidebar.setInitialView(SidebarView.OUTLINE);
    outlineViewer.reset();
    outlineViewer.render({outline: null, pdfDocument: {loadingParams: {disableAutoFetch: false}}});
    await Promise.resolve();
    check.equal(sidebar.active, SidebarView.THUMBS, "a document without an outline falls back to thumbnails");
    check.equal(visible(), false);
    check.equal(button.disabled, true);
    return "PDF outline button cases passed";
};

if (process.versions.electron && process.type === "browser") {
    (async () => {
        const {app, BrowserWindow} = require("electron");
        app.setPath("userData", process.argv[2]);
        await app.whenReady();
        const win = new BrowserWindow({show: false, webPreferences: {nodeIntegration: true, contextIsolation: false}});
        const moduleURL = source => "data:text/javascript;base64," + Buffer.from(source).toString("base64");
        const bundleURL = moduleURL(await require("./pdfViewerBundle.cjs")());
        const runtimeURL = moduleURL(readFileSync(path.join(__dirname, "../stage/protyle/js/pdf/pdf.min.mjs"), "utf8"));
        const ts = require("typescript");
        const source = ts.createSourceFile("viewer.js", readFileSync(path.join(__dirname, "../src/asset/pdf/viewer.js"), "utf8"),
            ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
        const configSource = source.statements.find(node => ts.isFunctionDeclaration(node) &&
            node.name.text === "getViewerConfiguration").getText(source);
        const mobileSource = readFileSync(path.join(__dirname, "../src/assets/scss/mobile.scss"), "utf8");
        const css = require("sass").compileString('@use "util/function"; @use "pdf/pdf";\n' +
            mobileSource.slice(mobileSource.indexOf(".pdf-viewer--mobile {")), {
            loadPaths: [path.join(__dirname, "../src/assets/scss")],
        }).css;
        for (const mobile of [false, true]) {
            win.setContentSize(mobile ? 360 : 1000, 800);
            await win.loadURL("data:text/html,<html><body style='margin:0'></body></html>");
            await win.webContents.insertCSS(css);
            const result = await win.webContents.executeJavaScript(`(async () => {
                try { return {message: await (${cases.toString()})(${[bundleURL, runtimeURL, configSource, mobile].map(JSON.stringify).join(",")})}; }
                catch (error) { return {error: error.stack}; }
            })()`);
            assert.ok(!result.error, result.error);
            console.log(result.message);
        }
        win.destroy();
        app.exit(0);
    })().catch(error => { console.error(error); require("electron").app.exit(1); });
} else {
    require("node:test").test("PDF outline navigation is visible, focusable and functional on desktop and mobile", {
        skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
        timeout: 30000,
    }, async () => {
        const profile = mkdtempSync(path.join(os.tmpdir(), "siyuan-pdf-outline-"));
        const env = {...process.env};
        delete env.ELECTRON_RUN_AS_NODE;
        try {
            const {stdout} = await require("node:util").promisify(require("node:child_process").execFile)(
                require("electron"), [__filename, profile], {env, windowsHide: true, timeout: 25000});
            assert.match(stdout, /PDF outline button cases passed/);
        } finally {
            assert.equal(path.dirname(path.resolve(profile)), path.resolve(os.tmpdir()));
            assert.ok(path.basename(profile).startsWith("siyuan-pdf-outline-"));
            rmSync(profile, {recursive: true, force: true, maxRetries: 5, retryDelay: 100});
        }
    });
}
