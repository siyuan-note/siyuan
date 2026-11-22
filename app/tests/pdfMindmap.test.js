const assert = require("node:assert/strict");
const {execFile} = require("node:child_process");
const {mkdtempSync, readFileSync, rmSync} = require("node:fs");
const {createRequire} = require("node:module");
const {tmpdir} = require("node:os");
const path = require("node:path");
const {promisify} = require("node:util");

const runElectron = async () => {
    const {app, BrowserWindow} = require("electron");
    app.setPath("userData", process.argv[2]);
    await app.whenReady();
    const win = new BrowserWindow({show: false, webPreferences: {backgroundThrottling: false}});
    try {
        const appPath = name => path.join(__dirname, "..", name);
        const read = name => readFileSync(appPath(name), "utf8");
        const source = read("src/protyle/export/index.ts");
        const section = (start, end) => {
            const offset = source.indexOf(start);
            const limit = source.indexOf(end, offset);
            assert.ok(offset >= 0 && limit > offset);
            return source.slice(offset, limit);
        };
        const prepare = section("    const getPageSizeDimensions =", "    const setPadding =") +
            section("        const buildExportConfig =", "        const reserveEmbeddedAssetSpace =")
                .replaceAll("${currentWindowId}", "0")
                .replaceAll("${toScriptLiteral(`${window.siyuan.languages.export} PDF`)}", '"Export PDF"') +
            section("            const isPaged =", "            exportConfig.filePath =");
        const requireBuild = createRequire(require.resolve("esbuild-loader"));
        const {parse} = require("ifdef-loader/preprocessor");
        const {outputFiles} = await requireBuild("esbuild").build({
            entryPoints: [appPath("src/protyle/render/mindmapRender.ts")],
            bundle: true, write: false, format: "iife", globalName: "Protyle",
            define: {NODE_ENV: '"production"', SIYUAN_VERSION: '"test"'},
            alias: {path: "path-browserify"}, loader: {".svg": "dataurl"},
            plugins: [{name: "export-platform", setup(build) {
                build.onLoad({filter: /\.ts$/}, ({path}) => ({
                    contents: parse(readFileSync(path, "utf8"), {BROWSER: true, MOBILE: true}, false), loader: "ts",
                }));
            }}],
        });
        const css = require("sass").compile(appPath("src/assets/scss/export.scss")).css +
            read("appearance/themes/daylight/theme.css") + section("        body {", "        ${await setInlineStyle(false, servePath)}");
        const moduleURL = name => "data:text/javascript;base64," + Buffer.from(read("stage/protyle/js/pdf/" + name)).toString("base64");
        for (const paged of [true, false]) {
            await win.loadURL("data:text/html,<!DOCTYPE html><html data-theme-mode='light'><body></body></html>");
            await win.webContents.insertCSS(css);
            await win.webContents.executeJavaScript(read("stage/protyle/js/lute/lute.min.js"));
            await win.webContents.executeJavaScript(outputFiles[0].text);
            const options = await win.webContents.executeJavaScript(`(async () => {
                window.siyuan = {config: {editor: {}, appearance: {mode: 0}}, languages: {}};
                // 打印可以先于下一次绘制帧，暂停排队的布局以验证实际打印位置。
                window.requestAnimationFrame = () => 1;
                document.body.dataset.exportPdf = "true";
                document.body.innerHTML = '<div id="action"></div><div id="previewContainer"><div id="preview"></div></div>';
                const actionElement = document.getElementById("action");
                for (const [id, value] of Object.entries({pageSize: "A4", scale: 1, marginsTop: 1,
                    marginsBottom: 1, marginsLeft: 0.54, marginsRight: 0.54, marginsType: "custom"})) {
                    actionElement.insertAdjacentHTML("beforeend", '<input id="' + id + '" value="' + value + '">');
                }
                actionElement.insertAdjacentHTML("beforeend", '<input id="landscape" type="checkbox"><input id="paged" type="checkbox">');
                document.getElementById("paged").checked = ${paged};
                const previewElement = document.getElementById("preview");
                Object.assign(previewElement.style, {width: "800px", padding: "1in .54in"});
                const lute = Lute.New();
                lute.SetKramdownIAL(true);
                const list = document.createElement("template");
                list.innerHTML = lute.Md2BlockDOM('- Root\\n' + Array.from({length: 26}, (_, index) => '  - Branch' + index).join('\\n'));
                const mindmap = list.content.querySelector('[data-type="NodeList"]');
                if (${paged}) {
                    mindmap.setAttribute("custom-sy-list-mindmap", "1");
                } else {
                    for (const block of [mindmap, ...mindmap.querySelectorAll('[data-type="NodeList"], [data-type="NodeListItem"]')]) {
                        block.dataset.type = block.dataset.type.replace("NodeList", "NodeMindmap");
                    }
                }
                const root = document.createElement("div");
                root.className = "protyle-wysiwyg";
                root.append(mindmap, "After mind map");
                previewElement.append(root);
                const Protyle = {...window.Protyle, highlightRender() {}, async mathRender() {}};
                Protyle.mindmapRender(root);
                const waitForImages = async () => {};
                const keepFoldElement = {}, addTitleElement = {}, titleImageElement = {}, customTitleElement = {},
                    mergeSubdocsElement = {}, mergeDocHeadingModeElement = {}, mergeContentHeadingModeElement = {},
                    watermarkElement = {}, removeAssetsElement = {};
                const getHeadingPageBreakLevels = () => [];
                const updateHeadingPageBreaks = () => {};
                ${prepare}
                actionElement.remove();
                return exportConfig.pdfOptions;
            })()`);
            const pdf = await win.webContents.printToPDF(options);
            const result = await win.webContents.executeJavaScript(`(async () => {
                const {getDocument} = await import(${JSON.stringify(moduleURL("pdf.min.mjs"))});
                globalThis.pdfjsWorker = await import(${JSON.stringify(moduleURL("pdf.worker.min.mjs"))});
                const data = Uint8Array.from(atob(${JSON.stringify(pdf.toString("base64"))}), c => c.charCodeAt(0));
                const document = await getDocument({data}).promise;
                const positions = [];
                let afterMap = false;
                for (let number = 1; number <= document.numPages; number++) {
                    const {items} = await (await document.getPage(number)).getTextContent();
                    for (const item of items) {
                        if (/^Branch\\d+$/.test(item.str)) positions.push([number, item.transform[5]]);
                        if (item.str === "After mind map") afterMap = true;
                    }
                }
                return {pages: document.numPages, positions, afterMap};
            })()`);
            assert.equal(result.positions.length, 26, "all mind map branches are present");
            assert.equal(new Set(result.positions.map(String)).size, 26, "branches occupy separate rows");
            assert.equal(result.afterMap, true, "content after the mind map remains visible");
            assert.equal(result.pages > 1, paged);
        }
        console.log("Mind map PDF cases passed");
        win.destroy();
        app.exit(0);
    } catch (error) {
        console.error(error);
        win.destroy();
        app.exit(1);
    }
};

if (process.versions.electron && process.type === "browser") {
    runElectron().catch(error => {
        console.error(error);
        require("electron").app.exit(1);
    });
} else {
    require("node:test").it("prints mind map branches before the next layout frame", {
        skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
        timeout: 60000,
    }, async () => {
        const env = {...process.env};
        delete env.ELECTRON_RUN_AS_NODE;
        const profile = mkdtempSync(path.join(tmpdir(), "siyuan-pdf-mindmap-"));
        try {
            const {stdout} = await promisify(execFile)(require("electron"), [__filename, profile], {
                env, windowsHide: true, timeout: 55000,
            });
            assert.match(stdout, /Mind map PDF cases passed/);
        } finally {
            rmSync(profile, {recursive: true, force: true, maxRetries: 5, retryDelay: 100});
        }
    });
}
