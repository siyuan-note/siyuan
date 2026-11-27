import {getAVCellShowIcon} from "./entryIcon";
import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import * as ts from "typescript";
import {isAVReadonlyType} from "./capabilities";
import {createAVDragFillOperation, genAVDragFillValue} from "./dragFillValue";
import {cloneAVCellValueSnapshot, createAVStableTextCell} from "./cellValue";
import {getAVHostBlockID} from "./host";
import dayjs from "dayjs";

const load = (file: string, name: string, dependencies: Record<string, unknown>) => {
    const source = ts.createSourceFile(file, readFileSync(`src/protyle/render/av/${file}`, "utf8"), ts.ScriptTarget.ES2022, true);
    const statement = source.statements.find(node => ts.isVariableStatement(node) &&
        node.declarationList.declarations.some(declaration => declaration.name.getText(source) === name));
    return runInNewContext(ts.transpileModule(statement.getText(source).replace(/^export /, ""), {
        compilerOptions: {target: ts.ScriptTarget.ES2022},
    }).outputText + `\n${name}`, {getAVCellShowIcon, getAVData: (): IAV | undefined => undefined, ...dependencies});
};

test("ordinary cell refresh preserves tree controls in a non-primary first field", () => {
    const controls = '<span class="av__sub-items"><button data-type="av-sub-items-toggle"></button></span>';
    const content = {innerHTML: "Before"};
    const cell = {dataset: {dtype: "select"}, innerHTML: controls, querySelector: (selector: string) =>
        selector === ".av__cellcontent" ? content : null};
    const refresh = load("action.ts", "updateAttrViewCellAnimation", {
        getAVHost: () => ({getAttribute: () => "table"}),
        renderCell: () => '<span class="b3-chip">Updated</span>', renderCellAttr() {}, renderAVRichTextElements() {},
    });
    refresh(cell, {type: "select"});
    assert.equal(cell.innerHTML, controls);
    assert.equal(content.innerHTML, '<span class="b3-chip">Updated</span>');
});

test("drag filling a first field retains hierarchy controls and the normal undo transaction", () => {
    const controls = '<span class="av__sub-items"><button data-type="av-sub-items-toggle"></button></span>';
    const target: IAVCellValue = {id: "value", type: "text", keyID: "field", blockID: "child", text: {content: "Before"}};
    const content = {innerHTML: "Before"};
    const cell = {dataset: {id: "value", colId: "field"}, innerHTML: controls, querySelector: () => content};
    const node = {dataset: {avId: "database", nodeId: "carrier"}, getAttribute: () => "20261101000000",
        querySelector: (): null => null, querySelectorAll: () => [cell]};
    const transactions: IOperation[][][] = [];
    const fill = load("cell.ts", "dragFillCellsValue", {
        getAVSelectedCells: (): import("./selectionState").IAVSelectedCell[] => [],
        hasClosestByClassName: () => ({dataset: {id: "child"}}), getTypeByCellElement: () => "text",
        genCellValueByElement: () => structuredClone(target), createAVDragFillOperation, genAVDragFillValue, isAVReadonlyType, getAVHostBlockID, dayjs,
        renderCell: (value: IAVCellValue) => `<span class="av__celltext">${value.text.content}</span>`,
        renderCellAttr() {}, renderAVRichTextElements() {}, updateAVSelectedCellValue() {}, focusBlock() {},
        transaction: (_protyle: IProtyle, redo: IOperation[], undo: IOperation[]) => transactions.push([redo, undo]),
    });
    fill({}, node, {origin: [{type: "text", text: {content: "After"}}]}, []);
    assert.equal(cell.innerHTML, controls);
    assert.equal(content.innerHTML, '<span class="av__celltext">After</span>');
    assert.equal(transactions.length, 1);
    assert.equal(transactions[0][0][0].action, "updateAttrViewCell");
    assert.equal(transactions[0][0][0].rowID, "child");
    assert.equal(transactions[0][0][0].blockID, "carrier");
    assert.equal(transactions[0][0].length, 2);
    assert.equal(transactions[0][0][1].action, "doUpdateUpdated");
    assert.equal(transactions[0][0][1].id, "carrier");
    assert.equal(transactions[0][1][1].action, "doUpdateUpdated");
    assert.equal(transactions[0][1][1].data, "20261101000000");
    const undo = transactions[0][1][0];
    assert.equal(undo.action, "updateAttrViewCell");
    if (undo.action === "updateAttrViewCell") assert.equal(undo.data.text.content, "Before");
});

for (const stable of [false, true]) {
    test(`drag fill saves and restores the explicit primary key source (${stable ? "model" : "DOM"})`, () => {
        const rich: NonNullable<IAVCellValue["block"]["rich"]> = {spec: 1, format: "kramdown", content: "**rich**"};
        const plain: IAVCellValue = {type: "block", isDetached: true, block: {content: "Plain"}};
        const formatted: IAVCellValue = {type: "block", isDetached: true, block: {content: "rich", rich}};
        for (const [source, previous, newRich, oldRich] of [
            [formatted, plain, rich, null], [plain, formatted, null, rich],
        ] as const) {
            const target = {...previous, id: "target-value", keyID: "primary", blockID: "target-row"};
            const selected = createAVStableTextCell({rowID: "target-row", colID: "primary", value: target});
            const content = {innerHTML: ""};
            const cell = {dataset: {id: target.id, colId: target.keyID}, querySelector: () => content,
                getAttribute: () => "true"};
            const node = {dataset: {avId: "database", nodeId: "carrier"}, getAttribute: () => "20261101000000",
                querySelector: (): null => null, querySelectorAll: () => [cell]};
            const transactions: IOperation[][][] = [];
            const fill = load("cell.ts", "dragFillCellsValue", {
                getAVSelectedCells: () => stable ? [selected] : [],
                getAVData: () => ({view: {}}),
                canEditAVHost: () => true, resolveAVSelectedCell: () => selected,
                hasClosestByClassName: () => ({dataset: {id: target.blockID}}),
                getTypeByCellElement: () => "block", genCellValueByElement: () => structuredClone(target),
                cloneAVCellValueSnapshot, createAVDragFillOperation, genAVDragFillValue, isAVReadonlyType, getAVHostBlockID, dayjs,
                renderCell: (value: IAVCellValue) => value.block.content,
                renderCellAttr() {}, renderAVRichTextElements() {}, updateAVSelectedCellValue() {}, focusBlock() {},
                updateAVCachedCellValue() {}, updateAttrViewCellInOtherElements() {},
                transaction: (_protyle: IProtyle, redo: IOperation[], undo: IOperation[]) => transactions.push([redo, undo]),
            });
            fill({}, node, {"source-row": [{...source, keyID: "primary"}]}, []);
            assert.equal(transactions.length, 1);
            const [[redo], [undo]] = JSON.parse(JSON.stringify(transactions[0])) as IOperation[][];
            assert.equal(redo.action, "updateAttrViewCell");
            assert.equal(undo.action, "updateAttrViewCell");
            assert.equal(redo.rowID, target.blockID);
            assert.equal(undo.id, target.id);
            assert.equal(redo.data.isDetached, true);
            assert.equal(undo.data.isDetached, true);
            assert.deepEqual(redo.data.block, {...source.block, rich: newRich});
            assert.deepEqual(undo.data.block, {...previous.block, rich: oldRich});
            assert.equal(plain.block.rich, undefined);
        }
    });
}
