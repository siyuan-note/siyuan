const assert = require("node:assert/strict");
const {readFileSync, mkdtempSync, rmSync, writeFileSync} = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const runElectron = async () => {
    const {app, BrowserWindow} = require("electron");
    app.setPath("userData", process.argv[2]);
    await app.whenReady();
    const win = new BrowserWindow({show: false, webPreferences: {backgroundThrottling: false}});
    let exitCode = 0;
    try {
        const source = readFileSync(path.join(__dirname, "../src/protyle/export/index.ts"), "utf8");
        const section = (start, end) => {
            const offset = source.indexOf(start);
            const limit = source.indexOf(end, offset);
            assert.ok(offset >= 0 && limit > offset);
            return source.slice(offset, limit);
        };
        const prepare = section("    const fixBlockWidth =", "    const setPadding =") +
            section("        const buildExportConfig =", "        const reserveEmbeddedAssetSpace =")
                .replaceAll("${currentWindowId}", "0") +
            section("            const isPaged =", "            exportConfig.filePaths =");
        const css = require("sass").compile(path.join(__dirname, "../src/assets/scss/export.scss")).css;
        const desktopCSS = section("        body {", "        ${await setInlineStyle(false, servePath)}");
        const mobileStart = source.indexOf("css: `@page") + "css: `".length;
        const mobileCSS = source.slice(mobileStart, source.indexOf("`", mobileStart));
        const moduleURL = name => "data:text/javascript;base64," + Buffer.from(readFileSync(
            path.join(__dirname, "../stage/protyle/js/pdf/", name))).toString("base64");
        const runtime = moduleURL("pdf.min.mjs");
        const worker = moduleURL("pdf.worker.min.mjs");
        const luteSource = readFileSync(path.join(__dirname, "../stage/protyle/js/lute/lute.min.js"), "utf8");
        const cases = [
            {name: "paragraph-default", scale: 1, margin: 1, realDOM: true},
            {name: "paragraph-full-width", scale: 1, margin: 1, realDOM: true, width: "100%"},
            {name: "paragraph-caption", scale: 1, margin: 1, realDOM: true, width: "100%", caption: true},
            {name: "full-size", scale: 1, margin: 1},
            {name: "landscape", scale: 1, margin: 0.42, landscape: true},
            {name: "scaled-up", scale: 1.5, margin: 0.5},
            {name: "scaled-down", scale: 0.5, margin: 0},
            {name: "small-image", scale: 1, margin: 1, small: true},
            {name: "resized-image", scale: 1, margin: 1, width: "150px", expectedHeight: 300},
            {name: "enlarged-image", scale: 1, margin: 1, small: true, naturalWidth: 120},
            {name: "caption", scale: 1, margin: 1, caption: true},
            {name: "unpaged", scale: 1, margin: 1, unpaged: true},
            {name: "mobile", scale: 1, margin: 10 / 25.4, mobile: true},
        ];
        for (const item of cases) {
            await win.loadURL("data:text/html,<!DOCTYPE html><html><body></body></html>");
            await win.webContents.insertCSS(css + (item.mobile ? mobileCSS : desktopCSS));
            await win.webContents.executeJavaScript(luteSource);
            const options = await win.webContents.executeJavaScript(`(async () => {
                const item = ${JSON.stringify(item)};
                document.body.innerHTML = '<div id="action"></div><div id="previewContainer"><div id="preview"></div></div>';
                const actionElement = document.getElementById("action");
                for (const [id, value] of Object.entries({pageSize: "A4", scale: item.scale,
                    marginsTop: item.margin, marginsBottom: item.margin,
                    marginsLeft: 0.54, marginsRight: 0.54, marginsType: "custom"})) {
                    actionElement.insertAdjacentHTML("beforeend", '<input id="' + id + '" value="' + value + '">');
                }
                actionElement.insertAdjacentHTML("beforeend", '<input id="landscape" type="checkbox"><input id="paged" type="checkbox">');
                document.getElementById("landscape").checked = !!item.landscape;
                document.getElementById("paged").checked = !item.unpaged;
                const previewElement = document.getElementById("preview");
                previewElement.style.cssText = "box-sizing:border-box;margin:24px auto;padding:1in .54in;zoom:" + item.scale;
                const canvas = document.createElement("canvas");
                canvas.width = item.naturalWidth || 600;
                canvas.height = item.small ? canvas.width / 3 : 1600;
                const ctx = canvas.getContext("2d");
                ctx.fillStyle = "#ff8000";
                ctx.fillRect(0, 0, canvas.width, canvas.height);
                ctx.fillStyle = "#0000ff";
                ctx.fillRect(0, 0, canvas.width, canvas.height / 10);
                ctx.fillStyle = "#00ff00";
                ctx.fillRect(0, canvas.height * 0.9, canvas.width, canvas.height / 10);
                const image = '<span class="img" data-type="img" style="display: inline-block;' +
                    (item.naturalWidth ? 'width:600px' : '') + '">' +
                    '<span> </span><span style="width:' + (item.width || "100%") + '"><img src="' + canvas.toDataURL() + '">' +
                    (item.caption ? '<span class="img__alt"><span>' + 'Image caption '.repeat(30) + '</span></span>' : "") +
                    '</span><span> </span></span>';
                previewElement.innerHTML = '<div class="protyle-wysiwyg" style="padding:8px 0 0;font:16px/26px Arial">' +
                    '<div data-node-id="before" data-type="NodeParagraph" style="height:140px">Before image</div>' +
                    '<div data-node-id="picture" data-type="NodeParagraph">' + image + '<hr style="margin:0;border:0"></div>' +
                    '<div data-node-id="after" data-type="NodeHeading">After image</div></div>';
                if (item.realDOM) {
                    const lute = Lute.New();
                    lute.SetKramdownIAL(true);
                    const markdown = 'Before image\\n\\n![description](assets/sample.png "' +
                        (item.caption ? 'Image caption '.repeat(30) : '') + '")' +
                        (item.width ? '{: style="width: ' + item.width + ';"}' : '') + '\\n\\n## After image';
                    previewElement.firstElementChild.innerHTML = lute.Md2BlockDOM(markdown);
                    previewElement.querySelector("[data-type=NodeParagraph]").style.height = "140px";
                    previewElement.querySelectorAll("[data-node-id]").forEach(block => {
                        if (block.querySelector(".img")) {
                            block.insertAdjacentHTML("beforeend", '<hr style="margin:0;border:0">');
                        }
                    });
                    const img = previewElement.querySelector("img");
                    img.loading = "eager";
                    img.src = canvas.toDataURL();
                }
                await previewElement.querySelector("img").decode();
                if (item.mobile) {
                    previewElement.style.cssText = "max-width:800px;margin:0 auto";
                    actionElement.remove();
                    return {pageSize: "A4", preferCSSPageSize: true, printBackground: true};
                }
                const Protyle = {highlightRender() {}, async mathRender() {}};
                const waitForImages = async () => {};
                const keepFoldElement = {}, addTitleElement = {}, titleImageElement = {}, customTitleElement = {},
                    mergeSubdocsElement = {}, mergeDocHeadingModeElement = {}, mergeContentHeadingModeElement = {},
                    watermarkElement = {}, removeAssetsElement = {};
                const response = {data: {name: "test"}};
                const getHeadingPageBreakLevels = () => [];
                const updateHeadingPageBreaks = () => {};
                ${prepare}
                const firstHeight = previewElement.querySelector("img").clientHeight;
                document.getElementById("paged").checked = false;
                await fixBlockWidth(true);
                const naturalHeight = previewElement.querySelector("img").clientHeight;
                document.getElementById("paged").checked = !item.unpaged;
                await fixBlockWidth(true);
                if (previewElement.querySelector("img").clientHeight !== firstHeight || naturalHeight < firstHeight) {
                    throw new Error("Toggling pagination must restore and reapply the selected image size");
                }
                actionElement.remove();
                return exportConfig.pdfOptions;
            })()`);
            const pdf = await win.webContents.printToPDF(options);
            const result = await win.webContents.executeJavaScript(`(async () => {
                const {getDocument} = await import(${JSON.stringify(runtime)});
                globalThis.pdfjsWorker = await import(${JSON.stringify(worker)});
                const task = getDocument({data: Uint8Array.from(atob(${JSON.stringify(pdf.toString("base64"))}), c => c.charCodeAt(0))});
                const pdf = await task.promise;
                const pages = [];
                for (let i = 1; i <= pdf.numPages; i++) {
                    const page = await pdf.getPage(i);
                    const viewport = page.getViewport({scale: 1});
                    const canvas = document.createElement("canvas");
                    canvas.width = Math.ceil(viewport.width);
                    canvas.height = Math.ceil(viewport.height);
                    const ctx = canvas.getContext("2d");
                    await page.render({canvasContext: ctx, viewport}).promise;
                    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
                    const bounds = {};
                    for (let y = 0; y < canvas.height; y++) {
                        for (let x = 0; x < canvas.width; x++) {
                            const j = (y * canvas.width + x) * 4;
                            const [r, g, b] = pixels.subarray(j, j + 3);
                            const color = b > 240 && r < 15 && g < 15 ? "top" :
                                g > 240 && r < 15 && b < 15 ? "bottom" :
                                    r > 240 && g > 110 && g < 145 && b < 15 ? "image" : null;
                            if (!color) continue;
                            const rect = bounds[color] ||= {left: x, right: x, top: y, bottom: y};
                            rect.left = Math.min(rect.left, x); rect.right = Math.max(rect.right, x);
                            rect.top = Math.min(rect.top, y); rect.bottom = Math.max(rect.bottom, y);
                        }
                    }
                    const text = await page.getTextContent();
                    const after = text.items.find(item => item.str === "After image");
                    pages.push({bounds, hasText: text.items.some(item => item.str.trim()),
                        afterTop: after ? viewport.height - after.transform[5] - after.height : null,
                        png: ${!!process.env.SIYUAN_PDF_IMAGE_PREVIEW} ? canvas.toDataURL().split(",")[1] : undefined});
                }
                await task.destroy();
                return pages;
            })()`);
            if (process.env.SIYUAN_PDF_IMAGE_PREVIEW) {
                result.forEach((page, i) => writeFileSync(path.join(process.env.SIYUAN_PDF_IMAGE_PREVIEW,
                    `${item.name}-${i + 1}.png`), Buffer.from(page.png, "base64")));
            }
            const imagePages = result.filter(page => Object.keys(page.bounds).length);
            assert.ok(result.every(page => page.hasText || page.bounds.image), `${item.name}: no blank PDF pages`);
            assert.equal(imagePages.length, 1, `${item.name}: image must stay on one page`);
            const imagePage = imagePages[0];
            assert.ok(imagePage.bounds.top && imagePage.bounds.bottom, `${item.name}: both ends must remain visible`);
            const height = imagePage.bounds.bottom.bottom - imagePage.bounds.top.top + 1;
            const width = imagePage.bounds.image.right - imagePage.bounds.image.left + 1;
            const ratio = 600 / (item.small ? 200 : 1600);
            assert.ok(Math.abs(width / height - ratio) / ratio < 0.01,
                `${item.name}: image aspect ratio must be preserved`);
            const afterIndex = result.findIndex(page => page.afterTop !== null);
            const imageIndex = result.indexOf(imagePage);
            assert.ok(afterIndex > imageIndex || afterIndex === imageIndex &&
                result[afterIndex].afterTop >= imagePage.bounds.bottom.bottom - 1,
            `${item.name}: following text must not overlap the image`);
            if (item.unpaged) assert.equal(result.length, 1, "Unpaged exports retain the entire long image");
            if (item.small) assert.ok(height > 140 && height < 160,
                `${item.name}: small images retain their displayed size (${height})`);
            if (item.expectedHeight) assert.ok(Math.abs(height - item.expectedHeight) < 3,
                "Manually resized images retain their displayed size");
        }
        console.log("PDF image layout cases passed");
    } catch (error) {
        console.error(error);
        exitCode = 1;
    } finally {
        win.destroy();
        app.exit(exitCode);
    }
};

if (process.versions.electron && process.type === "browser") {
    runElectron().catch(error => { console.error(error); require("electron").app.exit(1); });
} else {
    require("node:test").it("PDF images fit one page without distortion or overlapping following text", {
        skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
        timeout: 60000,
    }, async () => {
        const env = {...process.env};
        delete env.ELECTRON_RUN_AS_NODE;
        const profile = mkdtempSync(path.join(os.tmpdir(), "siyuan-pdf-images-"));
        try {
            const {stdout} = await require("node:util").promisify(require("node:child_process").execFile)(
                require("electron"), [__filename, profile], {env, windowsHide: true, timeout: 55000});
            assert.match(stdout, /PDF image layout cases passed/);
        } finally {
            assert.equal(path.dirname(path.resolve(profile)), path.resolve(os.tmpdir()));
            assert.ok(path.basename(profile).startsWith("siyuan-pdf-images-"));
            rmSync(profile, {recursive: true, force: true, maxRetries: 5, retryDelay: 100});
        }
    });
}
