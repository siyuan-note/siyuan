import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";
import {isAVDateType, isAVReadonlyType, isAVTextType} from "./capabilities";
import {cloneAVCellValueSnapshot, createAVCellUpdateOperation, genEmptyAVCellValue} from "./cellValue";
import {rebindAVCellValue} from "./dragFillValue";
import {formatDateValue, parseDateValue} from "./dateFormat";
import type {IAVSelectedCell} from "./selectionState";

const isCellUpdate = (operation: IOperation): operation is Extract<IOperation, {action: "updateAttrViewCell"}> =>
    operation.action === "updateAttrViewCell";

test("date paste preserves stored values on invalid text and supports explicit clearing and calendar conversion", async () => {
    Object.defineProperty(globalThis, "window", {configurable: true,
        value: {siyuan: {languages: JSON.parse(readFileSync("appearance/langs/en.json", "utf8"))}}});
    const source = readFileSync("src/protyle/render/av/cell.ts", "utf8");
    const fragment = source.slice(source.indexOf("export const genCellValue ="), source.indexOf("export const cellScrollIntoView =")) +
        source.slice(source.indexOf("export const updateCellsValue ="), source.indexOf("export const updateAttrViewCellInOtherElements ="));
    const exports = {} as Pick<typeof import("./cell"), "updateCellsValue">;
    runInNewContext(transpileModule(fragment, {compilerOptions: {
        module: ModuleKind.CommonJS, target: ScriptTarget.ES2021,
    }}).outputText, {exports, isAVDateType, isAVReadonlyType, isAVTextType, cloneAVCellValueSnapshot, createAVCellUpdateOperation,
        genEmptyAVCellValue, rebindAVCellValue, formatDateValue, parseDateValue,
        getAVBatchEditMode: () => "replace", getCellValueText: () => "stored date",
        objEquals: (first: unknown, second: unknown) => JSON.stringify(first) === JSON.stringify(second)});
    const stored: IAVCellValue = {id: "date-value", keyID: "birthday", blockID: "row", type: "date",
        date: {content: new Date(2024, 0, 2, 3, 4, 5, 123).valueOf(), isNotEmpty: true, isNotTime: false}};
    const snapshot = JSON.stringify(stored);
    const block = {dataset: {avId: "database", nodeId: "database-block"},
        getAttribute: () => "table"} as unknown as HTMLElement;
    const paste = (value: string | undefined, format: TAVDateFormat) => {
        const column: IAVColumn = {id: "birthday", name: "Birthday", type: "date", dateFormat: format,
            date: {autoFillNow: false, fillSpecificTime: true}};
        const selected: IAVSelectedCell = {groupID: "", rowID: "row", colID: column.id, rowIndex: 0, colIndex: 0, column,
            cell: {id: stored.id, value: stored, valueType: "date", bgColor: "", color: ""}};
        return exports.updateCellsValue({} as IProtyle, block, value, undefined, [column], undefined,
            true, false, false, [selected], false);
    };
    for (const format of ["full", "lunar"] as TAVDateFormat[]) {
        for (const text of ["not a date", "2025-02-30", "Chinese lunar 2026, Leap Month 6, day 1",
            "2025-07-25 → invalid end"]) {
            const operations = await paste(text, format);
            assert.equal(operations.doOperations.length, 0, `${format}: ${text}`);
            assert.equal(operations.undoOperations.length, 0);
            assert.equal(JSON.stringify(stored), snapshot);
        }
        for (const empty of [undefined, ""]) {
            const operations = await paste(empty, format);
            const operation = operations.doOperations.find(isCellUpdate);
            assert.ok(operation);
            assert.equal(operation.data.date.isNotEmpty, false, "explicit clearing remains available");
        }
        for (const text of ["July 25, 2025 14:07", "Chinese lunar 2025, Leap Month 6, day 1 14:07"]) {
            const operations = await paste(text, format);
            const operation = operations.doOperations.find(isCellUpdate);
            assert.ok(operation);
            assert.equal(operation.data.date.content, new Date(2025, 6, 25, 14, 7).valueOf());
            assert.equal(operations.undoOperations.find(isCellUpdate).data.date.content,
                stored.date.content);
        }
    }
});
