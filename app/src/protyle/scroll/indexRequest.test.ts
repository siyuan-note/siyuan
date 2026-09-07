import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

const compiled = transpileModule(readFileSync("src/protyle/scroll/index.ts", "utf8"), {
    compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
}).outputText;

test("scroll index waits for writes and drops superseded requests and responses", async () => {
    let commit: () => void;
    const pending = new Promise<void>(resolve => commit = resolve);
    const requests: {id: string, callback: (response: any) => void}[] = [];
    const indexes: number[] = [];
    const exports: any = {};
    runInNewContext(compiled, {
        exports,
        AbortController,
        require: () => ({
            waitForPendingTransactions: () => pending,
            fetchPost: (_url: string, data: any, callback: (response: any) => void) => {
                requests.push({id: data.id, callback});
                return Promise.resolve();
            },
        }),
    });
    const scroll = Object.create(exports.Scroll.prototype);
    scroll.indexRequestID = 0;
    const protyle = {block: {rootID: "document"}, scroll: {setCurrentIndex: (_protyle: any, index: number) => indexes.push(index)}};
    const first = scroll.updateIndex(protyle, "first-copy");
    const second = scroll.updateIndex(protyle, "second-copy");
    assert.equal(requests.length, 0);
    commit();
    await Promise.all([first, second]);
    assert.deepEqual(requests.map(item => item.id), ["second-copy"]);
    await scroll.updateIndex(protyle, "third-copy");
    requests[0].callback({data: 2});
    requests[1].callback({data: 3});
    assert.deepEqual(indexes, [3]);
    const switched = scroll.updateIndex(protyle, "fourth-copy");
    protyle.block.rootID = "another-document";
    await switched;
    assert.equal(requests.length, 2);
});
