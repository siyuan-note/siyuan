import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {createSourceFile, isClassDeclaration, ScriptTarget, transpileModule} from "typescript";
import {shouldCaptureHintUndoFocus} from "./blockHintRange";

const source = createSourceFile("index.ts", readFileSync(join(__dirname, "index.ts"), "utf8"), ScriptTarget.Latest);
const declaration = source.statements.find(node => isClassDeclaration(node) && node.name.text === "Hint");
assert.ok(declaration && isClassDeclaration(declaration));
const fill = declaration.members.find(member => member.name?.getText(source) === "fill").getText(source);

for (const scenario of ["replace", "insert", "empty-list-item", "list-item"]) {
    test(`slash undo retains the original caret for ${scenario}`, () => {
        const inList = scenario.includes("list-item");
        const empty = scenario === "replace" || scenario === "empty-list-item";
        const originalHTML = "original command text";
        const context = {undoFocusId: "original", undoFocusStart: "7", undoFocusEnd: "7"};
        let mutated = false;
        let saved: IOperation["context"];
        const editable = {textContent: empty ? "" : "prefix"};
        const old = {
            outerHTML: originalHTML,
            getAttribute: (name: string) => name === "data-type" ? "NodeParagraph" : "original",
            setAttribute() {}, remove() {}, insertAdjacentHTML() {}, nextElementSibling: undefined as unknown,
        };
        const inserted = {
            outerHTML: "inserted block",
            getAttribute: (name: string) => name === "data-type" ? (inList ? "NodeList" : "NodeHeading") : "new-block",
            classList: {contains: () => false}, previousElementSibling: old,
        };
        old.nextElementSibling = inserted;
        const range = {startContainer: old, setStart() { mutated = true; }, deleteContents() { mutated = true; }};
        const code = transpileModule(`class Hint { ${fill} } new Hint();`, {
            compilerOptions: {target: ScriptTarget.ES2020},
        }).outputText;
        const hint = runInNewContext(code, {
            Constants: {BLOCK_HINT_KEYS: ["(("], INLINE_TYPE: [], ZWSP: "\u200b"},
            Lute: {Caret: "caret", NewNodeID: () => "new-block"},
            Element: class {}, getSelection: (): null => null,
            document: {createElement: () => ({innerHTML: "", firstElementChild: {
                getAttribute: () => inList ? "NodeList" : "NodeHeading", setAttribute() {},
            }})},
            hideElements() {}, isProtyleListItemFragment: () => false,
            hasClosestBlock: () => old, hasClosestByClassName: () => inList,
            shouldCaptureHintUndoFocus,
            getUndoFocusContext: () => { assert.equal(mutated, false); return context; },
            getContenteditableElement: () => editable, getSuperBlockCommandLayout: (): undefined => undefined,
            focusByRange() {}, focusByWbr() {},
            updateTransaction: (_protyle: unknown, _element: unknown, html: string, undo: Record<string, string>) => {
                assert.equal(html, originalHTML);
                saved = undo;
            },
            transaction: (_protyle: unknown, _do: IOperation[], undo: IOperation[]) => {
                const restore = undo.find(operation => operation.action === "update" && operation.id === "original");
                assert.equal(restore.data, originalHTML);
                saved = restore.context;
            },
        });
        Object.assign(hint, {source: "hint", splitChar: "/", lastIndex: 6, fixImageCursor() {}});
        hint.fill("# caret", {
            toolbar: {range}, wysiwyg: {element: {querySelector: () => inserted}},
            lute: {SpinBlockDOM: () => '<div data-node-id="20260929120000-abcdefg"></div>'},
        }, false);
        assert.equal(saved, context);
        assert.equal(mutated, true);
    });
}
