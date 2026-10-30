import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

const {parse} = require("ifdef-loader/preprocessor");

const setup = (mobile = true, detached = true) => {
    const items: IMenu[] = [];
    const events: string[] = [];
    const opened: Array<Record<string, unknown>> = [];
    const fields: IAVColumn[] = [];
    const siyuan = {config: {readonly: false, keymap: {editor: {general: {
        newNameSettingFile: {custom: ""}, newNameFile: {custom: ""},
    }}}}, isPublish: false, languages: new Proxy({}, {get: (_target, key) => String(key)})};
    const selected = [{itemID: "row", groupID: "group"}];
    const classes = {contains: () => false, add: () => { events.push("select"); }};
    const cell = {dataset: {id: "value", colId: "primary", detached: detached ? "true" : undefined},
        isConnected: true, classList: classes, getClientRects: () => [{}],
        querySelector: () => ({textContent: " Title "})};
    const row = {dataset: {id: "row"}, querySelector: () => cell, getAttribute: () => "row"};
    const block = {dataset: {avId: "database", nodeId: "carrier"},
        getAttribute: () => "table", querySelector: () => row, querySelectorAll: (): HTMLElement[] => []};
    const target = {getAttribute: () => "av-row-more", closest: (): null => null,
        isEqualNode: () => false, getBoundingClientRect: () => ({left: 10, bottom: 30, width: 28, height: 28})};
    const protyle = {app: {}, notebookId: "notebook", toolbar: {}, disabled: false, options: {history: {}}} as IProtyle;
    class Menu {
        public element = {setAttribute() {}};
        public addItem(item: IMenu) { items.push(item); }
        public addSeparator() {}
        public open() { events.push("menu-open"); }
        public close() { events.push("menu-close"); }
    }
    const dependencies: Record<string, unknown> = {
        "../../../plugin/Menu": {Menu},
        "../../../menus/menuToggle": {toggleMenu: (options: {target: unknown; build: () => void}) => {
            assert.equal(options.target, target);
            options.build();
        }},
        "../../../util/functions": {isMobile: () => mobile},
        "../../util/compatibility": {isOnlyMeta: () => false},
        "../../util/hasClosest": {hasClosestBlock: () => block,
            hasClosestByClassName: (_element: unknown, name: string) =>
                name === "av__cell" ? cell : name === "av__row" ? row : null},
        "./attributeValue": {getAVTemplateInteractiveElement: (): null => null},
        "./cell": {
            genCellValueByElement: () => ({type: "block", isDetached: detached,
                block: {content: " Title ", id: detached ? undefined : "bound-block"}}),
            addDragFill: () => events.push("drag-fill"),
        },
        "./openDatabaseRow": {openDatabaseRowByData: (_protyle: unknown, data: Record<string, unknown>) => opened.push(data)},
        "../../util/selectionOffsets": {focusByRange: () => events.push("focus")},
        "../../hint/extend": {hintRef: (content: string) => events.push("bind:" + content)},
        "../../ui/hideElements": {hideElements() {}},
        "./virtualScroll": {
            getAVSelectedItemInfos: () => selected, getAVSelectedItems: () => selected.map(() => ({isDetached: detached})),
            getAVSelectedItemPoints: (): unknown[] => [],
            getAVSelectedItemIDs: () => selected.map(item => item.itemID),
        },
        "./viewType": {isTableLikeView: () => true},
        "./itemLink": {genAVItemLink: () => "link"},
        "./viewVisibility": {getAVCurrentViewID: () => "view"},
        "../../../menus/util": {openEditorTab: (): IMenu[] => []},
        "./subItems": {addSubItemsMenu() {}},
        "./batchEdit": {getEditableAVFields: () => fields,
            openAVFieldBinding: () => events.push("binding-panel")},
        "../../../plugin/EventBus": {emitOpenMenu() {}},
    };
    const exports = {} as typeof import("./action");
    const code = parse(readFileSync("src/protyle/render/av/action.ts", "utf8"), {MOBILE: mobile}, false, true);
    runInNewContext(transpileModule(code, {compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2022}}).outputText, {
        exports, require: (name: string) => dependencies[name] || {}, window: {siyuan},
        document: {createRange: () => ({selectNodeContents() { events.push("range"); }})},
    });
    const more = () => exports.avClick(protyle, {target,
        preventDefault: () => events.push("prevent"), stopPropagation: () => events.push("stop"),
    } as unknown as MouseEvent & {target: HTMLElement});
    const context = () => exports.avContextmenu(protyle, undefined, {x: 10, y: 30}, {
        blockElement: block as unknown as HTMLElement, anchorElement: target as unknown as HTMLElement,
    });
    return {more, context, items, events, opened, siyuan, protyle, cell, selected, fields};
};

for (const detached of [true, false]) {
    test(`compact row menu opens and ${detached ? "binds" : "rebinds"} only its own entry`, () => {
        const h = setup(true, detached);
        h.selected[0].itemID = "another-selected-row";
        assert.equal(h.more(), true);
        assert.deepEqual(h.items.map(item => item.label), ["openBy", detached ? "bind" : "rebind"]);
        assert.ok(h.events.includes("prevent") && h.events.includes("stop"));
        h.items[0].click(undefined, undefined);
        assert.equal(h.opened[0].itemID, "row");
        assert.equal(h.opened[0].valueID, "value");
        assert.equal(h.opened[0].boundBlockID, detached ? "" : "bound-block");
        h.items[1].click(undefined, undefined);
        assert.ok(h.events.includes("bind:Title"));
        assert.ok(h.events.indexOf("menu-close") < h.events.indexOf("bind:Title"));
        assert.ok(!h.events.includes("select") || h.events.indexOf("select") > h.events.indexOf("menu-open"));
    });

    test(`mobile selection menu keeps open and ${detached ? "bind" : "rebind"} available outside narrow columns`, () => {
        const h = setup(true, detached);
        assert.equal(h.context(), true);
        const open = h.items.find(item => item.id === "openDatabaseRow");
        assert.ok(open);
        open.click(undefined, undefined);
        assert.equal(h.opened[0].itemID, "row");
        assert.equal(h.opened[0].isDetached, detached);
        assert.equal(h.items.find(item => item.id === "bindDocument")?.label, detached ? "bind" : "rebind");
    });
}

const readonlyModes = ["document", "workspace", "publish", "history", "snapshot"];
const setReadonly = (h: ReturnType<typeof setup>, mode: string) => {
    h.protyle.disabled = mode === "document";
    h.siyuan.config.readonly = mode === "workspace";
    h.siyuan.isPublish = mode === "publish";
    if (mode === "history") { h.protyle.options.history.created = "archive"; }
    if (mode === "snapshot") { h.protyle.options.history.snapshot = "snapshot"; }
};

test("readonly compact and selection menus allow opening but hide binding actions", () => {
    for (const mode of readonlyModes) {
        const compact = setup();
        setReadonly(compact, mode);
        compact.more();
        assert.deepEqual(compact.items.map(item => item.label), ["openBy"], mode);
        compact.items[0].click(undefined, undefined);
        assert.equal(compact.opened.length, 1, mode);
        const selection = setup();
        setReadonly(selection, mode);
        selection.context();
        assert.ok(selection.items.some(item => item.id === "openDatabaseRow"), mode);
        assert.ok(!selection.items.some(item => item.id === "bindDocument"), mode);
    }
});

test("binding checks readonly state again after the menu opens and ignores removed virtual rows", () => {
    for (const mode of [...readonlyModes, "removed"]) {
        const h = setup();
        h.more();
        if (mode === "removed") { h.cell.isConnected = false; } else { setReadonly(h, mode); }
        h.items[1].click(undefined, undefined);
        assert.ok(!h.events.includes("bind:Title"), mode);
        assert.ok(!h.events.includes("range"), mode);
    }
});

test("multi-selection has no single-entry actions and desktop retains its existing row menu", () => {
    const multi = setup();
    multi.selected.push({itemID: "second", groupID: "group"});
    multi.context();
    assert.ok(!multi.items.some(item => ["openDatabaseRow", "bindDocument"].includes(item.id)));
    const desktop = setup(false, false);
    desktop.context();
    assert.ok(desktop.items.some(item => item.id === "openBy"));
    assert.ok(!desktop.items.some(item => ["openDatabaseRow", "bindDocument"].includes(item.id)));
});

test("selection binding rechecks readonly state before using its virtual-row fallback", () => {
    for (const mode of readonlyModes) {
        const h = setup();
        h.context();
        const bind = h.items.find(item => item.id === "bindDocument");
        h.cell.isConnected = false;
        h.fields.push({id: "primary", type: "block"} as IAVColumn);
        setReadonly(h, mode);
        bind.click(undefined, undefined);
        assert.ok(!h.events.includes("binding-panel"), mode);
        assert.ok(!h.events.includes("bind:Title"), mode);
    }
});
