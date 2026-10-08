import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {test} from "node:test";
import {setImmediate} from "node:timers/promises";
import {runInNewContext} from "node:vm";
import {createSourceFile, isVariableStatement, ScriptTarget, transpileModule} from "typescript";

const source = createSourceFile("extend.ts", readFileSync(join(__dirname, "extend.ts"), "utf8"), ScriptTarget.Latest);
const declaration = source.statements.find(node => isVariableStatement(node) &&
    node.declarationList.declarations.some(item => item.name.getText(source) === "hintRef"));
assert.ok(declaration);
const code = transpileModule(declaration.getText(source).replace("export ", "") + "\nhintRef;", {
    compilerOptions: {target: ScriptTarget.ES2020},
}).outputText;

test("typing a slash in reference search does not run title replacement or show a warning", async () => {
    let rendered = false;
    const block = {getAttribute: () => "block"};
    const hintRef = runInNewContext(code, {
        window: {siyuan: {languages: {newFile: "New document", newSubDoc: "New child", newFileAtPath: "Choose location"}}},
        Constants: {ZWSP: "\u200b"}, Lute: {Caret: "caret", UnEscapeHTMLStr: (text: string) => text},
        getEditorRange: () => ({startContainer: block}), hasClosestBlock: () => block,
        isEncryptedBox: () => false, getDailyNoteHints: async (): Promise<IHintData[]> => [],
        replaceFileName: () => assert.fail("typing a query sanitized a document title"),
        fetchPost: (path: string, request: {k: string}, callback: (response: unknown) => void) => {
            assert.equal(path, "/api/search/searchRefBlock");
            assert.equal(request.k, "10/");
            callback({data: {k: "10/", newDoc: true, blocks: []}});
        },
    });
    const protyle = {notebookId: "box", element: {clientWidth: 320}, block: {rootID: "root"},
        toolbar: {range: {startContainer: block}}, wysiwyg: {element: {}}, hint: {
            splitChar: "[[", genLoading() {},
            prepareCreateTarget: () => ({promise: Promise.resolve(false), isCurrent: () => true}),
            genHTML: (data: {value: string}[]) => { rendered = true; assert.ok(data[0].value.includes("10/")); },
        }};
    hintRef("10/", protyle, "hint");
    await setImmediate();
    assert.equal(rendered, true);
});
