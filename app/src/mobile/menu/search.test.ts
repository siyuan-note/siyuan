import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {createSourceFile, isVariableStatement, ScriptTarget, transpileModule} from "typescript";

const source = createSourceFile("search.ts", readFileSync("src/mobile/menu/search.ts", "utf8"), ScriptTarget.ES2021, true);
const declarations = source.statements.filter(isVariableStatement).flatMap(statement =>
    Array.from(statement.declarationList.declarations));
const declaration = declarations.find(item => item.name.getText(source) === "openSearchResult");
const compiled = transpileModule(`let searchOpenVersion = 0; const ${declaration.getText(source)};
    globalThis.open = openSearchResult;`, {compilerOptions: {target: ScriptTarget.ES2021}}).outputText;

const setup = () => {
    const folds: Array<(zoomIn: boolean) => void> = [];
    const opens: Array<{id: string, actions: string[], notebookID: string, after: (protyle: unknown) => void}> = [];
    const highlights: Array<{protyle: unknown, id: string, keywords: string[]}> = [];
    const context = {
        open: undefined as (app: unknown, target: unknown) => void,
        window: {siyuan: {mobile: {}}},
        Constants: {CB_GET_ALL: "all", CB_GET_HL: "highlight", CB_GET_CONTEXT: "context", CB_GET_ROOTSCROLL: "root-scroll"},
        getKeysByLiElement: (target: {keywords: string[]}) => [...target.keywords],
        checkFold: (_id: string, after: (zoomIn: boolean) => void) => folds.push(after),
        closePanel() {},
        openMobileFileById: (_app: unknown, id: string, actions: string[], position: string, notebookID: string,
                             after: (protyle: unknown) => void) => {
            assert.equal(position, "start");
            opens.push({id, actions: [...actions], notebookID, after});
            return Promise.resolve(true);
        },
        highlightMobileSearchResult: (protyle: unknown, id: string, keywords: string[]) => {
            highlights.push({protyle, id, keywords: [...keywords]});
        },
    };
    runInNewContext(compiled, context);
    return {open: context.open, folds, opens, highlights};
};

test("mobile search opens ordinary and folded results before highlighting their actual matched words", () => {
    for (const folded of [false, true]) {
        const state = setup();
        const target = {dataset: {nodeId: "hit", notebookId: "encrypted-box"}, keywords: ["Actual", "matched text"]};
        state.open({}, target);
        target.keywords = ["changed after click"];
        state.folds[0](folded);
        assert.equal(state.opens.length, 1);
        assert.equal(state.opens[0].id, "hit");
        assert.equal(state.opens[0].notebookID, "encrypted-box");
        assert.deepEqual(state.opens[0].actions, folded ? ["all", "highlight"] : ["highlight", "context", "root-scroll"]);
        assert.equal(state.highlights.length, 0);
        const editor = {id: "opened-editor"};
        state.opens[0].after(editor);
        assert.deepEqual(state.highlights, [{protyle: editor, id: "hit", keywords: ["Actual", "matched text"]}]);
    }
});

test("mobile search ignores out-of-order fold checks and callbacks from an older result", () => {
    const state = setup();
    const first = {dataset: {nodeId: "first"}, keywords: ["one"]};
    const second = {dataset: {nodeId: "second"}, keywords: ["two"]};
    state.open({}, first);
    state.open({}, second);
    state.folds[1](false);
    state.folds[0](true);
    assert.deepEqual(state.opens.map(item => item.id), ["second"]);
    state.open({}, first);
    state.opens[0].after({});
    assert.equal(state.highlights.length, 0);
});
