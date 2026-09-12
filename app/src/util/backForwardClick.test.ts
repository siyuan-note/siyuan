import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {createSourceFile, isVariableStatement, ModuleKind, ScriptTarget, transpileModule} from "typescript";

const source = createSourceFile("backForward.ts", readFileSync("src/util/backForward.ts", "utf8"), ScriptTarget.ES2021, true);
const declarations = source.statements.filter(statement => isVariableStatement(statement) &&
    statement.declarationList.declarations.some(item =>
        ["pushBackByClick", "pushBack", "goBack", "goForward", "forwardStack", "previousIsBack"].includes(item.name.getText(source))));
const compiled = transpileModule(declarations.map(item => item.getText(source)).join("\n"), {
    compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
}).outputText;

test("tablet paragraph clicks navigate back and forward despite a stale title selection", async () => {
    const exports: any = {};
    const focused: string[] = [];
    const stacks: any[] = [];
    let selectionRange: any = {startContainer: "title", endContainer: "title", offset: 0};
    let pointRange: any;
    const documentSelf = {
        contains: () => true,
        querySelector: (): undefined => undefined,
        getSelection: () => ({rangeCount: 1, getRangeAt: () => selectionRange}),
        caretRangeFromPoint: () => pointRange,
        createRange: () => ({
            startContainer: "", endContainer: "", offset: 0,
            selectNodeContents(element: any) { this.startContainer = element.id; this.endContainer = element.id; },
            collapse() {},
        }),
    };
    const block = (id: string) => ({
        id,
        ownerDocument: documentSelf,
        contains: (node: string) => node === id,
        getAttribute: () => id,
        classList: {contains: () => false},
    });
    runInNewContext(compiled, {
        exports,
        window: {siyuan: {backStack: stacks}},
        document: documentSelf,
        Constants: {SIZE_UNDO: 128},
        hasClosestBlock: (target: unknown) => target,
        isInEmbedBlock: () => false,
        getContenteditableElement: (element: unknown) => element,
        getSelectionOffset: (_element: unknown, _editor: unknown, range: any) => ({start: range.offset, end: range.offset}),
        focusStack: async (_app: unknown, stack: any) => { focused.push(stack.id); return true; },
    });
    const protyle = {model: {}, block: {rootID: "title"}, wysiwyg: {element: {contains: () => true}}};
    exports.pushBack(protyle, selectionRange, block("title"));
    pointRange = {startContainer: "first", endContainer: "first", offset: 8};
    exports.pushBackByClick(protyle, block("first"), {x: 100, y: 100});
    assert.equal(stacks.at(-1).position.start, 8);
    selectionRange = {startContainer: "first", endContainer: "first", offset: 4};
    pointRange = {startContainer: "second", endContainer: "second", offset: 12};
    exports.pushBackByClick(protyle, block("second"), {x: 100, y: 140});
    assert.equal(stacks.at(-1).position.start, 12);
    assert.deepEqual(stacks.map(stack => stack.id), ["title", "first", "second"]);
    await exports.goBack({});
    assert.equal(focused.at(-1), "first");
    await exports.goForward({});
    assert.equal(focused.at(-1), "second");
    selectionRange = {startContainer: "second", endContainer: "second", offset: 7};
    exports.pushBackByClick(protyle, block("second"));
    assert.equal(stacks.at(-1).position.start, 7);
    pointRange = {startContainer: "second", endContainer: "second", offset: 15};
    exports.pushBackByClick(protyle, block("second"), {x: 150, y: 140});
    assert.equal(stacks.at(-1).position.start, 15);
    assert.equal(selectionRange.offset, 7);
    pointRange = {startContainer: "first", endContainer: "first", offset: 3};
    exports.pushBackByClick(protyle, block("second"), {x: 10, y: 10});
    assert.equal(stacks.at(-1).position.start, 7);
});
