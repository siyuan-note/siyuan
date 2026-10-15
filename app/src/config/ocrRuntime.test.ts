import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

for (const mobile of [false, true]) {
    test(`model notifications reach OCR listeners through the shared WebSocket handler (mobile=${mobile})`, () => {
        const {parse} = require("ifdef-loader/preprocessor");
        const compile = (file: string) => transpileModule(parse(readFileSync(file, "utf8"), {MOBILE: mobile}, false, true), {
            compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
        }).outputText;
        const events: string[] = [];
        const runtime = {} as {OCR_CHANGED_EVENT: string; notifyOCRChanged: () => void};
        runInNewContext(compile("src/config/ocrRuntime.ts"), {exports: runtime, CustomEvent: Event,
            window: {dispatchEvent: (event: Event) => events.push(event.type)}});
        const api = {} as {processMessage: (value: unknown) => unknown};
        runInNewContext(compile("src/util/processMessage.ts"), {exports: api, require: (name: string) =>
            name === "../config/ocrRuntime" ? runtime : {}});
        assert.equal(api.processMessage({cmd: "ocrChanged", code: 0}), false);
        assert.deepEqual(events, [runtime.OCR_CHANGED_EVENT]);
        const unrelated = {cmd: "settingChanged", code: 0};
        assert.equal(api.processMessage(unrelated), unrelated);
    });
}
