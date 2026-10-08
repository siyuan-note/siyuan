import * as capabilities from "./capabilities";
import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

test("numeric field editors accept decimal steps and preserve decimal and empty values", () => {
    const methods = {} as typeof import("./fieldValueEditor");
    runInNewContext(transpileModule(readFileSync("src/protyle/render/av/fieldValueEditor.ts", "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2022},
    }).outputText, {
        exports: methods,
        require: (name: string) => name === "./capabilities" || name === "../capabilities" ? capabilities : (name === "../../../util/escape" ? {escapeAttr: String} : {}),
    });
    const column = {type: "number"} as IAVColumn;
    for (const content of ["1.25", "-0.125", "1e-7", "0", ""]) {
        const value = methods.genFieldValue(column, {value: content} as unknown as HTMLElement);
        const html = methods.getValueInputHTML(column, {mode: "static", value});
        assert.match(html, /type="number" step="any"/);
        assert.equal(value.number.isNotEmpty, content !== "");
        assert.equal(value.number.content, Number(content));
        assert.match(html, new RegExp(`value="${content === "" ? "" : Number(content)}"`));
    }
});
