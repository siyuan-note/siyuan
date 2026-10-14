import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";
import {DynamicLoadState} from "./dynamicLoadState";

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

test("page boundary loads preserve notebook scoping and focus suppression and reject invalidated responses", async () => {
    const rendered: any[] = [];
    const requests: Array<{data: any, callback: (data: any) => void, finish: () => void}> = [];
    const exports: any = {};
    runInNewContext(compiled, {
        exports, AbortController,
        window: {siyuan: {config: {editor: {dynamicLoadBlocks: 128}}}},
        require: () => ({
            DynamicLoadState,
            Constants: {CB_GET_BEFORE: "before", CB_GET_APPEND: "append", CB_GET_UNCHANGEID: "keep-id"},
            isEncryptedBox: (notebook: string) => notebook === "encrypted",
            onGet: (options: any) => rendered.push(options),
            refreshSyntheticDragTarget() {},
            fetchPost: (_url: string, data: any, callback: (data: any) => void) => new Promise<void>(finish => {
                requests.push({data, callback, finish});
            }),
        }),
    });
    const scroll = Object.create(exports.Scroll.prototype);
    scroll.dynamicLoadState = new DynamicLoadState();
    const attributes = new Map<string, string>();
    const protyle = {scroll, notebookId: "encrypted", block: {rootID: "document"},
        element: {isConnected: true}, contentElement: {scrollTop: 0}, wysiwyg: {element: {
            firstElementChild: {getAttribute: (name: string) => name === "data-node-id" ? "first" : undefined},
            lastElementChild: {getAttribute: (name: string) => name === "data-node-id" ? "last" : undefined},
            hasAttribute: (name: string) => attributes.has(name),
            setAttribute: (name: string, value: string) => attributes.set(name, value),
            removeAttribute: (name: string) => attributes.delete(name),
        }}};
    let result: boolean | undefined;
    assert.equal(scroll.loadDynamic(protyle, 1, {suppressFocus: true, onFinish: (success: boolean) => result = success}), true);
    assert.equal(requests[0].data.notebook, "encrypted");
    assert.equal(requests[0].data.mode, 1);
    assert.equal(scroll.loadDynamic(protyle, 2), false);
    requests[0].callback({code: 0, data: {content: "blocks"}});
    requests[0].finish();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(rendered[0].suppressFocus, true);
    assert.equal(rendered[0].protyle, protyle);
    assert.equal(result, true);
    assert.equal(attributes.has("data-top"), false);
    assert.equal(scroll.loadDynamic(protyle, 2, {suppressFocus: true}), true);
    scroll.invalidateDynamicLoad(protyle);
    requests[1].callback({code: 0});
    requests[1].finish();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(rendered.length, 1);
});
