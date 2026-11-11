import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {createSourceFile, isCallExpression, ModuleKind, Node, ScriptTarget, transpileModule} from "typescript";
import {loadModule} from "../../../testSupport/loadModule";
import {createAVCellUpdateOperation} from "./cellValue";
import {isAVReadonlyType} from "./capabilities";
import {getAVHostIdentity} from "./host";

const source = createSourceFile("cell.ts", readFileSync("src/protyle/render/av/cell.ts", "utf8"), ScriptTarget.Latest);
const inputSave = source.statements.find(statement => statement.getText(source).startsWith("const updateCellValueByInput"));
let inputKeydown: Node;
const findInputKeydown = (node: Node) => {
    if (isCallExpression(node) && node.expression.getText(source) === "inputElement.addEventListener" &&
        node.arguments[0].getText(source) === '"keydown"' && node.arguments[1].getText(source).includes("savingContinuousInput")) {
        inputKeydown = node.arguments[1];
    }
    node.forEachChild(findInputKeydown);
};
findInputKeydown(source);
assert.ok(inputSave && inputKeydown);
const inputCode = transpileModule(`let savingContinuousInput = false; ${inputSave.getText(source)}
const handler = ${inputKeydown.getText(source)}; handler;`, {compilerOptions: {target: ScriptTarget.ES2022}}).outputText;
const continuous = loadModule<typeof import("./continuousInput")>("src/protyle/render/av/continuousInput.ts", {require: () => ({})});

test("fallback text input leaves Enter available for multiline editing", async () => {
    const input = {value: "First\nSecond", disabled: false};
    const keydown = runInNewContext(inputCode, {
        type: "text", inputElement: input, electronUndo: () => false, isNotCtrl: () => true,
        isAVContinuousInputKey: continuous.isAVContinuousInputKey,
        prepareAVContinuousInput: () => assert.fail("text Enter must keep editing"),
    }) as (event: KeyboardEvent) => Promise<void>;
    for (const options of [{}, {repeat: true}, {shiftKey: true}, {isComposing: true}]) {
        const event: Partial<KeyboardEvent> = {key: "Enter", ...options,
            preventDefault: () => assert.fail("text Enter must reach the textarea"),
            stopPropagation: () => assert.fail("text Enter must propagate"),
        };
        await keydown(event as KeyboardEvent);
        assert.equal(input.value, "First\nSecond");
        assert.equal(input.disabled, false);
    }
});

test("ordinary and range text inputs confirm once, retain failed drafts and respect moved focus", async () => {
    for (const {type, result} of ["number", "text"].flatMap(type =>
        ["saved", "failed", "focusMoved"].map(result => ({type, result})))) {
        let complete: () => void;
        let fail: () => void;
        const saving = new Promise<void>((resolve, reject) => {complete = resolve; fail = () => reject(new Error("failed"));});
        let saves = 0;
        let next = 0;
        let errors = 0;
        const input = {value: "42", dataset: {changed: "true"}, disabled: false};
        const cell = {dataset: {dtype: type}, classList: {add() {}}};
        const block = {isConnected: true, getAttribute: (key: string) => key === "data-av-type" ? "table" : "database"};
        const mask = {isConnected: true, querySelector: () => input, contains: () => false, remove() {this.isConnected = false;}};
        const body = {};
        const document = {body, activeElement: body, querySelector: (key: string) => key === ".av__mask" ? mask : null};
        const keydown = runInNewContext(inputCode, {
            protyle: {}, type, blockElement: block, cellElements: [cell], inputElement: input, avMaskElement: mask,
            inputTarget: () => ({elements: [cell], cells: [] as import("./selectionState").IAVSelectedCell[]}), electronUndo: () => false,
            isAVContinuousInputKey: continuous.isAVContinuousInputKey,
            prepareAVContinuousInput: (_protyle: unknown, _block: unknown, _cells: unknown, _open: unknown, rangeOnly: boolean) => {
                assert.equal(rangeOnly, type === "text");
                return () => {next++;};
            },
            updateCellsValue: (...args: unknown[]) => {
                assert.equal(args.at(-1), true);
                saves++;
                return saving;
            },
            hasClosestByClassName: (): null => null, isTableLikeView: () => true, addDragFill() {}, focusBlock() {},
            document,
            window: {siyuan: {languages: {settingsPendingSaveError: "failed"}}},
            showMessage: () => {errors++;}, console: {error() {}},
        }) as (event: KeyboardEvent) => Promise<void>;
        const event = {key: "Enter", ctrlKey: type === "text", preventDefault() {}, stopPropagation() {}} as KeyboardEvent;
        const pending = keydown(event);
        assert.equal(saves, 1);
        assert.equal(next, 0);
        assert.equal(input.disabled, true);
        await keydown(event);
        assert.equal(saves, 1);
        if (result === "focusMoved") document.activeElement = {};
        if (result === "failed") fail();
        else complete();
        await pending;
        assert.equal(next, result === "saved" ? 1 : 0);
        assert.equal(mask.isConnected, result === "failed");
        assert.equal(input.disabled, false);
        assert.equal(errors, result === "failed" ? 1 : 0);
        assert.equal(input.value, "42");
    }
});
const declaration = source.statements.find(statement => statement.getText(source).startsWith("export const updateCellsValue"));
const code = transpileModule(declaration.getText(source), {compilerOptions: {
    module: ModuleKind.CommonJS, target: ScriptTarget.ES2022,
}}).outputText;

const fixture = () => {
    const previous = {id: "value", type: "text", text: {content: "original"}};
    const selected = {rowID: "row", colID: "column", column: {type: "text"}, cell: {id: "value", value: previous}};
    const updates: string[] = [];
    let complete: () => void;
    let fail: (error: Error) => void;
    let requests = 0;
    const node = {isConnected: true, dataset: {avId: "database", nodeId: "carrier"},
        getAttribute: (name: string) => name === "data-av-type" ? "table" : "previous-time"};
    const exports = {} as typeof import("./cell");
    runInNewContext(code, {exports,
        getAVRelationHost: (): undefined => undefined,
        isAVReadonlyType,
        getAVBatchEditMode: () => "replace",
        cloneAVCellValueSnapshot: structuredClone,
        getCellValueText: (value: typeof previous) => value.text.content,
        transformCellValue: (_type: string, value: unknown) => structuredClone(value),
        rebindAVCellValue: (value: object, ids: object) => ({...value, ...ids}),
        objEquals: (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b),
        createAVCellUpdateOperation,
        dayjs: () => ({format: () => "current-time"}),
        updateAttrViewCellInOtherElements: (_protyle: unknown, _av: string, _row: string, _col: string, value: typeof previous) =>
            updates.push(value.text.content),
        updateAVSelectedCellValue: () => {},
        transaction: (_protyle: unknown, operations: IOperation[], _undo: IOperation[], options: {awaitResponse: boolean}) => {
            assert.equal(options.awaitResponse, true);
            assert.equal(operations[0].action, "updateAttrViewCell");
            requests++;
            return new Promise<void>((resolve, reject) => { complete = resolve; fail = reject; });
        },
    });
    const save = () => exports.updateCellsValue({} as IProtyle, node as unknown as HTMLElement,
        {type: "text", text: {content: "draft"}}, undefined, undefined, undefined,
        false, false, false, [selected] as unknown as import("./selectionState").IAVSelectedCell[], true, true);
    return {save, node, previous, updates, requests: () => requests,
        complete: () => complete(), fail: () => fail(new Error("Save failed"))};
};

test("database text saves retain the original cache until the transaction succeeds", async () => {
    const f = fixture();
    const saving = f.save();
    assert.equal(f.requests(), 1);
    assert.deepEqual(f.updates, []);
    f.complete();
    await saving;
    assert.deepEqual(f.updates, ["draft"]);
});

test("failed database text saves do not cache an unsaved draft and permit explicit retry", async () => {
    const f = fixture();
    const saving = f.save();
    const rejected = assert.rejects(saving, /Save failed/);
    f.fail();
    await rejected;
    assert.deepEqual(f.updates, []);
    assert.equal(f.previous.text.content, "original");
    const retry = f.save();
    assert.equal(f.requests(), 2);
    f.complete();
    await retry;
    assert.deepEqual(f.updates, ["draft"]);
});

test("database text acknowledgements do not repopulate an invalidated owner", async () => {
    const f = fixture();
    const saving = f.save();
    f.node.isConnected = false;
    f.complete();
    await saving;
    assert.deepEqual(f.updates, []);
});

test("location editor saves await cell persistence and preserve the original target", async () => {
    const declaration = source.statements.find(statement => statement.getText(source).startsWith("export const popTextCell"));
    const exports = {} as typeof import("./cell");
    const previous = {id: "value", type: "location", location: {name: "original"}};
    const block = {isConnected: true, dataset: {avId: "database", nodeId: "carrier"},
        getAttribute: () => "table", querySelector: () => ({})};
    const cell = {dataset: {}, getBoundingClientRect: () => ({}), closest: (): null => null};
    const protyle = {block: {rootID: "document"}, options: {}};
    let editor: {onSave: (value: object) => Promise<void>; avBlockID: string};
    let complete: () => void;
    let fail: (error: Error) => void;
    let requests = 0;
    runInNewContext(transpileModule(declaration.getText(source), {compilerOptions: {
        module: ModuleKind.CommonJS, target: ScriptTarget.ES2022,
    }}).outputText, {exports,
        document: {querySelector: (): null => null}, getComputedStyle: () => ({}),
        window: {siyuan: {config: {}, menus: {menu: {remove() {}}}}},
        hasClosestBlock: () => block, hasClosestByClassName: () => ({}),
        getAVHostIdentity,
        isTableLikeView: () => true, cellScrollIntoView() {},
        getStoredCellValueByElement: () => previous,
        genCellValueByElement: () => previous, cloneAVCellValueSnapshot: structuredClone,
        getAVCellEditorOwner: () => ({contains: () => true}),
        getFieldIdByCellElement: () => "row", getColId: () => "column", getAVData: (): null => null,
        openAVLocationEditor: (options: typeof editor) => { editor = options; },
        updateCellsValue: (...args: unknown[]) => {
            assert.equal(args[0], protyle);
            assert.equal(args[1], block);
            const cells = args[9] as Array<{rowID: string; colID: string}>;
            assert.equal(cells[0].rowID, "row");
            assert.equal(cells[0].colID, "column");
            assert.equal(args[10], true);
            assert.equal(args[11], true);
            requests++;
            return new Promise<void>((resolve, reject) => { complete = resolve; fail = reject; });
        },
    });
    exports.popTextCell(protyle as IProtyle, [cell] as unknown as HTMLElement[], "location");
    assert.equal(editor.avBlockID, "carrier");
    const saving = editor.onSave({name: "draft"});
    let resolved = false;
    void saving.then(() => { resolved = true; }, () => {});
    await Promise.resolve();
    assert.equal(resolved, false);
    const rejected = assert.rejects(saving, /Save failed/);
    fail(new Error("Save failed"));
    await rejected;
    const retry = editor.onSave({name: "draft"});
    complete();
    await retry;
    assert.equal(requests, 2);
    block.dataset.nodeId = "different-carrier";
    await editor.onSave({name: "redirected"});
    assert.equal(requests, 2);
    block.dataset.nodeId = "carrier";
    block.isConnected = false;
    await editor.onSave({name: "stale"});
    assert.equal(requests, 2);
});
