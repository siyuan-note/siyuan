import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ScriptTarget, transpileModule} from "typescript";
import {getAppendListContext} from "./listContext";

const source = readFileSync("src/protyle/wysiwyg/keydown.ts", "utf8");
const start = source.indexOf("        if (matchHotKey(window.siyuan.config.keymap.editor.insert.mindmap");
const end = source.indexOf("        const isMatchList =", start);
assert.ok(start >= 0 && end > start);
const compiled = transpileModule(`(async () => {${source.slice(start, end)}})()`, {
    compilerOptions: {target: ScriptTarget.ES2021},
}).outputText;

interface TestBlock {
    dataset: {type: string};
    parentElement?: TestBlock;
    getAttribute: (name: string) => string | null;
}

const block = (type: string, parentElement?: TestBlock, legacy = false): TestBlock =>
    ({dataset: {type}, parentElement, getAttribute: (name: string) => name === "data-type" ? type :
    name === "custom-sy-list-mindmap" && legacy ? "1" : null});

const runShortcut = async (target: TestBlock, options: {
    selected?: TestBlock[], unbound?: boolean, fragment?: boolean, embedded?: boolean,
} = {}) => {
    const converted: unknown[] = [];
    const inserted: string[] = [];
    const focused: unknown[] = [];
    const context = {
        window: {siyuan: {config: {keymap: {editor: {insert: {mindmap: {custom: options.unbound ? "" : "shortcut"}}}}}}},
        Constants: {CUSTOM_SY_LIST_MINDMAP: "custom-sy-list-mindmap"},
        matchHotKey: (binding: {custom: string}) => binding.custom === "shortcut",
        event: {preventDefault() {}, stopPropagation() {}},
        protyle: {wysiwyg: {element: {querySelectorAll: () => options.selected || []}},
            hint: {fillCommand: (value: string) => inserted.push(value)}},
        nodeElement: target, getAppendListContext,
        isProtyleListItemFragment: () => options.fragment,
        isInEmbedBlock: () => options.embedded,
        toggleListMindmap: async (_protyle: unknown, list: unknown) => converted.push(list),
        hideElements() {}, focusBlock: (value: unknown) => focused.push(value),
        Lute: {Caret: "caret"},
    };
    await runInNewContext(compiled, context);
    return {converted, inserted, focused};
};

test("mindmap shortcut converts the selected list or the list containing the caret", async () => {
    const list = block("NodeList");
    const child = block("NodeParagraph", block("NodeListItem", list));
    assert.deepEqual((await runShortcut(child)).converted, [list]);
    assert.deepEqual((await runShortcut(block("NodeParagraph"), {selected: [list]})).converted, [list]);
});

test("mindmap shortcut inserts through the existing command and focuses a selected paragraph", async () => {
    const paragraph = block("NodeParagraph");
    for (const selected of [[], [paragraph]]) {
        const result = await runShortcut(paragraph, {selected});
        assert.deepEqual(result.inserted, ['- caret\n{: custom-sy-list-mindmap="1"}']);
        assert.deepEqual(result.focused, selected);
        assert.deepEqual(result.converted, []);
    }
});

test("mindmap shortcut leaves existing maps and unavailable contexts unchanged", async () => {
    const paragraph = block("NodeParagraph");
    for (const [target, options] of [
        [block("NodeMindmap"), {}], [block("NodeList", undefined, true), {}],
        [paragraph, {unbound: true}], [paragraph, {fragment: true}], [paragraph, {embedded: true}],
        [paragraph, {selected: [block("NodeList"), block("NodeList")]}],
    ] as Array<[TestBlock, Parameters<typeof runShortcut>[1]]>) {
        const result = await runShortcut(target, options);
        assert.deepEqual(result.converted, []);
        assert.deepEqual(result.inserted, []);
    }
});
