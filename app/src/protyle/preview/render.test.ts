import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

test("preview completion waits for its delayed request and database rendering and reports request failures", async () => {
    for (const failure of [false, true]) {
        let render: () => void;
        let reply: (response: unknown) => void;
        let completeDatabase: () => void;
        let completed = false;
        let failed = false;
        const database = new Promise<void>(resolve => completeDatabase = resolve);
        const noop = () => {};
        const api = {} as {Preview: typeof import("./index").Preview};
        runInNewContext(transpileModule(readFileSync("src/protyle/preview/index.ts", "utf8"), {
            compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
        }).outputText, {exports: api,
            window: {setTimeout: (callback: () => void) => { render = callback; return 1; },
                siyuan: {languages: {}, config: {editor: {}, appearance: {}}}},
            CSS: {escape: (id: string) => id},
            require: (name: string) => {
                if (name === "../../util/fetch") return {fetchPost: (_url: string, _data: unknown, callback: typeof reply) => {
                    reply = callback;
                    return Promise.resolve();
                }};
                if (name === "../render/av/render") return {avRender: () => database};
                if (name === "../../util/hostCapabilities") return {getHostCapabilities: () => ({remoteKernel: false})};
                return new Proxy({}, {get: () => noop});
            },
        });
        const preview = Object.create(api.Preview.prototype) as import("./index").Preview;
        preview.element = {style: {}, querySelector: () => ({remove: noop})} as unknown as HTMLElement;
        preview.previewElement = {scrollTop: 23, querySelector: (): null => null} as unknown as HTMLElement;
        preview.updatePadding = noop;
        preview.render({preview, block: {rootID: "root"}, options: {preview: {delay: 50}}} as IProtyle,
            () => completed = true, () => failed = true);
        assert.equal(completed, false);
        render();
        reply(failure ? {code: -1} : {code: 0, data: {html: "fresh content"}});
        assert.equal(completed, false);
        if (failure) {
            assert.equal(failed, true);
        } else {
            completeDatabase();
            await Promise.resolve();
            assert.equal(completed, true);
            assert.equal(failed, false);
            assert.equal(preview.previewElement.innerHTML, "fresh content");
            assert.equal(preview.previewElement.scrollTop, 23);
        }
    }
});
