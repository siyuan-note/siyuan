import * as assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import * as path from "node:path";
import {test} from "node:test";
import {promisify} from "node:util";
import {compile, Logger} from "sass";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

const {parse} = require("ifdef-loader/preprocessor");

const browserCases = async (sources: Record<string, string>, css: string, mobile: boolean) => {
    const check: typeof assert = require("node:assert/strict");
    const box = "20260101000000-aaaaaaa", otherBox = "20260101000000-bbbbbbb";
    const doc = "20260101000000-ccccccc", otherDoc = "20260101000000-ddddddd";
    const files = [doc, otherDoc].map((id): IFile => ({id, path: `/${id}.sy`, name: `Title ${id}`, subFileCount: 0,
        icon: "", count: 0, name1: "", alias: "", memo: "", bookmark: "", hMtime: "", hCtime: "", hSize: "",
        childrenSortMode: null}));
    const events: {type: string, items: {
        id: string, path: string, notebookId: string, effectiveSortMode: number, childrenSortMode?: number | null,
    }[], elements: NodeListOf<HTMLElement>}[] = [];
    const databases: unknown[][] = [], icons: unknown[][] = [];
    let treeAccess = 0;
    let subscribed = true;
    let hideAll = false;
    let eventAction: ((detail: {menu: {addItem: (item: IMenu) => void}}) => void) | undefined;
    let commonAction: (() => void) | undefined;
    let pending: (() => void) | undefined;
    let pause = false;
    const modules: Record<string, {exports: any}> = {};
    const constants = new Proxy({HELP_PATH: {}, TIMEOUT_DBLCLICK: 1}, {get: (value, key) =>
        key in value ? value[key as keyof typeof value] : String(key)});
    const text = (value: string) => String(value || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
    const externals: Record<string, unknown> = {
        constants: {Constants: constants},
        "util/functions": {isMobile: () => mobile},
        "util/zIndex": {isScrollAboveMenu: () => false},
        "layout/getTopBarHeight": {getTopBarHeight: () => 32},
        "protyle/util/compatibility": {getEventName: () => "click", isInMobileApp: () => false,
            isPhablet: () => false, updateHotkeyTip: (value: string) => value},
        "protyle/undo": {electronUndo() {}},
        "util/escape": {escapeAttr: text, escapeHtml: text, escapeHtmlTextAndAttr: text, escapeTooltipTextAttr: text},
        "menus/menuKeyboard": {setMenuInputCurrent() {}},
        "mobile/util/keyboardToolbar": {activeBlur() {}},
        "block/popoverLifecycle": {setPopoverMenuOpen() {}},
        "config/entryVisibility/runtime": {applyMenuEntryVisibility: (element: HTMLElement) => {
            if (hideAll) { element.lastElementChild.innerHTML = ""; }
        }},
        "plugin/EventBusCore": {hasPluginSubscriber: () => subscribed,
            forEachPluginSubscriber: (type: string, callback: (bus: {emit: () => void}) => void) => {
                if (type === "common-menu-open") { callback({emit: () => commonAction?.()}); }
            }, emitToPlugins: (_type: string, detail: typeof events[number]) => {
                events.push(detail); eventAction?.(detail as typeof detail & {menu: {addItem: (item: IMenu) => void}});
            }},
        "util/pathName": {pathPosix: () => require("node:path").posix,
            getDisplayName: (name: string) => name.replace(/\.sy$/, ""), getDocDisplayName: text,
            getNotebookName: (id: string) => window.siyuan.notebooks.find(item => item.id === id)?.name,
            isEncryptedBox: () => false},
        "util/pinnedDocs": {pinnedDocIDs: new Set(), updatePinnedDocs() {}},
        "util/fileTreeTooltip": {genFileTreeDocAriaLabel: (file: IFile) => text(file.name)},
        "emoji/fileTreeIcon": {getFileTreeDefaultIconAttr: () => "", getFileTreeIconHTML: () => "icon"},
        "protyle/util/publishAccess": {getPublishAccessOptionByLevel: () => ({iconHTML: ""})},
        "util/treeItemTail": {getTreeItemTailHTML: (count: string, actions: string) => count + actions},
        "util/fetch": {fetchPost: (url: string, _request: unknown, callback: (response: unknown) => void) => {
            if (url === "/api/av/searchAttributeView") {
                queueMicrotask(() => callback({code: 0, data: {results: []}}));
            }
        }, fetchSyncPost: async (url: string, request: {id: string, notebook: string, offset: number}) => {
            if (pause) {
                pause = false;
                await new Promise<void>(resolve => { pending = resolve; });
            }
            if (url.endsWith("locateDocTreeItem")) {
                return {code: 0, data: {box: request.notebook, id: request.id, steps: [{id: request.id,
                    parentID: "", path: "/", index: files.findIndex(file => file.id === request.id), revision: "v1"}]}};
            }
            if (url.endsWith("listDocTreeRange")) {
                return {code: 0, data: {box: request.notebook, parentID: "", path: "/", offset: request.offset,
                    files: [files[request.offset]], revision: "v1", stale: false, effectiveSortMode: 6, total: 2}};
            }
            if (url.endsWith("getBlockInfo")) {
                return {code: 0, data: {box: request.notebook, rootID: request.id, path: `/${request.id}.sy`}};
            }
            if (url.endsWith("getDocInfo")) {
                return {code: 0, data: {id: request.id, rootID: request.id, name: "Notebook document", subFileCount: 0}};
            }
            throw new Error(url);
        }},
        "config/util/resourceConfig": {}, "util/contractFormData": {}, "menus/onGetnotebookconf": {},
        "config/encryptedAssets": {canCleanEncryptedNotebookAssets: () => false}, "search/spread": {},
        "mobile/util/closePanel": {}, "mobile/menu/search": {}, "util/newFile": {}, "editor/deleteFile": {},
        "editor/util": {}, "layout/tabUtil": {getDockByType: (): undefined => undefined}, "layout/dock/Files": {},
        "layout/dock/docTree/DocTreeController": {getDocTreeController: () => { treeAccess++; throw new Error("Live tree access"); }},
        "card/openCard": {}, "card/viewCards": {}, "history/doc": {}, "card/makeCard": {},
        "protyle/wysiwyg/transaction": {}, "protyle/export/exportMd": {},
        "util/fileTreeSort": {}, "util/hostCapabilities": {getHostCapabilities: () => ({documentImportExport: false})},
        "emoji": {openEmojiPanel: (...args: unknown[]) => icons.push(args), unicode2Emoji: () => '<img src="data:,">'},
        "mobile/editor": {}, "dialog/message": {}, "dialog/mobileConfirmDialog": {},
    };
    for (const name of ["viewType", "subItems", "cell", "action", "view", "col", "row", "openDatabaseRow",
        "columnWidth", "attributeValue", "cellValue", "richText", "blockIcon", "relationLayout", "relationKeyboard", "host"]) {
        externals[`protyle/render/av/${name}`] = {};
    }
    Object.assign(externals, {
        "protyle/render/av/searchAVFocus": {getSearchAVFocus: (): undefined => undefined},
        "protyle/render/av/relatedViewConfig": {getPendingRelatedViewConfig: (): undefined => undefined},
        "protyle/render/av/filteredTip": {}, "protyle/util/selectionOffsets": {},
        "protyle/util/selection": {}, "util/upDownHint": {}, "util/documentSelectionRequest": {},
    });
    const load = (name: string): any => {
        if (name in externals) { return externals[name]; }
        if (modules[name]) { return modules[name].exports; }
        check.ok(sources[name], `Unexpected dependency ${name}`);
        const module = {exports: {}};
        modules[name] = module;
        new Function("require", "module", "exports", sources[name])((dependency: string) => {
            if (dependency === "dayjs") { return {}; }
            const parts = name.split("/");
            parts.pop();
            dependency.split("/").forEach(part => {
                if (part === "..") { parts.pop(); } else if (part !== ".") { parts.push(part); }
            });
            return load(parts.join("/"));
        }, module, module.exports);
        return module.exports;
    };
    const style = document.createElement("style");
    style.textContent = css + "body{margin:0}.fn__none{display:none!important}.fn__hidden{visibility:hidden!important}";
    document.head.append(style);
    const keys = new Proxy({}, {get: () => ({custom: ""})});
    Object.assign(window, {siyuan: {languages: new Proxy({}, {get: (_value, key) => String(key)}), zIndex: 0, storage: {},
        notebooks: [box, otherBox].map((id, index) => ({id, name: `Notebook ${index}`, icon: "", closed: false,
            subFileCount: 2, sortMode: index === 0 ? 15 : 2})), ws: {app: {}}, menus: {},
        mobile: {size: {portrait: {height1: innerHeight}}, docks: {}},
        config: {appearance: {}, readonly: false, fileTree: {boxDocEnabled: true, parentDocTitleClickMode: 1, sort: 0},
            flashcard: {deck: false}, keymap: {general: keys, editor: {general: keys}}}}});
    const {Menu, MenuItem}: typeof import("../menus/Menu") = load("menus/Menu");
    Object.assign(window, {Lute: {NewNodeID: () => "20260101000000-eeeeeee"}});
    const {addBlocksToDatabase}: typeof import("../protyle/render/av/addToDatabase") = load("protyle/render/av/addToDatabase");
    externals["protyle/render/av/addToDatabase"] = {addBlocksToDatabase: (...args: Parameters<typeof addBlocksToDatabase>) => {
        databases.push(args);
        addBlocksToDatabase(...args);
    }};
    externals["menus/commonMenuItem"] = {copySubMenu: () => [{id: "copyID", label: "Copy ID"}],
        exportMd: () => new MenuItem({id: "export", label: "Export"}).element,
        renameMenu: () => new MenuItem({id: "rename", label: "Rename"}).element,
        movePathToMenu: () => new MenuItem({id: "move", label: "Move"}).element};
    externals["menus/util"] = {openEditorTab: () => window.siyuan.menus.menu.addItem({id: "openBy", label: "Open"})};
    const {openDocTreeMenu}: typeof import("./openDocTreeMenu") = load("plugin/openDocTreeMenu");
    const {getDocTreeItem}: typeof import("../layout/dock/docTree/rowData") = load("layout/dock/docTree/rowData");
    const common = document.createElement("div");
    common.id = "commonMenu";
    common.className = "b3-menu fn__none";
    common.innerHTML = '<div class="b3-menu__title fn__none"><span class="b3-menu__label"></span></div><div class="b3-menu__items"></div>';
    document.body.append(common);
    const menu = new Menu(common);
    const popups: IPosition[] = [];
    const popup = menu.popup.bind(menu);
    menu.popup = (options, isCurrent) => { popups.push(options); popup(options, isCurrent); };
    window.siyuan.menus.menu = menu;
    const tree = document.createElement("ul");
    tree.innerHTML = '<li class="b3-list-item--focus" aria-expanded="true">Official selection</li>';
    document.body.append(tree);
    const initialTree = tree.outerHTML;
    const position = {x: 80, y: 100, w: 24, h: 32};
    const targets: Record<string, {notebookId: string, id?: string}[]> = {
        notebook: [{notebookId: box}], notebooks: [{notebookId: box}, {notebookId: otherBox}],
        doc: [{notebookId: box, id: doc}], docs: [{notebookId: box, id: doc}, {notebookId: box, id: otherDoc}],
        items: [{notebookId: box}, {notebookId: otherBox, id: otherDoc}]};
    for (const [type, items] of Object.entries(targets)) {
        check.equal(await openDocTreeMenu({items, position}), true, `${mobile ? "mobile" : "desktop"} ${type}`);
        const event = events.at(-1);
        check.equal(event.type, type);
        check.ok(event.elements instanceof NodeList);
        check.equal(event.elements.length, items.length);
        check.equal(event.items.length, items.length);
        event.items.forEach((item, index) => {
            check.equal(item.effectiveSortMode, items[index].id ? 6 : items[index].notebookId === box ? 0 : 2);
            check.equal(Object.hasOwn(item, "childrenSortMode"), Boolean(items[index].id));
            if (items[index].id) { check.equal(item.childrenSortMode, null); }
        });
        event.elements.forEach((element, index) => {
            check.equal(element.isConnected, false);
            check.equal(getDocTreeItem(element).notebookId, items[index].notebookId);
            check.equal(element.dataset.type, items[index].id ? "navigation-file" : "navigation-root");
        });
        check.equal(tree.outerHTML, initialTree);
        check.equal(treeAccess, 0);
        check.equal(common.classList.contains("b3-menu--sheet"), mobile);
        check.equal(common.querySelector('[data-id="multiSelect"]'), null);
    }
    for (const items of [targets.doc, targets.docs]) {
        check.equal(await openDocTreeMenu({items, position}), true);
        common.querySelector<HTMLElement>('[data-id="addToDatabase"]').click();
        check.deepEqual(databases.at(-1)[0], items.map(item => item.id));
        check.equal(databases.at(-1)[1], document.body);
        check.deepEqual(databases.at(-1)[2], position);
        await new Promise(resolve => setTimeout(resolve, 10));
        check.ok(common.querySelector(".b3-menu__filter input"), "The real database picker opens after the click");
        check.equal(common.classList.contains("fn__none"), false);
        check.equal(common.classList.contains("b3-menu--sheet"), mobile);
        if (!mobile) {
            check.deepEqual(popups.at(-1), position, "The database picker retains the supplied anchor coordinates");
        }
    }
    check.equal(await openDocTreeMenu({items: [{notebookId: box}, {notebookId: box, id: box}], position}), true);
    check.equal(events.at(-1).type, "items");
    check.equal(events.at(-1).elements.length, 2);
    check.deepEqual(Array.from(events.at(-1).elements, element => getDocTreeItem(element).kind), ["notebook", "document"]);
    if (mobile) {
        check.equal(await openDocTreeMenu({items: targets.notebook}), true);
        check.equal(common.classList.contains("b3-menu--sheet"), true);
        await openDocTreeMenu({items: targets.notebook, position});
        common.querySelector<HTMLElement>('[data-id="changeIcon"]').click();
        check.equal(icons.at(-1)[0], box);
        check.equal(icons.at(-1)[1], "notebook");
        check.deepEqual(icons.at(-1)[2], position);
        await new Promise(resolve => setTimeout(resolve, 10));
    }
    const before = events.length;
    subscribed = false;
    check.equal(await openDocTreeMenu({items: targets.doc, position}), true);
    check.equal(events.length, before);
    subscribed = true;
    eventAction = () => menu.remove();
    check.equal(await openDocTreeMenu({items: targets.doc, position}), false, "A subscriber can dismiss the pending menu");
    eventAction = detail => {
        detail.menu.addItem({id: "latePlugin", label: "Late plugin action"});
        menu.remove();
        menu.addItem({id: "replacement", label: "Replacement menu"});
        menu.popup(position);
    };
    check.equal(await openDocTreeMenu({items: targets.doc, position}), false);
    check.ok(common.querySelector('[data-id="replacement"]'));
    check.equal(common.querySelector('[data-id="plugin"]'), null, "Plugin items do not contaminate the replacement menu");
    for (const replace of [false, true]) {
        let bound = false;
        eventAction = detail => detail.menu.addItem({id: "boundPlugin", label: "Bound plugin action", bind: () => {
            bound = true;
            menu.remove();
            if (replace) {
                menu.addItem({id: "bindReplacement", label: "Replacement from bind"});
                menu.popup(position);
            }
        }});
        check.equal(await openDocTreeMenu({items: targets.doc, position}), false, "Plugin bind can cancel pending publication");
        check.equal(bound, true, "The real plugin MenuItem invokes its bind callback");
        check.equal(common.querySelector('[data-id="plugin"]'), null);
        check.equal(common.querySelector('[data-id="separator_pluginTop"]'), null);
        check.equal(common.querySelector('[data-id="separator_pluginBottom"]'), null);
        if (replace) {
            check.ok(common.querySelector('[data-id="bindReplacement"]'));
            check.equal(common.lastElementChild.children.length, 1, "Old menu fragments do not enter the replacement");
            check.equal(common.classList.contains("fn__none"), false);
        } else {
            check.equal(common.lastElementChild.children.length, 0);
            check.equal(common.classList.contains("fn__none"), true);
        }
    }
    eventAction = undefined;
    commonAction = () => menu.remove();
    check.equal(await openDocTreeMenu({items: targets.doc, position}), false, "Common-menu subscribers can cancel opening");
    check.equal(common.classList.contains("fn__none"), true);
    const replacementData = {owner: "replacement"};
    commonAction = () => {
        commonAction = undefined;
        menu.remove();
        menu.addItem({id: "commonReplacement", label: "Common replacement"});
        menu.popup({x: 220, y: 180});
        menu.data = replacementData;
    };
    check.equal(await openDocTreeMenu({items: targets.doc, position}), false);
    check.ok(common.querySelector('[data-id="commonReplacement"]'));
    check.equal(menu.data, replacementData, "The old API publication preserves replacement menu ownership");
    if (!mobile) { check.deepEqual(popups.at(-1), {x: 220, y: 180}); }
    if (!mobile) {
        hideAll = true;
        check.equal(await openDocTreeMenu({items: targets.doc, position}), false, "An empty configured menu is not opened");
        hideAll = false;
    }
    pause = true;
    const opening = openDocTreeMenu({items: targets.doc, position});
    await Promise.resolve();
    menu.remove();
    pending();
    check.equal(await opening, false);
    check.equal(common.classList.contains("fn__none"), true);
    if (mobile) {
        pause = true;
        const closing = openDocTreeMenu({items: targets.doc, position});
        await Promise.resolve();
        menu.closeSheet();
        pending();
        check.equal(await closing, false, "A closing sheet cancels pending work before its animation ends");
        check.equal(common.classList.contains("fn__none"), true);
        await new Promise(resolve => setTimeout(resolve, 10));
    }
    check.equal(tree.outerHTML, initialTree);
    check.equal(treeAccess, 0);
    menu.remove();
    return "Document tree DOM cases passed";
};

for (const mobile of [false, true]) {
    test(`plugin document tree menus use detached rows and real ${mobile ? "mobile sheet" : "desktop popup"} interactions`,
        {timeout: 45000}, async () => {
        const sources = Object.fromEntries(["plugin/openDocTreeMenu", "plugin/EventBus", "plugin/Menu", "menus/navigation",
            "menus/navigationSelection", "menus/Menu", "menus/menuToggle", "menus/menuPosition", "menus/menuMouseScroll",
            "menus/menuGroup", "menus/sheetOpen", "menus/sheetActions", "mobile/util/mobileSheetGesture", "mobile/util/keyboardSheetState",
            "util/setPosition", "protyle/util/hasClosest", "layout/dock/docTree/row", "layout/dock/docTree/rowData",
            "protyle/render/av/addToDatabase", "protyle/render/av/relation"]
            .map(name => [name, transpileModule(parse(readFileSync(path.join(__dirname, "..", name + ".ts"), "utf8"),
                {MOBILE: mobile, BROWSER: true}, false, true, name + ".ts"), {
                compilerOptions: {target: ScriptTarget.ES2021, module: ModuleKind.CommonJS},
            }).outputText]));
        const css = ["component/_menu.scss", "component/_list.scss"].map(name =>
            compile(path.join(__dirname, "../assets/scss", name), {logger: Logger.silent}).css).join("\n");
        const source = `const __name = value => value; (${browserCases.toString()})(${JSON.stringify(sources)}, ${JSON.stringify(css)}, ${mobile})`;
        const temporary = mkdtempSync(path.join(tmpdir(), "siyuan-doctree-menu-dom-"));
        const script = path.join(temporary, "run.cjs");
        writeFileSync(script, `const {app, BrowserWindow} = require("electron");
app.setPath("userData", ${JSON.stringify(path.join(temporary, "profile"))});
app.commandLine.appendSwitch("disable-gpu");
app.whenReady().then(async () => {
    const win = new BrowserWindow({show: false, width: 1000, height: 800, useContentSize: true,
        webPreferences: {nodeIntegration: true, contextIsolation: false, offscreen: true, backgroundThrottling: false}});
    try {
        await win.loadURL("about:blank");
        console.log(await win.webContents.executeJavaScript(${JSON.stringify(source)}));
        win.destroy(); app.exit(0);
    } catch (error) { console.error(error); win.destroy(); app.exit(1); }
});`, "utf8");
        const env: NodeJS.ProcessEnv = {...process.env, XDG_CACHE_HOME: path.join(temporary, "cache")};
        delete env.ELECTRON_RUN_AS_NODE;
        const args = process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY ?
            ["--ozone-platform=headless", script] : [script];
        try {
            const result = await promisify(execFile)(require("electron") as unknown as string, args,
                {env, timeout: 40000, windowsHide: true});
            assert.match(result.stdout, /Document tree DOM cases passed/);
        } finally {
            assert.equal(path.dirname(path.resolve(temporary)), path.resolve(tmpdir()));
            assert.ok(path.basename(temporary).startsWith("siyuan-doctree-menu-dom-"));
            rmSync(temporary, {recursive: true, force: true});
        }
    });
}
