import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ScriptTarget, transpileModule} from "typescript";
import {getListConversionType, shouldIgnoreListShortcut} from "./listContext";

const source = readFileSync("src/protyle/wysiwyg/keydown.ts", "utf8");
const start = source.indexOf("        const isMatchList =");
const end = source.indexOf("        if (matchHotKey(window.siyuan.config.keymap.editor.insert.table", start);
assert.ok(start >= 0 && end > start);
const compiled = transpileModule(`(async () => {${source.slice(start, end)}})()`, {
    compilerOptions: {target: ScriptTarget.ES2021},
}).outputText;

const runShortcut = async (type: string, subtype: string, key: string, legacy = false, embedded = false) => {
    const selected = {
        dataset: {type, subtype, nodeId: "selected"},
        getAttribute: (name: string) => name === "custom-sy-list-mindmap" && legacy ? "1" : null,
    };
    const calls: {type: string, nodeElement?: unknown}[] = [];
    const insertions: string[] = [];
    let prevented = false;
    const context = {
        window: {siyuan: {config: {keymap: {editor: {insert: {list: "list", check: "check", "ordered-list": "ordered-list", quote: "quote"}}}}}},
        Constants: {CUSTOM_SY_LIST_MINDMAP: "custom-sy-list-mindmap"},
        matchHotKey: (binding: string) => binding === key,
        event: {preventDefault: () => prevented = true, stopPropagation() {}},
        protyle: {wysiwyg: {element: {querySelectorAll: () => [selected]}},
            hint: {fillCommand: (value: string) => insertions.push(value)}},
        nodeElement: {dataset: {type: "NodeParagraph", nodeId: "following-paragraph"}},
        range: {}, isCrossBlock: false, selectText: "",
        isProtyleListItemFragment: () => false,
        isInEmbedBlock: () => embedded,
        shouldIgnoreListShortcut, getListConversionType,
        turnsOneInto: (options: {type: string, nodeElement?: unknown}) => calls.push(options),
        Lute: {Caret: "caret"},
    };
    await runInNewContext(compiled, context);
    return {selected, calls, insertions, prevented};
};

test("list shortcuts convert the selected mindmap instead of inserting at the retained caret", async () => {
    for (const legacy of [false, true]) {
        for (const subtype of ["u", "o", "t"]) {
            for (const [key, type] of [["list", "OL2UL"], ["ordered-list", "UL2OL"], ["check", "UL2TL"]]) {
                const result = await runShortcut(legacy ? "NodeList" : "NodeMindmap", subtype, key, legacy);
                assert.equal(result.calls.length, 1);
                assert.equal(result.calls[0].type, type);
                assert.equal(result.calls[0].nodeElement, result.selected);
                assert.deepEqual(result.insertions, []);
                assert.equal(result.prevented, true);
            }
        }
    }
});

test("ordinary list cancellation and embedded mindmap protection remain intact", async () => {
    const ordinary = await runShortcut("NodeList", "u", "list");
    assert.equal(ordinary.calls[0].type, "CancelList");
    const embedded = await runShortcut("NodeMindmap", "u", "list", false, true);
    assert.deepEqual(embedded.calls, []);
    assert.deepEqual(embedded.insertions, []);
});
