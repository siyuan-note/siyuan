import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";
import * as capabilities from "./capabilities";
import * as cellValue from "./cellValue";
import * as locationValue from "./locationValue";
import * as batchValue from "./batchValue";
import * as dragFillValue from "./dragFillValue";
import * as escape from "../../../util/escape";
import {genAVDragFillValue} from "./dragFillValue";
import {inferAVPasteColumnType} from "./paste";

const loadModule = <T>(file: string, extra: Record<string, unknown> = {}) => {
    const methods = {} as T;
    runInNewContext(transpileModule(readFileSync(`src/protyle/render/av/${file}.ts`, "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2022},
    }).outputText, {
        exports: methods,
        window: {siyuan: {languages: {empty: "Empty", copy: "Copy", locationPasteInEditor: "Use the location editor"}}},
        require: (name: string) => ({
            "./capabilities": capabilities,
            "./cellValue": cellValue,
            "./locationValue": locationValue,
            "./batchValue": batchValue,
            "./dragFillValue": dragFillValue,
            "../../../util/functions": {objEquals: (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right)},
            "../../../util/escape": escape,
            ...extra,
        })[name] || {},
    });
    return methods;
};

const cell = loadModule<typeof import("./cell")>("cell");

test("location cells display longitude first in every layout, row attributes and rollups", () => {
    const value: IAVCellValue = {type: "location", location: {
        name: "<Home>", latitude: 0, longitude: 180, originalInput: "untrusted raw",
    }};
    for (const type of ["table", "list", "gallery", "kanban", "map"] as TAVView[]) {
        const html = cell.renderCell(value, 0, false, type);
        assert.match(html, /&lt;Home&gt;; 180, 0 \[WGS84\]/);
        assert.doesNotMatch(html, /<Home>/);
        const data = /data-cell-value="([^"]+)"/.exec(html)?.[1];
        assert.deepEqual(JSON.parse(decodeURIComponent(data)), value);
        assert.match(html, /data-type="copy"/);
    }
    const attr = loadModule<typeof import("./attributeValue")>("attributeValue");
    const html = attr.genAVValueHTML(value);
    assert.match(html, /&lt;Home>; 180, 0 \[WGS84\]/);
    assert.match(html, /data-cell-value=/);
    const rollupHTML = cell.renderCell({type: "rollup", rollup: {contents: [value]}}, 0, false, "table");
    assert.match(rollupHTML, /180, 0 \[WGS84\]/);
});

test("location copies preserve canonical text for cells, nested leaves and templates", () => {
    const first: IAVCellValue = {type: "location", location: {latitude: 20, longitude: 30}};
    const second: IAVCellValue = {type: "location", location: {name: "Other", latitude: 40, longitude: 50}};
    const makeLeaf = (value?: IAVCellValue, template = false) => ({
        dataset: value ? {cellValue: encodeURIComponent(JSON.stringify(value))} : {},
        textContent: template ? "Custom display" : value ? locationValue.getAVLocationDisplayText(value.location) : "Ordinary text",
        matches: (selector: string) => selector === ".av__celltext" && !!value || template && selector === ".av__celltext--template",
        querySelector: (): HTMLElement => null,
        querySelectorAll: (): HTMLElement[] => [],
        getAttribute: (): string => null,
    });
    const firstLeaf = makeLeaf(first);
    const secondLeaf = makeLeaf(second);
    const wrapper = (leaves: ReturnType<typeof makeLeaf>[]) => ({
        ...makeLeaf(), querySelectorAll: () => leaves,
    }) as unknown as HTMLElement;
    assert.equal(cell.getCellText(firstLeaf as unknown as HTMLElement), "20, 30 [WGS84]");
    assert.equal(cell.getCellText(wrapper([firstLeaf])), "20, 30 [WGS84]");
    assert.equal(cell.getCellText(wrapper([firstLeaf, makeLeaf(), secondLeaf])), "20, 30 [WGS84], Ordinary text, Other; 40, 50 [WGS84]");
    assert.equal(cell.getCellText(firstLeaf as unknown as HTMLElement, "display"), "30, 20 [WGS84]");
    assert.equal(cell.getCellText(wrapper([firstLeaf, makeLeaf(), secondLeaf]), "display"), "30, 20 [WGS84], Ordinary text, Other; 50, 40 [WGS84]");
    assert.equal(cell.getCellText(makeLeaf(first, true) as unknown as HTMLElement), "Custom display");
    assert.equal(cell.getCellText(wrapper([makeLeaf(first, true)])), "Custom display");
    assert.equal(cell.getCellText(wrapper([makeLeaf(first, true)]), "display"), "Custom display");
    const attributeTemplate = {...makeLeaf(), dataset: firstLeaf.dataset, textContent: "Custom display"} as unknown as HTMLElement;
    assert.equal(cell.getCellText(attributeTemplate), "Custom display");
    assert.equal(cell.getCellText(attributeTemplate, "display"), "Custom display");
    assert.equal(cell.getCellValueText(first), "20, 30 [WGS84]");
    assert.equal(locationValue.parseAVLocationCoordinates(cell.getCellValueText(first), "longitudeLatitude"), undefined);
    assert.throws(() => cell.genCellValue("location", cell.getCellValueText(first)));
});

test("location hover text explicitly uses display order instead of clipboard order", () => {
    const source = readFileSync("src/block/popover.ts", "utf8");
    assert.doesNotMatch(source, /getCellText\((?:aElement|cellElement)\)/);
    assert.match(source, /escapeHtmlTextAndAttr\(getCellText\(aElement, "display"\)\)/);
    assert.match(source, /getCellText\(cellElement, "display"\)/);
});

test("selected location copies keep structured values and latitude-first TSV independent of display", () => {
    const value: IAVCellValue = {type: "location", location: {
        name: "Office", latitude: 20, longitude: 30, originalInput: "20,30",
    }};
    const selected = [{rowID: "row", rowIndex: 0, cell: {value}, column: {type: "location"}},
        {rowID: "row", rowIndex: 0, cell: {value}, column: {type: "location"}}] as import("./selectionState").IAVSelectedCell[];
    const copied = cell.getAVCellData(selected);
    assert.equal(copied.text, "Office; 20, 30 [WGS84]\tOffice; 20, 30 [WGS84]");
    assert.deepEqual(JSON.parse(JSON.stringify(copied.json[0])), [value, value]);
    assert.notEqual(copied.json[0][0].location, value.location);
    assert.deepEqual(cell.genCellValue("location", copied.json[0][0].location).location, value.location);
});

test("location generic paste keeps place names and rejects coordinates without guessing", () => {
    for (const coordinateSystem of ["wgs84", "gcj02", "bd09", "unknown"]) {
        const tagged = {latitude: 20, longitude: 30, coordinateSystem};
        assert.throws(() => cell.genCellValue("location", tagged), /Invalid WGS84 location/);
        assert.deepEqual(tagged, {latitude: 20, longitude: 30, coordinateSystem});
    }
    const raw = "  Home  ";
    const value = cell.genCellValue("location", raw);
    assert.equal(value.location.name, raw.trim());
    assert.equal(value.location.originalInput, raw);
    assert.equal("coordinateSystem" in value.location, false);
    assert.equal(value.location.latitude, null);
    assert.equal(value.location.longitude, null);
    for (const text of ["31.20, 121.40", "91, 0", "Home; 0, 0 [WGS84]"]) {
        assert.throws(() => cell.genCellValue("location", text));
    }
    assert.equal(inferAVPasteColumnType(["31.20, 121.40", "0, 0"]), "text");
    assert.deepEqual(cell.genCellValue("location", "").location, locationValue.createAVLocationReplacement());
});

test("location snapshots, drag fill and empty values retain structured zero coordinates", () => {
    const value: IAVCellValue = {type: "location", keyID: "key", blockID: "row", location: {
        name: "Origin", latitude: 0, longitude: 0, originalInput: "+0.0, -0.0",
    }};
    assert.equal(cellValue.cellValueIsEmpty(value), false);
    const cloned = genAVDragFillValue(value, {id: "next", keyID: "other", blockID: "other-row"});
    assert.deepEqual(cloned.location, value.location);
    assert.notEqual(cloned.location, value.location);
    assert.equal(cloned.keyID, "other");
    assert.equal(cellValue.cellValueIsEmpty({type: "location", location: {originalInput: "raw only"}}), true);
    assert.equal(cellValue.cellValueIsEmpty(cellValue.genEmptyAVCellValue("location")), true);
    assert.equal(cellValue.cellValueIsEmpty(cellValue.createEmptyAVValue("key", "location")), true);
    for (const type of ["text", "number", "date", "checkbox"] as TAVCol[]) {
        assert.equal(cellValue.createEmptyAVValue("key", type).location, undefined, type);
    }
});

test("location batch editor target validation includes hidden fields and every group", () => {
    const column = {id: "location", type: "location", hidden: true} as IAVColumn;
    const cell = {value: {type: "location", location: {name: "Place"}}} as IAVCell;
    const view = {groups: [
        {id: "group-a", columns: [column], rows: [{id: "row-a", cells: [cell]}]},
        {id: "group-b", fields: [column], cards: [{id: "row-b", values: [cell]}]},
    ]} as unknown as IAVView;
    for (const rowID of ["row-a", "row-b"]) {
        assert.equal(cellValue.hasAVCachedCellType(view, rowID, "location", "location"), true);
        assert.equal(cellValue.hasAVCachedCellType(view, rowID, "location", "text"), false);
        assert.equal(cellValue.hasAVCachedCellType(view, rowID, "removed-field", "location"), false);
    }
    assert.equal(cellValue.hasAVCachedCellType(view, "removed-row", "location", "location"), false);
});

test("location update, clear, structured paste and undo send full replacement payloads", async () => {
    const warnings: string[] = [];
    const cells = loadModule<typeof import("./cell")>("cell", {
        "../../../dialog/message": {showMessage: (message: string) => warnings.push(message)},
    });
    const block = {dataset: {avId: "av", nodeId: "block"}, getAttribute: () => "table"} as unknown as HTMLElement;
    const oldLocation: IAVCellLocationValue = {name: "Old", latitude: 20, longitude: 30, originalInput: "20,30"};
    const selected = (location?: IAVCellLocationValue): import("./selectionState").IAVSelectedCell[] => [{
        rowID: "row", colID: "key", groupID: "", colIndex: 0, rowIndex: 0,
        cell: {id: "value", color: "", bgColor: "", valueType: "location", value: {type: "location", location}},
        column: {id: "key", type: "location"} as IAVColumn,
    }];
    const update = (value: unknown, location: IAVCellLocationValue = oldLocation) => cells.updateCellsValue(
        {} as IProtyle, block, value, undefined, undefined, undefined, true, false, false, selected(location), false,
    );
    for (const input of [undefined, {type: "location", location: {}}, {type: "location", location: {name: "New"}}]) {
        const result = await update(input);
        const operation = result.doOperations[0];
        assert.equal(operation.action, "updateAttrViewCell");
        if (operation.action !== "updateAttrViewCell") {
            assert.fail("expected cell update");
        }
        assert.equal(operation.data.location.latitude, null);
        assert.equal(operation.data.location.longitude, null);
        assert.equal(operation.data.location.originalInput, "");
        assert.equal("coordinateSystem" in operation.data.location, false);
        const undo = result.undoOperations[0];
        assert.equal(undo.action, "updateAttrViewCell");
        if (undo.action !== "updateAttrViewCell") {
            assert.fail("expected cell undo");
        }
        assert.deepEqual(JSON.parse(JSON.stringify(undo.data.location)), oldLocation);
    }
    const fromEmpty = await update({type: "location", location: oldLocation}, {});
    const pasted = fromEmpty.doOperations[0];
    if (pasted.action === "updateAttrViewCell") {
        assert.deepEqual(JSON.parse(JSON.stringify(pasted.data.location)), oldLocation);
    } else {
        assert.fail("expected structured location paste");
    }
    const undo = fromEmpty.undoOperations[0];
    assert.equal(undo.action, "updateAttrViewCell");
    if (undo.action === "updateAttrViewCell") {
        assert.deepEqual(JSON.parse(JSON.stringify(undo.data.location)), locationValue.createAVLocationReplacement());
    }
    for (const input of ["91, 0", "31,", "Home; 0, 0 [WGS84]"]) {
        const result = await update(input);
        assert.equal(result.doOperations.length, 0);
    }
    assert.equal(warnings.length, 3);
});

test("template and automation value buttons preserve the structured location until explicitly edited", () => {
    const editor = loadModule<typeof import("./fieldValueEditor")>("fieldValueEditor");
    const location: IAVCellLocationValue = {latitude: -90, longitude: -180, originalInput: "-90, -180"};
    const column = {type: "location"} as IAVColumn;
    const html = editor.getValueInputHTML(column, {mode: "static", value: {type: "location", location}});
    assert.match(html, /data-value-type="location"/);
    assert.match(html, /-180, -90 \[WGS84\]/);
    const input = {dataset: {location: encodeURIComponent(JSON.stringify(location))}} as unknown as HTMLElement;
    assert.deepEqual(JSON.parse(JSON.stringify(editor.genFieldValue(column, input))), {
        type: "location", location: locationValue.createAVLocationReplacement(location),
    });
});

test("new template and automation locations use a single WGS84 value shape", () => {
    const editor = loadModule<typeof import("./fieldValueEditor")>("fieldValueEditor");
    const column = {type: "location"} as IAVColumn;
    const readValue = (value?: IAVNewItemFieldValue) => {
        const html = editor.getValueInputHTML(column, value);
        return JSON.parse(decodeURIComponent(/data-location="([^"]+)"/.exec(html)[1])) as IAVCellLocationValue;
    };
    assert.deepEqual(readValue(), {});
    assert.deepEqual(readValue({mode: "static", value: {type: "location"}}), {});
    const location = {name: "Existing", latitude: 0, longitude: 0};
    const value = {mode: "static", value: {type: "location", location}} as IAVNewItemFieldValue;
    assert.deepEqual(readValue(value), location);
    assert.deepEqual(value.value.location, location);
});

test("template and automation location editors are cancelled with their source control", () => {
    let opened: Parameters<typeof import("./locationEditor").openAVLocationEditor>[0];
    const editor = loadModule<typeof import("./fieldValueEditor")>("fieldValueEditor", {
        "./locationEditor": {openAVLocationEditor: (options: typeof opened) => opened = options},
    });
    let changes = 0;
    const target = {
        dataset: {location: encodeURIComponent(JSON.stringify({name: "Original"}))},
        isConnected: true,
        closest: (): HTMLElement => undefined,
        dispatchEvent: () => changes++,
    } as unknown as HTMLElement;
    editor.openFieldLocationEditor(target);
    assert.equal(opened.ownerElement, target);
    Object.defineProperty(target, "isConnected", {value: false});
    opened.onSave({name: "Stale callback"});
    assert.equal(changes, 0);
    assert.equal(JSON.parse(decodeURIComponent(target.dataset.location)).name, "Original");
});

test("location filter input uses text.content and never generates a location value from a search", () => {
    const source = readFileSync("src/protyle/render/av/filter.ts", "utf8");
    const start = source.indexOf("const readInlineValue =");
    const end = source.indexOf("\n};", start) + 3;
    const compiled = transpileModule(source.slice(start, end) + "\nexports.readInlineValue = readInlineValue;", {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2022},
    }).outputText;
    const methods: {readInlineValue?: (...args: unknown[]) => {newValue: IAVCellValue}} = {};
    runInNewContext(compiled, {
        exports: methods,
        genEmptyCellValue: (type: TAVCol) => ({type}),
        wrapFilterCellValue: (_filter: IAVFilter, value: IAVCellValue) => value,
    });
    const row = {querySelector: () => ({value: "Home"})};
    const {newValue} = methods.readInlineValue(row, "location", "Contains", {}, {});
    assert.deepEqual(JSON.parse(JSON.stringify(newValue)), {type: "location", text: {content: "Home"}});
    const empty = methods.readInlineValue(row, "location", "Is empty", {}, {});
    assert.equal(empty.newValue.type, "location");
    assert.equal(empty.newValue.location, undefined);
});
