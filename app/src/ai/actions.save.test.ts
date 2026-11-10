import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, transpileModule} from "typescript";

for (const action of ["create", "edit", "delete"]) {
    test(`AI custom action ${action} waits for acknowledgement, preserves failures and deduplicates retry`, async () => {
        const input = {value: "draft"};
        const textarea = {value: "draft action"};
        const clicks: (() => void)[] = [];
        const buttons = [0, 1, 2].map(index => ({addEventListener: (_event: string, cb: () => void) => { clicks[index] = cb; }}));
        const requests: {url: string, data: unknown, resolve: (value: {code: number}) => void}[] = [];
        let pending = false;
        let closed = false;
        let settled: Promise<boolean>;
        const exports = {} as {create: (protyle: unknown, elements: unknown[]) => void, edit: (item: unknown) => void};
        const compiled = transpileModule(readFileSync("src/ai/actions.ts", "utf8") +
            "\nexports.create = customDialog; exports.edit = editDialog;", {compilerOptions: {module: ModuleKind.CommonJS}}).outputText;
        runInNewContext(compiled, {
            exports,
            window: {siyuan: {languages: {}}},
            require: () => ({
                Constants: {}, isMobile: () => true,
                fetchSyncPost: (url: string, data: unknown) => new Promise(resolve => requests.push({url, data, resolve})),
                MobileDialog: class {
                    element = {setAttribute() {}, querySelector: (selector: string) => selector === "input" ? input : textarea,
                        querySelectorAll: () => buttons};
                    bindInput() {}
                    focusWhenReady() {}
                    destroy() { if (!pending) closed = true; }
                    runPending(task: () => Promise<boolean>) {
                        if (pending) return Promise.resolve(false);
                        pending = true;
                        settled = task().then(success => { closed = success; return success; })
                            .finally(() => { pending = false; });
                        return settled;
                    }
                },
            }),
        });
        if (action === "create") exports.create({}, []);
        else exports.edit({id: "test-id", name: "draft", action: "draft action"});
        input.value = "edited draft";
        const index = action === "delete" ? 0 : 2;
        clicks[index]();
        clicks[index]();
        clicks[action === "create" ? 0 : 1]();
        assert.equal(requests.length, 1);
        assert.equal(closed, false);
        requests[0].resolve({code: -1});
        assert.equal(await settled, false);
        assert.equal(closed, false);
        assert.equal(input.value, "edited draft");
        clicks[index]();
        assert.equal(requests.length, 2);
        assert.equal(requests[1].url, `/api/ai/editor/${action === "delete" ? "removeAction" : "saveAction"}`);
        assert.deepEqual(JSON.parse(JSON.stringify(requests[1].data)), action === "delete" ? {id: "test-id"} :
            {...(action === "edit" ? {id: "test-id"} : {}), name: "edited draft", action: "draft action"});
        requests[1].resolve({code: 0});
        assert.equal(await settled, true);
        assert.equal(closed, true);
    });
}
