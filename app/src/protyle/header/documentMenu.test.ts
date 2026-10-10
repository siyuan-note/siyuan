import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {posix} from "node:path";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";
import {getEntryCatalogChildren} from "../../config/entryVisibility/catalog";
const {loadMenuToggle} = require("../../../tests/menu-toggle-fixture.cjs");

const {parse} = require("ifdef-loader/preprocessor");
const noop = () => {};

const setup = (mobile = false, readonly = false, encrypted = false) => {
    const items: IMenu[] = [];
    const events: {detail: {protyle: IProtyle}, separatorPosition: string}[] = [];
    const calls: {name: string, args: unknown[]}[] = [];
    const attributes = new Map<string, string>();
    const menu = {element: {classList: {contains: () => true}, getAttribute: (key: string) => attributes.get(key),
        setAttribute: (key: string, value: string) => attributes.set(key, value)},
        remove: () => { items.length = 0; }, append: (item: IMenu) => { if (item && !item.ignore) { items.push(item); } },
        popup: noop, fullscreen: noop};
    const record = (name: string) => (...args: unknown[]) => { calls.push({name, args}); };
    const docInfo: import("../../types/api").DocInfo = {
        id: "20261006112233-abcdefg", rootID: "20261006112233-abcdefg", name: "Document", icon: "", subFileCount: 2,
        refCount: 0, refIDs: [], attrViews: [], ial: {id: "20261006112233-abcdefg", updated: "20261006123344"},
    };
    const keymaps = Object.fromEntries(["outline", "backlinks", "graphView", "attr", "spaceRepetition", "quickMakeCard",
        "search", "addToDatabase"].map(key => [key, {custom: ""}]));
    const app = {} as Parameters<typeof import("./documentMenu").openDocumentMenu>[0]["app"];
    const target = {getAttribute: (): null => null} as unknown as HTMLElement;
    const lute = {BlockDOM2HTML: (source: string) => "html:" + source};
    const cardData: {cards: unknown[], unreviewedCount: number} = {cards: [], unreviewedCount: 0};
    const globals = {window: {siyuan: {menus: {menu}, languages: {}, isPublish: false,
        config: {readonly, cloudRegion: 0, flashcard: {deck: true}, system: {dataDir: "/data"},
            keymap: {general: keymaps, editor: {general: keymaps}}}}}, getSelection: () => ({rangeCount: 0})};
    const dependencies: Record<string, unknown> = {
        "../../menus/Menu": {MenuItem: class {element: IMenu; constructor(item: IMenu) { this.element = item; }}},
        "../../menus/commonMenuItem": {copySubMenu: (...args: unknown[]) => {
            record("copySubMenu")(...args); return [{id: "copyID"}];
        }, exportMd: () => ({id: "export"}), movePathToMenu: (...args: unknown[]) => {
            record("move")(...args); return {id: "move"};
        }, openFileAttr: record("attr"), openFileWechatNotify: record("wechatReminder")},
        "../../editor/deleteFile": {deleteFile: record("delete")},
        "../util/compatibility": {updateHotkeyTip: () => "", writeClipboardData: async (...args: unknown[]) => {
            record("clipboard")(...args); return {status: "success"};
        }},
        "../../layout/dock/util": {openOutline: record("outline"), openBacklink: record("backlinks"), openGraph: record("graphView")},
        "../../util/pathName": {isEncryptedBox: () => encrypted, pathPosix: () => posix,
            getNotebookName: () => "Notebook", getDisplayName: (value: string) => value.replace(/\.sy$/, ""), useShell: record("folder")},
        "../../card/makeCard": {makeCard: record("makeCard"), quickMakeCard: record("quickMakeCard")},
        "../../card/openCard": {openCardByData: record("spaceRepetition")},
        "../../card/viewCards": {viewCards: record("manage")},
        "../../plugin/EventBus": {emitOpenMenu: (event: typeof events[number]) => {
            events.push(event); menu.append({id: "plugin"}); menu.append({id: "separator_pluginBottom", type: "separator"});
        }},
        "../../search/spread": {openSearch: record("search")},
        "../../mobile/menu/search": {popSearch: record("search")},
        "../../history/doc": {openDocHistory: record("history")},
        "../../window/openNewWindow": {openNewWindowById: record("newWindow")},
        "../../menus/block": {transferBlockRef: (id: string) => {
            menu.append({id: "transferBlockRef", click: () => { record("transferBlockRef")(id); }});
        }},
        "../render/av/addToDatabase": {addBlocksToDatabase: record("database"), addEditorToDatabase: record("editorDatabase")},
        "../../editor/util": {openFileById: record("open")},
        "../../mobile/editor": {openMobileFileById: record("open")},
        "../util/hasClosest": {hasTopClosestByClassName: (): null => null},
        "../../util/functions": {isMobile: () => mobile},
        "../../dialog/tooltip": {hideTooltip: noop},
        "../../dialog/message": {showMessage: noop},
        "../render/setLute": {getLute: () => lute},
        "../util/blockDOMClipboard": {buildBlockDOMClipboardRichData: (parser: typeof lute, source: string) =>
            ({textHTML: parser.BlockDOM2HTML(source), textSiyuan: "sy:" + source})},
        "../util/clipboardData": {buildWebClipboardHTML: (html: string) => "web:" + html},
        "../export/util": {exportImage: record("copyAsPNG")},
        "../wysiwyg/transaction": {transaction: record("transaction")},
        "../../util/hostCapabilities": {getHostCapabilities: () => ({documentImportExport: true, localFileSystem: true})},
        "../../constants": {Constants: {MENU_TITLE: "title", CUSTOM_RIFF_DECKS: "decks", QUICK_DECK_ID: "quick", DIALOG_SEARCH: "search"}},
        "../../util/fetch": {
            fetchPost: (url: string, body: unknown, callback: (response: unknown) => void) => {
                record("fetchPost")(url, body);
                callback({code: 0, data: url.endsWith("getDocInfo") ? docInfo :
                    url.endsWith("getTreeRiffDueCards") ? cardData : "/Document"});
            },
            fetchSyncPost: async (url: string, body: unknown) => {
                record("fetchSyncPost")(url, body);
                return {code: 0, data: url.endsWith("getBlockDOM") ? {dom: "Document DOM"} :
                    url.endsWith("getHPathByPath") ? "/Document" : {content: "Document Markdown"}};
            },
        },
        path: posix,
        dayjs: (value: string) => ({format: () => value}),
    };
    const load = (file: string) => {
        const exports = {};
        runInNewContext(transpileModule(parse(readFileSync("src/protyle/header/" + file + ".ts", "utf8"),
            {MOBILE: mobile, BROWSER: mobile}, false, true, file), {
            compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
        }).outputText, {exports, require: (name: string) => dependencies[name] || {}, ...globals});
        return exports;
    };
    const documentModule = load("documentMenu") as typeof import("./documentMenu");
    dependencies["../../menus/menuToggle"] = loadMenuToggle(globals);
    dependencies["./documentMenu"] = documentModule;
    const titleModule = load("openTitleMenu") as typeof import("./openTitleMenu");
    const options: Parameters<typeof documentModule.openDocumentMenu>[0] = {
        app, id: docInfo.id, notebookId: "notebook", path: "/parent/document.sy", docInfo, target,
        position: {x: 60, y: 90}, from: "graph", disabled: readonly,
    };
    const click = async (id: string) => {
        const item = items.find(item => item.id === id) || (items.find(item => item.id === "copy").submenu as IMenu[])
            .find(item => item.id === id);
        assert.ok(item, id);
        await item.click(null, null);
    };
    return {documentModule, titleModule, options, items, events, calls, attributes, cardData, lute, click,
        open: (overrides: Partial<typeof options> = {}) => documentModule.openDocumentMenu({...options, ...overrides})};
};

test("graph document menus share editor menu identities and order instead of document tree entries", () => {
    const menu = setup();
    menu.open();
    const expected = getEntryCatalogChildren("document.title").map(item => item.key);
    assert.deepEqual(menu.items.map(item => item.id), expected);
    assert.equal(menu.attributes.get("data-name"), "title");
    assert.equal(menu.attributes.get("data-from"), "app-graph");
    assert.ok(!menu.items.some(item => ["newSiblingDoc", "rename", "pinDoc", "sort", "replace", "import"].includes(item.id)));
    assert.equal(menu.events.length, 0);
    const timestamps = menu.items.find(item => item.id === "updateAndCreatedAt");
    assert.ok(timestamps.label.includes("20261006123344"));
    assert.ok(timestamps.label.includes("20261006112233"));
});

test("graph document actions target the selected document without opening an editor", async () => {
    const menu = setup();
    menu.open();
    await menu.click("outline");
    await menu.click("backlinks");
    await menu.click("graphView");
    for (const name of ["outline", "backlinks", "graphView"]) {
        const action = menu.calls.find(call => call.name === name).args[0] as {rootId: string, title: string};
        assert.equal(action.rootId, menu.options.id);
        assert.equal(action.title, "Document");
    }
    await menu.click("addToDatabase");
    const database = menu.calls.find(call => call.name === "database");
    assert.equal(JSON.stringify(database.args[0]), JSON.stringify([menu.options.id]));
    assert.equal(database.args[1], menu.options.target);
    assert.equal(database.args[2], menu.options.position);
    await menu.click("delete");
    assert.deepEqual(menu.calls.find(call => call.name === "delete").args, ["notebook", "/parent/document.sy"]);
    await menu.click("wechatReminder");
    assert.deepEqual(menu.calls.find(call => call.name === "wechatReminder").args, [menu.options.id, "notebook"]);
    await menu.click("transferBlockRef");
    assert.deepEqual(menu.calls.find(call => call.name === "transferBlockRef").args, [menu.options.id]);
    assert.ok(!menu.calls.some(call => call.name === "open"));
});

test("copying a closed document uses the shared parser and retains Markdown and rich clipboard content", async () => {
    const menu = setup();
    menu.open();
    await menu.click("copyDoc");
    const clipboard = menu.calls.find(call => call.name === "clipboard").args[0] as {textPlain: string, textHTML: string};
    assert.equal(clipboard.textPlain, "Document Markdown");
    assert.equal(clipboard.textHTML, "web:html:Document DOM");
    const request = menu.calls.find(call => call.name === "fetchSyncPost" && call.args[0] === "/api/block/getBlockDOM");
    assert.equal((request.args[1] as {id: string}).id, menu.options.id);
});

test("graph flashcards keep response data and use document IDs with reversible operations", async () => {
    const menu = setup();
    menu.open();
    const cardItems = menu.items.find(item => item.id === "riffCard").submenu as IMenu[];
    await cardItems.find(item => item.id === "spaceRepetition").click(null, null);
    assert.equal(menu.calls.find(call => call.name === "spaceRepetition").args[1], menu.cardData);
    await cardItems.find(item => item.id === "manage").click(null, null);
    assert.equal(menu.calls.find(call => call.name === "manage").args[2], "Notebook/Document");
    await cardItems.find(item => item.id === "quickMakeCard").click(null, null);
    const transaction = menu.calls.find(call => call.name === "transaction");
    assert.equal(JSON.stringify(transaction.args[1]), JSON.stringify([{action: "addFlashcards", deckID: "quick", blockIDs: [menu.options.id]}]));
    assert.equal(JSON.stringify(transaction.args[2]), JSON.stringify([{action: "removeFlashcards", deckID: "quick", blockIDs: [menu.options.id]}]));
});

for (const mobile of [false, true]) {
    test(`editor title menus retain actual editor context and plugin extensions (${mobile ? "mobile" : "desktop"})`, async () => {
        const menu = setup(mobile);
        const protyle = {app: menu.options.app, notebookId: "notebook", path: menu.options.path, disabled: false,
            block: {rootID: menu.options.id, id: "heading", showAll: true},
            element: menu.options.target, options: {history: {}, render: {title: true}},
            title: {editElement: {textContent: "Editor title"}}, lute: menu.lute,
        } as unknown as IProtyle;
        menu.titleModule.openTitleMenu(protyle, menu.options.position, "editor");
        assert.equal(menu.events[0].detail.protyle, protyle);
        assert.equal(menu.events[0].separatorPosition, "bottom");
        assert.equal(menu.attributes.get("data-from"), "app-editor");
        await menu.click("addToDatabase");
        assert.equal(menu.calls.find(call => call.name === "editorDatabase").args[0], protyle);
        await menu.click("copyAsPNG");
        assert.deepEqual(menu.calls.find(call => call.name === "copyAsPNG").args, ["heading", true]);
        const keys = menu.items.map(item => item.id);
        assert.ok(keys.indexOf("separator_4") < keys.indexOf("plugin"));
        assert.ok(keys.indexOf("plugin") < keys.indexOf("updateAndCreatedAt"));
    });
}

test("locked graph documents retain viewing history while respecting editor mutation restrictions", async () => {
    const menu = setup();
    menu.open({disabled: true});
    assert.ok(!menu.items.some(item => ["move", "addToDatabase", "delete", "transferBlockRef"].includes(item.id)));
    await menu.click("fileHistory");
    assert.equal((menu.calls.find(call => call.name === "history").args[0] as {readonly: boolean}).readonly, true);
});

test("workspace readonly and encrypted documents preserve existing history and notebook-boundary rules", () => {
    const readonly = setup(false, true);
    readonly.open();
    assert.ok(!readonly.items.some(item => ["fileHistory", "wechatReminder", "riffCard", "delete"].includes(item.id)));
    const encrypted = setup(false, false, true);
    encrypted.open();
    assert.equal(JSON.stringify(encrypted.calls.find(call => call.name === "move").args[1]), '["notebook"]');
    assert.ok(!encrypted.items.some(item => item.id === "riffCard"));
});
