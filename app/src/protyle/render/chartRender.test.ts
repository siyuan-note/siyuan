import * as assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import * as path from "node:path";
import {promisify} from "node:util";
import test from "node:test";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

const browserCases = async (sources: Record<string, string>, libraries: Record<string, string>) => {
    const check: typeof assert = require("node:assert/strict");
    const echarts = require(libraries.echarts);
    window.echarts = echarts;
    window.htmlToImage = require(libraries.html);
    window.modernScreenshot = require(libraries.modern);
    window.siyuan = {
        config: {appearance: {mode: 0}, editor: {}, export: {addTitle: false}, system: {}},
        languages: {exportFileSaveFailed: "Export failed"},
        storage: {image: {keepFold: false, watermark: false}},
    } as unknown as ISiyuan;
    Object.defineProperty(window, "devicePixelRatio", {value: 1});
    const tick = (ms = 0) => new Promise(resolve => setTimeout(resolve, ms));
    const unescape = (value: string) => {
        const text = document.createElement("textarea");
        text.innerHTML = value;
        return text.value;
    };
    Object.assign(window, {Lute: {UnEscapeHTMLStr: unescape}});
    let loading: Promise<void> = Promise.resolve();
    let parsing: Promise<void> = Promise.resolve();
    const chartAPI = {} as typeof import("./chartRender");
    const chartDependencies: Record<string, unknown> = {
        "../util/addScript": {addScript: () => loading},
        "../util/echarts": {loadECharts: () => loading},
        "./foldedContent": {isFoldedRenderContent: () => false},
        "../../constants": {Constants: {PROTYLE_CDN: "", ZWSP: "\u200b"}},
        "../util/hasClosest": {hasClosestByClassName: (element: Element) => element.closest(".protyle-wysiwyg")},
        "../../util/functions": {looseJsonParse: async (text: string) => { await parsing; return JSON.parse(text); }},
        "./util": {genIconHTML: () => '<div class="protyle-icons"></div>'},
        "../../util/hostCapabilities": {getHostCapabilities: () => ({remoteKernel: false})},
        "../../util/escape": {escapeHtml: (text: string) => text},
    };
    new Function("exports", "require", sources.chart)(chartAPI, (name: string) => chartDependencies[name]);
    const option = {
        animation: true, animationDuration: 60000, animationDelay: 60000,
        title: {text: "Chart"},
        xAxis: {type: "category", boundaryGap: false, data: Array.from({length: 31}, (_, i) => `${i}`)},
        yAxis: {type: "value"},
        series: [{type: "line", animation: true, animationDuration: 60000, animationDelay: 60000,
            itemStyle: {color: "#4285f4"}, areaStyle: {}, data: Array.from({length: 31}, (_, i) => 20 + i % 5 * 5)}],
    };
    const block = () => {
        const element = document.createElement("div");
        element.dataset.subtype = "echarts";
        element.dataset.content = JSON.stringify(option);
        element.innerHTML = '<div class="protyle-icons"></div><div><span></span><div style="height:420px" contenteditable="false"></div></div>';
        return element;
    };
    const host = document.createElement("div");
    host.className = "protyle-wysiwyg";
    host.style.width = "720px";
    document.body.append(host);
    const sourceBlock = block();
    host.append(sourceBlock);
    chartAPI.chartRender(sourceBlock);
    await tick(30);
    const sourceChart = echarts.getInstanceByDom(sourceBlock.querySelector("[_echarts_instance_]"));
    check.ok(sourceChart);
    check.equal(sourceChart.getOption().animation, true, "editor animation remains enabled");
    check.equal(sourceChart.getOption().series[0].animationDuration, 60000);
    const sourceWidth = sourceChart.getWidth();
    const sourceHeight = sourceChart.getHeight();
    const sourceID = sourceChart.id;
    for (const hidden of [false, true]) {
        host.style.display = hidden ? "none" : "";
        for (const mode of [1, 0, 1, 0]) {
            window.siyuan.config.appearance.mode = mode;
            chartAPI.refreshChartTheme(document.body);
            await tick(20);
            const refreshed = echarts.getInstanceByDom(sourceBlock.querySelector("[_echarts_instance_]"));
            check.equal(refreshed, sourceChart, "theme changes retain the chart instance");
            check.equal(refreshed.id, sourceID);
            check.equal(refreshed.getWidth(), sourceWidth, "hidden tabs retain a nonzero chart width");
            check.equal(refreshed.getHeight(), sourceHeight);
            const referenceElement = document.createElement("div");
            const reference = echarts.init(referenceElement, mode ? "dark" : undefined, {width: sourceWidth, height: sourceHeight});
            reference.setOption({...option, animation: false, series: option.series.map(series => ({...series, animation: false}))});
            check.equal(refreshed.getOption().textStyle.color, reference.getOption().textStyle.color,
                "both directions use the requested theme");
            check.deepEqual(refreshed.getOption().series[0].data, option.series[0].data);
            echarts.dispose(reference);
        }
    }
    host.style.display = "";
    check.equal(sourceChart.getWidth(), host.clientWidth, "showing the tab needs no corrective resize");
    echarts.dispose(sourceChart);
    host.remove();

    let content = "";
    let mobile = false;
    let modern = false;
    let dialog: {element: HTMLElement};
    let captured: {blob: Blob; x: number; y: number; width: number; height: number};
    const messages: string[] = [];
    const layout = new Function("exports", sources.layout + "; return exports;")({});
    const fonts = new Function("exports", sources.fonts + "; return exports;")({});
    const remember = (blob: Blob) => {
        const chartElement = dialog.element.querySelector<HTMLElement>("[_echarts_instance_]");
        const instance = echarts.getInstanceByDom(chartElement);
        check.equal(instance.getOption().animation, false);
        check.equal(instance.getOption().series[0].animation, false, "series cannot re-enable export animation");
        check.equal(instance.getOption().series[0].progressive, 0);
        check.deepEqual(JSON.parse(chartElement.closest<HTMLElement>('[data-subtype="echarts"]').dataset.content), option,
            "static rendering preserves the source configuration");
        const bounds = chartElement.getBoundingClientRect();
        const contentBounds = dialog.element.querySelector(".b3-dialog__content").getBoundingClientRect();
        captured = {blob, x: bounds.left - contentBounds.left, y: bounds.top - contentBounds.top,
            width: bounds.width, height: bounds.height};
        return true;
    };
    class ExportDialog {
        element: HTMLElement;
        constructor(options: {content: string}) {
            this.element = document.createElement("div");
            this.element.innerHTML = `<div class="b3-dialog__container" style="width:${mobile ? 360 : 800}px">${options.content}</div>`;
            document.body.append(this.element);
            dialog = {element: this.element};
        }
        destroy() {
            this.element.querySelectorAll("[_echarts_instance_]").forEach(element => echarts.dispose(element));
            this.element.remove();
        }
    }
    const dependencies: Record<string, unknown> = {
        "./imageLayout": layout, "./imageFonts": fonts,
        "../../dialog": {Dialog: ExportDialog},
        "../../dialog/message": {showMessage: (text: string) => messages.push(text), hideMessage: () => {}},
        "../../util/fetch": {fetchPost: (url: string, data: {file: File}, callback: (response: unknown) => void) => {
            if (url === "/api/export/exportPreviewHTML") {
                callback({data: {content, attrs: {}, type: "NodeDocument", name: "chart"}});
            } else {
                check.equal(url, "/api/export/exportAsFile");
                remember(data.file);
                callback({code: 0, data: {file: "chart.png"}});
            }
            return Promise.resolve();
        }},
        "../../util/contractFormData": {ContractFormData: class {file: File; constructor(data: {file: File}) { this.file = data.file; }}},
        "./jsEmbed": {renderExportJSEmbeds: async () => {}},
        "../util/addScript": {addScript: async () => {}},
        "../../util/functions": {isMobile: () => mobile},
        "../../constants": {Constants: {LOCAL_EXPORTIMG: "image", DIALOG_EXPORTIMAGE: "image", TIMEOUT_LOAD: 0}},
        "../render/highlightRender": {highlightRender: () => {}},
        "../render/chartRender": chartAPI,
        "../util/processCode": {processRender: chartAPI.chartRender},
        "../util/compatibility": {isIPhone: () => mobile && modern, isIPad: () => false, isSafari: () => modern,
            isInAndroid: () => false, setStorageVal: () => {}, saveExportFile: async () => {}},
        "../../util/hostCapabilities": {getHostCapabilities: () => ({documentImportExport: true}), sanitizeKernelHTML: (text: string) => text},
        "../../menus/util": {writePNGBlob: async (blob: Blob) => remember(blob)},
    };
    const exports = {} as typeof import("../export/util");
    new Function("exports", "require", sources.export)(exports, (name: string) => dependencies[name] || {});
    const waitFor = async (predicate: () => boolean) => {
        const deadline = Date.now() + 5000;
        while (!predicate() && Date.now() < deadline) {
            await tick(10);
        }
        check.ok(predicate(), messages.join("\n"));
    };
    const verifyPNG = async () => {
        const image = new Image();
        const url = URL.createObjectURL(captured.blob);
        try {
            image.src = url;
            await image.decode();
            const canvas = document.createElement("canvas");
            canvas.width = image.naturalWidth;
            canvas.height = image.naturalHeight;
            const context = canvas.getContext("2d");
            context.drawImage(image, 0, 0);
            const pixels = context.getImageData(Math.floor(captured.x + captured.width * 0.7),
                Math.floor(captured.y + captured.height * 0.15), Math.floor(captured.width * 0.15),
                Math.floor(captured.height * 0.7)).data;
            let blue = 0;
            for (let i = 0; i < pixels.length; i += 4) {
                if (pixels[i + 2] > pixels[i] + 30 && pixels[i + 2] > pixels[i + 1] + 10 && pixels[i + 3] > 100) {
                    blue++;
                }
            }
            check.ok(blue > 100, `right side of the PNG is incomplete: mobile=${mobile}, modern=${modern}, blue=${blue}`);
        } finally {
            URL.revokeObjectURL(url);
        }
    };
    for (const viewport of [false, true]) {
        mobile = viewport;
        for (const engine of [false, true]) {
            modern = engine;
            for (const automatic of [true, false]) {
                captured = undefined;
                content = block().outerHTML;
                let finishLoading: () => void;
                let finishParsing: () => void;
                loading = new Promise(resolve => { finishLoading = resolve; });
                parsing = new Promise(resolve => { finishParsing = resolve; });
                exports.exportImage("chart", automatic);
                await tick(350);
                check.equal(captured, undefined, "slow library loading must not produce an empty PNG");
                check.equal((dialog.element.querySelector('[data-type="copy"]') as HTMLButtonElement).disabled, true);
                finishLoading();
                await tick(30);
                check.equal(captured, undefined, "configuration parsing must finish before capture");
                finishParsing();
                if (!automatic) {
                    await waitFor(() => !(dialog.element.querySelector('[data-type="export"]') as HTMLButtonElement).disabled);
                    (dialog.element.querySelector('[data-type="export"]') as HTMLButtonElement).click();
                }
                await waitFor(() => !!captured);
                await verifyPNG();
                await waitFor(() => !dialog.element.isConnected);
            }
        }
    }
    return "Chart theme and PNG regression cases passed";
};

test("hidden chart themes and static PNG exports retain complete charts on desktop and mobile", {
    skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
    timeout: 45000,
}, async () => {
    const sources = Object.fromEntries(Object.entries({chart: "chartRender.ts", export: "../export/util.ts",
        layout: "../export/imageLayout.ts", fonts: "../export/imageFonts.ts"}).map(([name, file]) => [name,
        transpileModule(readFileSync(path.resolve(__dirname, file), "utf8"), {
            compilerOptions: {target: ScriptTarget.ES2021, module: ModuleKind.CommonJS},
        }).outputText]));
    const libraries = {echarts: path.resolve("stage/protyle/js/echarts/echarts.min.js"),
        html: path.resolve("stage/protyle/js/html-to-image.min.js"),
        modern: path.resolve("stage/protyle/js/modern-screenshot.min.js")};
    const temporary = mkdtempSync(path.join(tmpdir(), "siyuan-chart-render-"));
    const script = path.join(temporary, "run.cjs");
    writeFileSync(script, `const {app, BrowserWindow} = require("electron");
app.setPath("userData", ${JSON.stringify(path.join(temporary, "profile"))});
app.commandLine.appendSwitch("disable-gpu");
app.whenReady().then(async () => {
    const win = new BrowserWindow({show:false,width:850,height:650,
        webPreferences:{nodeIntegration:true,contextIsolation:false,backgroundThrottling:false,offscreen:true}});
    try {
        await win.loadURL("data:text/html,<html><body></body></html>");
        console.log(await win.webContents.executeJavaScript(${JSON.stringify(
        `const __name = value => value; (${browserCases.toString()})(${JSON.stringify(sources)}, ${JSON.stringify(libraries)})`)}));
        win.destroy(); app.exit(0);
    } catch (error) {
        console.error(error); win.destroy(); app.exit(1);
    }
});`, "utf8");
    const env = {...process.env};
    delete env.ELECTRON_RUN_AS_NODE;
    try {
        const result = await promisify(execFile)(require("electron") as unknown as string, [script], {
            env, timeout: 40000, windowsHide: true,
        });
        assert.match(result.stdout, /Chart theme and PNG regression cases passed/, result.stderr);
    } finally {
        assert.equal(path.dirname(temporary), tmpdir());
        assert.ok(path.basename(temporary).startsWith("siyuan-chart-render-"));
        rmSync(temporary, {recursive: true, force: true});
    }
});
