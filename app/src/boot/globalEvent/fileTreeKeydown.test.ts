import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {createSourceFile, isVariableStatement, ScriptTarget, transpileModule} from "typescript";
import {getDocTreeActionItems} from "../../menus/navigationSelection";

const source = createSourceFile("keydown.ts", readFileSync("src/boot/globalEvent/keydown.ts", "utf8"), ScriptTarget.Latest, true);
const declaration = source.statements.find(statement => isVariableStatement(statement) &&
    statement.declarationList.declarations.some(item => item.name.getText(source) === "fileTreeKeydown"));
const compiled = transpileModule(declaration.getText(source), {compilerOptions: {target: ScriptTarget.ES2022}}).outputText;

const fixture = (count = 1) => {
    const calls: unknown[][] = [];
    const items = Array.from({length: count}, (_, index) => ({id: String(index), notebookId: "box",
        path: `/${index}.sy`, name: String(index), kind: "document", occurrenceKey: `box/${index}`}));
    const controller = {
        getSelectedItems: () => items,
        getSelectionElements: () => { throw new Error("keyboard actions must not materialize selection DOM"); },
        focusRelative: (delta: number, extend: boolean) => calls.push(["relative", delta, extend]),
        focusBoundary: (edge: string, extend: boolean) => calls.push(["boundary", edge, extend]),
        expandFocused: () => calls.push(["expand"]),
        collapseFocused: () => calls.push(["collapse"]),
        toggle: (key: string) => calls.push(["toggle", key]),
    };
    const keys = new Proxy({}, {get: (_target, key) => key});
    const files = {docTree: controller, element: {parentElement: {classList: {contains: () => true}}}};
    let shortcut = "";
    const handle = runInNewContext(compiled + "\nfileTreeKeydown;", {
        getDockByType: () => ({data: {file: files}}),
        getActiveDocTreeController: () => controller,
        getDocTreeActionItems,
        dispatchPluginShortcut: () => false,
        matchHotKey: (configured: string) => configured === shortcut,
        window: {siyuan: {config: {keymap: {general: keys, editor: {general: keys}}},
            menus: {menu: {remove() {}}}}},
        document: {querySelector: (): null => null},
        Constants: {CB_GET_FOCUS: "focus", DIALOG_CONFIRM: "confirm"},
        isNotCtrl: () => true,
        isEncryptedBox: () => false,
        isMac: () => false,
        hasClosestByAttribute: () => false,
        hasClosestByClassName: () => false,
        deleteDocTreeItems: (selected: typeof items) => calls.push(["delete", selected]),
        openFileById: (options: {id: string}) => calls.push(["open", options.id]),
        openCardByScope: (_app: object, ...scope: unknown[]) => calls.push(["card", ...scope]),
        getDisplayName: (name: string) => name,
        getNotebookName: (id: string) => `Notebook ${id}`,
        execByCommand: (options: {command: string, fileLiElements: Element[]}) => calls.push(["command", options]),
    }) as (_app: object, event: KeyboardEvent) => boolean;
    return {
        calls, items,
        shortcut: (value: string) => { shortcut = value; },
        press: (key: string, shiftKey = false) => handle({}, {
            key, shiftKey, target: {tagName: "DIV"}, preventDefault() {}, stopPropagation() {},
        } as unknown as KeyboardEvent),
    };
};

test("virtual tree keyboard navigation never builds DOM for a large offscreen selection", () => {
    const f = fixture(10000);
    for (const [key, shift] of [["ArrowDown", false], ["ArrowUp", true], ["Home", true], ["End", false]] as const) {
        assert.equal(f.press(key, shift), true);
    }
    assert.deepEqual(f.calls, [["relative", 1, false], ["relative", -1, true],
        ["boundary", "first", true], ["boundary", "last", false]]);
});

test("virtual tree delete and enter operate on complete deduplicated metadata", () => {
    const f = fixture(3);
    f.items.push({...f.items[0], occurrenceKey: "pinned/0"});
    assert.equal(f.press("Delete"), true);
    assert.equal((f.calls[0][1] as unknown[]).length, 3);
    f.calls.length = 0;
    assert.equal(f.press("Enter"), true);
    assert.deepEqual(f.calls, [["open", "0"], ["open", "1"], ["open", "2"]]);
});

test("virtual tree native shortcuts capture logical selection without selection DOM", () => {
    const f = fixture(1000);
    f.shortcut("move");
    assert.equal(f.press("m"), true);
    assert.equal(f.calls[0][0], "command");
    const options = f.calls[0][1] as {command: string, fileLiElements: Element[]};
    assert.equal(options.command, "move");
    assert.equal(options.fileLiElements.length, 0);
});

test("virtual tree flashcard shortcuts open v2 scopes from logical document and notebook metadata", () => {
    const document = fixture(10000);
    document.shortcut("spaceRepetition");
    assert.equal(document.press("r"), true);
    assert.deepEqual(document.calls, [["card", "doc", "0", "0", true]]);

    const notebook = fixture();
    notebook.items[0].kind = "notebook";
    notebook.shortcut("spaceRepetition");
    assert.equal(notebook.press("r"), true);
    assert.deepEqual(notebook.calls, [["card", "notebook", "box", "Notebook box", true]]);
});
