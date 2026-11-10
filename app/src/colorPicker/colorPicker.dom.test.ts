import * as assert from "node:assert/strict";
import test from "node:test";
import {execFile} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join, resolve, dirname} from "node:path";
import {promisify} from "node:util";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";
import {compile} from "sass";

const browserCases = async (sources: Record<string, string>, css: string, theme: string) => {
    const check: typeof assert = require("node:assert/strict");
    const style = document.createElement("style");
    style.textContent = theme + css;
    document.head.append(style);
    const languages = {color: "Color", originalValue: "Original", new: "Draft", cancel: "Cancel", confirm: "Apply",
        themeLight: "Light", themeDark: "Dark", colorFont: "Text", colorPrimary: "Background",
        invalidColor: "Invalid HEX or RGB", colorPickerComposing: "Finish composing", nativeColorUnavailable: "Use numeric inputs"};
    const modules: Record<string, any> = {};
    const load = (name: string, deps: Record<string, unknown> = {}) => {
        const exports = {};
        new Function("exports", "require", sources[name])(exports, (path: string) => {
            const key = path.split("/").at(-1);
            return modules[key] || deps;
        });
        modules[name] = exports;
        return exports as any;
    };
    let uuid = 0;
    const menu = document.createElement("div");
    document.body.append(menu);
    (window as any).siyuan = {dialogs: [], zIndex: 10, config: {}, languages,
        menus: {menu: {element: menu, remove() {}}}};
    const dialogDeps = {genUUID: () => String(++uuid), getZIndex: () => 0, isAbove: () => false,
        isMobile: () => false, isNotCtrl: () => true, moveResize() {}, Constants: {TIMEOUT_OPENDIALOG: 0},
        destroyDialogBlockPanels() {}, getDialogBlockPanel() {}, getAnchoredInputMask() {}};
    const {Dialog} = load("dialog", dialogDeps);
    ["model", "session", "native", "field", "runtime", "owners"].forEach(name => load(name));
    modules.panel = {registerColorPickerWindow() {}};
    const api = load("index");
    const {registerColorPickerRuntime} = modules.runtime;
    registerColorPickerRuntime(document, (options: unknown) => new Dialog(options), () => languages);
    const makeOwner = () => { const button = document.createElement("button"); document.body.append(button); return button; };
    const owner = makeOwner();
    const plugin = {};
    modules.owners.registerColorPickerOwner(plugin);
    const open = (extra: Record<string, unknown> = {}) => api.openColorPicker({value: "#123456", ownerPlugin: plugin, ownerElement: owner, ...extra});
    const current = () => (window as any).siyuan.dialogs.at(-1).element as HTMLElement;
    const edit = (input: HTMLInputElement, value: string) => { input.value = value; input.dispatchEvent(new Event("input", {bubbles: true})); };
    const tick = () => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));

    const host = document.createElement("div"); document.body.append(host);
    const previews: string[] = [];
    const field = modules.field.createColorField(host, {value: "#abc", label: "Test", languages,
        onPreview: (value: {hex: string}) => previews.push(value.hex)});
    const inputs = host.querySelectorAll<HTMLInputElement>('input[type="text"]');
    const hex = inputs[0];
    edit(hex, "#12f"); check.equal(hex.value, "#12f");
    edit(hex, "#12fa45"); check.equal(hex.value, "#12fa45");
    edit(hex, "#12"); check.equal(field.commitDraft().ok, false); check.equal(field.getValue().hex, "#12fa45");
    hex.dispatchEvent(new CompositionEvent("compositionstart"));
    edit(hex, "uncommitted");
    const native = host.querySelector<HTMLInputElement>('input[type="color"]');
    edit(native, "#ffffff"); native.dispatchEvent(new Event("change"));
    check.equal(hex.value, "uncommitted"); check.equal(field.validate(), "composing");
    hex.value = "#111"; hex.dispatchEvent(new CompositionEvent("compositionend"));
    check.equal(field.getValue().hex, "#111111"); check.equal(hex.value, "#111");
    check.equal(field.commitDraft().value.hex, "#111111"); check.equal(hex.value, "#111111");
    edit(inputs[1], ""); check.equal(field.commitDraft().ok, false);
    field.setEnabled(false); check.equal(field.validate(), "valid");
    field.setEnabled(true); field.setValue("#222222");
    edit(native, "#000000"); check.equal(field.getValue().hex, "#222222");
    const replacement = host.querySelector<HTMLInputElement>('input[type="color"]');
    edit(hex, "#unfinished"); edit(replacement, "#222222");
    check.equal(field.validate(), "valid", "a native source can clear invalid text even when its color bytes are unchanged");
    const count = previews.length;
    edit(replacement, "#ffffff"); replacement.dispatchEvent(new Event("change"));
    check.equal(previews.length, count + 1);
    field.destroy(); edit(replacement, "#000000"); check.equal(previews.length, count + 1);

    const themeEditor = load("themeColorEditor");
    const themeHost = document.createElement("div"); themeHost.innerHTML = themeEditor.getThemeColorEditorHTML(); document.body.append(themeHost);
    const colors = themeEditor.bindThemeColorEditor(themeHost);
    const themeInputs = themeHost.querySelectorAll<HTMLInputElement>('[data-field] input[type="text"]');
    edit(themeInputs[0], "#123"); edit(themeInputs[12], "#invalid");
    check.equal(colors.commitDraft("style1"), undefined);
    check.equal(themeInputs[0].value, "#123", "failed parent confirmation must not normalize other fields");
    colors.setEnabled("backgroundColor", false);
    check.equal(colors.commitDraft("style1").light.color, "#112233");
    colors.setEnabled("backgroundColor", true);
    colors.setValue({light: {color: "#abcdef", backgroundColor: "#112233"}, dark: {color: "#445566", backgroundColor: "#778899"}});
    check.equal(colors.commitDraft("style1").dark.backgroundColor, "#778899");
    colors.destroy(); themeHost.remove();

    let ended = 0;
    let notified = 0;
    const first = open({title: "<img src=x onerror=alert(1)>", onPreview: () => { notified++; }, onPreviewEnd: () => { ended++; }});
    check.equal(current().querySelector(".b3-dialog__header").textContent, "<img src=x onerror=alert(1)>");
    check.equal(current().querySelector(".b3-dialog__header img"), null);
    const firstRoot = current();
    check.equal(document.activeElement.tagName, "DIV", "opening does not focus an input");
    const firstNative = firstRoot.querySelector<HTMLInputElement>('input[type="color"]');
    edit(firstNative, "#abcdef"); firstNative.dispatchEvent(new Event("change"));
    await tick(); check.equal(notified, 1);
    check.throws(() => open({value: "invalid"}), /Invalid/);
    check.equal(firstRoot.dataset.dialogClosing, undefined);
    firstRoot.dispatchEvent(new KeyboardEvent("keydown", {key: "Escape", bubbles: true}));
    check.deepEqual(await first.result, {type: "cancel", reason: "escape"});
    edit(firstNative, "#000000"); await tick(); check.equal(notified, 1); check.equal(ended, 1);

    let latest: {result: Promise<unknown>; destroy(): void};
    const previous = open({onPreviewEnd: () => { latest = open(); }});
    const superseded = open();
    check.deepEqual(await previous.result, {type: "cancel", reason: "replaced"});
    check.deepEqual(await superseded.result, {type: "cancel", reason: "replaced"});
    latest.destroy(); check.deepEqual(await latest.result, {type: "cancel", reason: "destroy"});

    const unchanged = open({value: "#ABC"});
    const unchangedRoot = current();
    for (const width of [320, 360, 800]) {
        document.body.style.width = `${width}px`;
        const container = unchangedRoot.querySelector<HTMLElement>(".b3-dialog__container");
        container.style.maxWidth = `${width - 24}px`;
        const content = unchangedRoot.querySelector<HTMLElement>(".b3-dialog__content");
        check.ok(content.scrollWidth <= content.clientWidth + 1, `no horizontal clipping at ${width}: ${content.scrollWidth}/${content.clientWidth}`);
    }
    unchangedRoot.querySelector<HTMLButtonElement>(".b3-dialog__action .b3-button:last-child").click();
    const confirmed = await unchanged.result;
    check.equal(confirmed.type, "confirm"); check.equal(confirmed.changed, false); check.equal(confirmed.value.hex, "#aabbcc");

    const doomed = {};
    modules.owners.registerColorPickerOwner(doomed);
    const replacedOwner = open({onPreviewEnd: () => modules.owners.cancelPluginColorPickers(doomed)});
    const rejectedOwner = open({ownerPlugin: doomed});
    check.deepEqual(await replacedOwner.result, {type: "cancel", reason: "replaced"});
    check.deepEqual(await rejectedOwner.result, {type: "cancel", reason: "owner-destroyed"});

    const frame = document.createElement("iframe"); document.body.append(frame);
    const targetDoc = frame.contentDocument;
    const targetView = frame.contentWindow as Window & typeof globalThis;
    const foreignOwner = targetDoc.createElement("button"); targetDoc.body.append(foreignOwner);
    check.throws(() => api.openInternalColorPicker({value: "#fff", ownerElement: foreignOwner}), /ready SiYuan/);
    const targetMenu = targetDoc.createElement("div"); targetDoc.body.append(targetMenu);
    (targetView as any).siyuan = {dialogs: [], zIndex: 10, config: {}, languages,
        menus: {menu: {element: targetMenu, remove() {}}}};
    const targetExports: any = {};
    new targetView.Function("exports", "require", sources.dialog)(targetExports, () => dialogDeps);
    registerColorPickerRuntime(targetDoc, (options: unknown) => new targetExports.Dialog(options), () => languages);
    const mainSession = open(); const mainRoot = current();
    const targetSession = open({ownerElement: foreignOwner});
    const targetRoot = (targetView as any).siyuan.dialogs.at(-1).element as HTMLElement;
    check.equal(targetRoot.ownerDocument, targetDoc);
    check.equal(mainRoot.dataset.dialogClosing, undefined, "target documents have independent sessions");
    document.body.append(foreignOwner); await tick();
    check.deepEqual(await targetSession.result, {type: "cancel", reason: "owner-destroyed"});
    mainSession.destroy(); await mainSession.result;
    const hiddenPage = open(); window.dispatchEvent(new Event("pagehide"));
    check.deepEqual(await hiddenPage.result, {type: "cancel", reason: "owner-destroyed"});

    const detached = makeOwner();
    const owned = open({ownerElement: detached});
    detached.remove(); await tick();
    check.deepEqual(await owned.result, {type: "cancel", reason: "owner-destroyed"});
    const active = open();
    modules.owners.cancelPluginColorPickers(plugin);
    check.deepEqual(await active.result, {type: "cancel", reason: "owner-destroyed"});
    check.throws(() => open(), /live Plugin/);
    return "Color field and lifecycle passed";
};

test("real color fields retain drafts, isolate native events and obey dialog and plugin lifetimes", {
    timeout: 45000, skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
}, async () => {
    const sources = Object.fromEntries(["model", "session", "native", "field", "runtime", "owners", "index", "dialog", "themeColorEditor"].map(name => [name,
        transpileModule(readFileSync(name === "dialog" ? join(__dirname, "../dialog/index.ts") : name === "themeColorEditor" ?
            join(__dirname, "../dialog/themeColorEditor.ts") : join(__dirname, name + ".ts"), "utf8"), {
            compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
        }).outputText]));
    const css = compile(join(__dirname, "../assets/scss/base.scss"), {logger: {warn() {}}}).css;
    const theme = readFileSync(join(__dirname, "../../appearance/themes/daylight/theme.css"), "utf8");
    const temporary = mkdtempSync(join(tmpdir(), "siyuan-color-picker-"));
    const script = join(temporary, "run.cjs");
    const expression = `const __name = value => value; (${browserCases.toString()})(${JSON.stringify(sources)},${JSON.stringify(css)},${JSON.stringify(theme)})`;
    writeFileSync(script, `const {app,BrowserWindow}=require("electron");
app.setPath("userData",${JSON.stringify(join(temporary, "profile"))});
app.commandLine.appendSwitch("disable-gpu");
app.whenReady().then(async()=>{const win=new BrowserWindow({show:false,width:900,height:900,webPreferences:{nodeIntegration:true,contextIsolation:false}});
try{await win.loadURL("data:text/html,<html><body></body></html>");console.log(await win.webContents.executeJavaScript(${JSON.stringify(expression)}));app.exit(0);}
catch(error){console.error(error);app.exit(1);}});`, "utf8");
    const env = {...process.env}; delete env.ELECTRON_RUN_AS_NODE;
    try {
        const result = await promisify(execFile)(require("electron"), [script], {env, timeout: 35000, windowsHide: true});
        assert.match(result.stdout, /Color field and lifecycle passed/);
    } finally {
        assert.equal(dirname(resolve(temporary)), resolve(tmpdir()));
        rmSync(temporary, {recursive: true, force: true});
    }
});
