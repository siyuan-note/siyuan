import * as assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import * as path from "node:path";
import {test} from "node:test";
import {promisify} from "node:util";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

const {parse} = require("ifdef-loader/preprocessor");

const browserCases = (sources: Record<string, string>, languages: Record<string, string>, mobile: boolean) => {
    const check = (condition: unknown, message: string) => { if (!condition) throw new Error(message); };
    const custom: Config.IEntryVisibilityProfile = {id: "custom", name: "Custom", entries: {}, orders: {}};
    window.siyuan = {languages, config: {readonly: false, appearance: {entryVisibility: {
        version: 7, active: "custom", profiles: [custom],
    }}, keymap: {editor: {general: {exitFocus: {custom: "Escape"}}}}}} as unknown as typeof window.siyuan;
    const cache: Record<string, Record<string, any>> = {};
    const load = (id: string): Record<string, any> => {
        if (cache[id]) return cache[id];
        const exports = {};
        cache[id] = exports;
        const resolve = (relative: string) => {
            const parts = id.split("/").slice(0, -1);
            relative.split("/").forEach(part => {
                if (part === "..") parts.pop();
                else if (part !== ".") parts.push(part);
            });
            return parts.join("/");
        };
        const require = (relative: string) => {
            const name = resolve(relative);
            if (sources[name]) return load(name);
            if (id === "protyle/breadcrumb/index") {
                return {isMobile: () => mobile, isIPad: () => !mobile, isInAndroid: () => false,
                    isInHarmony: () => false, isMac: () => false, updateHotkeyTip: (s: string) => s,
                    bindMobileMenuKeyboard: () => (): undefined => undefined};
            }
            if (name === "config/entryVisibility/dockOrder") return {
                isDockOrderScope: () => false, getDockEntryOrderSnapshot: () => ({}),
                getDefaultDockEntryOrderSnapshot: () => ({}), mergeDockEntryOrderSnapshot: () => ({}),
                applyDockEntryOrderSnapshot() {},
            };
            if (name === "config/setting/windowContext") return {getSettingsOwnerApp: (): undefined => undefined};
            if (name === "layout/dock/barVisibility") return {syncDockBarVisibility() {}};
            // Other editor actions are not invoked by these button lifecycle cases.
            return {};
        };
        new Function("exports", "require", sources[id])(exports, require);
        return exports;
    };
    const runtime = load("config/entryVisibility/runtime");
    const buttons = load("plugin/breadcrumbButton");
    const registry = load("plugin/breadcrumbButtonRegistry");
    const {Breadcrumb} = load("protyle/breadcrumb/index");
    const keyA = registry.getPluginBreadcrumbEntryKey("plugin.a", "same.id");
    const keyB = registry.getPluginBreadcrumbEntryKey("plugin.b", "same.id");
    const root = "editor.breadcrumb";
    const calls: Array<{protyle: IProtyle, event: MouseEvent, version: number}> = [];
    const options = (version: number) => ({id: "same.id", icon: "iconFile", title: `Button ${version}`,
        callback: (event: MouseEvent, protyle: IProtyle) => calls.push({event, protyle, version})});
    buttons.addBreadcrumbButton("plugin.a", options(1));
    buttons.addBreadcrumbButton("plugin.b", options(1));
    const create = () => {
        const protyle = {wysiwyg: {element: document.createElement("div")}} as IProtyle;
        protyle.breadcrumb = new Breadcrumb(protyle);
        const element = protyle.breadcrumb.element.parentElement;
        document.body.append(element);
        const actions = element.querySelector<HTMLElement>(".protyle-breadcrumb__actions");
        return {protyle, element, actions};
    };
    const first = create();
    const entries = (actions: HTMLElement) => Array.from(actions.querySelectorAll<HTMLElement>("[data-breadcrumb-entry]"));
    const keys = (actions: HTMLElement) => entries(actions).map(item => item.dataset.breadcrumbEntry);
    const find = (actions: HTMLElement, key: string) => entries(actions).find(item => item.dataset.breadcrumbEntry === key);
    const defaultKeys = keys(first.actions);
    check(defaultKeys.join() === [keyA, keyB, ...(!mobile ? ["undo", "redo", "outdent", "indent"] : ["command-panel"]),
        "readonly", "doc", "more"].join(), "Existing layout and plugin registration order must be preserved");
    const second = create();
    custom.orders[root] = ["more", keyB, "doc", keyA, "readonly", "command-panel", "indent", "outdent", "redo", "undo",
        "plugin:unavailable:button"];
    custom.entries[`${root}.${keyA}`] = false;
    custom.entries[`${root}.readonly`] = false;
    if (mobile) custom.entries[`${root}.command-panel`] = false;
    const saved = JSON.stringify(custom);
    runtime.applyEntryVisibility(window.siyuan.config.appearance.entryVisibility);
    const expected = custom.orders[root].filter(key => defaultKeys.includes(key));
    for (const editor of [first, second]) {
        check(keys(editor.actions).join() === expected.join(), "Every existing editor must apply mixed plugin and built-in order");
        check(getComputedStyle(find(editor.actions, keyA)).display === "none", "Configured plugin must be hidden");
        const readonly = find(editor.actions, "readonly");
        readonly.classList.add("fn__none");
        readonly.classList.remove("fn__none");
        check(getComputedStyle(readonly).display === "none", "Business state updates must not reveal configured-hidden buttons");
        editor.protyle.breadcrumb.toggleExit(false);
        check(getComputedStyle(editor.actions.querySelector('[data-type="exit-focus"]')).display !== "none",
            "Exit focus must keep its existing state control");
        check(editor.element.querySelector('[data-type="context"]').classList.contains("fn__none"),
            "Applying profiles must preserve hidden context state");
        check(editor.element.lastElementChild === editor.element.querySelector('[data-type="context"]'),
            "Block panels must still find the context button at the end of the breadcrumb");
        if (mobile) check(getComputedStyle(find(editor.actions, "command-panel")).display === "none",
            "Mobile command panel must honor the profile");
    }
    const originalButton = find(first.actions, keyA);
    buttons.addBreadcrumbButton("plugin.a", options(2));
    check(find(first.actions, keyA) === originalButton, "Updating a registration must reuse the button");
    check(originalButton.getAttribute("aria-label") === "Button 2", "Updating a registration must refresh its label");
    check(getComputedStyle(originalButton).display === "none", "Updating a hidden plugin must preserve its preference");
    find(first.actions, keyB).click();
    find(second.actions, keyB).click();
    check(calls.length === 2 && calls[0].protyle === first.protyle && calls[1].protyle === second.protyle &&
        calls[0].event instanceof MouseEvent, "Callbacks must receive the clicked editor and event");
    buttons.removeBreadcrumbButtons("plugin.a");
    check(!find(first.actions, keyA) && !find(second.actions, keyA), "Unloading a plugin must remove all of its buttons");
    check(JSON.stringify(custom) === saved, "Unloading must preserve unavailable plugin preferences and order slots");
    buttons.addBreadcrumbButton("plugin.a", options(3));
    check(keys(first.actions).join() === expected.join(), "Re-registering must restore mixed order");
    check(getComputedStyle(find(first.actions, keyA)).display === "none", "Re-registering must restore hidden preference");
    buttons.unmountBreadcrumbButtons(second.protyle);
    second.element.remove();
    const disposedHTML = second.actions.innerHTML;
    buttons.addBreadcrumbButton("plugin.a", options(4));
    check(second.actions.innerHTML === disposedHTML, "Disposed editors must stop receiving registry updates");
    const third = create();
    check(keys(third.actions).join() === expected.join() && getComputedStyle(find(third.actions, keyA)).display === "none",
        "New editors must inherit the current profile");
    window.siyuan.config.appearance.entryVisibility.active = "full";
    runtime.applyEntryVisibility(window.siyuan.config.appearance.entryVisibility);
    check(getComputedStyle(find(first.actions, keyA)).display !== "none", "Switching profiles must restore visible entries");
    // Re-added plugin groups retain registry order in the Full profile.
    check(keys(first.actions).slice(0, 2).join() === [keyB, keyA].join(), "Full profile must follow current plugin registration order");
    check(JSON.stringify(custom) === saved, "Profile application must never rewrite custom preferences");
    window.siyuan.config.readonly = true;
    const readonlyEditor = create();
    runtime.applyEntryVisibility(window.siyuan.config.appearance.entryVisibility);
    check(getComputedStyle(find(readonlyEditor.actions, "readonly")).display === "none",
        "Full profile must not expose a button unavailable in global readonly mode");
    if (!mobile) {
        const path = first.protyle.breadcrumb.element;
        path.innerHTML = '<span class="protyle-breadcrumb__item"><span class="protyle-breadcrumb__text">' +
            "Long breadcrumb path ".repeat(60) + "</span></span>";
        const available = first.element.clientWidth;
        check(first.actions.clientWidth >= Math.min(first.actions.scrollWidth, available / 2),
            `Long paths must leave buttons accessible: ${first.actions.clientWidth}/${first.actions.scrollWidth}/${available}`);
    }
    for (const editor of [first, third, readonlyEditor]) buttons.unmountBreadcrumbButtons(editor.protyle);
    buttons.removeBreadcrumbButtons("plugin.a");
    buttons.removeBreadcrumbButtons("plugin.b");
    return "Breadcrumb lifecycle passed";
};

for (const mobile of [false, true]) {
    test(`${mobile ? "mobile" : "desktop tablet"} breadcrumb lifecycle applies profiles in real DOM`, {
        skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
        timeout: 60000,
    }, async () => {
        const modules = ["plugin/breadcrumbButton", "plugin/breadcrumbButtonRegistry", "protyle/breadcrumb/index",
            "config/entryVisibility/runtime", "config/entryVisibility/catalog", "config/entryVisibility/order",
            "config/entryVisibility/profile", "config/entryVisibility/mobileToolbarContext", "protyle/toolbar/defaults",
            "mobile/util/toolbarActions", "protyle/wysiwyg/codeBlockUtil", "protyle/gutter/turnIntoMenu",
            "protyle/wysiwyg/calloutType", "plugin/dockKey", "plugin/topBarKey", "util/escape",
            "menus/declarations/imageOCRMenu", "menus/declarations/menuDeclaration"];
        const sources = Object.fromEntries(modules.map(id => [id, transpileModule(parse(
            readFileSync(path.join("src", id + ".ts"), "utf8"), {MOBILE: mobile, BROWSER: true}, false, true), {
            compilerOptions: {target: ScriptTarget.ES2021, module: ModuleKind.CommonJS},
        }).outputText]));
        const temporary = mkdtempSync(path.join(tmpdir(), "siyuan-breadcrumb-test-"));
        const script = path.join(temporary, "run.cjs");
        const languages = JSON.parse(readFileSync("appearance/langs/en.json", "utf8"));
        const code = `const __name = value => value; (() => { try {
            return (${browserCases.toString()})(${JSON.stringify(sources)},${JSON.stringify(languages)},${mobile});
        } catch (error) { return {error: error.stack || String(error)}; } })()`;
        writeFileSync(script, `const {app, BrowserWindow} = require("electron");
app.setPath("userData", ${JSON.stringify(path.join(temporary, "profile"))});
app.commandLine.appendSwitch("disable-gpu");
app.whenReady().then(async () => {
    const win = new BrowserWindow({show: false, width: 500, height: 700, webPreferences: {offscreen: true}});
    try {
        await win.loadURL("data:text/html,<html><body></body></html>");
        await win.webContents.insertCSS(require(${JSON.stringify(require.resolve("sass"))}).compile(${JSON.stringify(path.resolve("src/assets/scss", mobile ? "mobile.scss" : "base.scss"))}, {logger: {warn() {}}}).css);
        const result = await win.webContents.executeJavaScript(${JSON.stringify(code)});
        if (result.error) throw new Error(result.error);
        console.log(result);
        win.destroy(); app.exit(0);
    } catch (error) { console.error(error); win.destroy(); app.exit(1); }
});`, "utf8");
        const env = {...process.env};
        delete env.ELECTRON_RUN_AS_NODE;
        try {
            const result = await promisify(execFile)(require("electron") as unknown as string, [script],
                {env, timeout: 45000, windowsHide: true});
            assert.match(result.stdout, /Breadcrumb lifecycle passed/);
        } finally {
            if (path.dirname(path.resolve(temporary)) === path.resolve(tmpdir()) &&
                path.basename(temporary).startsWith("siyuan-breadcrumb-test-")) rmSync(temporary, {recursive: true, force: true});
        }
    });
}
