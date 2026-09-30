import * as assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import * as path from "node:path";
import {promisify} from "node:util";
import test from "node:test";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";
import {getExportImageSize, isExportImageSizeSupported, updateExportImageLayout} from "./imageLayout";

test("image limits account for device pixels, side length and bitmap area", () => {
    assert.equal(isExportImageSizeSupported({width: 8192, height: 2048}, 2), true);
    assert.equal(isExportImageSizeSupported({width: 8193, height: 100}, 2), false);
    assert.equal(isExportImageSizeSupported({width: 100, height: 8193}, 2), false);
    assert.equal(isExportImageSizeSupported({width: 4097, height: 4096}, 2), false);
    assert.equal(isExportImageSizeSupported({width: 0, height: 100}, 1), false);
    assert.equal(isExportImageSizeSupported({width: Infinity, height: 100}, 1), false);
    assert.equal(isExportImageSizeSupported({width: 100, height: 100}, NaN), false);
});

const browserCases = async (layoutSource: string, exportSource: string, mobile: boolean) => {
    const check = require("node:assert/strict");
    const layout: {
        updateExportImageLayout: typeof updateExportImageLayout,
        getExportImageSize: typeof getExportImageSize,
        isExportImageSizeSupported: typeof isExportImageSizeSupported,
    } = new Function("exports", `${layoutSource}; return exports;`)({});
    let engine = "html";
    let content = "";
    let dialog: {element: HTMLElement, resize: () => void};
    let captured: {blob: Blob, width: number, height: number, x: number, y: number};
    const messages: string[] = [];
    let watermarkWidth = 0;
    class ExportDialog {
        element: HTMLElement;
        resize: () => void;
        constructor(options: {content: string, width: string, height: string, resizeCallback: () => void}) {
            this.element = document.createElement("div");
            this.element.classList.add("b3-dialog--open");
            this.element.innerHTML = `<div class="b3-dialog"><div class="b3-dialog__container" style="width:${options.width};height:${options.height}">
<div class="b3-dialog__body">${options.content}</div></div></div>`;
            document.body.append(this.element);
            this.resize = options.resizeCallback;
            dialog = {element: this.element, resize: options.resizeCallback};
        }
        destroy() {
            this.element.remove();
        }
    }
    window.siyuan = {
        config: {editor: {}, export: {addTitle: false}, system: {}},
        languages: {exportImageTooLarge: "Image too large", exportFileSaveFailed: "Export failed"},
        storage: {image: {keepFold: false, watermark: false}},
    } as unknown as ISiyuan;
    Object.defineProperty(window, "devicePixelRatio", {value: 2, configurable: true});
    const htmlCanvas = window.htmlToImage.toCanvas;
    window.htmlToImage.toCanvas = async (element, options) => {
        watermarkWidth = element.clientWidth;
        return htmlCanvas(element, options);
    };
    const rememberBlob = (blob: Blob) => {
        const element = dialog.element.querySelector<HTMLElement>(".b3-dialog__content");
        const size = layout.getExportImageSize(element);
        const markers = element.querySelectorAll<HTMLElement>(".marker");
        const marker = markers[markers.length - 1].getBoundingClientRect();
        const rect = element.getBoundingClientRect();
        captured = {blob, ...size, x: marker.left - rect.left + element.scrollLeft + marker.width / 2,
            y: marker.top - rect.top + element.scrollTop + marker.height / 2};
    };
    const dependencies: Record<string, unknown> = {
        "./imageLayout": layout,
        "../../dialog": {Dialog: ExportDialog},
        "../../dialog/message": {showMessage: (message: string) => messages.push(message), hideMessage: () => {}},
        "../../util/fetch": {fetchPost: (url: string, data: {file: File}, callback: (response: unknown) => void) => {
            if (url === "/api/export/exportPreviewHTML") {
                callback({data: {content, attrs: {}, type: "NodeDocument", name: "image"}});
            } else {
                check.equal(url, "/api/export/exportAsFile");
                rememberBlob(data.file);
                callback({code: 0, data: {file: "image.png"}});
            }
        }},
        "../../util/contractFormData": {ContractFormData: class {
            file: File;
            constructor(data: {file: File}) {
                this.file = data.file;
            }
        }},
        "./jsEmbed": {renderExportJSEmbeds: async () => {}},
        "../util/addScript": {addScript: async () => {}},
        "../../util/functions": {isMobile: () => mobile},
        "../../constants": {Constants: {LOCAL_EXPORTIMG: "image", DIALOG_EXPORTIMAGE: "image", TIMEOUT_LOAD: 0}},
        "../render/highlightRender": {highlightRender: () => {}, lineNumberRender: () => {}},
        "../util/processCode": {processRender: () => {}},
        "../util/compatibility": {isIPhone: () => mobile && engine === "modern", isIPad: () => false,
            isSafari: () => engine === "modern", isInAndroid: () => false, setStorageVal: () => {},
            saveExportFile: async () => {}},
        "../../util/hostCapabilities": {getHostCapabilities: () => ({documentImportExport: true}),
            sanitizeKernelHTML: (value: string) => value},
        "../../menus/util": {writePNGBlob: async (blob: Blob) => {
            rememberBlob(blob);
            return false;
        }},
    };
    const exported: {exportImage: (id: string, copyOnly?: boolean) => void} = new Function("exports", "require",
        `${exportSource}; return exports;`)({}, (name: string) => dependencies[name] || {});
    const waitForActions = async () => {
        for (let i = 0; i < 500; i++) {
            if (!document.body.contains(dialog.element) ||
                !(dialog.element.querySelector('[data-type="copy"]') as HTMLButtonElement).disabled) {
                return;
            }
            await new Promise(resolve => setTimeout(resolve, 10));
        }
        check.fail("Export actions did not become available");
    };
    const table = (columns: number, wide = true) => `<div class="table" data-node-id="table"><div><table><tbody><tr>${
        Array.from({length: columns}, (_, index) => `<td${wide ? ' style="min-width:400px"' : ""}>column ${index}
${index === columns - 1 ? '<span class="marker" style="display:block;width:20px;height:20px;background:red"></span>' : ""}</td>`).join("")
    }</tr></tbody></table></div></div>`;
    const open = async (html: string, copyOnly = false) => {
        document.body.replaceChildren();
        content = html;
        captured = undefined;
        messages.length = 0;
        exported.exportImage("root", copyOnly);
        await waitForActions();
        return dialog.element.querySelector<HTMLElement>(".b3-dialog__content");
    };
    const verifyCaptured = async () => {
        check.ok(captured, "No PNG captured: " + messages.join("\n"));
        const image = new Image();
        const url = URL.createObjectURL(captured.blob);
        try {
            image.src = url;
            await image.decode();
            check.equal(image.naturalWidth, captured.width * window.devicePixelRatio);
            check.equal(image.naturalHeight, captured.height * window.devicePixelRatio);
            const canvas = document.createElement("canvas");
            canvas.width = image.naturalWidth;
            canvas.height = image.naturalHeight;
            const context = canvas.getContext("2d");
            context.drawImage(image, 0, 0);
            const pixel = context.getImageData(Math.floor(captured.x * 2), Math.floor(captured.y * 2), 1, 1).data;
            check.deepEqual(Array.from(pixel), [255, 0, 0, 255], `Last column was clipped (${engine}, mobile=${mobile})`);
        } finally {
            URL.revokeObjectURL(url);
        }
    };
    const capture = async (type = "copy") => {
        (dialog.element.querySelector(`[data-type="${type}"]`) as HTMLButtonElement).click();
        await waitForActions();
        await verifyCaptured();
    };
    for (const renderer of ["html", "modern"]) {
        engine = renderer;
        const narrow = await open(table(2, false));
        check.equal(narrow.querySelector<HTMLElement>(".export-img").style.minWidth, "");
        check.equal(narrow.scrollWidth, narrow.clientWidth);
        await capture();

        const wide = await open(table(4));
        const imageElement = wide.querySelector<HTMLElement>(".export-img");
        const cell = wide.querySelector("td");
        check.ok(wide.scrollWidth > wide.clientWidth, "Wide preview must scroll horizontally");
        check.equal(getComputedStyle(cell).fontSize, "16px");
        check.equal(getComputedStyle(wide.querySelector("table")).transform, "none");
        check.ok(wide.querySelector("table").getBoundingClientRect().right <= imageElement.getBoundingClientRect().right,
            "Image must cover the whole table");
        wide.scrollLeft = wide.scrollWidth - wide.clientWidth;
        const oldScroll = wide.scrollLeft;
        await capture();
        check.equal(wide.scrollLeft, oldScroll);
        check.equal(wide.style.overflow, "");
        imageElement.querySelector(".protyle-wysiwyg").innerHTML = table(1, false);
        dialog.resize();
        check.equal(imageElement.style.minWidth, "");

        const nested = await open(`<div class="sb" data-node-id="columns" data-sb-layout="col">${table(2)}${table(2)}</div>`);
        const nestedTables = nested.querySelectorAll("table");
        const firstTable = nestedTables[0].getBoundingClientRect();
        const secondTable = nestedTables[1].getBoundingClientRect();
        check.ok(firstTable.right <= secondTable.left || firstTable.bottom <= secondTable.top,
            "Tables in a super block must not overlap");
        await capture();

        const rtl = await open(table(4));
        rtl.querySelector<HTMLElement>(".protyle-wysiwyg").style.direction = "rtl";
        dialog.resize();
        const rtlTable = rtl.querySelector("table").getBoundingClientRect();
        const rtlImage = rtl.querySelector(".export-img").getBoundingClientRect();
        check.ok(rtlTable.left >= rtlImage.left && rtlTable.right <= rtlImage.right, "RTL table must fit inside the image");
        await capture();

        const large = await open(table(4));
        large.querySelector<HTMLElement>("table").style.width = "20000px";
        dialog.resize();
        (dialog.element.querySelector('[data-type="copy"]') as HTMLButtonElement).click();
        await waitForActions();
        check.equal(captured, undefined);
        check.ok(messages.includes("Image too large"), "Oversized image must show a size error");
        check.equal(large.style.overflow, "");
        large.querySelector<HTMLElement>("table").style.width = "";
        await capture();

        await open(table(4), true);
        await verifyCaptured();
        await open(table(4));
        await capture("export");

        const tall = await open(table(4).replace('class="table"', 'class="table" custom-pinthead="true"')
            .replace("<tr>", "<tr><td colspan=\"4\" style=\"height:1200px\">long content</td></tr><tr>"));
        check.equal(getComputedStyle(tall.querySelector(".table > div")).maxHeight, "none");
        tall.scrollTop = 200;
        const oldTop = tall.scrollTop;
        await capture();
        check.equal(tall.scrollTop, oldTop);
    }
    window.siyuan.storage.image.watermark = true;
    window.siyuan.config.export.imageWatermarkStr = "Watermark";
    const watermarked = await open(table(4));
    check.ok(watermarkWidth < watermarked.querySelector<HTMLElement>(".export-img").clientWidth / 3,
        "Watermark tiles must be bounded by the viewport");
    await capture();
    document.body.replaceChildren();
    return `Image exports passed (mobile=${mobile})`;
};

test("wide PNG exports preserve text and all columns in both screenshot engines and viewport sizes", {
    skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
    timeout: 60000,
}, async () => {
    const sass = require("sass");
    const css = sass.compileString('@use "component/dialog"; @use "protyle/wysiwyg"; ' +
        '@use "component/typography"; @use "business/export";', {
        loadPaths: [path.resolve("src/assets/scss")], logger: sass.Logger.silent,
    }).css + " .protyle-wysiwyg {font-size:16px;font-family:Arial} .b3-dialog__container {border:1px solid #ccc}";
    const compile = (file: string) => transpileModule(readFileSync(path.join(__dirname, file), "utf8"), {
        compilerOptions: {target: ScriptTarget.ES2021, module: ModuleKind.CommonJS},
    }).outputText;
    const layoutSource = compile("imageLayout.ts");
    const exportSource = compile("util.ts");
    const libraries = ["html-to-image.min.js", "modern-screenshot.min.js"].map(file =>
        readFileSync(path.resolve("stage/protyle/js", file), "utf8"));
    const mobileCSS = sass.compileString('@use "main/mobile";', {
        loadPaths: [path.resolve("src/assets/scss")], logger: sass.Logger.silent,
    }).css;
    const temporary = mkdtempSync(path.join(tmpdir(), "siyuan-export-image-"));
    const script = path.join(temporary, "run.cjs");
    writeFileSync(script, `const {app, BrowserWindow} = require("electron");
app.setPath("userData", ${JSON.stringify(path.join(temporary, "profile"))});
app.commandLine.appendSwitch("disable-gpu");
app.on("window-all-closed", () => {});
app.whenReady().then(async () => {
    let win;
    let phase;
    try {
        for (const mobile of [false, true]) {
            phase = "load viewport " + mobile;
            win = new BrowserWindow({show:false,width:mobile ? 390 : 1000,height:850,
                webPreferences:{nodeIntegration:true,contextIsolation:false}});
            await win.loadURL("data:text/html,<html><head></head><body></body></html>");
            await win.webContents.executeJavaScript(${JSON.stringify(`const style = document.createElement("style");
style.textContent = ${JSON.stringify(css)}; document.head.append(style);
${libraries.map(source => `new Function("module", "exports", ${JSON.stringify(source)})(undefined, undefined);`).join("\n")}`)});
            if (mobile) {
                phase = "mobile styles";
                await win.webContents.executeJavaScript(${JSON.stringify(`style.textContent += ${JSON.stringify(mobileCSS)};`)});
            }
            phase = "export cases " + mobile;
            console.log(await win.webContents.executeJavaScript(
                "const __name = value => value; (" + ${JSON.stringify(browserCases.toString())} + ")(" +
                ${JSON.stringify(JSON.stringify(layoutSource) + "," + JSON.stringify(exportSource))} + "," + mobile + ")"));
            win.destroy();
        }
        app.exit(0);
    } catch (error) {
        console.error(phase, error); if (win && !win.isDestroyed()) win.destroy(); app.exit(1);
    }
});`, "utf8");
    const env = {...process.env};
    delete env.ELECTRON_RUN_AS_NODE;
    try {
        const result = await promisify(execFile)(require("electron") as unknown as string, [script], {
            env, timeout: 55000, windowsHide: true,
        });
        assert.match(result.stdout, /Image exports passed \(mobile=false\)/);
        assert.match(result.stdout, /Image exports passed \(mobile=true\)/);
    } finally {
        rmSync(temporary, {recursive: true, force: true});
    }
});
