import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {createSourceFile, isClassDeclaration, ScriptTarget, transpileModule} from "typescript";
import {getAVBindingOperations} from "../render/av/binding";
import {shouldCaptureHintUndoFocus} from "./blockHintRange";

const source = createSourceFile("index.ts", readFileSync(join(__dirname, "index.ts"), "utf8"), ScriptTarget.Latest);
const declaration = source.statements.find(node => isClassDeclaration(node) && node.name.text === "Hint");
assert.ok(declaration && isClassDeclaration(declaration));
const methods = declaration.members.filter(member => ["fillCommand", "fill"].includes(member.name?.getText(source)))
    .map(member => member.getText(source)).join("\n");
const code = transpileModule(`class Hint { ${methods} } new Hint();`, {
    compilerOptions: {target: ScriptTarget.ES2020},
}).outputText;

for (const scenario of ["database shortcut", "database mobile toolbar", "tag search"]) {
    test(`direct table insertion ignores residual ${scenario} context`, () => {
        let rangeReads = 0;
        let updated = false;
        let mutated = false;
        const original = {
            outerHTML: "original paragraph",
            getAttribute: (name: string) => name === "data-type" ? "NodeParagraph" : "original",
            querySelector: (): null => null,
            remove() {}, insertAdjacentHTML() {}, nextElementSibling: undefined as unknown,
        };
        const inserted = {
            outerHTML: "inserted table",
            getAttribute: (name: string) => name === "data-type" ? "NodeTable" : "new-table",
            querySelectorAll: (): HTMLElement[] => [], classList: {contains: () => false}, previousElementSibling: original,
        };
        original.nextElementSibling = inserted;
        const range = {startContainer: original, deleteContents() { mutated = true; }};
        const staleRange = {startContainer: {}};
        const savedRange = scenario === "database mobile toolbar";
        const hint = runInNewContext(code, {
            Constants: {BLOCK_HINT_KEYS: ["(("], INLINE_TYPE: [], ZWSP: "\u200b"},
            Lute: {Caret: "caret"}, Element: class {}, getSelection: (): null => null,
            document: {createElement: () => ({innerHTML: "", firstElementChild: {
                getAttribute: () => "NodeTable",
            }})},
            hideElements() {}, isProtyleListItemFragment: () => false,
            getEditorRange: () => { rangeReads++; return range; },
            hasClosestBlock: (node: unknown) => node === original ? original : null,
            hasClosestByClassName: () => false,
            shouldCaptureHintUndoFocus, getUndoFocusContext: () => ({}),
            getAVBindingCell: () => { throw new Error("table command entered database binding"); },
            getContenteditableElement: () => ({textContent: ""}),
            getSuperBlockCommandLayout: (): undefined => undefined,
            focusByWbr() {},
            updateTransaction: (_protyle: unknown, element: unknown, html: string) => {
                assert.equal(element, inserted);
                assert.equal(html, original.outerHTML);
                updated = true;
            },
        });
        Object.assign(hint, {source: scenario === "tag search" ? "hint" : "av", splitChar: "#", lastIndex: 12,
            hashTagSearchElement: {isConnected: false}, fixImageCursor() {}});
        const protyle = {
            toolbar: {range: savedRange ? range : staleRange}, wysiwyg: {element: {}},
            lute: {SpinBlockDOM: () => "new table"},
        };
        hint.fillCommand("| caret |\n| --- |", protyle, !savedRange);
        assert.equal(updated, true);
        assert.equal(mutated, true);
        assert.equal(rangeReads, savedRange ? 0 : 1);
        assert.equal(protyle.toolbar.range, range);
        assert.equal(hint.hashTagSearchElement, undefined);
    });
}

test("selecting a database binding candidate retains its field and creates a binding transaction", () => {
    let operations: IOperation[];
    const cell = {isConnected: true, hasAttribute: () => false};
    const row = {dataset: {id: "item"}};
    const block = {dataset: {nodeId: "database-block"}, getAttribute: () => "database"};
    const range = {startContainer: cell};
    const previousValue = {type: "block", isDetached: true, block: {content: "Draft"}};
    const hint = runInNewContext(code, {
        Constants: {BLOCK_HINT_KEYS: ["(("]},
        window: {siyuan: {}}, hideElements() {}, isProtyleListItemFragment: () => false,
        hasClosestBlock: () => block, getAVBindingCell: () => cell,
        isTableLikeView: () => true, hasClosestByClassName: () => row,
        genCellValueByElement: () => previousValue, getAVBindingOperations,
        document: {createElement: () => ({innerHTML: "", firstElementChild: {
            getAttribute: () => "target-block", textContent: "Target",
        }})},
        getEditorRange: () => { throw new Error("binding candidate replaced its saved field range"); },
        transaction: (_protyle: unknown, doOperations: IOperation[]) => { operations = doOperations; },
        updateAttrViewCellAnimation() {},
    });
    Object.assign(hint, {source: "av", splitChar: "/", lastIndex: -1});
    const protyle = {id: "editor", toolbar: {range}, options: {}};
    hint.fill('<span data-id="target-block">Target</span>', protyle);
    assert.equal(protyle.toolbar.range, range);
    assert.equal(operations.length, 1);
    assert.equal(operations[0].action, "replaceAttrViewBlock");
    assert.equal(operations[0].previousID, "item");
    assert.equal(operations[0].nextID, "target-block");
});
