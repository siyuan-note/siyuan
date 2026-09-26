import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {createSourceFile, forEachChild, isIfStatement, isVariableStatement, ModuleKind, ScriptTarget, transpileModule} from "typescript";
import * as bindings from "../../util/keymapBindings";
import {isDisallowedTextInputHotkey, isReservedKeymap} from "../../util/hotKeyPolicy";

const evaluate = (source: string, globals: Record<string, unknown>) => {
    const exports: Record<string, any> = {};
    runInNewContext(transpileModule(source, {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
    }).outputText, {exports, ...globals});
    return exports;
};

const constants = evaluate(readFileSync("src/constants.ts", "utf8"), {
    SIYUAN_VERSION: "test", NODE_ENV: "test",
}).Constants;

const loadFunction = (path: string, name: string, globals: Record<string, unknown>) => {
    const source = createSourceFile(path, readFileSync(path, "utf8"), ScriptTarget.ES2021, true);
    const declaration = source.statements.find(statement => isVariableStatement(statement) &&
        statement.declarationList.declarations.some(item => item.name.getText(source) === name));
    assert.ok(declaration);
    return evaluate(`${declaration.getText(source)}\nexports.subject = ${name};`, globals).subject;
};

const menuPaths = [
    "src/protyle/wysiwyg/keydown.ts",
    "src/protyle/render/av/keydown.ts",
    "src/boot/globalEvent/searchKeydown.ts",
    "src/boot/globalEvent/keydown.ts",
];

for (const mac of [false, true]) {
    const {matchHotKey} = evaluate(readFileSync("src/protyle/util/hotKey.ts", "utf8"), {
        require: (name: string) => name.endsWith("compatibility") ? {
            isMac: () => mac,
            isOnlyMeta: (event: KeyboardEvent) => mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey,
            isNotCtrl: (event: KeyboardEvent) => !event.ctrlKey && !event.metaKey,
        } : name.endsWith("constants") ? {Constants: constants} : bindings,
    });
    for (const path of menuPaths) {
        test(`context menu respects defaults, rebindings and unbinding: ${path}, mac=${mac}`, () => {
            const source = createSourceFile(path, readFileSync(path, "utf8"), ScriptTarget.ES2021, true);
            let branch = "";
            const find = (node: import("typescript").Node) => {
                if (isIfStatement(node) && node.expression.getText(source).includes("matchHotKey(window.siyuan.config.keymap.general.openContextMenu, event)")) {
                    branch = node.getText(source);
                    return;
                }
                forEachChild(node, find);
            };
            find(source);
            assert.ok(branch);
            const item = bindings.mergeKeymapDefault(undefined, constants.SIYUAN_KEYMAP.general.openContextMenu);
            const run = (keyCode: number) => {
                let opened = 0;
                let prevented = false;
                const element = {getBoundingClientRect: () => ({left: 1, top: 2, right: 3, bottom: 4}),
                    querySelector: () => element};
                const menu = {popup: () => { opened++; }};
                evaluate(`const run = () => { ${branch} }; run();`, {
                    window: {siyuan: {config: {keymap: {general: {openContextMenu: item}}}, menus: {menu}}},
                    event: {keyCode, ctrlKey: !mac, metaKey: mac, altKey: false, shiftKey: false,
                        stopPropagation() {}, preventDefault() { prevented = true; }},
                    matchHotKey, isInEmbedBlock: () => false,
                    nodeElement: element, selectRowElements: [element], liElements: [element],
                    protyle: {wysiwyg: {element: {querySelectorAll: () => [element]}}, gutter: {renderMenu() {}}},
                    avContextmenu: () => { opened++; }, currentList: element, id: "block",
                    initSearchMenu: () => menu, initFileMenu: () => menu,
                    isFile: true, app: {}, notebookId: "box", pathString: "/doc.sy",
                });
                return {opened, prevented};
            };
            assert.equal(run(191).opened, 1);
            bindings.setKeymapBindings(item, ["⌘K", "⌘L"]);
            assert.equal(run(191).opened, 0);
            assert.equal(run(75).opened, 1);
            assert.equal(run(76).opened, 1);
            bindings.setKeymapBindings(item, []);
            assert.equal(run(191).opened, 0);
            assert.equal(run(75).opened, 0);
        });
    }
}

test("context menu shortcut is assignable while slash text remains protected", () => {
    assert.equal(isReservedKeymap("⌘/", ["editor", "general", "undo"]), false);
    assert.equal(isDisallowedTextInputHotkey("⌘/"), false);
    assert.equal(isDisallowedTextInputHotkey("/"), true);
});

test("startup adds context menu defaults and preserves an explicitly empty binding", () => {
    const keymap = {general: {}};
    const match = loadFunction("src/boot/globalEvent/commonHotkey.ts", "matchKeymap", {
        window: {siyuan: {config: {keymap}}}, Constants: constants,
        ipcRenderer: {send() {}}, mergeKeymapDefault: bindings.mergeKeymapDefault,
    });
    const defaults = {openContextMenu: constants.SIYUAN_KEYMAP.general.openContextMenu};
    match(defaults, "general");
    const item = bindings.getKeymapItem(keymap, ["general", "openContextMenu"]);
    assert.deepEqual(bindings.getKeymapBindings(item), ["⌘/"]);
    bindings.setKeymapBindings(item, []);
    match(defaults, "general");
    assert.deepEqual(bindings.getKeymapBindings(item), []);
});

test("mobile leaves unhandled context menu shortcuts available to plugin dispatch", () => {
    let dispatched = 0;
    const mobileKeydown = loadFunction("src/mobile/util/keydown.ts", "mobileKeydown", {
        window: {siyuan: {config: {keymap: {general: {openContextMenu: {custom: "⌘/"}}}}}},
        filterHotkey: () => false,
        matchHotKey: () => { throw new Error("Context menu must be handled locally"); },
        captureShortcutContext: () => ({}),
        dispatchPluginShortcut: () => { dispatched++; },
    });
    mobileKeydown({}, {key: "/", preventDefault() { throw new Error("Unexpected default prevention"); }});
    assert.equal(dispatched, 1);
    mobileKeydown({}, {key: "/", defaultPrevented: true});
    assert.equal(dispatched, 1);
});

test("keymap panel marks context menu conflicts and clears them after unbinding", () => {
    const item = {...constants.SIYUAN_KEYMAP.general.openContextMenu};
    const keymap = {general: {openContextMenu: item}, editor: {general: {undo: {custom: "⌘/"}}}};
    const rows = ["general.openContextMenu", "editor.general.undo"].map(path => ({
        dataset: {key: path.replaceAll(".", constants.ZWSP), keys: '["⌘/"]', defaults: '["⌘/"]', conflict: "false"},
        querySelector: () => ({querySelector: () => ({style: {}, tabIndex: 0})}),
        querySelectorAll: () => [],
    }));
    let hidden = true;
    const filter = {dataset: {keymapFilterValue: "conflict"}, setAttribute() {},
        classList: {toggle: (name: string, value: boolean) => { if (name === "fn__none") { hidden = value; } }}};
    const list = {dataset: {keymapFilter: "all"},
        querySelector: (selector: string) => selector === '[data-conflict="true"]' ?
            rows.find(row => row.dataset.conflict === "true") : {value: "", dataset: {}},
        querySelectorAll: () => [filter]};
    const refresh = loadFunction("src/config/tabs/keymapUi.ts", "refreshKeymapBindings", {
        window: {siyuan: {config: {keymap}}}, Constants: constants, isMac: () => false,
        getRowBindings: (row: typeof rows[number]) => JSON.parse(row.dataset.keys),
        getKeymapItem: bindings.getKeymapItem, normalizeShortcutKey: bindings.normalizeShortcutKey,
        searchKeymapList() {},
    });
    const root = {querySelectorAll: () => rows, querySelector: () => list};
    refresh(root);
    assert.equal(hidden, false);
    assert.ok(rows.every(row => row.dataset.conflict === "true"));
    bindings.setKeymapBindings(item, []);
    rows[0].dataset.keys = "[]";
    refresh(root);
    assert.equal(hidden, true);
    assert.ok(rows.every(row => row.dataset.conflict === "false"));
});
