const assert = require("node:assert/strict");
const {readFileSync, mkdtempSync, rmSync} = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const ts = require("typescript");

const compile = source => ts.transpileModule(source, {
    compilerOptions: {target: ts.ScriptTarget.ES2021, module: ts.ModuleKind.CommonJS},
}).outputText;

const browserCases = async (headingSource, uiSource, desktopSource, mobileSource, mobileMenuSource, persistSource) => {
    const check = require("node:assert/strict");
    const heading = {};
    new Function("exports", headingSource)(heading);
    const {applyExportHeadingPageBreaks: apply, normalizeHeadingPageBreakLevels: normalize} = heading;
    check.deepEqual(normalize(undefined), []);
    check.deepEqual(normalize([6, 1, 1, "2", 0, 7, null]), [1, 6]);
    const root = document.createElement("div");
    root.className = "protyle-wysiwyg";
    root.style.cssText = "font:16px/24px Arial;padding:0;margin:0";
    document.body.append(root);
    const h = (level, id) => `<div data-type="NodeHeading" data-subtype="h${level}" data-node-id="${id}">${id}</div>`;
    const p = text => `<div data-type="NodeParagraph" data-node-id="p">${text}</div>`;
    const marked = () => Array.from(root.querySelectorAll("[data-export-heading-page-break]"))
        .map(element => element.getAttribute("data-node-id"));
    root.innerHTML = h(1, "first") + p("Body") + h(2, "second") + h(3, "third") + p("Body") +
        h(6, "sixth") + p("Body") + h(4, "fourth");
    apply(root, [1, 2, 3, 6]);
    check.deepEqual(marked(), ["second", "sixth"]);
    apply(root, [4]);
    check.deepEqual(marked(), ["fourth"], "Changing levels clears previous page breaks");
    apply(root, [1, 2, 3, 4, 5, 6], false);
    check.deepEqual(marked(), [], "Unpaged exports never force heading page breaks");
    apply(root, []);
    check.deepEqual(marked(), [], "No selected levels preserves continuous layout");

    root.innerHTML = h(2, "first") + p("\u200b<br>") + '<div class="protyle-attr">Bookmark</div>' +
        "<div hidden>" + p("Hidden") + "</div>" + h(2, "consecutive") + p("<img>") + h(3, "after-image") +
        '<div data-type="NodeSuperBlock"><div data-type="NodeBlockquote">' +
        h(1, "nested-consecutive") + p("Nested body") + h(6, "nested-after-body") + "</div></div>";
    apply(root, [1, 2, 3, 6]);
    check.deepEqual(marked(), ["after-image", "nested-after-body"]);
    root.innerHTML = '<h3>First</h3><p>Body</p><h5 data-node-id="native">Native</h5>';
    apply(root, [3, 5]);
    check.deepEqual(marked(), ["native"]);

    let saved;
    let confirmed = 0;
    let activeDialog;
    const Constants = {LOCAL_EXPORTPDF: "pdf", SIYUAN_VERSION: "test", SIYUAN_GET: "get"};
    window.siyuan = {storage: {pdf: {headingPageBreakLevels: [2]}}, languages: {
        print: "Print", confirm: "Confirm", cancel: "Cancel", pdfHeadingPageBreaks: "Heading page breaks",
        pdfHeadingPageBreaksTip: "Choose levels", exportTitleImage: "Export title image",
    }};
    const ui = {};
    new Function("exports", "require", uiSource)(ui, name => {
        if (name === "./headingPageBreaks") return heading;
        if (name.includes("constants")) return {Constants};
        if (name.includes("compatibility")) return {setStorageVal: (key, value) => saved = {
            key, levels: [...value.headingPageBreakLevels], titleImage: value.titleImage}};
        if (name.includes("dialog")) return {Dialog: class {
            constructor(options) {
                this.element = document.createElement("div");
                this.element.innerHTML = options.content;
                document.body.append(this.element);
                activeDialog = {element: this.element};
            }
            destroy() { this.element.remove(); }
        }};
        throw new Error(name);
    });
    ui.openHeadingPageBreakDialog(() => confirmed++);
    check.equal(activeDialog.element.querySelector("#titleImage").checked, true);
    for (const width of [280, 360]) {
        activeDialog.element.style.width = `${width}px`;
        for (const fontSize of [16, 24]) {
            activeDialog.element.style.fontSize = `${fontSize}px`;
            const titleImage = activeDialog.element.querySelector("#titleImage").getBoundingClientRect();
            const headingSwitch = activeDialog.element.querySelector('input[value="1"]').getBoundingClientRect();
            const imageLabel = activeDialog.element.querySelector("#titleImage").closest("label");
            const headingLabel = activeDialog.element.querySelector('input[value="1"]').closest("label");
            check.equal(imageLabel.getBoundingClientRect().left, headingLabel.getBoundingClientRect().left);
            check.equal(titleImage.right, headingSwitch.right, "Mobile print switches align at narrow widths and large fonts");
            check.equal(getComputedStyle(imageLabel).paddingLeft, "0px");
        }
    }
    check.ok(parseFloat(getComputedStyle(activeDialog.element.querySelector(".ft__smaller")).fontSize) <
        parseFloat(getComputedStyle(activeDialog.element.querySelector(".b3-dialog__content > div")).fontSize),
        "Mobile print descriptions use a smaller font than their titles");
    check.equal(activeDialog.element.querySelector('input[value="2"]').checked, true);
    activeDialog.element.querySelector('input[value="6"]').checked = true;
    activeDialog.element.querySelector("#titleImage").checked = false;
    activeDialog.element.querySelector(".b3-button--cancel").click();
    check.equal(saved, undefined);
    check.equal(confirmed, 0);
    ui.openHeadingPageBreakDialog(() => confirmed++);
    check.equal(activeDialog.element.querySelector("#titleImage").checked, true, "Cancel preserves the default");
    activeDialog.element.querySelector('input[value="6"]').checked = true;
    activeDialog.element.querySelector("#titleImage").checked = false;
    activeDialog.element.querySelector(".b3-button--text").click();
    check.deepEqual(saved, {key: "pdf", levels: [2, 6], titleImage: false});
    check.equal(confirmed, 1);
    ui.openHeadingPageBreakDialog(() => confirmed++);
    check.equal(activeDialog.element.querySelector("#titleImage").checked, false, "Mobile printing restores the saved choice");
    check.equal(activeDialog.element.querySelector('input[value="6"]').checked, true);
    activeDialog.element.querySelector(".b3-button--cancel").click();

    let html;
    const config = {appearance: {themeLight: "daylight"}, editor: {}, export: {addTitle: true}, system: {}};
    window.siyuan = {config, storage: {pdf: {paged: true, scale: 1, mergeSubdocs: false,
        mergeDocHeadingMode: "flat", mergeContentHeadingMode: "preserve", headingPageBreakLevels: [2, 6]}},
    languages: new Proxy({}, {get: (_object, key) => String(key)})};
    const renderPDF = new Function("Constants", "ipcRenderer", "getAvailableExportPath", "getHostCapabilities",
        "getIconScript", "getSnippetCSS", "getSnippetJS", "getExportLanguages", "setInlineStyle", "getCustomFontStyle",
        "getPluginStyle", "fetchPost", "headingPageBreakControls", desktopSource + ";return renderPDF;")(
        Constants, {invoke: async () => 0}, async () => "", () => ({}), () => "", () => "", () => "", () => "{}",
        async () => "", async () => "", async () => "", (_url, data) => html = data.content, ui.headingPageBreakControls);
    window.siyuan.storage.pdf.paged = false;
    await renderPDF("root");
    check.ok(new DOMParser().parseFromString(html, "text/html").getElementById("headingPageBreakOptions")
        .classList.contains("fn__none"), "Unpaged preferences hide heading options before initialization");
    window.siyuan.storage.pdf.paged = true;
    await renderPDF("root");
    check.equal(new DOMParser().parseFromString(html, "text/html").getElementById("titleImage").checked, true);
    check.ok(html.includes('id="headingPageBreaks"'));
    const inline = html.match(/<script>\s*const previewElement[\s\S]*?<\/script>/)[0]
        .replace(/^<script>|<\/script>$/g, "");
    document.body.innerHTML = html.slice(html.indexOf("<body")).replace(/<script[\s\S]*?<\/script>/g, "");
    window.Protyle = new Proxy({applyExportHeadingPageBreaks: apply, renderExportJSEmbeds: async () => {}}, {
        get: (target, key) => target[key] || (() => {}),
    });
    const previewRequests = [];
    window.fetch = async (_url, options) => {
        const request = JSON.parse(options.body);
        previewRequests.push(request);
        return {ok: true, json: async () => ({code: 0, data: {name: "Test", attrs: {},
            content: (request.excludeTitleImage ? "" : "<div data-cover>Title image</div>") +
                (request.addTitle ? h(1, "root-title") : "") + p("Body") +
                h(2, "child-title") + p("Child body") + h(6, "deep-title")}})};
    };
    await new Function(inline + "; return new Promise(resolve => setTimeout(resolve, 30));")();
    const preview = document.getElementById("preview");
    const waitForPreview = () => new Promise(resolve => setTimeout(resolve, 30));
    check.equal(previewRequests.at(-1).pdf, true);
    check.equal(previewRequests.at(-1).excludeTitleImage, false);
    check.ok(preview.querySelector("[data-cover]"));
    const titleImage = document.getElementById("titleImage");
    titleImage.click();
    await waitForPreview();
    check.equal(preview.querySelector("[data-cover]"), null);
    check.ok(preview.querySelector('[data-node-id="root-title"]'));
    check.equal(previewRequests.at(-1).excludeTitleImage, true);
    check.equal(previewRequests.at(-1).pdf, true);
    document.getElementById("addTitle").click();
    await waitForPreview();
    check.equal(titleImage.checked, false);
    check.equal(preview.querySelector('[data-node-id="root-title"]'), null);
    check.ok(preview.textContent.includes("Body"));
    document.getElementById("addTitle").click();
    await waitForPreview();
    check.deepEqual(Array.from(preview.querySelectorAll("[data-export-heading-page-break]"))
        .map(element => element.getAttribute("data-node-id")), ["child-title", "deep-title"]);
    const paged = document.getElementById("paged");
    const options = document.getElementById("headingPageBreakOptions");
    check.notEqual(getComputedStyle(options).display, "none");
    check.ok(parseFloat(getComputedStyle(options.querySelector(".ft__smaller")).fontSize) <
        parseFloat(getComputedStyle(options.firstElementChild).fontSize),
        "Desktop export descriptions use a smaller font than their titles");
    paged.checked = false;
    paged.dispatchEvent(new Event("change"));
    check.equal(getComputedStyle(options).display, "none");
    check.equal(preview.querySelectorAll("[data-export-heading-page-break]").length, 0);
    check.ok(Array.from(document.querySelectorAll("#headingPageBreaks input")).every(input => input.disabled));
    paged.checked = true;
    paged.dispatchEvent(new Event("change"));
    check.notEqual(getComputedStyle(options).display, "none");
    check.deepEqual(Array.from(options.querySelectorAll("input:checked")).map(input => Number(input.value)), [2, 6],
        "Showing the heading options preserves selected levels");
    check.equal(preview.querySelectorAll("[data-export-heading-page-break]").length, 2);
    document.querySelector('#headingPageBreaks input[value="2"]').click();
    check.equal(preview.querySelectorAll("[data-export-heading-page-break]").length, 1);
    document.getElementById("mergeSubdocs").checked = true;
    document.getElementById("mergeDocHeadingMode").value = "tree";
    document.getElementById("mergeSubdocs").dispatchEvent(new Event("change"));
    await new Promise(resolve => setTimeout(resolve, 30));
    check.equal(preview.querySelectorAll("[data-export-heading-page-break]").length, 1,
        "Refreshing merged previews reapplies the selected levels");
    const exportStyle = html.match(/<style>([\s\S]*?)<\/style>/)[1];

    const persist = new Function("Constants", "setStorageVal", "ipcData", persistSource);
    const ipcData = {titleImage: false, pdfOptions: {margins: {}}, headingPageBreakLevels: [2, 6]};
    window.siyuan = {config, storage: {pdf: {}}, languages: {}};
    persist(Constants, (key, value) => saved = {key, value}, ipcData);
    check.equal(saved.value.titleImage, false);
    await renderPDF("root");
    check.equal(new DOMParser().parseFromString(html, "text/html").getElementById("titleImage").checked, false,
        "Desktop PDF exports restore the preference saved by the parent window");
    persist(Constants, () => {}, {...ipcData, titleImage: undefined});
    check.equal(window.siyuan.storage.pdf.titleImage, true, "Older export messages preserve the default");

    window.siyuan = {config, storage: {pdf: {headingPageBreakLevels: [2, 6]}}, languages: {}};
    const onExport = new Function("Constants", "isInMobileApp", "getScreenWidth", "getThemeMode", "setInlineStyle",
        "getPluginStyle", "getSnippetCSS", "getSnippetJS", "getIconScript", "getExportLanguages", "normalizeHeadingPageBreakLevels",
        mobileSource + ";return onExport;")(Constants, () => true, () => 390, () => "light", async () => "",
        async () => "", () => "", () => "", () => "", () => "{}", normalize);
    const data = {data: {name: "Mobile", content: h(1, "first") + p("Body") + h(2, "second") + p("Body") + h(6, "sixth")}};
    const mobileHTML = await onExport(data, undefined, "/", {type: "pdf", id: "root"});
    const ordinaryHTML = await onExport(data, undefined, "/", {type: "html", id: "root"});
    check.ok(!ordinaryHTML.includes("Protyle.applyExportHeadingPageBreaks"), "HTML export ignores PDF preferences");
    document.body.innerHTML = mobileHTML.slice(mobileHTML.indexOf("<body")).replace(/<script[\s\S]*?<\/script>/g, "");
    const mobileInline = mobileHTML.match(/<script>\s*[\s\S]*?<\/script>/)[0].replace(/^<script>|<\/script>$/g, "");
    new Function(mobileInline)();
    check.deepEqual(Array.from(document.querySelectorAll("[data-export-heading-page-break]"))
        .map(element => element.getAttribute("data-node-id")), ["second", "sixth"]);

    let mobileRequest;
    let printed;
    window.siyuan = {config, storage: {pdf: {headingPageBreakLevels: [2, 6]}}, languages: {}};
    window.JSAndroid = {print: (name, content) => printed = {name, content}};
    window.siyuan.storage.pdf.titleImage = false;
    const mobilePrint = new Function("openHeadingPageBreakDialog", "showMessage", "Constants", "id", "fetchPost",
        "onExport", "isInAndroid", "isInHarmony", "isInIOS", "hideMessage", mobileMenuSource + ";return printPDF;")(
        callback => callback(), () => "message", Constants, "root",
        (_url, request, callback) => {
            mobileRequest = request;
            return callback({data: {name: "Mobile", content: (request.excludeTitleImage ? "" : "<div data-cover>Cover</div>") + p("Body")}});
        }, onExport, () => true, () => false, () => false, () => {});
    mobilePrint();
    await waitForPreview();
    check.equal(mobileRequest.pdf, true);
    check.equal(mobileRequest.excludeTitleImage, true);
    check.ok(printed.content.includes("Body"));
    check.ok(!printed.content.includes("data-cover"));
    window.siyuan.storage.pdf.titleImage = true;
    mobilePrint();
    await waitForPreview();
    check.equal(mobileRequest.excludeTitleImage, false);
    check.ok(printed.content.includes("data-cover"));
    return {message: "Heading page break UI and DOM cases passed", exportStyle};
};

const runElectron = async () => {
    const {app, BrowserWindow} = require("electron");
    app.setPath("userData", process.argv[2]);
    app.commandLine.appendSwitch("disable-gpu");
    await app.whenReady();
    const win = new BrowserWindow({show: false, webPreferences: {nodeIntegration: true, contextIsolation: false}});
    try {
        const headingSource = compile(readFileSync(path.join(__dirname, "../src/protyle/export/headingPageBreaks.ts"), "utf8"));
        const uiSource = compile(readFileSync(path.join(__dirname, "../src/protyle/export/headingPageBreaksUI.ts"), "utf8"));
        const source = readFileSync(path.join(__dirname, "../src/protyle/export/index.ts"), "utf8");
        const desktopSource = compile(source.slice(source.indexOf("const renderPDF ="), source.indexOf("const getExportPath =")));
        const mobileSource = compile(source.slice(source.indexOf("export const onExport =")).replace("export const", "const"));
        const menu = ts.createSourceFile("menu.ts", readFileSync(path.join(__dirname, "../src/menus/commonMenuItem.ts"), "utf8"),
            ts.ScriptTarget.Latest, true);
        let mobileMenuSource;
        const visit = node => {
            if (ts.isPropertyAssignment(node) && node.name.getText(menu) === "click" &&
                node.initializer.getText(menu).includes("openHeadingPageBreakDialog")) {
                mobileMenuSource = compile("const printPDF = " + node.initializer.getText(menu) + ";");
            }
            ts.forEachChild(node, visit);
        };
        visit(menu);
        assert.ok(mobileMenuSource);
        const bootSource = readFileSync(path.join(__dirname, "../src/boot/onGetConfig.ts"), "utf8");
        const persistStart = bootSource.indexOf("        window.siyuan.storage[Constants.LOCAL_EXPORTPDF] =");
        const persistSource = compile(bootSource.slice(persistStart, bootSource.indexOf("        try {", persistStart)));
        await win.loadURL("data:text/html,<!DOCTYPE html><html><body></body></html>");
        const css = require("sass").compile(path.join(__dirname, "../src/assets/scss/export.scss")).css;
        await win.webContents.insertCSS(css);
        const result = await win.webContents.executeJavaScript(`(${browserCases.toString()})(
            ${JSON.stringify(headingSource)}, ${JSON.stringify(uiSource)}, ${JSON.stringify(desktopSource)}, ${JSON.stringify(mobileSource)},
            ${JSON.stringify(mobileMenuSource)}, ${JSON.stringify(persistSource)})`);
        console.log(result.message);

        const h = level => `<div data-node-id="h${level}" data-type="NodeHeading" data-subtype="h${level}">Heading ${level}</div>`;
        const p = '<div data-node-id="p" data-type="NodeParagraph">Body</div>';
        const cases = [
            {html: h(1) + p + h(2) + p + h(6) + p, levels: [], pages: 1},
            {html: h(1) + p + h(2) + p + h(6) + p, levels: [2, 6], pages: 3},
            {html: h(1) + h(3) + h(6) + p, levels: [1, 3, 6], pages: 1},
            {html: h(6) + p + h(6) + p, levels: [6], pages: 2},
            {html: p + h(1) + '<div data-type="NodeParagraph"><br></div>' + h(3) + p, levels: [1, 3], pages: 2},
            {html: p + h(2) + p + h(6) + p, levels: [2, 6], enabled: false, pages: 1},
            {html: h(1) + p + h(1) + p, levels: [1], pages: 2},
        ];
        for (const item of cases) {
            await win.loadURL("data:text/html,<!DOCTYPE html><html><body style='margin:0'></body></html>");
            await win.webContents.insertCSS(css);
            await win.webContents.insertCSS(result.exportStyle);
            await win.webContents.executeJavaScript(`(() => {
                const exports = {};
                new Function("exports", ${JSON.stringify(headingSource)})(exports);
                document.body.className = "exporting";
                document.body.innerHTML = '<div id="previewContainer"><div id="preview" style="padding:6px 0 0 0">' +
                    '<div class="protyle-wysiwyg" style="font:16px/24px Arial"></div></div></div>';
                const root = document.querySelector(".protyle-wysiwyg");
                root.innerHTML = ${JSON.stringify(item.html)};
                exports.applyExportHeadingPageBreaks(root, ${JSON.stringify(item.levels)}, ${item.enabled !== false});
            })()`);
            const pdf = await win.webContents.printToPDF({pageSize: "A4", margins: {top: 0.5, bottom: 0.5, left: 0.5, right: 0.5}});
            assert.equal((pdf.toString("latin1").match(/\/Type\s*\/Page\b/g) || []).length, item.pages, JSON.stringify(item));
        }
        console.log("Heading PDF page counts passed");
        app.exit(0);
    } catch (error) {
        console.error(error);
        app.exit(1);
    } finally {
        if (!win.isDestroyed()) win.destroy();
    }
};

if (process.versions.electron && process.type === "browser") {
    runElectron().catch(error => { console.error(error); require("electron").app.exit(1); });
} else {
    require("node:test").it("heading page breaks support multiple levels, continuous headings and desktop/mobile controls", {
        skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
        timeout: 60000,
    }, async () => {
        const env = {...process.env};
        delete env.ELECTRON_RUN_AS_NODE;
        const profile = mkdtempSync(path.join(os.tmpdir(), "siyuan-pdf-heading-"));
        try {
            const {stdout} = await require("node:util").promisify(require("node:child_process").execFile)(
                require("electron"), [__filename, profile], {env, windowsHide: true, timeout: 55000});
            assert.match(stdout, /Heading page break UI and DOM cases passed/);
            assert.match(stdout, /Heading PDF page counts passed/);
        } finally {
            assert.equal(path.dirname(path.resolve(profile)), path.resolve(os.tmpdir()));
            assert.ok(path.basename(profile).startsWith("siyuan-pdf-heading-"));
            rmSync(profile, {recursive: true, force: true, maxRetries: 5, retryDelay: 100});
        }
    });
}
