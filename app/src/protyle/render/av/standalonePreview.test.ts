import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

for (const layout of ["table", "gallery", "kanban"]) {
    test(`${layout} previews omit temporary carriers and never create missing databases`, async () => {
        const requests: Array<{blockID: string, createIfNotExist: boolean}> = [];
        const methods: Record<string, (...args: unknown[]) => Promise<void>> = {};
        const imports: Record<string, unknown> = {
            Constants: {CB_GET_AV_NO_CREATE: "standalone"},
            getAVSelectedItemPoints: (): [] => [],
            getPageSize: () => ({unGroupPageSize: 50, groupPageSize: {}}),
            isCurrentAVRender: () => false,
            fetchSyncPost: async (url: string, request: typeof requests[number]) => {
                assert.equal(url, "/api/av/renderAttributeView");
                requests.push(request);
                return {code: 0};
            },
        };
        runInNewContext(transpileModule(readFileSync(
            `src/protyle/render/av/${layout === "table" ? "" : layout + "/"}render.ts`, "utf8"), {
            compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2022},
        }).outputText, {
            exports: methods,
            window: {siyuan: {}},
            require: () => new Proxy(imports, {get: (target, key: string) => target[key] || ((): undefined => undefined)}),
        });
        const block = {
            style: {}, firstElementChild: {innerHTML: "loading"},
            getAttribute: (name: string) => ({
                "data-type": "NodeAttributeView", "data-node-id": "carrier", "data-av-id": "database",
                "data-av-type": layout,
            })[name] || null,
            closest: (): null => null, removeAttribute() {}, querySelector: (): null => null, querySelectorAll: (): [] => [],
        };
        for (const standalone of [true, false]) {
            const protyle = {options: {}, block: {action: standalone ? ["standalone"] : []}, contentElement: {scrollTop: 0}};
            if (layout === "table") {
                await methods.avRender(block, protyle);
            } else {
                await methods[layout === "gallery" ? "renderGallery" : "renderKanban"]({blockElement: block, protyle});
            }
        }
        assert.equal(requests.length, 2);
        assert.equal(requests[0].blockID, "");
        assert.equal(requests[0].createIfNotExist, false);
        assert.equal(requests[1].blockID, "carrier");
        assert.equal(requests[1].createIfNotExist, true);
    });
}
