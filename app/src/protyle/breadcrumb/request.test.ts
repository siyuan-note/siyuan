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
    runInNewContext(compiled, {
        exports,
        require: () => ({
            waitForPendingTransactions: () => pending,
            refreshUndoButtons: (): void => undefined,
            improveBreadcrumbAppearance: (): void => undefined,
            fetchPost: (_url: string, data: any, callback: (response: any) => void) => {
                requests.push({data, callback});
            },
        }),
    });
    const breadcrumb = Object.create(exports.Breadcrumb.prototype);
    breadcrumb.renderRequestID = 0;
    breadcrumb.element = {innerHTML: "previous", parentElement: null};
    const protyle = {
        element: {getAttribute: (): string => null},
        block: {rootID: "document"},
        notebookId: "ordinary-notebook",
    };
    const block = (id: string) => ({
        isConnected: true,
        getAttribute: () => id,
        classList: {contains: () => false},
    });
    return {breadcrumb, protyle, requests, block, commit: () => commit()};
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
    f.requests[0].callback({data: []});
    assert.equal(f.breadcrumb.element.innerHTML, "previous");
    f.requests[1].callback({data: []});
    assert.equal(f.breadcrumb.element.innerHTML, "");
});
