import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

const compile = (file: string) => transpileModule(readFileSync(resolve(__dirname, file), "utf8"), {
    compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
}).outputText;

test("title input truncates at the same character boundary as title validation", () => {
    const runtime = {siyuan: {documentAddressingVersion: 2,
        languages: {fileNameRule: "Invalid filename", _kernel: {106: "Title too long"}}}};
    const constants = {SIZE_TITLE: 512};
    const rename = {};
    runInNewContext(compile("../../editor/rename.ts"), {
        exports: rename,
        window: runtime,
        require: (name: string) => name === "../constants" ? {Constants: constants} :
            {showMessage: () => {}, showTooltip: () => {}},
    });
    const moduleExports: {Title?: {prototype: any}} = {};
    runInNewContext(compile("Title.ts"), {
        exports: moduleExports,
        clearTimeout: () => {},
        require: (name: string) => {
            if (name === "../../editor/rename") return rename;
            if (name === "../../constants") return {Constants: constants};
            if (name === "../util/selectionOffsets") return {getSelectionOffset: () => ({start: 1026, end: 1026})};
            if (name === "../util/selection") return {focusByOffset: () => {}};
            return {};
        },
    });
    const title = Object.create(moduleExports.Title.prototype);
    title.editElement = {textContent: ""};
    title.setTitle = (value: string) => { title.editElement.textContent = value; };
    for (const [input, expected] of [
        ["😀".repeat(513), "😀".repeat(512)],
        ["A" + "😀".repeat(512), "A" + "😀".repeat(511)],
        ["文".repeat(513), "文".repeat(512)],
        ["Title\nwith/slash", "Title\nwith/slash"],
    ]) {
        title.editElement.textContent = input;
        assert.equal(title.rename({}), false);
        assert.equal(title.editElement.textContent, expected);
    }
    runtime.siyuan.documentAddressingVersion = 1;
    title.editElement.textContent = "😀".repeat(513);
    assert.equal(title.rename({}), false);
    assert.equal(title.editElement.textContent, "😀".repeat(256));
});
