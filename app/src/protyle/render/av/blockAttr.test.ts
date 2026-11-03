import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

test("attribute panel requests bind the panel revision and release its lifecycle guard", async () => {
    let current: () => boolean;
    let owner: unknown;
    let disposed = 0;
    let finish: () => void;
    const signal = new AbortController().signal;
    const requests: unknown[][] = [];
    const exports: Record<string, (...args: any[]) => void> = {};
    runInNewContext(transpileModule(readFileSync("src/protyle/render/av/blockAttr.ts", "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2022},
    }).outputText, {exports, require: () => ({
        guardTemplateHTTPRequest: (valid: () => boolean, element: unknown) => {
            current = valid;
            owner = element;
            return {signal, dispose: () => disposed++};
        },
        fetchPost: (...args: unknown[]) => {
            requests.push(args);
            return new Promise<void>(resolve => { finish = resolve; });
        },
    })});
    const panel = {isConnected: true, dataset: {} as Record<string, string>};
    const protyle = {disabled: false, options: {history: {created: false, snapshot: false}}};
    exports.renderAVAttribute(panel, "document", protyle);
    assert.equal(owner, panel);
    assert.equal(current(), true);
    assert.equal(requests[0][0], "/api/av/getAttributeViewKeys");
    assert.equal(requests[0][5], signal);
    panel.dataset.avAttributeRenderId = "superseded";
    assert.equal(current(), false);
    finish();
    await Promise.resolve();
    assert.equal(disposed, 1);
    panel.isConnected = false;
    const liveOwner = {isConnected: true};
    let revisionCurrent = true;
    exports.renderAVAttribute(panel, "document", protyle, undefined, undefined,
        {owner: liveOwner, isCurrent: () => revisionCurrent});
    assert.equal(owner, liveOwner);
    assert.equal(current(), true);
    revisionCurrent = false;
    assert.equal(current(), false);
    revisionCurrent = true;
    liveOwner.isConnected = false;
    assert.equal(current(), false);
    finish();
    await Promise.resolve();
    assert.equal(disposed, 2);
    for (const mode of ["readonly", "history", "snapshot"]) {
        protyle.disabled = mode === "readonly";
        protyle.options.history.created = mode === "history";
        protyle.options.history.snapshot = mode === "snapshot";
        exports.renderAVAttribute(panel, "document", protyle);
        assert.equal(requests.at(-1)[5], undefined);
        finish();
        await Promise.resolve();
    }
    assert.equal(disposed, 2);
});
