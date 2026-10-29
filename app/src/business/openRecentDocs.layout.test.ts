import * as assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import * as path from "node:path";
import {test} from "node:test";
import {promisify} from "node:util";
import {compile} from "sass";
import {createSourceFile, isPropertyAssignment, ModuleKind, ScriptTarget, transpileModule} from "typescript";

const browserCases = async (sources: string[], css: string, languages: Record<string, string>[], themes: Record<string, string>) => {
    const check: typeof assert = require("node:assert/strict");
    document.head.innerHTML = `<style id="theme"></style><style>${css}</style>`;
    document.body.className = "body--windows";
    const constants = {DIALOG_RECENTDOCS: "recent-docs", LOCAL_DIALOGPOSITION: "dialog-position", TIMEOUT_OPENDIALOG: 0};
    const load = (source: string, dependencies: Record<string, unknown>) => {
        const exports: any = {};
        new Function("exports", "require", source)(exports, (id: string) => {
            check.ok(id in dependencies, "missing dependency: " + id);
            return dependencies[id];
        });
        return exports;
    };
    const closest = {hasClosestByClassName: (element: Element, name: string) => element.closest("." + name)};
    const resize = load(sources[0], {
        "../protyle/util/hasClosest": closest, "../constants": {Constants: constants},
        "../protyle/ui/hideElements": {hideAllElements() {}},
        "../protyle/util/compatibility": {setStorageVal() {}}, "../layout/getTopBarHeight": {getTopBarHeight: () => 0},
    });
    const panels = {destroyDialogBlockPanels() {}, getDialogBlockPanel() {}};
    const dialog = load(sources[1], {
        "../util/genID": {genUUID: () => "test-dialog"}, "../util/zIndex": {isAbove: () => false}, "./moveResize": resize,
        "../util/functions": {isMobile: () => false}, "../protyle/util/compatibility": {},
        "../protyle": {}, "../constants": {Constants: constants}, "../block/panelOwnership": panels,
        "./anchoredInput": {},
    });
    const clear = load(sources[2], {
        "../dialog/confirmDialog": {}, "../dialog/message": {}, "../util/fetch": {},
        "../util/escape": {escapeHtmlTextAndAttr: (value: string) => value},
    });
    let detached = false;
    const api = load(sources[3], {
        "../config/tabs/fileRuntime": {},
        "../util/fetch": {fetchPost: (_url: string, _data: unknown, callback: (data: unknown) => void) => callback({data: []})},
        "../emoji/fileTreeIcon": {}, "../constants": {Constants: constants}, "../util/escape": {},
        "../util/functions": {isWindow: () => detached}, "../protyle/util/compatibility": {updateHotkeyTip: () => ""},
        "../layout/getAll": {getAllDocks: (): unknown[] => []}, "../layout/dock/hotkey": {}, "../dialog": dialog,
        "../protyle/util/hasClosest": closest, "../protyle/ui/hideElements": {},
        "../block/panelOwnership": panels, "./clearRecentDocs": clear,
    });
    let cases = 0;
    for (const theme of ["daylight", "midnight"]) {
        document.getElementById("theme").textContent = themes[theme];
        document.documentElement.dataset.themeMode = theme === "daylight" ? "light" : "dark";
        for (const lang of languages) {
            for (const fontSize of [16, 28]) {
                document.documentElement.style.setProperty("--b3-font-size", fontSize + "px");
                for (const isDetached of [false, true]) {
                    detached = isDetached;
                    window.siyuan = {zIndex: 1, languages: lang, dialogs: [], storage: {[constants.LOCAL_DIALOGPOSITION]: {}},
                        menus: {menu: {element: document.createElement("div")}},
                        config: {fileTree: {recentDocsSort: "viewedAt"}, keymap: {general: {riffCard: {custom: ""}}}},
                    } as unknown as typeof window.siyuan;
                    api.openRecentDocs();
                    await new Promise(resolve => setTimeout(resolve, 10));
                    const root = window.siyuan.dialogs[0].element;
                    root.querySelector(".switch-doc__path").textContent = "/Notebook/" + "Long document path/".repeat(30);
                    const container = root.querySelector<HTMLElement>(".b3-dialog__container");
                    container.style.transition = "none";
                    container.parentElement.style.display = "block";
                    for (const direction of ["r", "l", "rd", "lt"]) {
                        for (const width of [201, 320, 680]) {
                            Object.assign(container.style, {left: "20px", top: "20px", width: "700px", height: "560px"});
                            const bounds = container.getBoundingClientRect();
                            const x = direction.includes("l") ? bounds.left : bounds.right;
                            const y = direction.includes("t") ? bounds.top : bounds.bottom;
                            const delta = container.clientWidth - width;
                            container.querySelector(".resize__" + direction).dispatchEvent(new MouseEvent("mousedown", {
                                bubbles: true, clientX: x, clientY: y,
                            }));
                            document.dispatchEvent(new MouseEvent("mousemove", {
                                clientX: x + (direction.includes("l") ? 1 : -1) * delta, clientY: y,
                            }));
                            document.dispatchEvent(new MouseEvent("mouseup"));
                            const rect = container.getBoundingClientRect();
                            check.ok(Math.abs(rect.width - width) <= 2, `${direction}: requested ${width}, got ${rect.width}`);
                            const label = `${theme}/${lang.recentDocs}/${fontSize}/${isDetached}/${direction}/${width}`;
                            for (const control of root.querySelectorAll<HTMLElement>(".b3-dialog__header input, .b3-dialog__header select, .switch-doc__footer button")) {
                                const controlRect = control.getBoundingClientRect();
                                check.ok(controlRect.width > 0 && controlRect.left >= rect.left && controlRect.right <= rect.right &&
                                    controlRect.top >= rect.top && controlRect.bottom <= rect.bottom, label);
                            }
                            const header = root.querySelector(".b3-dialog__header");
                            check.ok(header.scrollWidth <= header.clientWidth + 1, "header overflow: " + label);
                            const content = root.querySelector(".switch-doc").getBoundingClientRect();
                            check.ok(content.left >= rect.left && content.right <= rect.right, "content overflow: " + label);
                            const path = root.querySelector(".switch-doc__path");
                            const pathStyle = getComputedStyle(path);
                            check.equal(pathStyle.padding, "0px", "footer path padding: " + label);
                            check.equal(pathStyle.borderTopWidth, "0px", "footer path border: " + label);
                            check.ok(path.getBoundingClientRect().right <=
                                root.querySelector(".switch-doc__footer button").getBoundingClientRect().left,
                            "path overlaps clear button: " + label);
                            cases++;
                        }
                    }
                    window.siyuan.dialogs[0].destroy();
                    await new Promise(resolve => setTimeout(resolve, 10));
                    // 页签切换复用路径栏样式，窗口拉高时仍应保持单行，并保留边距和分隔线。
                    for (const count of [2, 40]) {
                        const tabHTML = Array.from({length: count}, (_, index) =>
                            `<li class="b3-list-item"><span class="b3-list-item__text">Document ${index}</span></li>`).join("");
                        const content = new Function("dockHtml", "tabHtml", "isTabWindow", "return " + sources[4])(
                            isDetached ? "" : `<ul class="b3-list b3-list--background" style="width:200px">${tabHTML}</ul>`,
                            tabHTML, isDetached);
                        const switchDialog = new dialog.Dialog({title: lang.switchTab, content, disableAnimation: true});
                        const switchRoot = switchDialog.element as HTMLElement;
                        const switchContainer = switchRoot.querySelector<HTMLElement>(".b3-dialog__container");
                        const path = switchRoot.querySelector<HTMLElement>(".switch-doc__path");
                        path.textContent = "/Notebook/" + "Long document path/".repeat(30);
                        for (const width of [201, 680]) {
                            for (const height of ["auto", "560px"]) {
                                Object.assign(switchContainer.style, {width: width + "px", height});
                                const label = `${theme}/${lang.switchTab}/${fontSize}/${isDetached}/${count}/${width}/${height}`;
                                const pathRect = path.getBoundingClientRect();
                                const contentRect = switchRoot.querySelector(".switch-doc").getBoundingClientRect();
                                const style = getComputedStyle(path);
                                check.equal(style.padding, "4px 8px", "switch path padding: " + label);
                                // 1px 边框在非整数缩放下会被吸附到整设备像素，计算值可能为 0.666667px。
                                check.ok(Math.abs(parseFloat(style.borderTopWidth) - 1) < 0.5,
                                    "switch path border: " + label);
                                check.ok(Math.abs(pathRect.height - 27) < 1, "switch path height: " + label);
                                check.ok(Math.abs(pathRect.top - path.previousElementSibling.getBoundingClientRect().bottom) < 1,
                                    "switch path follows list: " + label);
                                check.ok(pathRect.left >= contentRect.left && pathRect.right <= contentRect.right,
                                    "switch path overflow: " + label);
                                cases++;
                            }
                        }
                        switchDialog.destroy();
                        await new Promise(resolve => setTimeout(resolve, 10));
                    }
                }
            }
        }
    }
    return cases;
};

test("recent documents controls fit resized dialogs without changing the shared tab switcher path", {
    skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
    timeout: 30000,
}, async () => {
    const sources = ["src/dialog/moveResize.ts", "src/dialog/index.ts", "src/business/clearRecentDocs.ts", "src/business/openRecentDocs.ts"]
        .map(file => transpileModule(readFileSync(file, "utf8"), {
            compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
        }).outputText);
    const keydown = createSourceFile("keydown.ts", readFileSync("src/boot/globalEvent/keydown.ts", "utf8"), ScriptTarget.Latest, true);
    const switchTemplates: string[] = [];
    const visit = (node: import("typescript").Node) => {
        if (isPropertyAssignment(node) && node.name.getText(keydown) === "content" &&
            node.initializer.getText(keydown).includes("switch-doc__path")) {
            switchTemplates.push(node.initializer.getText(keydown));
        }
        node.forEachChild(visit);
    };
    visit(keydown);
    assert.equal(switchTemplates.length, 1, "load the actual tab switcher template");
    sources.push(switchTemplates[0]);
    const css = compile("src/assets/scss/base.scss", {logger: {warn() {}, debug() {}}}).css;
    const languages = ["en", "zh-CN", "zh-TW", "ja"].map(lang => JSON.parse(readFileSync(`appearance/langs/${lang}.json`, "utf8")));
    const themes = Object.fromEntries(["daylight", "midnight"].map(theme => [theme, readFileSync(`appearance/themes/${theme}/theme.css`, "utf8")]));
    const temporaryRoot = realpathSync(tmpdir());
    const temporary = mkdtempSync(path.join(temporaryRoot, "siyuan-recent-docs-layout-"));
    const script = path.join(temporary, "run.cjs");
    writeFileSync(script, `const {app, BrowserWindow} = require("electron");
app.setPath("userData", ${JSON.stringify(path.join(temporary, "profile"))});
app.disableHardwareAcceleration();
app.whenReady().then(async () => {
    const win = new BrowserWindow({show: false, width: 1000, height: 800,
        webPreferences: {nodeIntegration: true, contextIsolation: false, backgroundThrottling: false}});
    try {
        await win.loadURL("about:blank");
        const result = await win.webContents.executeJavaScript(${JSON.stringify("const __name = value => value; (" + browserCases.toString() + ")(" +
            JSON.stringify(sources) + "," + JSON.stringify(css) + "," + JSON.stringify(languages) + "," + JSON.stringify(themes) + ")")});
        console.log(JSON.stringify({cases: result}));
        app.exit(0);
    } catch (error) {
        console.error(error);
        app.exit(1);
    }
});`, "utf8");
    const env = {...process.env};
    delete env.ELECTRON_RUN_AS_NODE;
    try {
        const result = await promisify(execFile)(require("electron"), [script], {env, windowsHide: true, timeout: 25000});
        assert.deepEqual(JSON.parse(result.stdout.trim().split("\n").at(-1)), {cases: 640});
    } finally {
        assert.equal(path.dirname(path.resolve(temporary)), temporaryRoot);
        assert.ok(path.basename(temporary).startsWith("siyuan-recent-docs-layout-"));
        rmSync(temporary, {recursive: true, force: true});
    }
});
