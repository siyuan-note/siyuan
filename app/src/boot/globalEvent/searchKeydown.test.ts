import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

const runEnter = (targetId: string, method: number, resultType: string | undefined) => {
    const calls: string[] = [];
    const hidden = {classList: {contains: () => true}};
    const current = resultType ? {getAttribute: () => resultType, dataset: {}} : null;
    const element = {querySelector: (selector: string) => {
        if (selector === "#searchAssets" || selector === "#searchUnRefPanel") return hidden;
        if (selector === "#searchInput") return {value: "missing"};
        return {querySelector: () => current};
    }};
    const dialog = {element: {contains: () => true, querySelector: (selector: string) => selector === "#searchList" ? {} : element},
        data: {method}, editors: {edit: {protyle: {}}}};
    const dependencies = {matchHotKey: () => false, hasClosestByClassName: () => false, getKeysByLiElement: () => [], Constants: {KEYCODELIST: {}},
        replace: () => calls.push("replace"), newFile: () => calls.push("newFile"), openSearchEditor: () => calls.push("open")};
    const exports: Record<string, unknown> = {};
    runInNewContext(transpileModule(readFileSync(__dirname + "/searchKeydown.ts", "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
    }).outputText, {exports, require: () => dependencies, getSelection: () => ({rangeCount: 1, getRangeAt: () => ({startContainer: {}})}),
        window: {siyuan: {dialogs: [dialog], config: {keymap: {general: {}, editor: {general: {}}}}, storage: {}, menus: {menu: {element: hidden}}}}});
    const handle = exports.searchKeydown as typeof import("./searchKeydown").searchKeydown;
    const handled = handle({} as Parameters<typeof handle>[0], {key: "Enter", target: {id: targetId}} as unknown as KeyboardEvent);
    return {calls, handled};
};

test("replace Enter never creates a document for an empty result in any search method", () => {
    for (const method of [0, 1, 2, 3]) {
        for (const resultType of ["search-new", undefined, "search-result"]) {
            assert.deepEqual(runEnter("replaceInput", method, resultType), {calls: ["replace"], handled: true});
        }
    }
});

test("search input Enter retains keyword document creation and ordinary result opening", () => {
    assert.deepEqual(runEnter("searchInput", 0, "search-new"), {calls: ["newFile"], handled: true});
    assert.deepEqual(runEnter("searchInput", 1, "search-new"), {calls: [], handled: false});
    assert.deepEqual(runEnter("searchInput", 0, "search-result"), {calls: ["open"], handled: true});
});
