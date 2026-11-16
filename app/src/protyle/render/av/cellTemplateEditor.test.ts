import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {createSourceFile, forEachChild, isIfStatement, ModuleKind, Node, ScriptTarget, transpileModule} from "typescript";
import {loadModule} from "../../../testSupport/loadModule";

const source = createSourceFile("cell.ts", readFileSync("src/protyle/render/av/cell.ts", "utf8"), ScriptTarget.ES2022, true);
let loading: string;
const visit = (node: Node) => {
    if (isIfStatement(node) && node.expression.getText(source) === 'type === "template"' &&
        node.thenStatement.getText(source).includes('fetchPost("/api/av/renderAttributeView"')) {
        loading = node.thenStatement.getText(source);
    }
    forEachChild(node, visit);
};
visit(source);
assert.ok(loading);
const saving = source.statements.find(node => node.getText(source).startsWith("const updateCellValueByInput ="));
const compile = (code: string) => transpileModule(code, {compilerOptions: {target: ScriptTarget.ES2022}}).outputText;

const fixture = () => {
    const input = {value: "old query result", disabled: false, dataset: {} as Record<string, string>, focus() {}, select() {}};
    const mask = {isConnected: true, querySelector: () => input, remove: () => { mask.isConnected = false; }};
    const block = {dataset: {avId: "database", nodeId: "carrier"},
        getAttribute: (name: string) => name === "data-av-type" ? "table" : null, setAttribute() {}};
    const transactions: Array<[IOperation[], IOperation[]]> = [];
    let respond: (response: unknown) => void;
    let request: {ignoreRows?: boolean};
    const context = {inputElement: input, avMaskElement: mask, blockElement: block,
        cellElements: [{dataset: {}, classList: {add() {}}}], viewType: "table",
        getColId: () => "template", isTableLikeView: () => true,
        getFieldsByData: (data: {view: {columns: unknown[]}}) => data.view.columns,
        isAVRenderData: (data: {view?: unknown}) => !!data?.view,
        fetchPost: (_url: string, data: typeof request, callback: typeof respond) => { request = data; respond = callback; },
        document: {querySelector: () => mask, querySelectorAll: () => [mask]},
        hasClosestByClassName: (_element: unknown, name: string) => name === "av__row" ? {dataset: {id: "row"}} : null,
        addDragFill() {}, transaction: (_editor: unknown, operations: IOperation[], undo: IOperation[]) => transactions.push([operations, undo]),
    };
    runInNewContext(compile(loading), context);
    const close = runInNewContext(compile(saving.getText(source)) + "\nupdateCellValueByInput;", context);
    return {input, transactions, request: () => request,
        close: () => close({}, "template", block, context.cellElements, false),
        reply: () => respond({code: 0, data: {view: {columns: [{id: "template", template: "source code"}]}}})};
};

test("closing a template cell before its source arrives never saves the displayed HTTP result", () => {
    const f = fixture();
    assert.equal(f.request().ignoreRows, true);
    assert.equal(f.input.disabled, true);
    assert.equal(f.input.value, "");
    f.close();
    f.reply();
    assert.equal(f.transactions.length, 0);
    assert.equal(f.input.value, "");
});

test("unchanged template source is not saved and intentional edits preserve the undo source", () => {
    const unchanged = fixture();
    unchanged.reply();
    unchanged.close();
    assert.equal(unchanged.transactions.length, 0);
    const changed = fixture();
    changed.reply();
    assert.equal(changed.input.disabled, false);
    changed.input.value = "new source";
    changed.close();
    assert.equal(changed.transactions.length, 1);
    assert.equal(changed.transactions[0][0][0].data, "new source");
    assert.equal(changed.transactions[0][1][0].data, "source code");
});

const cellValues = loadModule<typeof import("./cellValue")>("src/protyle/render/av/cellValue.ts", {require: () => ({})});
const cellDeclarations = ["getStoredCellValueByElement", "getStableTextCells", "popTextCell"].map(name =>
    source.statements.find(node => node.getText(source).startsWith(`const ${name} =`) ||
        node.getText(source).startsWith(`export const ${name} =`)).getText(source)).join("\n");
const cellCode = transpileModule(cellDeclarations, {compilerOptions: {
    target: ScriptTarget.ES2022, module: ModuleKind.CommonJS,
}}).outputText;

const textCellFixture = (template: boolean, rich = false, type: "text" | "block" = "text") => {
    const value: IAVCellValue = {id: "value", keyID: "column", blockID: "row", type,
        ...(type === "block" ? {block: {content: "Original", id: ""}} : {text: {content: "Original",
            ...(rich ? {rich: {spec: 1, format: "kramdown", content: "**Original**"}} : {})}})};
    const rendered = {textContent: "Template output", dataset: {cellValue: encodeURIComponent(JSON.stringify({
        ...value, ...(template ? {hasRenderTemplate: true, renderedContent: "Template output"} : {}),
    }))}};
    const input = Object.assign(new EventTarget(), {value: "", dataset: {} as Record<string, string>, select() {}, focus() {}});
    const mask = Object.assign(new EventTarget(), {querySelector: () => input});
    let legacy = false;
    let editor: Parameters<typeof import("./richTextEditor").openAVRichTextEditor>[0];
    const saves: unknown[][] = [];
    const row = {dataset: {id: "row"}, getAttribute: () => "0", classList: {contains: () => true}};
    const group = {dataset: {groupId: "group"}, getAttribute: () => "group"};
    const cell = {dataset: {dtype: type, id: "value"}, isConnected: true,
        classList: {add() {}}, getAttribute: () => "column", matches: () => false,
        closest: (selector: string) => selector.includes("av__body") ? group : row,
        getBoundingClientRect: () => ({left: 10, top: 20, bottom: 50, width: 200, height: 30}),
        querySelector: (selector: string) => selector.includes("av__celltext--template") ? template ? rendered : null : rendered,
        parentElement: {querySelectorAll: (): unknown[] => [cell]},
    };
    const block = {dataset: {avType: "table", avId: "database", nodeId: "carrier"}, getAttribute: () => "table"};
    const exports = {} as typeof import("./cell");
    const context = {exports,
        document: {querySelector: () => legacy ? mask : null,
            body: {insertAdjacentHTML: () => { legacy = true; }}},
        window: {siyuan: {menus: {menu: {remove() {}}}, zIndex: 0}},
        getComputedStyle: () => ({}),
        hasClosestBlock: () => block,
        hasClosestByClassName: (_element: unknown, name: string) => name === "av__row" ? row : name === "av__body" ? group : null,
        getAVRelationHost: (): undefined => undefined,
        isTableLikeView: () => true,
        getFieldIdByCellElement: () => "row", getColId: () => "column",
        createAVStableTextCell: cellValues.createAVStableTextCell,
        genCellValueByElement: () => value,
        openAVRichTextEditor: (options: typeof editor) => { editor = options; },
        updateCellsValue: async (...args: unknown[]) => { saves.push(args); },
        isAVRichTextType: () => true,
        createCellInputTarget: () => (): undefined => undefined,
        escapeAttr: String, bindAnchoredInputPosition() {}, callMobileAppShowKeyboard() {}, addDragFill() {},
        getAVHostIdentity: () => "carrier", AV_CELL_EDITOR_CLOSE_EVENT: "cell-close",
    };
    runInNewContext(cellCode, context);
    exports.popTextCell({} as IProtyle, [cell] as unknown as HTMLElement[], type, {scrollIntoView: false});
    return {value, editor, saves, legacy};
};

test("text cells with display templates edit their raw plain or rich value in the rich-text editor", () => {
    for (const rich of [false, true]) {
        const f = textCellFixture(true, rich);
        assert.ok(f.editor, "a display template must not divert text cells into the legacy textarea");
        assert.equal(f.legacy, false);
        assert.deepEqual(JSON.parse(JSON.stringify(f.editor.value)), f.value);
        assert.equal(f.editor.stableCells[0].groupID, "group");
        assert.equal(f.editor.stableCells[0].rowID, "row");
        assert.equal(f.editor.stableCells[0].colID, "column");
        assert.equal(f.editor.value.renderedContent, undefined);
        assert.equal(f.editor.value.hasRenderTemplate, undefined);
    }
});

test("template text edits save the rich value with the original cell identity and undo source", async () => {
    const f = textCellFixture(true, true);
    assert.ok(f.editor);
    const edited: IAVCellValue = {...f.value, text: {content: "Edited",
        rich: {spec: 1, format: "kramdown", content: "**Edited**"}}};
    await f.editor.onSave(edited, f.editor.nodeElement, f.editor.stableCells);
    assert.equal(f.saves.length, 1);
    assert.equal(f.saves[0][2], edited);
    assert.equal(f.saves[0][9], f.editor.stableCells);
    assert.deepEqual(JSON.parse(JSON.stringify(f.editor.stableCells[0].cell.value)), f.value);
    assert.equal(f.saves[0][10], true);
    assert.equal(f.saves[0][11], true);
});

test("ordinary text cells retain the rich-text editor and templated primary cells retain their input", () => {
    const text = textCellFixture(false, true);
    assert.ok(text.editor);
    assert.equal(text.legacy, false);
    const primary = textCellFixture(true, false, "block");
    assert.equal(primary.editor, undefined);
    assert.equal(primary.legacy, true);
});
