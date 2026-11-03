import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

test("calculation templates delegate confirmation and await the transaction before reporting success", async () => {
    const items: Array<{label: string; click: () => void}> = [];
    let pending: () => Promise<boolean>;
    let confirm: () => void;
    let complete: () => void;
    let fail: (error: Error) => void;
    let requests = 0;
    let closes = 0;
    const textarea = {value: "qa-template"};
    class Dialog {
        element = {querySelector: (selector: string) => selector === "textarea" ? textarea : {
            addEventListener: (_: string, callback: () => void) => {
                if (selector === ".b3-button--text") confirm = callback;
            },
        }};
        runPending(task: () => Promise<boolean>) { pending = task; return Promise.resolve(false); }
        destroy() { closes++; }
        bindInput() {}
        focusWhenReady() {}
    }
    const columns = [{id: "column", calc: {operator: "Template", template: "old"}}];
    const exports = {} as typeof import("./calc");
    runInNewContext(transpileModule(readFileSync("src/protyle/render/av/calc.ts", "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2022},
    }).outputText, {exports, window: {siyuan: {languages: new Proxy({}, {get: (_, key) => String(key)})}},
        require: () => ({MobileDialog: Dialog, Constants: {}, isAVDateType: () => false,
            getFieldsByData: () => columns, escapeAttr: String, escapeHtml: String,
            Menu: class {addItem(item: typeof items[0]) { items.push(item); } close() {} open() {}},
            transaction: (_protyle: unknown, operations: IOperation[], undo: IOperation[], options: {awaitResponse: boolean}) => {
                assert.equal(options.awaitResponse, true);
                assert.equal(operations[0].action, "setAttrViewColCalc");
                assert.equal(undo[0].action, "setAttrViewColCalc");
                assert.equal(operations[0].data.template, textarea.value);
                assert.equal(undo[0].data.template, "old");
                requests++;
                return new Promise<void>((resolve, reject) => { complete = resolve; fail = reject; });
            },
        }),
    });
    await exports.openCalcMenu({} as IProtyle, {dataset: {colType: "text", calc: "Template"},
        getBoundingClientRect: () => ({left: 0, bottom: 100, height: 28})} as unknown as HTMLElement,
    {data: {id: "database"} as IAV, colId: "column", blockID: "carrier"});
    items.find(item => item.label === "calcOperatorTemplate").click();
    confirm();
    assert.equal(requests, 0);
    const saving = pending();
    const rejected = assert.rejects(saving, /failed/);
    fail(new Error("failed"));
    await rejected;
    assert.equal(closes, 0);
    const retry = pending();
    complete();
    assert.equal(await retry, true);
    assert.equal(requests, 2);
});
