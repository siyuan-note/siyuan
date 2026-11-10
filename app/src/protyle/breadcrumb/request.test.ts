import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

const compiled = transpileModule(readFileSync("src/protyle/breadcrumb/index.ts", "utf8"), {
    compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
}).outputText;

const fixture = () => {
    let commit: () => void;
    const pending = new Promise<void>(resolve => commit = resolve);
    const requests: {data: any, callback: (response: any) => void}[] = [];
    const exports: any = {};
    const editor = {globalBreadcrumb: false};
    runInNewContext(compiled, {
        exports,
        window: {siyuan: {config: {editor}}},
        require: () => ({
            waitForPendingTransactions: () => pending,
            isBreadcrumbNotebookAvailable: () => true,
            refreshUndoButtons: (): void => undefined,
            improveBreadcrumbAppearance: (): void => undefined,
            getGlobalBreadcrumb: async (blocks: unknown) => blocks,
            fetchPost: (_url: string, data: any, callback: (response: any) => void) => {
                requests.push({data, callback});
            },
        }),
    });
    const breadcrumb = Object.create(exports.Breadcrumb.prototype);
    breadcrumb.renderRequestID = 0;
    breadcrumb.element = {innerHTML: "previous", parentElement: null, querySelectorAll: (): unknown[] => [], querySelector: (): null => null};
    const protyle = {
        element: {getAttribute: (): string => null},
        block: {rootID: "document"},
        notebookId: "ordinary-notebook",
        breadcrumb,
    };
    const block = (id: string) => ({
        isConnected: true,
        getAttribute: () => id,
        classList: {contains: () => false},
    });
    return {editor, breadcrumb, protyle, requests, block, commit: () => commit()};
};

test("breadcrumb waits for copied blocks and queries only the latest selection with its notebook", async () => {
    const f = fixture();
    const first = f.breadcrumb.render(f.protyle, true, f.block("first-copy"));
    const second = f.breadcrumb.render(f.protyle, true, f.block("second-copy"));
    assert.equal(f.requests.length, 0);
    f.commit();
    await Promise.all([first, second]);
    assert.equal(f.requests.length, 1);
    assert.equal(f.requests[0].data.id, "second-copy");
    assert.equal(f.requests[0].data.notebook, "ordinary-notebook");
});

test("breadcrumb discards a block removed or a document switched during pending writes", async () => {
    for (const change of ["delete", "switch"]) {
        const f = fixture();
        const block = f.block("copy");
        const render = f.breadcrumb.render(f.protyle, true, block);
        if (change === "delete") {
            block.isConnected = false;
        } else {
            f.protyle.block.rootID = "another-document";
        }
        f.commit();
        await render;
        assert.equal(f.requests.length, 0);
    }
});

test("late breadcrumb responses cannot overwrite a newer selection", async () => {
    const f = fixture();
    f.commit();
    await f.breadcrumb.render(f.protyle, true, f.block("first-copy"));
    await f.breadcrumb.render(f.protyle, true, f.block("second-copy"));
    await f.requests[0].callback({data: []});
    assert.equal(f.breadcrumb.element.innerHTML, "previous");
    await f.requests[1].callback({data: []});
    assert.equal(f.breadcrumb.element.innerHTML, "");
});


for (const global of [false, true]) {
    test(`interrupted global breadcrumb refresh retries the same block (global=${global})`, async () => {
        const editors = Array.from({length: 3}, () => fixture());
        for (const f of editors) {
            f.editor.globalBreadcrumb = global;
            f.breadcrumb.globalBreadcrumb = !global;
            f.breadcrumb.id = "same-block";
            const old = f.block("same-block");
            const first = f.breadcrumb.render(f.protyle, true, old);
            old.isConnected = false;
            f.commit();
            await first;
            await f.breadcrumb.render(f.protyle, false, f.block("same-block"));
            assert.equal(f.requests.length, 1);
            await f.requests[0].callback({data: []});
            assert.equal(f.breadcrumb.element.innerHTML, "");
            await f.breadcrumb.render(f.protyle, false, f.block("same-block"));
            assert.equal(f.requests.length, 1, "completed render retains the cache");
        }
    });
}

test("a forced refresh superseded by the same block cannot suppress its replacement", async () => {
    const f = fixture();
    f.commit();
    await f.breadcrumb.render(f.protyle, true, f.block("same"));
    await f.requests[0].callback({data: []});
    const old = f.block("same");
    await f.breadcrumb.render(f.protyle, true, old);
    old.isConnected = false;
    await f.breadcrumb.render(f.protyle, false, f.block("same"));
    assert.equal(f.requests.length, 3);
    f.breadcrumb.element.innerHTML = "not refreshed";
    await f.requests[1].callback({data: []});
    assert.equal(f.breadcrumb.element.innerHTML, "not refreshed");
    await f.requests[2].callback({data: []});
    assert.equal(f.breadcrumb.element.innerHTML, "");
});
