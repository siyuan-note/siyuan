import {it} from "node:test";
import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {runInNewContext} from "node:vm";
import * as ts from "typescript";

const moduleObject = {exports: {}};
runInNewContext(ts.transpileModule(readFileSync(join(__dirname, "subItemsDrag.ts"), "utf8"), {
    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022},
}).outputText, {module: moduleObject, exports: moduleObject.exports, require: () => ({})});
const {getSubItemsDrop} = moduleObject.exports as typeof import("./subItemsDrag");
const rows = [
    {id: "root", hierarchy: {parentID: "", depth: 0}},
    {id: "a", hierarchy: {parentID: "root", depth: 1}},
    {id: "grandchild", hierarchy: {parentID: "a", depth: 2}},
    {id: "b", hierarchy: {parentID: "root", depth: 1}},
    {id: "other", hierarchy: {parentID: "", depth: 0}},
] as IAVRow[];

it("uses the target sibling as a before anchor across child-page boundaries", () => {
    const result = getSubItemsDrop(rows, ["other"], "b", "before", false);
    assert.equal(result.parentID, "root");
    assert.equal(result.previousID, undefined);
    assert.equal(result.nextID, "b");
    const secondPage = getSubItemsDrop(rows.filter(row => row.id !== "a" && row.id !== "grandchild"), ["other"], "b", "before", false);
    assert.equal(secondPage.nextID, "b");
});

it("forbids cycles and self drops", () => {
    assert.equal(getSubItemsDrop(rows, ["root"], "grandchild", "inside", false), undefined);
    assert.equal(getSubItemsDrop(rows, ["a"], "a", "after", false), undefined);
});

it("allows reparenting under sorting and refuses manual sibling order changes", () => {
    assert.equal(getSubItemsDrop(rows, ["a"], "b", "after", true), undefined);
    const result = getSubItemsDrop(rows, ["other"], "a", "inside", true);
    assert.equal(result.parentID, "a");
    assert.equal(result.previousID, undefined);
    assert.equal(result.nextID, undefined);
});

it("delegates appending to the complete sibling list instead of the loaded child page", () => {
    const result = getSubItemsDrop(rows, ["other"], "root", "inside", false);
    assert.equal(result.parentID, "root");
    assert.equal(result.previousID, undefined);
    assert.equal(result.nextID, undefined);
});
