import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

const compiled = transpileModule(readFileSync("src/protyle/render/av/backlink.ts", "utf8"), {
    compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
}).outputText;

test("initial backlinks locate once while reused databases only restore reference marks", () => {
    const requests: {itemID: string, scroll: boolean, highlight: boolean}[] = [];
    const exports: {prepareBacklinkAV?: (element: unknown, targets: unknown[]) => void} = {};
    runInNewContext(compiled, {
        exports,
        require: () => ({setAVLocateRequest: (_element: unknown, request: typeof requests[number]) => requests.push(request)}),
    });
    let rendered = false;
    let marked = false;
    let listeners = 0;
    const reference = {dataset: {id: "definition"}, classList: {add: () => { marked = true; }}};
    const database = {
        dataset: {nodeId: "database"},
        matches: () => true,
        classList: {add: () => {}},
        addEventListener: () => listeners++,
        getAttribute: () => rendered ? "true" : null,
        querySelectorAll: (selector: string) => selector === ".def--mark" ? [] : [{querySelectorAll: () => [reference]}],
    };
    const targets = [{blockID: "database", matches: [{itemID: "first", keyID: "key", defIDs: ["definition"]}]}];
    exports.prepareBacklinkAV(database, targets);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].itemID, "first");
    assert.equal(requests[0].scroll, true);
    assert.equal(requests[0].highlight, true);
    rendered = true;
    exports.prepareBacklinkAV(database, targets);
    exports.prepareBacklinkAV(database, targets);
    assert.equal(requests.length, 1);
    assert.equal(listeners, 1);
    assert.equal(marked, true);
});
