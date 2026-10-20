import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

const compiled = transpileModule(readFileSync("src/protyle/render/av/blockCollection.ts", "utf8"), {
    compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2022},
}).outputText;

test("collection scope requires a notebook or document and complete attribute names", () => {
    const methods = {} as typeof import("./blockCollection");
    runInNewContext(compiled, {exports: methods, require: () => ({})});
    assert.equal(methods.collectionSourceIncomplete({}), true);
    assert.equal(methods.collectionSourceIncomplete({documentIDs: ["doc"]}), false);
    assert.equal(methods.collectionSourceIncomplete({notebookIDs: ["notebook"], attributes: [{name: "custom-", operator: "exists"}]}), true);
    assert.equal(methods.collectionSourceIncomplete({documentIDs: ["doc"], attributes: [{name: "custom-state", operator: "equals", value: "open"}]}), false);
});

test("collection type selection replaces overlapping parents and preserves independent types", () => {
    const methods = {} as typeof import("./collectionConditions");
    const conditions = transpileModule(readFileSync("src/protyle/render/av/collectionConditions.ts", "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2022},
    }).outputText;
    runInNewContext(conditions, {exports: methods, require: () => ({})});
    const toggle = (types: string[], type: string): string[] => JSON.parse(JSON.stringify(methods.toggleCollectionType(types, type)));
    assert.deepEqual(toggle(["l:u", "l:t", "i:t"], "l"), ["i:t", "l"]);
    assert.deepEqual(toggle(["l", "h:h1"], "l:o"), ["h:h1", "l:o"]);
    assert.deepEqual(toggle(["h:h1"], "h:h2"), ["h:h1", "h:h2"]);
    assert.deepEqual(toggle(["callout:WARNING"], "callout:WARNING"), []);
});
