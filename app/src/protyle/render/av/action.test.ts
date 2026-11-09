import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";
import * as host from "./host";
import * as columnWindow from "./columnWindow";
import {isTableLikeView} from "./viewType";

const {parse} = require("ifdef-loader/preprocessor");

const setup = (mobile = true, detached = true, viewType: TAVView = "table") => {
    const items: IMenu[] = [];
    const events: string[] = [];
    const opened: Array<Record<string, unknown>> = [];
    const inserted: Array<{count: number; previousID: string; parentID?: string; groupID?: string}> = [];
    const fields: IAVColumn[] = [];
    const siyuan = {config: {readonly: false, keymap: {editor: {general: {
        newNameSettingFile: {custom: ""}, newNameFile: {custom: ""},
    }}}}, isPublish: false, languages: new Proxy({}, {get: (_target, key) => String(key)})};
    const selected: Array<{itemID: string; groupID: string; previousID?: string; item?: IAVRow | IAVGalleryItem}> =
        [{itemID: "row", groupID: "group", item: {id: "row", cells: []}}];
    const classes = {contains: () => false, add: () => { events.push("select"); }};
    const cell = {dataset: {id: "value", colId: "primary", detached: detached ? "true" : undefined},
        isConnected: true, classList: classes, getClientRects: () => [{}],
        querySelector: () => ({textContent: " Title "})};
    const row = {dataset: {id: "row"}, querySelector: () => cell, getAttribute: () => "row"};
    const block = {dataset: {avId: "database", nodeId: "carrier"},
        getAttribute: () => viewType, querySelector: () => row, querySelectorAll: (): HTMLElement[] => []};
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
        "./columnWindow": columnWindow,
        "./host": {...host, getAVHost: () => block},
        "../../../plugin/Menu": {Menu},
        "../../../menus/menuToggle": {toggleMenu: (options: {target: unknown; build: () => void}) => {
            assert.equal(options.target, target);
            options.build();
        }},
        "../../../util/functions": {isMobile: () => mobile},
        "../../util/compatibility": {isOnlyMeta: () => false},
        "../../util/hasClosest": {hasClosestByClassName: (_element: unknown, name: string) =>
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
        "./viewType": {isTableLikeView},
        "./itemLink": {genAVItemLink: () => "link"},
        "./viewVisibility": {getAVCurrentViewID: () => "view"},
        "../../../menus/util": {openEditorTab: (): IMenu[] => []},
        "./subItems": {addSubItemsMenu() {}},
        "./row": {insertRows: (options: typeof inserted[number]) => inserted.push(options)},
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
    return {more, context, items, events, opened, inserted, siyuan, protyle, cell, selected, fields};
};

test("desktop and mobile insertion menus keep table/list siblings under the selected entry's parent", () => {
    for (const mobile of [false, true]) {
        for (const viewType of ["table", "list"] as const) {
            for (const parentID of [undefined, "parent", "nested-parent"]) {
                for (const direction of ["Before", "After"]) {
                    for (const keyboard of [false, true]) {
                        const h = setup(mobile, true, viewType);
                        h.selected[0].previousID = "previous-visible";
                        if (parentID) {
                            h.selected[0].item = {id: "row", cells: [], hierarchy: {
                                parentID, depth: parentID === "parent" ? 1 : 2, childCount: 0, context: false, expanded: false,
                            }};
                        }
                        h.context();
                        const item = h.items.find(value => value.id === `insertRow${direction}`);
                        assert.ok(item);
                        const input = Object.assign(new EventTarget(), {value: "3"});
                        const element = Object.assign(new EventTarget(), {querySelector: () => input});
                        item.bind(element as unknown as HTMLElement);
                        if (keyboard) input.dispatchEvent(Object.assign(new Event("keydown"), {key: "Enter", isComposing: false}));
                        else element.dispatchEvent(new Event("click"));
                        assert.equal(h.inserted.length, 1);
                        assert.equal(h.inserted[0].count, 3);
                        assert.equal(h.inserted[0].previousID, direction === "Before" ? "previous-visible" : "row");
                        assert.equal(h.inserted[0].groupID, "group");
                        assert.equal(h.inserted[0].parentID, parentID);
                        assert.ok(h.events.includes("menu-close"));
                    }
                }
            }
        }
    }
});

test("flat gallery insertion retains its root placement without table hierarchy metadata", () => {
    const h = setup(false, true, "gallery");
    h.selected[0].item = {id: "row", values: []};
    h.context();
    const item = h.items.find(value => value.id === "insertItemAfter");
    assert.ok(item);
    const input = Object.assign(new EventTarget(), {value: "1"});
    const element = Object.assign(new EventTarget(), {querySelector: () => input});
    item.bind(element as unknown as HTMLElement);
    element.dispatchEvent(new Event("click"));
    assert.equal(h.inserted[0].parentID, undefined);
    assert.equal(h.inserted[0].previousID, "row");
});

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
