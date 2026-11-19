import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";
import {escapeAriaLabel} from "../../util/escape";
import {createDockKeymapDefaults} from "../../util/dockKeymap";

const compile = (path: string) => transpileModule(readFileSync(path, "utf8"), {
    compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
}).outputText;

const constants = {} as typeof import("../../constants");
runInNewContext(compile("src/constants.ts"), {
    exports: constants, SIYUAN_VERSION: "test", NODE_ENV: "test",
    require: () => ({createDockKeymapDefaults}),
});
const {Constants} = constants;

const outlineFixture = (active = true, empty = false, responseCode = 0) => {
    const element = (width: string) => {
        const classes = new Set<string>();
        return {style: {width}, classList: {
            add: (name: string) => classes.add(name),
            remove: (name: string) => classes.delete(name),
            contains: (name: string) => classes.has(name),
        }};
    };
    const original = element("50%");
    const outline = element("50%");
    const other = element("25%");
    const models: Array<{blockId: string, type: string, parent: object}> = [];
    let splits = 0;
    let requests = 0;
    const wnd = {element: original, split: (direction: string, after: boolean) => {
        assert.equal(direction, "lr");
        assert.equal(after, false);
        splits++;
        return empty ? wnd : newWnd;
    }, addTab: (tab: {callback: (tab: object) => void}) => {
        tab.callback({id: "outline", parent: wnd, addModel: (model: typeof models[number]) => models.push(model)});
    }, removeTab: () => models.pop()};
    const newWnd = {element: outline, parent: {direction: "lr", children: [
        {element: outline}, {element: original}, {element: other},
    ]}, addTab: wnd.addTab, removeTab: wnd.removeTab};
    const util = {} as typeof import("./util");
    runInNewContext(compile("src/layout/dock/util.ts"), {
        exports: util,
        window: {siyuan: {layout: {centerLayout: {}}}},
        document: {querySelector: () => active ? {getAttribute: () => "active"} : null},
        require: () => ({Constants, getAllModels: () => ({outline: models}),
            getInstanceById: () => wnd, getWndByLayout: () => wnd,
            isEncryptedBox: () => false,
            fetchSyncPost: async () => {
                requests++;
                return {code: responseCode, data: {name: "Document", ial: {}}};
            },
            getDocDisplayName: (name: string) => name,
            Tab: class {constructor(options: object) {Object.assign(this, options);}},
            Outline: class {
                blockId: string;
                type: string;
                parent: object;
                constructor(options: {blockId: string, type: string, tab: object}) {
                    this.blockId = options.blockId;
                    this.type = options.type;
                    this.parent = options.tab;
                }
            },
        }),
    });
    const open = (title = "Document") => util.openOutline({
        app: undefined, rootId: "document", isPreview: false, title,
    });
    return {open, original, outline, other, models, splits: () => splits, requests: () => requests};
};

for (const active of [true, false]) {
    test(`document outline uses the default dock width and leaves other panes intact (active=${active})`, async () => {
        const fixture = outlineFixture(active);
        await fixture.open();
        const defaultWidth = Constants.SIYUAN_EMPTY_LAYOUT.left.data.flat().find(item => item.type === "outline").size.width;
        assert.equal(fixture.outline.style.width, `${defaultWidth}px`);
        assert.equal(fixture.outline.classList.contains("fn__flex-1"), false);
        assert.equal(fixture.original.style.width, "");
        assert.equal(fixture.original.classList.contains("fn__flex-1"), true);
        assert.equal(fixture.other.style.width, "25%");
        assert.equal(fixture.models.length, 1);
        await fixture.open();
        assert.equal(fixture.models.length, 0);
        assert.equal(fixture.splits(), 1);
        await fixture.open("");
        assert.equal(fixture.models.length, 1);
        assert.equal(fixture.requests(), 1);
        assert.equal(fixture.outline.style.width, `${defaultWidth}px`);
    });
}

test("opening an outline in an empty center keeps the unsplit window size", async () => {
    const fixture = outlineFixture(true, true);
    await fixture.open();
    assert.equal(fixture.original.style.width, "50%");
    assert.equal(fixture.models.length, 1);
});

test("failed document metadata does not split or resize an outline", async () => {
    const fixture = outlineFixture(true, false, -1);
    await fixture.open("");
    assert.equal(fixture.splits(), 0);
    assert.equal(fixture.models.length, 0);
    assert.equal(fixture.original.style.width, "50%");
});

for (const hidden of [false, true]) {
    test(`dock toggle tip describes the next action at startup, after clicks and shortcut toggles (hidden=${hidden})`, () => {
        const buttonAttributes = new Map<string, string>();
        const iconAttributes = new Map([["xlink:href", hidden ? "#iconDock" : "#iconHideDock"]]);
        const button = {id: "barDock", firstElementChild: {firstElementChild: null as unknown},
            setAttribute: (name: string, value: string) => buttonAttributes.set(name, value)};
        const icon = {
            getAttribute: (name: string) => iconAttributes.get(name),
            setAttribute: (name: string, value: string) => iconAttributes.set(name, value),
            closest: (selector: string) => selector === "#barDock" ? button : null,
        };
        button.firstElementChild.firstElementChild = icon;
        let click: (event: unknown) => void;
        const status = {innerHTML: "", addEventListener: (name: string, handler: typeof click) => {
            if (name === "click") click = handler;
        }};
        const uiLayout = {hideDock: hidden};
        const key = {custom: "Alt+D"};
        const dock = {isFloating: () => false};
        const siyuan = {config: {uiLayout, readonly: false, appearance: {hideStatusBar: false}, keymap: {general: {toggleDock: key}}},
            languages: {showDockBar: "Show dock bars", hideDockBar: "Hide dock bars"},
            layout: {leftDock: dock, rightDock: dock, bottomDock: dock}};
        const util = {} as typeof import("./util");
        const dependencies = {updateHotkeyTip: (value: string) => value,
            syncDockBarVisibility() {}, resizeTabs() {}, setTabPosition() {}};
        runInNewContext(compile("src/layout/dock/util.ts"), {
            exports: util, window: {siyuan}, require: () => dependencies,
        });
        const exports = {} as typeof import("../status");
        runInNewContext(compile("src/layout/status.ts"), {
            exports, window: {siyuan},
            document: {getElementById: () => status, querySelector: () => status},
            require: (name: string) => name === "./dock/util" ? util : {escapeAriaLabel,
                applyStatusBarEntryVisibility() {}, syncStatusBarVisibility() {}},
        });
        exports.initStatus();
        const action = (isHidden: boolean) => isHidden ? "Show dock bars" : "Hide dock bars";
        assert.ok(status.innerHTML.includes(`aria-label="${action(hidden)} Alt+D"`));
        click({target: button, stopPropagation() {}});
        assert.equal(uiLayout.hideDock, !hidden);
        assert.equal(buttonAttributes.get("aria-label"), `${action(!hidden)} Alt+D`);
        util.toggleDockBar(icon as unknown as Element);
        assert.equal(uiLayout.hideDock, hidden);
        assert.equal(buttonAttributes.get("aria-label"), `${action(hidden)} Alt+D`);
        key.custom = "";
        util.toggleDockBar(icon as unknown as Element);
        assert.equal(buttonAttributes.get("aria-label"), action(!hidden));
    });
}
