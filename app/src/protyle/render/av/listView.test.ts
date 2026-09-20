import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {runInNewContext} from "node:vm";
import * as ts from "typescript";
import * as viewType from "./viewType";
import {resolveAVSelectedCell} from "./selectionState";

// 使用实际行渲染与字段定位函数，检查列表沿用行列交互时的字段映射。
const loadModule = (name: string) => {
    const mocks: Record<string, unknown> = {
        "./viewType": viewType,
        "./cell": {renderCell: (value: IAVCellValue) => value?.text?.content || value?.block?.content || ""},
        "./blockAttr": {isCustomAttr: () => false},
        "../../util/hasClosest": {hasClosestByClassName: (element: HTMLElement, className: string) =>
            element.closest(`.${className}`)},
        "../../../util/escape": {escapeAttr: (value: string) => value || "", escapeAriaLabel: (value: string) => value || ""},
    };
    const module = {exports: {}};
    runInNewContext(ts.transpileModule(readFileSync(join(__dirname, `${name}.ts`), "utf8"), {
        compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022},
    }).outputText, {
        module, exports: module.exports, require: (id: string) => mocks[id] || {},
        window: {siyuan: {languages: {freezeDrag: "Freeze"}}},
    });
    return module.exports;
};

const {getRowHTML, getFieldIdByCellElement} = loadModule("row") as typeof import("./row");
const {getColId} = loadModule("col") as typeof import("./col");

const createView = () => ({
    rowCount: 1,
    columns: [
        {id: "title", name: "Title", type: "block", hidden: false, width: "360px", pin: true},
        {id: "tag", name: "Tag", type: "text", hidden: true, width: "180px"},
    ],
    rows: [{id: "row", cells: [
        {id: "title-value", valueType: "block", value: {type: "block", block: {content: "Entry"}}},
        {id: "tag-value", valueType: "text", value: {type: "text", text: {content: "Work"}}},
    ]}],
}) as IAVTable;

describe("database list view", () => {
    it("renders the primary field without column widths or freezing and reveals selected properties", () => {
        const data = createView();
        const options = {data, row: data.rows[0], rowIndex: 0, pinIndex: 0, type: "list" as TAVView};
        const html = getRowHTML(options);
        assert.match(html, /data-col-id="title"/);
        assert.match(html, />Entry<\/div>/);
        assert.doesNotMatch(html, /data-col-id="tag"|width:|av__freeze-drag|av__colsticky--freeze/);

        data.columns[1].hidden = false;
        const revealedHTML = getRowHTML(options);
        assert.match(revealedHTML, /data-col-id="tag"/);
        assert.match(revealedHTML, /aria-label="Tag"/);
        assert.match(revealedHTML, />Work<\/div>/);
        assert.doesNotMatch(revealedHTML, /width:/);
    });

    it("keeps table widths and frozen columns when rendering the same data as a table", () => {
        const data = createView();
        const html = getRowHTML({data, row: data.rows[0], rowIndex: 0, pinIndex: 0, type: "table"});
        assert.match(html, /width: 360px/);
        assert.match(html, /av__colsticky--freeze/);
        assert.match(html, /av__freeze-drag/);
    });

    it("resolves list edit targets from row IDs and column IDs", () => {
        const row = {dataset: {id: "row"}};
        const element = {
            closest: (selector: string) => selector === ".av__row" ? row : undefined,
            getAttribute: (name: string) => name === "data-col-id" ? "tag" : undefined,
        } as unknown as HTMLElement;
        assert.equal(getFieldIdByCellElement(element, "list"), "row");
        assert.equal(getColId(element, "list"), "tag");

        const view = createView();
        view.columns[1].hidden = false;
        const selected = resolveAVSelectedCell({view, viewType: "list"} as IAV,
            {groupID: "", rowID: "row", colID: "tag"});
        assert.equal(selected.column.id, "tag");
        assert.equal(selected.cell.id, "tag-value");
    });

    it("creates every property type in the active list view when the database has another primary view", () => {
        const source = readFileSync(join(__dirname, "col.ts"), "utf8");
        const compiled = ts.transpileModule(source.slice(source.indexOf("export const addCol ="),
            source.indexOf("const genColDataByType =")), {
            compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022},
        }).outputText;
        const items: Array<{click: () => void}> = [];
        const operations: IOperation[] = [];
        const exports: {addCol?: typeof import("./col").addCol} = {};
        runInNewContext(compiled, {
            exports,
            Menu: class {
                addItem(item: {click: () => void}) {
                    items.push(item);
                }
            },
            activeBlur: () => {},
            Lute: {NewNodeID: () => "new-field"},
            dayjs: () => ({format: () => "20260920120000"}),
            Constants: {CUSTOM_SY_AV_VIEW: "custom-sy-av-view"},
            window: {siyuan: {languages: {}}},
            transaction: (_protyle: IProtyle, values: IOperation[]) => operations.push(...values),
            addAttrViewColAnimation: () => {},
        });
        const block = {
            getAttribute: (name: string) => ({
                "data-av-id": "database",
                "data-node-id": "carrier",
                "custom-sy-av-view": "list-view",
            })[name],
            setAttribute: () => {},
        } as unknown as Element;
        exports.addCol({} as IProtyle, block, "title");
        items.forEach(item => item.click());
        const columns = operations.filter(operation => operation.action === "addAttrViewCol");
        assert.equal(columns.length, items.length);
        assert.ok(columns.length > 0);
        columns.forEach(operation => {
            assert.equal(operation.blockID, "carrier");
            assert.equal(operation.viewID, "list-view");
            assert.equal(operation.previousID, "title");
        });
    });
});
