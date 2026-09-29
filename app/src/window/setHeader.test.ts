import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, transpileModule} from "typescript";

test("空页签不阻断新窗口初始化，重新添加文档后更新窗口标识", () => {
    const tabs: Array<{model?: unknown, headElement?: {getAttribute: () => string}}> = [{}];
    const window = {location: {hash: "previous"}};
    const api = {} as typeof import("./setHeader");
    const dependencies = {
        isWindow: () => true,
        getAllTabs: () => tabs,
        Constants: {ZWSP: "\u200b"},
        Editor: class {},
        Asset: class {},
    };
    runInNewContext(transpileModule(readFileSync("src/window/setHeader.ts", "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS},
    }).outputText, {exports: api, require: () => dependencies, window});
    api.setModelsHash();
    assert.equal(window.location.hash, "");
    tabs.push({headElement: {getAttribute: () => JSON.stringify({instance: "Editor", rootId: "reopened"})}});
    api.setModelsHash();
    assert.equal(window.location.hash, "reopened\u200b");
});
