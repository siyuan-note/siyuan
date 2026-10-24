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
const searchRefSource = readFileSync(join(__dirname, "searchRef.ts"), "utf8")
    .replace(/^import .*;\r?\n/gm, "").replace("export ", "");
const code = transpileModule(searchRefSource + "\n" + declaration.getText(source).replace("export ", "") + "\nhintRef;", {
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
        normalizeDocumentTitle: () => assert.fail("typing a query sanitized a document title"),
        fetchPost: (path: string, request: {k: string}, callback: (response: unknown) => void) => {
            assert.equal(path, "/api/search/searchRefBlock");
            assert.equal(request.k, "10/");
            callback({code: 0, data: {k: "10/", newDoc: true, blocks: []}});
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

test("closing a reference resolves exact titles before daily notes or configured creation and rejects stale results", async () => {
    const scenarios = ["document", "daily", "create", "subdoc", "stale", "error", "ordinary"];
    for (const [splitChar, scenario] of ["[[", "【【"].flatMap(split => scenarios.map(scenario => [split, scenario]))) {
        const block = {getAttribute: () => "block"};
        const closeContext = {range: "original"};
        const commits: string[] = [];
        let rendered = false;
        const hintRef = runInNewContext(code, {
            window: {siyuan: {config: {editor: {autoCloseRefBrackets: true}}, languages: {}}},
            Constants: {ZWSP: "\u200b"}, Lute: {Caret: "caret", UnEscapeHTMLStr: (text: string) => text},
            getEditorRange: () => ({startContainer: block}), hasClosestBlock: () => block,
            isEncryptedBox: () => true, genHintItemHTML: () => "document",
            getDailyNoteHints: async () => scenario === "daily" || scenario === "document" ?
                [{value: "daily-note:2026-10-14:box", html: "daily"}] : [],
            fetchPost: (_path: string, request: {exactDocTitle?: boolean; notebook?: string}, callback: (response: unknown) => void) => {
                assert.equal(request.exactDocTitle, scenario === "ordinary" ? undefined : true);
                assert.equal(request.notebook, "box");
                callback({code: scenario === "error" ? -1 : 0, data: {k: "Title", newDoc: scenario !== "document",
                    blocks: scenario === "document" ? [{id: "exact", type: "NodeDocument", refText: "Title"}] : []}});
            },
        });
        const protyle = {notebookId: "box", element: {clientWidth: 320}, block: {rootID: "root"},
            wysiwyg: {element: {}}, hint: {
                splitChar, closeKeyTyped: scenario !== "ordinary", genLoading() {},
                getRefCloseContext: () => closeContext,
                isRefCloseContextCurrent: () => scenario !== "stale",
                prepareCreateTarget: () => ({promise: Promise.resolve(scenario === "subdoc"), isCurrent: () => true}),
                fillRefClose: (value: string, _protyle: unknown, original: unknown) => {
                    assert.equal(original, closeContext);
                    commits.push(value);
                },
                genHTML: (data: IHintData[]) => { rendered = data.length > 0; },
            }};
        hintRef("Title", protyle, "hint");
        await setImmediate();
        if (scenario === "document") {
            assert.equal(commits.length, 1);
            assert.match(commits[0], /data-id="exact"/);
        } else if (scenario === "daily") {
            assert.deepEqual(commits, ["daily-note:2026-10-14:box"]);
        } else if (scenario === "create" || scenario === "subdoc") {
            assert.equal(commits.length, 1);
            assert.ok(commits[0].startsWith(scenario === "create" ? "((newFile " : "((newSubDoc "));
        } else {
            assert.equal(commits.length, 0);
            assert.equal(rendered, scenario === "ordinary");
        }
    }
});
