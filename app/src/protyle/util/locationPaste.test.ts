import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";
import {isAVReadonlyType} from "../render/av/capabilities";
import {cloneAVCellValueSnapshot} from "../render/av/cellValue";
import {createAVLocationFromText, createAVLocationReplacement} from "../render/av/locationValue";
import {
    compactAVCellOperations,
    getAVPasteMatrixWidth,
    getAVPasteValueForType,
    inferAVPasteColumnType,
} from "../render/av/paste";

// 执行完整矩阵粘贴流程，校验位置文本预检先于列、行及单元格的修改。
const source = readFileSync("src/protyle/util/insertHTML.ts", "utf8");
const start = source.indexOf("const pasteAVMatrix =");
const end = source.indexOf("const pasteAVMatrixWithSkeleton =", start);
const compiled = transpileModule(source.slice(start, end) + "\nexports.pasteAVMatrix = pasteAVMatrix;", {
    compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2022},
}).outputText;

const createHarness = (inferable = false) => {
    const oldValue: IAVCellValue = {id: "value", type: "location", location: {
        name: "Old", latitude: 20, longitude: 30, originalInput: "old input",
    }};
    const column = {id: "location", type: "location", name: "Location", width: "200px"} as IAVColumn;
    const view = {columns: [column], rows: [{id: "row", cells: [{value: oldValue}]}]};
    const warnings: string[] = [];
    const pasted: Array<string | IAVCellValue> = [];
    const transactions: Array<{doOperations: IOperation[], undoOperations: IOperation[]}> = [];
    const cellElement = {dataset: {id: "value"}};
    const rowElement = {querySelector: () => cellElement};
    const body = {dataset: {groupId: ""}, querySelector: () => rowElement};
    const blockElement = {
        dataset: {avId: "av", nodeId: "block"},
        querySelectorAll: () => [body], querySelector: (): null => null,
        getAttribute: () => "view",
    };
    let measured = 0;
    let restored = 0;
    const methods: {pasteAVMatrix?: (options: unknown) => Promise<boolean>} = {};
    runInNewContext(compiled, {
        exports: methods,
        Constants: {CUSTOM_SY_AV_VIEW: "custom-sy-av-view"},
        getAVPasteMatrixWidth, getAVPasteValueForType, inferAVPasteColumnType,
        compactAVCellOperations, cloneAVCellValueSnapshot,
        createAVLocationFromText, createAVLocationReplacement, isAVReadonlyType,
        fetchSyncPost: async () => ({code: 0, data: {view, inferableKeyIDs: inferable ? [column.id] : []}}),
        showMessage: (message: string) => warnings.push(message),
        window: {siyuan: {languages: {locationPasteInEditor: "Invalid WGS84 coordinates"}}},
        getAVColumnTextMeasurer: () => measured++,
        getAVColumnFitWidth: () => "200px",
        genEmptyAVCell: (column: IAVColumn) => ({value: {type: column.type}}),
        syncAVPasteRowCells: () => {},
        updateCellsValue: async (_protyle: unknown, _block: unknown, value: string | IAVCellValue): Promise<{
            doOperations: IOperation[], undoOperations: IOperation[],
        }> => {
            pasted.push(value);
            const data: IAVCellValue = column.type === "location" ? {type: "location", location:
                typeof value === "string" ? createAVLocationFromText(value) : value.type === "location" ?
                    createAVLocationReplacement(value.location) : createAVLocationFromText(value.text.content)} :
                {type: "text", text: {content: value as string}};
            return {doOperations: [{action: "updateAttrViewCell", id: "value", avID: "av",
                keyID: "location", rowID: "row", data}], undoOperations: []};
        },
        restoreAVPasteCellPlaceholders: () => restored++,
        removePlaceholderRows: () => {},
        dayjs: () => ({format: () => "20261011000000"}),
        transaction: (_protyle: unknown, doOperations: IOperation[], undoOperations: IOperation[]) =>
            transactions.push({doOperations, undoOperations}),
    });
    return {
        oldValue, column, warnings, pasted, transactions,
        getMeasured: () => measured, getRestored: () => restored,
        paste: (values: Array<Array<string | IAVCellValue>>, header?: string[]) => methods.pasteAVMatrix({
            values, header, columns: [column], protyle: {}, blockElement, html: "",
            start: {rowID: "row", colID: column.id, rowIndex: 0, groupID: ""},
        }),
    };
};

test("matrix paste accepts decimal and canonical location text and restores the original structured value on undo", async () => {
    for (const value of ["31.20, 121.40", "Home; 0, 0 [WGS84]",
        {type: "text", text: {content: "Office; Campus; -90, 180 [WGS84]"}} as IAVCellValue]) {
        const harness = createHarness();
        assert.equal(await harness.paste([[value]]), true);
        assert.deepEqual(harness.warnings, []);
        assert.equal(harness.transactions.length, 1);
        const {doOperations, undoOperations} = harness.transactions[0];
        const update = doOperations[0];
        const undo = undoOperations[0];
        if (update.action !== "updateAttrViewCell" || undo.action !== "updateAttrViewCell") {
            assert.fail("expected location paste and undo operations");
        }
        const text = typeof value === "string" ? value : value.text.content;
        assert.deepEqual(update.data.location, createAVLocationFromText(text));
        assert.deepEqual(undo.data.location, createAVLocationReplacement(harness.oldValue.location));
        assert.equal(harness.getRestored(), 1);
    }
});

test("matrix paste rejects invalid location text before changing headers, adding rows or updating any cells", async () => {
    for (const text of ["91, 0", "31,", "Home; 0, 0 [GCJ-02]", "0, 0 [WGS84] trailing"]) {
        const harness = createHarness();
        assert.equal(await harness.paste([["31, 121"], [text]], ["Renamed"]), undefined);
        assert.deepEqual(harness.warnings, ["Invalid WGS84 coordinates"]);
        assert.equal(harness.column.name, "Location");
        assert.equal(harness.getMeasured(), 0);
        assert.equal(harness.getRestored(), 0);
        assert.deepEqual(harness.pasted, []);
        assert.deepEqual(harness.transactions, []);
    }
});

test("matrix paste keeps structured locations authoritative even when names resemble unsupported coordinates", async () => {
    const harness = createHarness();
    const location = {name: "91, 0 [GCJ-02]", latitude: 0, longitude: 0, originalInput: "legacy source"};
    const value: IAVCellValue = {type: "location", location};
    assert.equal(await harness.paste([[value]]), true);
    assert.deepEqual(harness.warnings, []);
    assert.deepEqual(harness.pasted, [value]);
    const update = harness.transactions[0].doOperations[0];
    if (update.action !== "updateAttrViewCell") {
        assert.fail("expected structured location paste");
    }
    assert.deepEqual(update.data.location, location);
    assert.notEqual(update.data.location, location);
});

test("matrix paste does not infer a location field from coordinate text when the column type is inferable", async () => {
    const harness = createHarness(true);
    assert.equal(await harness.paste([["91, 0"]], ["Text field"]), true);
    assert.deepEqual(harness.warnings, []);
    assert.equal(harness.column.type, "text");
    assert.equal(harness.column.name, "Text field");
    assert.deepEqual(harness.pasted, ["91, 0"]);
});
