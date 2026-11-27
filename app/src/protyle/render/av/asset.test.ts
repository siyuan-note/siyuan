import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import * as path from "node:path";
import {runInNewContext} from "node:vm";
import * as ts from "typescript";
import * as selectionState from "./selectionState";
import * as assetUploadTarget from "./assetUploadTarget";
import {getStoredCellValueByElement, updateAVCachedCellValue} from "./cellValue";
import * as uploadResult from "../../upload/uploadResult";
import * as viewType from "./viewType";
import * as insertPosition from "../../upload/insertPosition";
import * as escape from "../../../util/escape";
import * as image from "../../../util/image";
import * as imageURL from "../../../util/imageURL";
import * as host from "./host";
import * as panelTarget from "./panelTarget";
import {DOMFixture, type DOMElement} from "./testDOM";
import type {IAVCellInputElements} from "./cell";

const compile = (file: string) => ts.transpileModule(readFileSync(path.join(__dirname, file), "utf8"), {
    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022},
}).outputText;
const assetSource = compile("asset.ts");
const cellSource = compile("cell.ts");

const pathNames = {} as typeof import("../../../util/pathName");
runInNewContext(compile("../../../util/pathName.ts"), {
    exports: pathNames,
    require: (name: string) => name === "path" ? path : {},
});

// 使用完整资源消费者，控制上传完成与虚拟行移除的顺序，记录实际生成的事务。
const createHarness = (layout = "table", assetContent = "original.png") => {
    const column = {id: "assets", type: "mAsset"} as IAVColumn;
    const cell = {id: "value", value: {id: "value", type: "mAsset", mAsset: [
        {content: assetContent, name: "original", type: "image"},
    ]}} as IAVCell;
    const data = {view: {id: "view", columns: [column], rows: [{id: "row", cells: [cell]}]}} as unknown as IAV;
    let rendered = true;
    let panelOpen = false;
    const panel = {querySelector: (selector: string) => selector === ".b3-form__upload" ? {} : null,
        isConnected: false};
    const element = {
        dataset: {colId: "assets", id: "value"},
        classList: {contains: () => false},
        closest: () => ({dataset: {}}),
    };
    const block = {
        dataset: {avId: "av", nodeId: "block", avType: layout},
        closest: (): HTMLElement | null => null,
        getAttribute: (key: string) => ({"data-av-type": layout, "data-av-id": "av", "data-node-id": "block"})[key],
        contains: () => rendered,
        querySelector: () => rendered ? element : null,
        querySelectorAll: () => rendered ? [element] : [],
    };
    const operations: IOperation[] = [];
    const pending: Array<(_response: string, result: unknown) => void> = [];
    const mocks: Record<string, unknown> = {
        "./host": {...host, getAVHost: () => block},
        "./viewType": viewType,
        "./selectionState": selectionState,
        "./assetUploadTarget": assetUploadTarget,
        "./panelTarget": panelTarget,
        "../../upload/uploadResult": uploadResult,
        "../../upload/insertPosition": insertPosition,
        "./virtualScroll": {getAVData: () => data},
        "./col": {getColId: () => "assets"},
        "./row": {getFieldIdByCellElement: () => "row"},
        "./batchValue": {getAVBatchEditMode: () => "replace"},
        "../../../util/escape": escape,
        "../../../util/image": image,
        "../../../util/imageURL": imageURL,
        "../../../util/pathName": pathNames,
        "../../../constants": {Constants: {SIYUAN_ASSETS_IMAGE: [".png"]}},
        "../../../dialog/message": {showMessage: () => {}},
        "../../wysiwyg/transaction": {transaction: (_protyle: unknown, values: IOperation[]) => operations.push(...values)},
        "./action": {updateAttrViewCellAnimation: () => {}},
        "./cell": {
            getTypeByCellElement: () => "mAsset",
            genCellValueByElement: () => JSON.parse(JSON.stringify(cell.value)),
            updateAttrViewCellInOtherElements: (_p: unknown, _av: string, row: string, col: string, value: IAVCellValue) =>
                updateAVCachedCellValue(data.view, row, col, value),
        },
        "dayjs": () => ({format: () => "20260909120000"}),
        "../../upload": {
            uploadFiles: (_p: unknown, _files: unknown, _input: unknown, callback: typeof pending[number]) => pending.push(callback),
            uploadLocalFiles: (_files: unknown, _p: unknown, _upload: boolean, _options: unknown, callback: typeof pending[number]) => pending.push(callback),
        },
    };
    const module = {exports: {}};
    runInNewContext(assetSource, {
        module, exports: module.exports, require: (name: string) => mocks[name] || {},
        document: {body: {contains: () => true}, querySelector: () => panelOpen ? panel : null},
        window: {siyuan: {languages: {}}},
    });
    const api = module.exports as typeof import("./asset");
    const start = (kind: "picker" | "drop" | "panel") => {
        if (kind === "picker") {
            let change: () => void;
            api.bindAssetEvent({protyle: {} as IProtyle, blockElement: block as unknown as Element,
                cellElements: [element as unknown as HTMLElement], menuElement: {
                    querySelector: () => ({addEventListener: (_name: string, callback: (event: unknown) => void) => {
                        change = () => callback({target: {files: [new File(["image"], "image.png")]}});
                    }}),
                } as unknown as HTMLElement});
            change();
        } else if (kind === "panel") {
            panelOpen = true;
            const consume = api.captureAVAssetUploadHandler({options: {upload: {filename: (name: string) => name}}} as unknown as IProtyle,
                block as unknown as HTMLElement);
            pending.push((_response, result) => { void consume(result as Omit<IAssetUploadResult, "requestId" | "input">); });
            panelOpen = false;
        } else {
            api.dragUpload([{path: "image.png", size: 5}], {} as IProtyle, element as unknown as HTMLElement);
        }
    };
    return {start, data, column, cell, operations, api, element, hide: () => { rendered = false; },
        complete: (name: string) => pending.shift()("", {status: "success", succFiles: [
            {index: 0, name, path: name},
        ]})};
};

describe("database resource upload consumers", () => {
    it("keeps list uploads bound to the original row after virtualization removes it", () => {
        const harness = createHarness("list");
        harness.start("picker");
        harness.hide();
        harness.complete("list.png");
        assert.deepEqual(harness.cell.value.mAsset.map(value => value.content), ["original.png", "list.png"]);
        assert.equal(harness.operations.filter(op => op.action === "updateAttrViewCell").length, 1);
    });
    for (const kind of ["picker", "drop", "panel"] as const) {
        it(`${kind}: appends to a visible target`, () => {
            const harness = createHarness();
            harness.start(kind);
            harness.complete("new.png");
            assert.deepEqual(harness.cell.value.mAsset.map(value => value.content), ["original.png", "new.png"]);
            assert.deepEqual(harness.cell.value.mAsset.map(value => value.name), ["original", "new.png"]);
        });
        it(`${kind}: recognizes image filenames containing a literal hash`, () => {
            for (const name of ["image#copy.png", "image#copy.PNG"]) {
                const harness = createHarness();
                harness.start(kind);
                harness.complete(name);
                assert.equal(harness.cell.value.mAsset[1].type, "image", name);
                assert.equal(harness.cell.value.mAsset[1].name, name);
            }
        });
        it(`${kind}: appends both uploads while the row is not rendered`, () => {
            const harness = createHarness();
            harness.start(kind);
            harness.start(kind);
            harness.hide();
            harness.complete("first.png");
            harness.complete("second.png");
            assert.deepEqual(harness.cell.value.mAsset.map(value => value.content), ["original.png", "first.png", "second.png"]);
            assert.equal(harness.operations.filter(op => op.action === "updateAttrViewCell").length, 2);
        });

        for (const change of ["delete", "type"] as const) {
            it(`${kind}: stops when the target is ${change}`, () => {
                const harness = createHarness();
                harness.start(kind);
                harness.hide();
                if (change === "delete") {
                    (harness.data.view as IAVTable).rows = [];
                } else {
                    harness.column.type = "text";
                }
                harness.complete("new.png");
                assert.equal(harness.operations.length, 0);
                assert.equal(harness.cell.value.mAsset.length, 1);
            });
        }
    }
});

describe("database asset menu", () => {
    it("escapes quote-bearing image sources", () => {
        const harness = createHarness("table", "assets/poc.png?x=1\" onerror=\"require('child_process')\"");
        const html = harness.api.getAssetHTML([harness.element as unknown as HTMLElement]);

        assert.equal(html.includes(' onerror="'), false);
        assert.match(html, /src="assets\/poc\.png\?x=1&quot; onerror=&quot;/);
    });

    for (const ownerClass of ["protyle-db-row", "protyle-db-attr"]) {
        it(`continues removing attachments after the field is rendered again in ${ownerClass}`, () => {
            const document = new DOMFixture();
            const owner = document.createElement("div");
            owner.className = ownerClass;
            owner.innerHTML = '<div class="custom-attr"></div>';
            document.body.append(owner);
            const fieldOwner = owner.firstElementChild;
            const closest = fieldOwner.closest.bind(fieldOwner);
            fieldOwner.closest = selector => selector.split(",").map(part => closest(part.trim())).find(Boolean) || null;
            const panel = document.createElement("div");
            panel.className = "av__panel";
            panel.innerHTML = '<div class="b3-menu"></div>';
            document.body.append(panel);
            const menu = panel.firstElementChild;
            const paths = ["assets/first.png", "assets/second.png", "assets/third.png"];
            let value = {id: "value", type: "mAsset", mAsset: paths.map(content => ({type: "image", name: "", content}))};
            const render = (rowID = "row") => {
                owner.firstElementChild.innerHTML = `<div data-av-id="database" data-node-id="carrier" data-attribute-id="${rowID}" data-av-type="table">
<div class="custom-attr__avvalue" data-row-id="${rowID}" data-col-id="assets" data-id="value" data-type="mAsset"></div></div>`;
                const block = owner.firstElementChild.firstElementChild;
                const field = block.firstElementChild;
                field.dataset.cellValue = encodeURIComponent(JSON.stringify(value));
                return {block: block as unknown as HTMLElement, field: field as unknown as HTMLElement};
            };
            const {block, field} = render();
            const updates: Array<{before: string[]; after: string[]}> = [];
            const mocks: Record<string, unknown> = {
                "./host": {...host, canEditAVHost: () => true},
                "./cellEditor": {getAVCellEditorOwner: () => fieldOwner},
                "./cellValue": {getStoredCellValueByElement},
                "./viewType": viewType,
                "./panelTarget": panelTarget,
                "./virtualScroll": {getAVData: (): undefined => undefined},
                "./col": {getColId: (element: HTMLElement) => element.dataset.colId},
                "./row": {getFieldIdByCellElement: (element: HTMLElement) => element.dataset.rowId},
                "./batchValue": {getAVBatchEditMode: () => "replace"},
                "./cellPanelPosition": {setAVCellPanelPosition() {}},
                "../../../constants": {Constants: {CUSTOM_SY_AV_VIEW: "custom-sy-av-view", TIMEOUT_LOAD: 0}},
                "../../../util/escape": escape,
                "../../../util/image": image,
                "../../../util/imageURL": imageURL,
                "dayjs": () => ({format: () => "20261126000000"}),
                "../../wysiwyg/transaction": {transaction: (_protyle: unknown, ops: IOperation[], undo: IOperation[]) => {
                    const updated = ops[0].data as typeof value;
                    updates.push({before: Array.from((undo[0].data as typeof value).mAsset, asset => asset.content),
                        after: Array.from(updated.mAsset, asset => asset.content)});
                    value = updated;
                }},
            };
            const load = <T>(source: string) => {
                const exports = {} as T;
                runInNewContext(source, {exports, require: (name: string) => mocks[name] || {}, document,
                    window: {siyuan: {languages: {}}}, setTimeout: () => {}});
                return exports;
            };
            const cell = load<typeof import("./cell")>(cellSource);
            mocks["./cell"] = {...cell, updateAttrViewCellInOtherElements: () => {}};
            const asset = load<typeof import("./asset")>(assetSource);
            const protyle = {block: {rootID: "document"}} as IProtyle;
            const cellElements: IAVCellInputElements = [field];
            cell.captureAVCellInput(protyle, block, cellElements);
            panelTarget.setAVCellPanelTarget(panel as unknown as HTMLElement, block, cellElements);
            menu.innerHTML = asset.getAssetHTML(cellElements);
            const visible = () => Array.from(menu.querySelectorAll("button[data-index]"), (item: DOMElement) => item.dataset.content);
            const removeFirst = () => asset.updateAssetCell({protyle, blockElement: block, cellElements,
                menuElement: menu as unknown as HTMLElement, removeIndex: 0});
            removeFirst();
            assert.deepEqual(visible(), paths.slice(1));
            const replacement = render().field;
            assert.equal(field.isConnected, false);
            removeFirst();
            assert.equal(cellElements[0], replacement);
            assert.deepEqual(visible(), paths.slice(2));
            render("other-row");
            removeFirst();
            assert.deepEqual(updates, [
                {before: paths, after: paths.slice(1)},
                {before: paths.slice(1), after: paths.slice(2)},
            ]);
        });
    }
});
