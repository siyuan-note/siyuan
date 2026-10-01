import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {runInNewContext} from "node:vm";
import * as ts from "typescript";
import * as cellValue from "./cellValue";
import * as dragFillValue from "./dragFillValue";
import * as viewType from "./viewType";
import * as escape from "../../../util/escape";

// 执行实际渲染、取值和事务生成代码，隔离图标面板与编辑器外部依赖。
const createHarness = (layout: TAVView = "table", detached = true, icon?: string, relation = false) => {
    const value: IAVCellValue = {id: "value", keyID: "primary", blockID: "row", type: "block",
        isDetached: detached, block: {content: "Title", ...(detached ? {} : {id: "document"}), icon}};
    const cell = {id: "value", value} as IAVCell;
    const data = {view: {columns: [{id: "primary", type: "block"}], rows: [{id: "row", cells: [cell]}]}} as IAV;
    const operations: Array<{doOperations: IOperation[], undoOperations: IOperation[]}> = [];
    let panel: {id: string, type: string, callback: (icon: string) => void};
    const siyuan = {config: {readonly: false, editor: {allowHTMLBLockScript: true}}, isPublish: false,
        languages: {untitled: "Untitled"}};
    const block = {dataset: {avId: "av", nodeId: "database", avType: layout},
        getAttribute: (name: string) => name === "data-av-type" ? layout : "20260929120000",
        querySelectorAll: (): HTMLElement[] => [], contains: () => true};
    const cellElement = {dataset: {id: "value", colId: "primary", detached: String(detached)},
        isConnected: true,
        querySelector: (selector: string) => {
            if (selector === "input, textarea") {
                return null;
            }
            if (selector === ".av__celltext") {
                return {textContent: cell.value.block.content, dataset: {id: cell.value.block.id}};
            }
            return selector === ".b3-menu__avemoji" ? target : null;
        }};
    const relationElement = {dataset: {rowId: "row", relationValue: encodeURIComponent(JSON.stringify(value))},
        closest: () => ({dataset: layout === "gallery" ? {fieldId: "relation"} : {colId: "relation"}})};
    const target = {dataset: {unicode: icon || ""}, innerHTML: "", isConnected: true,
        closest: (selector: string) => selector === ".av__cell--relation" ? (relation ? relationElement : null) : cellElement,
        querySelector: (): HTMLElement => null,
        getBoundingClientRect: () => ({left: 1, bottom: 2, height: 3, width: 4})};
    const protyle = {disabled: false, element: {}, options: {},
        wysiwyg: {element: {querySelectorAll: () => [block]}}} as unknown as IProtyle;
    const mocks: Record<string, unknown> = {
        "./cellValue": cellValue,
        "./dragFillValue": dragFillValue,
        "./viewType": viewType,
        "../../../util/escape": escape,
        "../../../emoji/fileTreeIcon": {getFileTreeIconHTML: (item: string) => `<i>${escape.escapeHtml(item || "document-default")}</i>`},
        "../../../emoji": {openEmojiPanel: (id: string, type: string, _position: unknown, callback: (icon: string) => void) => {
            panel = {id, type, callback};
        }},
        "../../util/hasClosest": {hasClosestBlock: () => block, hasClosestByClassName: () => false},
        "./virtualScroll": {getAVData: () => data, getAVPrimaryCell: () => cell},
        "../../../util/fetch": {fetchSyncPost: async (path: string) => ({code: 0,
            data: path.endsWith("getAttributeViewKeysByID") ? [{relation: {avID: "related"}}] : [{
                avID: "related", blockIDs: ["related-database"],
                keyValues: [{key: {id: "primary", type: "block"}, values: [cell.value]}],
            }],
        })},
        "./row": {getFieldIdByCellElement: () => "row"},
        "./col": {getColId: () => "primary"},
        "./selectionState": {updateAVSelectedCellValue: () => {}},
        "./batchValue": {getAVBatchEditMode: () => "replace", getAVBatchSourceValue: (_element: unknown, item: IAVCellValue) => item},
        "../../../util/functions": {objEquals: (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)},
        "../../../util/hostCapabilities": {getHostCapabilities: () => ({remoteKernel: false})},
        "dayjs": () => ({format: () => "20260929130000"}),
        "../../wysiwyg/transaction": {transaction: (_protyle: unknown, doOperations: IOperation[], undoOperations: IOperation[]) => {
            operations.push({doOperations, undoOperations});
        }},
    };
    const load = (name: string) => {
        const module = {exports: {}};
        runInNewContext(ts.transpileModule(readFileSync(join(__dirname, `${name}.ts`), "utf8"), {
            compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022},
        }).outputText, {
            module, exports: module.exports, require: (id: string) => mocks[id] || {},
            window: {siyuan}, document: {querySelectorAll: (): HTMLElement[] => [], createElement: () => ({
                matches: () => false, querySelector: (): HTMLElement => null, querySelectorAll: (): HTMLElement[] => [], textContent: "",
            })},
        });
        mocks[`./${name}`] = module.exports;
        return module.exports;
    };
    const icons = load("blockIcon") as typeof import("./blockIcon");
    const attributes = load("attributeValue") as typeof import("./attributeValue");
    const api = load("cell") as typeof import("./cell");
    const selected = () => [{groupID: "", rowID: "row", colID: "primary", rowIndex: 0, colIndex: 0,
        cell, column: {id: "primary", type: "block"}}] as Parameters<typeof api.updateCellsValue>[9];
    return {api, icons, attributes, cell, cellElement, target, protyle, siyuan, operations,
        get panel() { return panel; },
        update: (next: unknown) => api.updateCellsValue(protyle, block as unknown as HTMLElement, next,
            undefined, undefined, undefined, false, false, false, selected()),
        open: () => api.openAVCellIcon(protyle, target as unknown as HTMLElement)};
};

describe("database item icons", () => {
    it("renders detached defaults and custom icons in every layout and honors hidden icons", () => {
        const h = createHarness();
        for (const layout of ["table", "list", "gallery", "kanban", "calendar"] as TAVView[]) {
            assert.match(h.api.renderCell(h.cell.value, 0, true, layout), /#iconLine/);
            assert.match(h.api.renderCell(h.cell.value, 0, false, layout), /b3-menu__avemoji fn__none/);
            h.cell.value.block.icon = "1f600";
            const html = h.api.renderCell(h.cell.value, 0, true, layout);
            assert.match(html, /data-unicode="1f600"/);
            assert.doesNotMatch(html, /data-type="block-ref"/);
            delete h.cell.value.block.icon;
        }
        assert.match(h.attributes.genAVValueHTML(h.cell.value), /#iconLine/);
        assert.doesNotMatch(h.attributes.genAVValueHTML(h.cell.value), /data-id="undefined"/);
    });

    it("shows detached icons in relation and rollup values without creating a block reference", () => {
        const h = createHarness("table", true, "1f600");
        const relation = h.attributes.genAVRelationHTML(h.cell.value, "row");
        assert.match(relation, /data-unicode="1f600"/);
        assert.doesNotMatch(relation, /data-type="block-ref"/);
        const rollup = h.api.renderCell({type: "rollup", rollup: {contents: [h.cell.value]}}, 0, false);
        assert.match(rollup, /b3-menu__avemoji fn__none/);
    });

    it("keeps icons beside display templates and in entry details", () => {
        const h = createHarness("table", true, "1f600");
        h.cell.value.renderedContent = "<strong>Display title</strong>";
        for (const html of [h.api.renderCell(h.cell.value), h.attributes.genAVValueHTML(h.cell.value)]) {
            assert.match(html, /data-unicode="1f600"/);
            assert.match(html, /<strong>Display title<\/strong>/);
            assert.match(html, /data-cell-value=/);
        }
    });

    it("keeps primary content separate from row actions without changing references or template values", () => {
        for (const detached of [false, true]) {
            const h = createHarness("table", detached, "1f600");
            for (const template of [false, true]) {
                if (template) {
                    h.cell.value.renderedContent = "<strong>Display title</strong>";
                }
                for (const showIcon of [false, true]) {
                    const html = h.api.renderCell(h.cell.value, 0, showIcon);
                    assert.match(html, /^<span class="av__cellprimary"><span class="b3-menu__avemoji/);
                    assert.match(html, /<\/span><span class="av__row-actions">/);
                    assert.equal((html.match(/data-type="av-row-open"/g) || []).length, 1);
                    assert.equal((html.match(/data-type="av-row-update"/g) || []).length, 1);
                    if (template) {
                        const value = html.match(/data-cell-value="([^"]+)"/)[1];
                        assert.equal(JSON.parse(decodeURIComponent(value)).block.content, "Title");
                        assert.match(html, /<strong>Display title<\/strong>/);
                    } else if (!detached) {
                        assert.match(html, /data-type="block-ref" data-id="document"/);
                    }
                }
            }
        }
    });

    it("reads an explicit empty icon for undo and preserves icons when renaming or unbinding", async () => {
        const h = createHarness("list", true, "1f600");
        assert.equal(h.api.genCellValueByElement("block", h.cellElement as unknown as HTMLElement).block.icon, "1f600");
        await h.update("Renamed");
        assert.equal(h.cell.value.block.content, "Renamed");
        assert.equal(h.cell.value.block.icon, "1f600");
        await h.update({icon: "", content: "Renamed"});
        assert.equal((h.operations[1].doOperations[0].data as IAVCellValue).block.icon, "");
        assert.equal((h.operations[1].undoOperations[0].data as IAVCellValue).block.icon, "1f600");
        h.target.dataset.unicode = "";
        assert.equal(h.api.genCellValueByElement("block", h.cellElement as unknown as HTMLElement).block.icon, "");
        const bound = createHarness("table", false, "1f600");
        await bound.update({content: "Title"});
        assert.equal(bound.cell.value.isDetached, true);
        assert.equal(bound.cell.value.block.icon, "1f600");
        assert.equal((bound.operations[0].undoOperations[0].data as IAVCellValue).block.id, "document");
        const paste = createHarness();
        await paste.update({type: "block", isDetached: true, block: {content: "Pasted", icon: "1f600"}});
        assert.equal((paste.operations[0].undoOperations[0].data as IAVCellValue).block.icon, "");
    });

    it("uses row transactions for detached icons and the document picker for bound icons", async () => {
        for (const layout of ["table", "list", "gallery", "kanban"] as TAVView[]) {
            const h = createHarness(layout);
            h.open();
            assert.equal(h.panel.type, "av");
            h.panel.callback("1f600");
            await Promise.resolve();
            const op = h.operations[0];
            assert.equal(op.doOperations[0].rowID, "row");
            assert.equal(op.doOperations[0].keyID, "primary");
            assert.equal((op.doOperations[0].data as IAVCellValue).block.content, "Title");
            assert.equal((op.doOperations[0].data as IAVCellValue).block.icon, "1f600");
            assert.equal((op.undoOperations[0].data as IAVCellValue).block.icon, "");
        }
        const bound = createHarness("table", false);
        bound.open();
        assert.equal(bound.panel.type, "doc");
        assert.equal(bound.panel.id, "document");
        bound.panel.callback("1f600");
        assert.equal(bound.target.dataset.unicode, "1f600");
        assert.equal(bound.operations.length, 0);
    });

    it("keeps the original row through virtual scrolling and preserves later title edits", async () => {
        const h = createHarness();
        h.open();
        h.cellElement.isConnected = false;
        h.cell.value.block.content = "Later title";
        h.panel.callback("1f600");
        await Promise.resolve();
        assert.equal((h.operations[0].doOperations[0].data as IAVCellValue).block.content, "Later title");
        assert.equal(h.operations[0].doOperations[0].rowID, "row");
    });

    it("edits the related entry with its carrier and reads its latest primary value for undo", async () => {
        const h = createHarness("gallery", true, undefined, true);
        await h.open();
        assert.equal(h.panel.type, "av");
        h.cell.value.block.content = "Later title";
        h.cell.value.block.icon = "1f680";
        await h.panel.callback("1f600");
        const op = h.operations[0];
        assert.equal(op.doOperations[0].avID, "related");
        assert.equal(op.doOperations[0].blockID, "related-database");
        assert.equal(op.doOperations[0].rowID, "row");
        assert.equal((op.doOperations[0].data as IAVCellValue).block.content, "Later title");
        assert.equal((op.undoOperations[0].data as IAVCellValue).block.icon, "1f680");
        assert.equal(h.target.dataset.unicode, "1f600");
        h.cell.value.isDetached = false;
        await h.panel.callback("");
        assert.equal(h.operations.length, 1);
    });

    it("does not write after rebinding, becoming read-only, or publishing", () => {
        for (const change of ["binding", "disabled", "readonly", "publish"]) {
            const h = createHarness();
            h.open();
            if (change === "binding") {
                h.cell.value.isDetached = false;
                h.cell.value.block.id = "document";
            } else if (change === "disabled") {
                h.protyle.disabled = true;
            } else if (change === "readonly") {
                h.siyuan.config.readonly = true;
            } else {
                h.siyuan.isPublish = true;
            }
            h.panel.callback("1f600");
            assert.equal(h.operations.length, 0);
        }
        const h = createHarness();
        h.protyle.disabled = true;
        h.open();
        assert.equal(h.panel, undefined);
    });
});
