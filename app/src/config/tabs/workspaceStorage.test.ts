import * as assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import * as path from "node:path";
import {promisify} from "node:util";
import {test} from "node:test";
import {createSourceFile, isVariableStatement, ModuleKind, ScriptTarget, transpileModule} from "typescript";
import type {WorkspaceStorageData} from "../../types/api";

const browserCases = async (source: string, sharedSource: string, echartsPath: string, locales: Record<string, Record<string, string>>) => {
    const languages = locales.en;
    const check = require("node:assert/strict");
    const shared = {} as typeof import("../render/fragments") & Pick<typeof import("../render/render"), "genButtonHtml" | "genButtonRowHtml" | "genConfigGroup">;
    new Function("exports", sharedSource)(shared);
    const realEcharts = require(echartsPath);
    const captures = async (name: string) => {
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        await require("electron").ipcRenderer.invoke("capture-storage", name);
    };
    let inits = 0;
    let disposals = 0;
    let allowChart = true;
    let scriptLoads = 0;
    const echarts = {...realEcharts,
        init: (...args: unknown[]) => { inits++; return realEcharts.init(...args); },
        dispose: (...args: unknown[]) => { disposals++; return realEcharts.dispose(...args); },
    };
    Object.assign(window, {siyuan: {languages, config: {appearance: {mode: 0}}}, echarts: undefined});
    const requests: {signal: AbortSignal; resolve: (result: {code: number; msg: string; data: WorkspaceStorageData | null}) => void}[] = [];
    const exports: typeof import("./workspaceStorage") = {} as typeof import("./workspaceStorage");
    new Function("require", "exports", source)((name: string) => {
        switch (name) {
            case "../../util/fetch":
                return {fetchSyncPost: (url: string, _data: unknown, _headers: unknown, process: boolean, signal: AbortSignal) => {
                    check.equal(url, "/api/system/getWorkspaceStorage");
                    check.equal(process, false);
                    return new Promise(resolve => requests.push({signal, resolve}));
                }};
            case "../../protyle/util/echarts":
                return {loadECharts: async () => {
                    scriptLoads++;
                    if (allowChart) {
                        window.echarts = echarts;
                    }
                }};
            case "../../util/escape":
                return {escapeHtml: (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")};
            case "../render/fragments":
            case "../render/render":
                return shared;
            default:
                throw new Error(`Unexpected dependency: ${name}`);
        }
    }, exports);
    check.equal(exports.formatStorageSize(0), "0 B");
    check.equal(exports.formatStorageSize(1024), "1 KiB");
    check.equal(exports.formatStorageSize(1024 ** 4), "1 TiB");
    const root = document.createElement("div");
    const host = document.createElement("div");
    const tabWrap = document.createElement("div");
    tabWrap.className = "config__tab-wrap";
    root.dataset.name = "app";
    document.body.append(host);
    const surface = async (mobile: boolean, width: number, fontSize = 16) => {
        host.id = mobile ? "model" : "";
        host.className = mobile ? "" : "config";
        host.style.cssText = "position:static;width:100%;height:auto";
        root.className = mobile ? "config config--mobile config--mobile-items" : "config__tab-container";
        root.style.cssText = `height:auto;font-size:${fontSize}px`;
        if (mobile) {
            host.replaceChildren(root);
        } else {
            host.replaceChildren(tabWrap);
            tabWrap.replaceChildren(root);
        }
        await require("electron").ipcRenderer.invoke("storage-surface", mobile, width);
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    };
    await surface(false, 850);
    const mount = () => {
        root.innerHTML = shared.genConfigGroup(exports.genWorkspaceStorageHtml(), window.siyuan.languages.workspace) +
            shared.genConfigGroup(shared.genButtonRowHtml("storageReferenceControl", window.siyuan.languages.reloadUI,
                window.siyuan.languages.reloadUITip, window.siyuan.languages.reloadUI, "iconRefresh"), window.siyuan.languages.configGroupMaintenance);
        exports.mountWorkspaceStorage(root);
    };
    mount();
    const tick = () => new Promise(resolve => setTimeout(resolve, 30));
    const button = () => root.querySelector<HTMLButtonElement>("button");
    const status = () => root.querySelector<HTMLElement>("[data-storage-status]");
    const result = (size = 1024 ** 3): WorkspaceStorageData => ({
        totalSize: size * 2, assetsSize: size / 2, calculatedAt: 1700000000000,
        directories: [
            {name: "data", size}, {name: "repo", size: size / 2}, {name: "history", size: size / 4},
            {name: "temp", size: size / 8}, {name: "conf", size: size / 16}, {name: "other", size: size / 16},
        ],
    });
    const succeed = async (index: number, data = result()) => {
        requests[index].resolve({code: 0, msg: "", data});
        await tick();
    };
    check.equal(requests.length, 1);
    check.equal(button().disabled, true);
    button().dispatchEvent(new Event("click"));
    check.equal(requests.length, 1, "pending refresh must be coalesced");
    await succeed(0);
    check.equal(button().disabled, false);
    check.equal(scriptLoads, 1);
    check.equal(root.querySelector("[data-storage-total]").textContent, "2 GiB");
    check.equal(root.querySelectorAll(".workspace-storage__row").length, 7);
    const chart = () => realEcharts.getInstanceByDom(root.querySelector("[data-storage-chart]"));
    check.equal(chart().getOption().series[0].data.length, 6, "assets must not become another pie slice");
    check.equal(chart().getOption().series[0].data.reduce((sum: number, item: {value: number}) => sum + item.value, 0), result().totalSize);
    await captures("desktop-light");
    await surface(true, 340, 24);
    window.siyuan.config.appearance.mode = 1;
    document.documentElement.setAttribute("data-theme-mode", "dark");
    await tick();
    check.ok(inits >= 2 && disposals >= 1, "theme changes must recreate the chart");
    const beforeStyleLoad = inits;
    const themeLink = document.createElement("link");
    themeLink.rel = "stylesheet";
    document.head.append(themeLink);
    themeLink.dispatchEvent(new Event("load"));
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    check.ok(inits > beforeStyleLoad, "stylesheet completion must refresh chart colors");
    themeLink.remove();
    check.ok(root.scrollWidth <= root.clientWidth, "large mobile text must not overflow");
    const figure = root.querySelector(".workspace-storage__figure").getBoundingClientRect();
    const details = root.querySelector("[data-storage-details]").getBoundingClientRect();
    check.ok(details.top >= figure.bottom, "mobile details must appear below the chart");
    const contentStyle = getComputedStyle(root.querySelector("[data-storage-content]"));
    check.ok(parseFloat(contentStyle.lineHeight) >= parseFloat(contentStyle.fontSize), "large text needs sufficient line height");
    await captures("mobile-dark-large-text");
    button().click();
    requests[1].resolve({code: -1, msg: "unreadable", data: null});
    await tick();
    check.equal(status().textContent, languages.workspaceStorageFailed);
    check.equal(button().disabled, false);
    check.equal(root.querySelector("[data-storage-total]").textContent, "2 GiB", "failure must retain the previous dated result");
    button().click();
    await succeed(2, result(0));
    check.equal(root.querySelector("[data-storage-total]").textContent, "0 B");
    check.equal(chart().getOption().series[0].data.length, 0);
    check.equal(status().textContent, "");
    await captures("empty-workspace");
    button().click();
    const oldTotal = root.querySelector("[data-storage-total]").textContent;
    const beforeDispose = disposals;
    exports.unmountWorkspaceStorage(root);
    check.equal(requests[3].signal.aborted, true);
    check.equal(disposals, beforeDispose + 1);
    await succeed(3);
    check.equal(root.querySelector("[data-storage-total]").textContent, oldTotal, "late responses must not update an unmounted page");
    mount();
    const replacedRequest = requests[4];
    mount();
    check.equal(replacedRequest.signal.aborted, true, "remount must release the previous request");
    await succeed(4);
    check.equal(root.querySelector("[data-storage-total]").textContent, "");
    Object.assign(window, {echarts: undefined});
    allowChart = false;
    await succeed(5);
    check.equal(root.querySelector("[data-storage-total]").textContent, "2 GiB");
    check.ok(!root.querySelector("[data-storage-chart-error]").classList.contains("fn__none"));
    allowChart = true;
    button().click();
    await succeed(6);
    check.ok(chart());
    check.ok(root.querySelector("[data-storage-chart-error]").classList.contains("fn__none"));
    exports.unmountWorkspaceStorage(root);
    for (const [locale, mobile, width, fontSize] of [
        ["zh-CN", false, 850, 16], ["en", false, 620, 24], ["de", false, 850, 24],
        ["zh-CN", true, 320, 16], ["en", true, 340, 24], ["de", true, 375, 24], ["ar", true, 375, 24],
    ] as const) {
        Object.assign(window.siyuan, {languages: locales[locale]});
        document.documentElement.dir = locale === "ar" ? "rtl" : "ltr";
        await surface(mobile, width, fontSize);
        const requestIndex = requests.length;
        mount();
        await succeed(requestIndex, result(1024 ** 4 * 987.654));
        const context = `${locale}-${mobile ? "mobile" : "desktop"}-${width}-${fontSize}`;
        await captures(context);
        check.ok(root.scrollWidth <= root.clientWidth, `${context}: horizontal overflow`);
        const refreshRect = button().getBoundingClientRect();
        const referenceRect = root.querySelector("#storageReferenceControl").getBoundingClientRect();
        check.ok(Math.abs(refreshRect.width - referenceRect.width) < 1, `${context}: shared button width`);
        check.ok(Math.abs(refreshRect.right - referenceRect.right) < 1, `${context}: shared button alignment`);
        const sizeRects = Array.from(root.querySelectorAll(".workspace-storage__row dd:first-of-type"), node => node.getBoundingClientRect());
        const edge = locale === "ar" ? "left" : "right";
        check.ok(sizeRects.every(rect => Math.abs(rect[edge] - sizeRects[0][edge]) < 1), `${context}: size column alignment`);
        for (const row of root.querySelectorAll(".workspace-storage__row")) {
            const label = row.querySelector("dt").getBoundingClientRect();
            const value = row.querySelector("dd").getBoundingClientRect();
            check.ok(locale === "ar" ? value.right <= label.left : label.right <= value.left, `${context}: label overlaps size`);
            const name = row.querySelector("dt > span:last-child");
            if (name && ["data", "repo", "history", "temp", "conf"].includes(name.textContent)) {
                check.ok(name.getBoundingClientRect().height < fontSize * 2, `${context}: directory name breaks across lines`);
            }
        }
        exports.unmountWorkspaceStorage(root);
    }
    host.remove();
    return "Workspace storage browser checks passed";
};

test("workspace storage rendering, refresh, theme, mobile layout and lifecycle", {
    skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
    timeout: 60000,
}, async () => {
    const temporary = mkdtempSync(path.join(tmpdir(), "siyuan-workspace-storage-"));
    const script = path.join(temporary, "run.cjs");
    const source = transpileModule(readFileSync(path.join(__dirname, "workspaceStorage.ts"), "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS},
    }).outputText;
    const locales = Object.fromEntries(["en", "zh-CN", "de", "ar"].map(lang =>
        [lang, JSON.parse(readFileSync(path.resolve(`appearance/langs/${lang}.json`), "utf8"))]));
    const render = createSourceFile("render.ts", readFileSync(path.join(__dirname, "../render/render.ts"), "utf8"), ScriptTarget.Latest, true);
    const sharedSource = transpileModule(readFileSync(path.join(__dirname, "../render/fragments.ts"), "utf8") +
        render.statements.filter(statement => isVariableStatement(statement) && statement.declarationList.declarations.some(declaration =>
            ["genButtonHtml", "genButtonRowHtml", "genConfigGroup"].includes(declaration.name.getText(render))))
            .map(statement => statement.getText(render)).join("\n"), {compilerOptions: {module: ModuleKind.CommonJS}}).outputText;
    const css = require("sass").compile(path.resolve("src/assets/scss/base.scss")).css;
    const mobileCSS = require("sass").compile(path.resolve("src/assets/scss/mobile.scss")).css;
    const theme = readFileSync(path.resolve("appearance/themes/daylight/theme.css"), "utf8");
    const darkTheme = readFileSync(path.resolve("appearance/themes/midnight/theme.css"), "utf8");
    const icons = readFileSync(path.resolve("appearance/icons/litheness/icon.js"), "utf8");
    const commonCSS = theme + darkTheme.replace(/:root/g, ':root[data-theme-mode="dark"]') + "\nbody{margin:0;font:16px sans-serif;color:var(--b3-theme-on-background);background:var(--b3-theme-background)}";
    const code = `const __name = value => value; (${browserCases.toString()})(${JSON.stringify(source)}, ${JSON.stringify(sharedSource)}, ${JSON.stringify(path.resolve("stage/protyle/js/echarts/echarts.min.js"))}, ${JSON.stringify(locales)})`;
    writeFileSync(script, `const {app, BrowserWindow, ipcMain} = require("electron");
const fs = require("node:fs");
const path = require("node:path");
app.setPath("userData", ${JSON.stringify(path.join(temporary, "profile"))});
app.commandLine.appendSwitch("disable-gpu");
app.whenReady().then(async () => {
    const win = new BrowserWindow({show: false, width: 850, height: 1050, webPreferences: {nodeIntegration: true, contextIsolation: false, backgroundThrottling: false}});
    let styleKey;
    ipcMain.handle("storage-surface", async (_event, mobile, width) => {
        win.setContentSize(width, 1100);
        if (styleKey) await win.webContents.removeInsertedCSS(styleKey);
        styleKey = await win.webContents.insertCSS((mobile ? ${JSON.stringify(mobileCSS)} : ${JSON.stringify(css)}) + ${JSON.stringify(commonCSS)});
    });
    ipcMain.handle("capture-storage", async (_event, name) => {
        if (process.env.SIYUAN_STORAGE_SCREENSHOTS) {
            fs.mkdirSync(process.env.SIYUAN_STORAGE_SCREENSHOTS, {recursive: true});
            fs.writeFileSync(path.join(process.env.SIYUAN_STORAGE_SCREENSHOTS, name + ".png"), (await win.webContents.capturePage()).toPNG());
        }
    });
    try {
        await win.loadURL("data:text/html,<html><body></body></html>");
        await win.webContents.executeJavaScript(${JSON.stringify(icons)});
        console.log(await win.webContents.executeJavaScript(${JSON.stringify(code)}));
        win.destroy();
        app.exit(0);
    } catch (error) {
        console.error(error);
        win.destroy();
        app.exit(1);
    }
});`, "utf8");
    const env = {...process.env};
    delete env.ELECTRON_RUN_AS_NODE;
    try {
        const executable = require("electron") as unknown as string;
        const result = await promisify(execFile)(executable, [script], {env, timeout: 50000, windowsHide: true});
        assert.match(result.stdout, /Workspace storage browser checks passed/);
    } finally {
        // 临时目录由 mkdtempSync 在系统临时目录中创建，只清理本次测试生成的文件。
        assert.equal(path.dirname(temporary), tmpdir());
        assert.ok(path.basename(temporary).startsWith("siyuan-workspace-storage-"));
        rmSync(temporary, {recursive: true, force: true});
    }
});
