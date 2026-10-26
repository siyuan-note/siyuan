import * as assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import * as path from "node:path";
import {test} from "node:test";
import {promisify} from "node:util";
import {compile} from "sass";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

const browserCases = async (sources: string[], languages: typeof window.siyuan.languages) => {
    const check: typeof assert = require("node:assert/strict");
    const settle = () => new Promise(resolve => setTimeout(resolve, 40));
    const viewport = Object.assign(new EventTarget(), {offsetTop: 0, height: window.innerHeight});
    Object.defineProperty(window, "visualViewport", {configurable: true, value: viewport});
    window.requestAnimationFrame = callback => window.setTimeout(() => callback(performance.now()), 0);
    window.cancelAnimationFrame = id => window.clearTimeout(id);
    let mobile = false;
    let native = true;
    let clipboardReads = 0;
    let clipboard: () => string | undefined | Promise<string> = () => "pasted-secret";
    const messages: string[] = [];
    const writes: {namespace: string, items: {name: string, value: string, allowedHosts?: string[]}[]}[] = [];
    const dependencies: Record<string, unknown> = {
        isMobile: () => mobile,
        isInMobileApp: () => native,
        readText: () => { clipboardReads++; return clipboard(); },
        showMessage: (message: string) => messages.push(message),
        Constants: {TIMEOUT_OPENDIALOG: 0, TIMEOUT_DBLCLICK: 0, DIALOG_AIPROVIDER: "dialog-aiprovider"},
        genUUID: () => String(Math.random()),
        moveResize: () => {},
        getZIndex: () => 0,
        isAbove: () => false,
        destroyDialogBlockPanels: () => {},
        getDialogBlockPanel: (): undefined => undefined,
        getAnchoredInputMask: (): undefined => undefined,
    };
    Object.defineProperty(window, "siyuan", {configurable: true, writable: true, value: {
        config: {secrets: {items: []}, variables: {items: []}},
        dialogs: [], storage: {}, zIndex: 0, languages,
        menus: {menu: {element: document.createElement("div")}},
    }});
    for (const namespace of ["secrets", "variables"] as const) {
        dependencies[`${namespace}ConfigApi`] = {
            patch: (_key: string, items: Config.ISecret[], callback: () => void) => {
                writes.push({namespace, items});
                window.siyuan.config[namespace].items = items;
                callback();
            },
        };
    }
    for (const source of sources) {
        const exports = {};
        new Function("exports", "require", source)(exports, () => dependencies);
        Object.assign(dependencies, exports);
    }
    const ui = dependencies as unknown as typeof import("./secretsVariablesUi");
    const root = document.createElement("div");
    root.innerHTML = ui.genSecretsBlockHtml() + ui.genVariablesBlockHtml();
    document.body.append(root);
    ui.mountSecretsBlock(root);
    ui.mountVariablesBlock(root);
    const open = async (kind = "Secret") => {
        root.querySelector<HTMLElement>(`[data-type="add${kind}"]`).click();
        await settle();
        return window.siyuan.dialogs.at(-1);
    };
    const input = (element: HTMLElement, id: string) => element.querySelector<HTMLInputElement>(`#${id}`);
    const visible = (element: Element) => {
        const rect = element.getBoundingClientRect();
        const top = viewport.offsetTop;
        const bottom = Math.min(window.innerHeight, top + viewport.height);
        check.ok(rect.height > 0 && rect.top >= top - 1 && rect.bottom <= bottom + 1,
            `${element.id || element.className} must fit in ${top}..${bottom}, got ${rect.top}..${rect.bottom}`);
        check.ok(rect.width > 0 && rect.left >= 0 && rect.right <= window.innerWidth + 1,
            `${element.id || element.className} must fit horizontally`);
    };

    // 桌面保留密码显隐及保存行为，不绑定移动端视口，也不显示粘贴按钮。
    let dialog = await open();
    check.equal(dialog.element.querySelector('[data-action="pasteValue"]'), null);
    check.equal(dialog.element.querySelector<HTMLElement>(".b3-dialog").style.height, "");
    input(dialog.element, "itemName").value = "desktop-key";
    input(dialog.element, "itemValue").value = "desktop-secret";
    dialog.element.querySelector<HTMLElement>('[data-action="togglePassword"]').dispatchEvent(new MouseEvent("click"));
    check.equal(input(dialog.element, "itemValue").type, "text");
    dialog.element.querySelector<HTMLButtonElement>(".b3-button--text").click();
    await settle();
    check.equal(writes.at(-1).items[0].value, "desktop-secret");

    mobile = true;
    // 原生 App 和移动端浏览器都覆盖视觉视口缩小、平移和瞬时零高度。
    for (native of [true, false]) {
        const initialReads = clipboardReads;
        dialog = await open();
        const name = input(dialog.element, "itemName");
        const value = input(dialog.element, "itemValue");
        const hosts = input(dialog.element, "itemAllowedHosts");
        name.value = native ? "native-key" : "browser-key";
        hosts.value = "api.example.com, api.other.test";
        value.value = "draft-secret";
        value.focus();
        value.setSelectionRange(2, 5);
        let focusouts = 0;
        value.addEventListener("focusout", () => focusouts++);
        const overlay = dialog.element.querySelector<HTMLElement>(".b3-dialog");
        for (const height of [300, 220, 0, 340]) {
            viewport.height = height;
            viewport.dispatchEvent(new Event("resize"));
            await settle();
            check.equal(document.activeElement, value);
            check.equal(value.value, "draft-secret");
            check.equal(value.selectionStart, 2);
            check.equal(value.selectionEnd, 5);
            check.equal(focusouts, 0);
            if (height > 0) {
                visible(value);
                visible(dialog.element.querySelector(".b3-dialog__action"));
            }
        }
        viewport.offsetTop = 35;
        viewport.height = 240;
        viewport.dispatchEvent(new Event("scroll"));
        await settle();
        visible(value);
        // 切换字段也要滚动到当前输入框，不能依赖上一次点击时的延迟。
        for (const field of [name, hosts, value]) {
            field.focus();
            await settle();
            visible(field);
        }
        const paste = dialog.element.querySelector<HTMLButtonElement>('[data-action="pasteValue"]');
        visible(paste);
        check.equal(clipboardReads, initialReads, "opening and focusing must not read the clipboard");
        paste.click();
        await settle();
        check.equal(value.value, "pasted-secret");
        check.equal(value.type, "password", "pasting does not expose or focus a plaintext field");
        clipboard = () => "";
        paste.click();
        await settle();
        check.equal(value.value, "pasted-secret", "empty clipboard keeps the draft");
        clipboard = () => { throw new Error("clipboard rejected"); };
        paste.click();
        await settle();
        check.equal(messages.at(-1), languages.clipboardPermissionDenied);
        check.equal(paste.disabled, false);
        check.equal(value.value, "pasted-secret");
        clipboard = () => undefined;
        paste.click();
        await settle();
        check.equal(messages.at(-1), languages.clipboardPermissionDenied);
        dialog.element.querySelector<HTMLButtonElement>(".b3-button--text").click();
        await settle();
        check.equal(writes.at(-1).namespace, "secrets");
        check.deepEqual(writes.at(-1).items.at(-1), {
            name: native ? "native-key" : "browser-key", value: "pasted-secret",
            allowedHosts: ["api.example.com", "api.other.test"],
        });
        viewport.height = window.innerHeight;
        viewport.offsetTop = 0;
        viewport.dispatchEvent(new Event("resize"));
        await settle();
        check.equal(overlay.style.height, "240px", "closing releases viewport listeners");
        clipboard = () => "pasted-secret";
    }

    // 关闭时仍在读取剪贴板的结果不能写回草稿或触发保存。
    dialog = await open();
    let finishRead: (value: string) => void;
    clipboard = () => new Promise(resolve => { finishRead = resolve; });
    const paste = dialog.element.querySelector<HTMLButtonElement>('[data-action="pasteValue"]');
    const draft = input(dialog.element, "itemValue");
    draft.value = "keep-draft";
    const writeCount = writes.length;
    paste.click();
    check.equal(paste.disabled, true);
    const pendingReads = clipboardReads;
    paste.click();
    check.equal(clipboardReads, pendingReads, "pending reads cannot be started twice");
    dialog.destroy();
    finishRead("late-secret");
    await settle();
    check.equal(draft.value, "keep-draft");
    check.equal(writes.length, writeCount);

    // 没有 VisualViewport 时仍跟随窗口缩放；变量保持文本输入和原保存格式。
    Object.defineProperty(window, "visualViewport", {configurable: true, value: undefined});
    dialog = await open("Variable");
    check.equal(dialog.element.querySelector('[data-action="pasteValue"]'), null);
    const variable = input(dialog.element, "itemValue");
    check.equal(variable.type, "text");
    variable.value = "variable-draft";
    variable.focus();
    input(dialog.element, "itemName").value = "variable-name";
    const initialHeight = window.innerHeight;
    const initialHeightDescriptor = Object.getOwnPropertyDescriptor(window, "innerHeight");
    Object.defineProperty(window, "innerHeight", {configurable: true, value: 220});
    window.dispatchEvent(new Event("resize"));
    await settle();
    check.equal(dialog.element.querySelector<HTMLElement>(".b3-dialog").style.height, "220px");
    check.ok(variable.getBoundingClientRect().bottom <= 220);
    Object.defineProperty(window, "innerHeight", {configurable: true, value: initialHeight});
    window.dispatchEvent(new Event("resize"));
    await settle();
    dialog.element.querySelector<HTMLButtonElement>(".b3-button--text").click();
    await settle();
    check.deepEqual(writes.at(-1), {namespace: "variables", items: [{name: "variable-name", value: "variable-draft"}]});
    root.remove();
    Object.defineProperty(window, "innerHeight", initialHeightDescriptor);
    check.equal(window.siyuan.dialogs.length, 0);
    return "Secrets and variables input cases passed";
};

test("secrets and variables dialogs preserve input through keyboard resizing and explicit secret paste", {
    skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
    timeout: 45000,
}, async () => {
    const sources = ["util/escape", "config/render/fragments", "mobile/util/visibleViewport", "dialog/index", "config/tabs/secretsVariablesUi"]
        .map(id => transpileModule(readFileSync(path.resolve("src", id + ".ts"), "utf8"), {
            compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2022},
        }).outputText);
    const languages = JSON.parse(readFileSync("appearance/langs/zh-CN.json", "utf8"));
    const css = compile("src/assets/scss/mobile.scss", {logger: {warn() {}}}).css;
    const temporary = mkdtempSync(path.join(tmpdir(), "siyuan-secrets-input-test-"));
    const script = path.join(temporary, "run.cjs");
    writeFileSync(script, `const {app, BrowserWindow} = require("electron");
app.setPath("userData", ${JSON.stringify(path.join(temporary, "profile"))});
app.commandLine.appendSwitch("disable-gpu");
app.whenReady().then(async () => {
    const win = new BrowserWindow({show: false, width: 390, height: 844,
        webPreferences: {nodeIntegration: true, contextIsolation: false, backgroundThrottling: false}});
    try {
        await win.loadURL("about:blank");
        await win.webContents.insertCSS(${JSON.stringify(css)});
        for (const [theme, width, height, fontSize] of [["daylight", 390, 844, 16], ["midnight", 320, 640, 20], ["daylight", 640, 390, 16]]) {
            win.setSize(width, height);
            await win.webContents.insertCSS(require("node:fs").readFileSync(${JSON.stringify(path.resolve("appearance/themes"))} + "/" + theme + "/theme.css", "utf8"));
            await win.webContents.insertCSS("body {font-size:" + fontSize + "px} .b3-dialog__container {transition:none}");
            console.log(await win.webContents.executeJavaScript(${JSON.stringify(
        `var __name = value => value; (${browserCases.toString()})(${JSON.stringify(sources)}, ${JSON.stringify(languages)})`)}));
        }
        win.destroy(); app.exit(0);
    } catch (error) { console.error(error); win.destroy(); app.exit(1); }
});`, "utf8");
    const env = {...process.env};
    delete env.ELECTRON_RUN_AS_NODE;
    try {
        const {stdout} = await promisify(execFile)(require("electron") as unknown as string, [script],
            {env, timeout: 40000, windowsHide: true});
        assert.equal(stdout.match(/Secrets and variables input cases passed/g)?.length, 3);
    } finally {
        assert.equal(path.dirname(path.resolve(temporary)), path.resolve(tmpdir()));
        assert.ok(path.basename(temporary).startsWith("siyuan-secrets-input-test-"));
        rmSync(temporary, {recursive: true, force: true});
    }
});
