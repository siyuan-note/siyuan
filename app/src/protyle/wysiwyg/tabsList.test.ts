import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";
const {createMockRequire} = require("../../../tests/fixtures/mockModules.cjs");

const api = {} as typeof import("./tabsList");
runInNewContext(transpileModule(readFileSync("src/protyle/wysiwyg/tabsList.ts", "utf8"), {
    compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
}).outputText, {
    exports: api,
    require: createMockRequire({
        "../render/tabsRender": {},
        "../render/listMindmap/model": {},
        "../render/listMindmap/preferences": {},
    }),
});
const {isEmptyTabPlaceholder} = api;

const paragraph = (attrs: Record<string, string>, text = "", rich = false) => ({
    attributes: Object.entries(attrs).map(([name, value]) => ({name, value})),
    getAttribute: (name: string) => attrs[name],
    querySelector: () => ({textContent: text, querySelector: () => rich ? {} : null}),
}) as unknown as Element;

test("only untouched conversion placeholders can be omitted when restoring a list", () => {
    assert.equal(isEmptyTabPlaceholder(paragraph({})), false);
    assert.equal(isEmptyTabPlaceholder(paragraph({"tabs-placeholder": "true"})), true);
    assert.equal(isEmptyTabPlaceholder(paragraph({"tabs-placeholder": "true"}, "12")), false);
    assert.equal(isEmptyTabPlaceholder(paragraph({"tabs-placeholder": "true"}, "", true)), false);
    for (const name of ["custom-test", "name", "alias", "memo", "bookmark", "style", "refcount"]) {
        assert.equal(isEmptyTabPlaceholder(paragraph({"tabs-placeholder": "true", [name]: "kept"})), false);
    }
});
