const assert = require("node:assert/strict");
const {readFileSync, mkdtempSync, rmSync} = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const runElectron = async () => {
    const {app, BrowserWindow} = require("electron");
    app.setPath("userData", process.argv[2]);
    await app.whenReady();
    const win = new BrowserWindow({show: false});
    let exitCode = 0;
    try {
        const source = readFileSync(path.join(__dirname, "../src/protyle/export/index.ts"), "utf8");
        const section = (start, end) => {
            const offset = source.indexOf(start);
            assert.ok(offset >= 0);
            const limit = source.indexOf(end, offset);
            assert.ok(limit > offset);
            return source.slice(offset, limit);
        };
        const prepare = section("    const fixBlockWidth =", "    const setPadding =") +
            section("        const buildExportConfig =", "        const reserveEmbeddedAssetSpace =")
                .replaceAll("${currentWindowId}", "0") +
            section("            const isPaged =", "            exportConfig.filePaths =");
        const css = require("sass").compile(path.join(__dirname, "../src/assets/scss/export.scss")).css;
        for (const landscape of [false, true]) {
            for (const scale of [0.5, 1, 1.5]) {
                for (const {margin, paged} of [{margin: 0, paged: false}, {margin: 1, paged: false},
                    {margin: 1, paged: true}]) {
                    await win.loadURL("data:text/html,<html><body></body></html>");
                    await win.webContents.insertCSS(css);
                    const options = await win.webContents.executeJavaScript(`(async () => {
                        document.body.innerHTML = '<div id="action"></div><div id="preview"></div>';
                        document.body.style.margin = "0";
                        const actionElement = document.getElementById("action");
                        const values = {pageSize: "A4", scale: ${scale}, marginsTop: ${margin},
                            marginsBottom: ${margin}, marginsLeft: 0.54, marginsRight: 0.54,
                            marginsType: "custom"};
                        for (const [id, value] of Object.entries(values)) {
                            actionElement.insertAdjacentHTML("beforeend", '<input id="' + id + '" value="' + value + '">');
                        }
                        actionElement.insertAdjacentHTML("beforeend", '<input id="landscape" type="checkbox"><input id="paged" type="checkbox">');
                        document.getElementById("landscape").checked = ${landscape};
                        document.getElementById("paged").checked = ${paged};
                        const previewElement = document.getElementById("preview");
                        previewElement.style.cssText = "box-sizing:border-box;margin:24px auto;padding:1in .54in;zoom:${scale}";
                        previewElement.innerHTML = '<div class="protyle-wysiwyg" style="padding-top:8px;font:16px/24px Arial">' +
                            '<div class="list" data-node-id="list">' + Array.from({length: 60}, (_, i) =>
                                '<div class="li" data-node-id="item-' + i + '"><div style="padding-left:34px">Task ' + i + '</div>' +
                                '<div class="list" data-node-id="nested-' + i + '"><div class="li" data-node-id="child-' + i + '">' +
                                '<div style="padding-left:68px">' + '1234567890 '.repeat(12) + '</div></div></div></div>').join("") + '</div></div>';
                        const Protyle = {highlightRender() {}, async mathRender() {}};
                        const waitForImages = async () => {};
                        const keepFoldElement = {}, addTitleElement = {}, customTitleElement = {},
                            mergeSubdocsElement = {}, mergeDocHeadingModeElement = {},
                            mergeContentHeadingModeElement = {}, watermarkElement = {}, removeAssetsElement = {};
                        const response = {data: {name: "test"}};
                        ${prepare}
                        actionElement.remove();
                        return exportConfig.pdfOptions;
                    })()`);
                    const pdf = await win.webContents.printToPDF({...options, displayHeaderFooter: true,
                        headerTemplate: "<span></span>",
                        footerTemplate: '<div style="font-size:10px"><span class="pageNumber"></span> / <span class="totalPages"></span></div>'});
                    const pages = pdf.toString("latin1").match(/\/Type\s*\/Page\b/g) || [];
                    if (paged) {
                        assert.ok(pages.length > 1, JSON.stringify({landscape, scale, margin, paged}));
                    } else {
                        assert.equal(pages.length, 1, JSON.stringify({landscape, scale, margin, paged}));
                    }
                }
            }
        }
        console.log("Unpaged PDF cases passed");
    } catch (error) {
        console.error(error);
        exitCode = 1;
    } finally {
        win.destroy();
        app.exit(exitCode);
    }
};

if (process.versions.electron && process.type === "browser") {
    runElectron().catch(error => {
        console.error(error);
        require("electron").app.exit(1);
    });
} else {
    require("node:test").it("exports long lists to one PDF page across margins, scales and orientations", {
        skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
        timeout: 60000,
    }, async () => {
        const env = {...process.env};
        delete env.ELECTRON_RUN_AS_NODE;
        const profile = mkdtempSync(path.join(os.tmpdir(), "siyuan-pdf-unpaged-"));
        try {
            const {stdout} = await require("node:util").promisify(require("node:child_process").execFile)(
                require("electron"), [__filename, profile], {env, windowsHide: true, timeout: 55000});
            assert.match(stdout, /Unpaged PDF cases passed/);
        } finally {
            assert.equal(path.dirname(path.resolve(profile)), path.resolve(os.tmpdir()));
            assert.ok(path.basename(profile).startsWith("siyuan-pdf-unpaged-"));
            rmSync(profile, {recursive: true, force: true, maxRetries: 5, retryDelay: 100});
        }
    });
}
