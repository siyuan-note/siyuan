import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";
import {getAVBindingOperations} from "./binding";

test("document binding validates document selection and reads the current binding for undo", async () => {
    let choose: (paths: string[]) => boolean | void;
    let message = "";
    let value: IAVCellValue = {type: "block", blockID: "item", isDetached: true, block: {id: "", content: "Title"}};
    const requests: unknown[] = [];
    const transactions: IOperation[][][] = [];
    const protyle = {id: "editor", options: {}} as IProtyle;
    const block = {dataset: {avId: "database", nodeId: "carrier"}, isConnected: true};
    const modules: Record<string, unknown> = {
        "../../../util/pathName": {movePathTo: (options: {cb: typeof choose, validate: (paths: string[]) => boolean}) => {
            choose = paths => options.validate(paths) ? options.cb(paths) : false;
        }},
        "../../../dialog/message": {showMessage: (text: string) => { message = text; }},
        "../../../util/fetch": {fetchSyncPost: async (_path: string, body: unknown) => {
            requests.push(body);
            return {code: 0, data: [{avID: "database", keyValues: [{key: {type: "block"}, values: value ? [value] : []}]}]};
        }},
        "../../wysiwyg/transaction": {transaction: (_owner: IProtyle, ...operations: IOperation[][]) => transactions.push(operations)},
        "./binding": {getAVBindingOperations},
    };
    const exports = {} as typeof import("./bindDocument");
    runInNewContext(transpileModule(readFileSync(join(__dirname, "bindDocument.ts"), "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2020},
    }).outputText, {exports, require: (name: string) => modules[name], window: {siyuan: {languages: {selectOneDocument: "Select one"}}}});
    exports.openAVBindDocument(protyle, block as unknown as HTMLElement, "item");
    assert.equal(choose(["/"]), false);
    assert.equal(choose(["/first.sy", "/second.sy"]), false);
    assert.equal(message, "Select one");
    assert.equal(requests.length, 0);
    for (const oldID of ["", "old-document"]) {
        value = {...value, isDetached: !oldID, block: {id: oldID, content: "Title"}};
        choose(["/parent/new-document.sy"]);
        await new Promise(resolve => setTimeout(resolve, 0));
        const [redo, undo] = transactions[transactions.length - 1];
        assert.equal(redo[0].nextID, "new-document");
        assert.equal(redo[0].previousID, "item");
        assert.equal(redo[0].blockID, "carrier");
        assert.equal(undo[0].nextID, oldID);
        assert.equal(undo[0].isDetached, !oldID);
    }
    assert.deepEqual(JSON.parse(JSON.stringify(requests[0])), {id: "item", avID: "database", itemID: "item"});
    value = undefined;
    choose(["/deleted-item.sy"]);
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(transactions.length, 2);
    value = {type: "block", blockID: "item", block: {id: "previous", content: "Title"}};
    choose(["/readonly.sy"]);
    protyle.disabled = true;
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(transactions.length, 2);
    choose = undefined;
    exports.openAVBindDocument(protyle, block as unknown as HTMLElement, "item");
    assert.equal(choose, undefined);
});
