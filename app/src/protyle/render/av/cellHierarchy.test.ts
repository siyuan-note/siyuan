import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import * as ts from "typescript";
import {isAVReadonlyType} from "./capabilities";
import {genAVDragFillValue} from "./dragFillValue";
import {getAVHostBlockID} from "./host";
import dayjs from "dayjs";

const load = (file: string, name: string, dependencies: Record<string, unknown>) => {
    const source = ts.createSourceFile(file, readFileSync(`src/protyle/render/av/${file}`, "utf8"), ts.ScriptTarget.ES2022, true);
    const statement = source.statements.find(node => ts.isVariableStatement(node) &&
        node.declarationList.declarations.some(declaration => declaration.name.getText(source) === name));
    return runInNewContext(ts.transpileModule(statement.getText(source).replace(/^export /, ""), {
        compilerOptions: {target: ts.ScriptTarget.ES2022},
    }).outputText + `\n${name}`, dependencies);
};

test("ordinary cell refresh preserves tree controls in a non-primary first field", () => {
    const controls = '<span class="av__sub-items"><button data-type="av-sub-items-toggle"></button></span>';
    const content = {innerHTML: "Before"};
    const cell = {dataset: {dtype: "select"}, innerHTML: controls, querySelector: (selector: string) =>
        selector === ".av__cellcontent" ? content : null};
    const refresh = load("action.ts", "updateAttrViewCellAnimation", {
        hasClosestBlock: () => ({getAttribute: () => "table"}),
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
        genCellValueByElement: () => structuredClone(target), genAVDragFillValue, isAVReadonlyType, getAVHostBlockID, dayjs,
        renderCell: (value: IAVCellValue) => `<span class="av__celltext">${value.text.content}</span>`,
        renderCellAttr() {}, renderAVRichTextElements() {}, updateAVSelectedCellValue() {}, focusBlock() {},
        transaction: (_protyle: IProtyle, redo: IOperation[], undo: IOperation[]) => transactions.push([redo, undo]),
    });
    fill({}, node, {origin: [{type: "text", text: {content: "After"}}]}, [], {querySelector: (): null => null});
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
