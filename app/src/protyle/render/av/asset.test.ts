import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {runInNewContext} from "node:vm";
import * as ts from "typescript";
import * as selectionState from "./selectionState";
import * as assetUploadTarget from "./assetUploadTarget";
import {updateAVCachedCellValue} from "./cellValue";
import * as uploadResult from "../../upload/uploadResult";

// 使用完整资源消费者，控制上传完成与虚拟行移除的顺序，记录实际生成的事务。
const createHarness = () => {
    const column = {id: "assets", type: "mAsset"} as IAVColumn;
    const cell = {id: "value", value: {id: "value", type: "mAsset", mAsset: [
        {content: "original.png", name: "original", type: "image"},
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
        getAttribute: (key: string) => ({"data-av-type": "table", "data-av-id": "av", "data-node-id": "block"})[key],
        contains: () => rendered,
        querySelector: () => rendered ? element : null,
        querySelectorAll: () => rendered ? [element] : [],
    };
    const operations: IOperation[] = [];
    const pending: Array<(_response: string, result: unknown) => void> = [];
    const mocks: Record<string, unknown> = {
        "./selectionState": selectionState,
        "./assetUploadTarget": assetUploadTarget,
        "../../upload/uploadResult": uploadResult,
        "./virtualScroll": {getAVData: () => data},
        "./col": {getColId: () => "assets"},
        "./row": {getFieldIdByCellElement: () => "row"},
        "./batchValue": {getAVBatchEditMode: () => "replace"},
        "../../../util/pathName": {getAssetExtension: () => ".png"},
        "../../../constants": {Constants: {SIYUAN_ASSETS_IMAGE: [".png"]}},
        "../../../dialog/message": {showMessage: () => {}},
        "../../util/hasClosest": {hasClosestBlock: () => block},
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
    runInNewContext(ts.transpileModule(readFileSync(join(__dirname, "asset.ts"), "utf8"), {
        compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022},
    }).outputText, {
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
    return {start, data, column, cell, operations, hide: () => { rendered = false; },
        complete: (name: string) => pending.shift()("", {status: "success", succFiles: [
            {index: 0, name, path: name},
        ]})};
};

describe("database resource upload consumers", () => {
    for (const kind of ["picker", "drop", "panel"] as const) {
        it(`${kind}: appends to a visible target`, () => {
            const harness = createHarness();
            harness.start(kind);
            harness.complete("new.png");
            assert.deepEqual(harness.cell.value.mAsset.map(value => value.content), ["original.png", "new.png"]);
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
