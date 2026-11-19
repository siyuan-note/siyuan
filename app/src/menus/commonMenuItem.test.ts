import * as dockKeymap from "../util/dockKeymap";
import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import * as path from "node:path";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";
import * as escape from "../util/escape";
import * as mergePathSegments from "../util/mergePathSegments";
import * as imageURL from "../util/imageURL";
import * as pdfAssetLink from "../editor/pdfAssetLink";
import * as assetOpen from "../editor/assetOpen";
import * as keymapBindings from "../util/keymapBindings";
import {formatShortcut} from "../util/shortcut";

type Flags = {MOBILE: boolean; BROWSER: boolean};

const compile = (file: string, flags: Flags) => transpileModule(require("ifdef-loader/preprocessor").parse(
    readFileSync(file, "utf8"), flags, false, true), {
    compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
}).outputText;

const loadOpenMenu = (flags: Flags, markdownAvailable = false, mac = false) => {
    const calls: Array<{name: string; args: unknown[]}> = [];
    const exportConfig: {headingNumber?: boolean} = {};
    const folderKeymap: keymapBindings.IShortcutKeymap = {custom: "⌥A"};
    const editor = {assetOpen: {...assetOpen.DEFAULT_ASSET_OPEN}};
    const window = {siyuan: {config: {editor, fileTree: {}, export: exportConfig,
        keymap: {editor: {general: {showInFolder: folderKeymap}}}}, languages: {click: "click"}}};
    // 未显式提供的依赖统一替换为记录调用的空函数
    const recorder = new Proxy({}, {
        get: (_target, name) => typeof name === "string" && name !== "__esModule" ?
            (...args: unknown[]) => {
                calls.push({name, args});
                return name === "getHostCapabilities" ? {localFileSystem: true} : undefined;
            } : undefined,
    });
    const load = (file: string, modules: Record<string, unknown> = {}) => {
        const exports: Record<string, any> = {};
        runInNewContext(compile(file, flags), {exports, window, navigator: {userAgent: ""},
            SIYUAN_VERSION: "dev", NODE_ENV: "development", URL, URLSearchParams,
            require: (id: string) => modules[id] ?? (id === "path" ? path : recorder)});
        return exports;
    };
    const pathName = load("src/util/pathName.ts", {"./mergePathSegments": mergePathSegments, "./escape": escape});
    const constants = load("src/constants.ts", {"./util/dockKeymap": dockKeymap});
    const menu = load("src/menus/commonMenuItem.ts", {
        "../util/pathName": pathName,
        "../constants": constants,
        "../util/imageURL": imageURL,
        "../editor/pdfAssetLink": pdfAssetLink,
        "../editor/assetOpen": assetOpen,
        "../util/keymapBindings": keymapBindings,
        "../protyle/util/compatibility": new Proxy(recorder, {
            get: (target, name) => name === "updateHotkeyTip" ?
                (value: string) => formatShortcut(value, mac) : Reflect.get(target, name),
        }),
        "../util/fetch": {fetchSyncPost: async (...args: unknown[]) => {
            calls.push({name: "fetchSyncPost", args});
            return {code: 0, data: {content: "Markdown"}};
        }},
        "../editor/markdownAsset": {canOpenMarkdownAsset: () => markdownAvailable,
            openMarkdownAsset: (...args: unknown[]) => calls.push({name: "openMarkdownAsset", args})},
    });
    return {openMenu: menu.openMenu, copySubMenu: menu.copySubMenu, calls, folderKeymap, editor,
        setHeadingNumberChoice: (value: boolean | undefined) => { exportConfig.headingNumber = value; }};
};

const app = {};

test("asset folder menus show keyboard bindings together with click gestures", () => {
    const {openMenu, folderKeymap, editor, calls} = loadOpenMenu({MOBILE: false, BROWSER: false});
    const folder = (src = "assets/document.pdf", show = true) =>
        openMenu(app, src, true, show).find((item: IMenu) => item.id === "showInFolder");
    for (const src of ["assets/document.pdf", "assets/archive.zip"]) {
        assert.equal(folder(src).accelerator, "Alt+A / Ctrl+click");
        folder(src).click();
        assert.deepEqual(calls.at(-1), {name: "openBy", args: [src, "folder"]});
    }
    keymapBindings.setKeymapBindings(folderKeymap, ["⌘⇧F", "⌥B"]);
    assert.equal(folder().accelerator, "Ctrl+Shift+F / Alt+B / Ctrl+click");
    assert.equal(folder("file:///tmp/document.pdf").accelerator, "Ctrl+Shift+F / Alt+B");
    editor.assetOpen.ctrlClick = "current";
    assert.equal(folder().accelerator, "Ctrl+Shift+F / Alt+B");
    keymapBindings.setKeymapBindings(folderKeymap, []);
    assert.equal(folder().accelerator, "");
    editor.assetOpen.ctrlClick = "folder";
    assert.equal(folder().accelerator, "Ctrl+click");
    assert.equal(folder("assets/document.pdf", false).accelerator, "");
});

test("browser and mobile asset menus do not advertise desktop folder shortcuts", () => {
    for (const flags of [{MOBILE: false, BROWSER: true}, {MOBILE: true, BROWSER: true}]) {
        const {openMenu} = loadOpenMenu(flags);
        const items = openMenu(app, "assets/document.pdf", true, true);
        assert.equal(items.some((item: IMenu) => item.id === "showInFolder"), false);
        assert.equal(items.some((item: IMenu) => item.accelerator?.includes("Alt+A")), false);
    }
});

test("macOS folder menus preserve native shortcut symbols", () => {
    const {openMenu, folderKeymap} = loadOpenMenu({MOBILE: false, BROWSER: false}, false, true);
    keymapBindings.setKeymapBindings(folderKeymap, ["⌥A", "⌘⇧F"]);
    const item = openMenu(app, "assets/document.pdf", true, true)
        .find((entry: IMenu) => entry.id === "showInFolder");
    assert.equal(item.accelerator, "⌥A / ⌘⇧F / ⌘click");
});

for (const mobile of [false, true]) {
    test(`copy Markdown uses persisted numbering without an additional prompt (${mobile ? "mobile" : "desktop"})`, async () => {
        for (const choice of [true, false, undefined]) {
            const state = loadOpenMenu({MOBILE: mobile, BROWSER: mobile});
            state.setHeadingNumberChoice(choice);
            const items = state.copySubMenu(["document"], false, undefined, "heading");
            await items.find((item: IMenu) => item.id === "copyMarkdown").click();
            const request = state.calls.find(call => call.name === "fetchSyncPost");
            assert.equal(JSON.stringify(request.args), JSON.stringify(["/api/export/exportMdContent", {
                id: "heading", headingNumber: choice === true, refMode: 3, embedMode: 1, yfm: false,
                preserveTaskMarkers: true, fillCSSVar: false, adjustHeadingLevel: false,
            }]));
            assert.ok(state.calls.some(call => call.name === "writeText"));
            assert.equal(state.calls.filter(call => call.name === "fetchSyncPost").length, 1);
        }
    });
}

for (const {name, flags, newWindow} of [
    {name: "desktop", flags: {MOBILE: false, BROWSER: false}, newWindow: true},
    {name: "browser", flags: {MOBILE: false, BROWSER: true}, newWindow: false},
]) {
    test(`asset menu opens PDFs without fragments and passes the page separately (${name})`, () => {
        const {openMenu, calls} = loadOpenMenu(flags);
        const submenu = openMenu(app, " assets/document.pdf?box=20260101000000-abcdefg&page=3#view ", true, false);
        const opened = (id: string) => {
            calls.length = 0;
            submenu.find((item: {id: string}) => item.id === id).click();
            return calls.filter(call => call.name.startsWith("openAsset"));
        };
        const pdfPath = "assets/document.pdf?box=20260101000000-abcdefg";
        assert.deepEqual(opened("openBy"), [{name: "openAsset", args: [app, pdfPath, 3]}]);
        assert.deepEqual(opened("insertRight"), [{name: "openAsset", args: [app, pdfPath, 3, "right"]}]);
        assert.deepEqual(opened("insertBottom"), [{name: "openAsset", args: [app, pdfPath, 3, "bottom"]}]);
        assert.deepEqual(opened("openByBackground"), [{name: "openAssetInBackground", args: [app, pdfPath, 3]}]);
        if (newWindow) {
            // 窗口选项对象创建于 vm 上下文中，原型不同，按 JSON 比较
            assert.equal(JSON.stringify(opened("openByNewWindow")),
                JSON.stringify([{name: "openAssetNewWindow", args: [pdfPath, {}, 3]}]));
        } else {
            assert.equal(submenu.some((item: {id: string}) => item.id === "openByNewWindow"), false);
        }
    });

    test(`asset menu keeps media fragments when opening in a tab (${name})`, () => {
        const {openMenu, calls} = loadOpenMenu(flags);
        const submenu = openMenu(app, "assets/video.mp4#t=10", true, false);
        submenu.find((item: {id: string}) => item.id === "openBy").click();
        assert.deepEqual(calls.filter(call => call.name === "openAsset"),
            [{name: "openAsset", args: [app, "assets/video.mp4#t=10", undefined]}]);
    });
}


test("local Markdown assets expose the built-in editor action without replacing default open", () => {
    const {openMenu, calls} = loadOpenMenu({MOBILE: false, BROWSER: false}, true);
    const items = openMenu(app, "assets/note.md", true, false);
    assert.ok(items.some((item: {id: string}) => item.id === "useDefault"));
    items.find((item: {id: string}) => item.id === "openMarkdownEditor").click();
    assert.deepEqual(calls.filter(call => call.name === "openMarkdownAsset"), [{name: "openMarkdownAsset", args: ["assets/note.md"]}]);
    const unavailable = loadOpenMenu({MOBILE: false, BROWSER: false}).openMenu(app, "assets/note.md", true, false);
    assert.equal(unavailable.some((item: {id: string}) => item.id === "openMarkdownEditor"), false);
    const browser = loadOpenMenu({MOBILE: false, BROWSER: true}, true).openMenu(app, "assets/note.md", true, false);
    assert.equal(browser.some((item: {id: string}) => item.id === "openMarkdownEditor"), false);
});
