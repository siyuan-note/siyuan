import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

const source = transpileModule(readFileSync("src/protyle/wysiwyg/commonHotkey.ts", "utf8"), {
    compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
}).outputText;

const copy = (options: {selected?: string[], rangeBlocks?: string[], collapsed?: boolean, outside?: boolean, document?: boolean}) => {
    const block = (id: string) => ({getAttribute: () => id});
    const writes: {ids: string[], type: string}[] = [];
    const range = {collapsed: options.collapsed ?? false, commonAncestorContainer: {}};
    let rangeReads = 0;
    let prevented = false;
    const dependencies = {
        matchHotKey: (value: string) => value === "embed",
        getEditorRange: () => range,
        getBlockElementsByRange: (value: unknown) => {
            assert.equal(value, range);
            rangeReads++;
            return (options.rangeBlocks || []).map(block);
        },
        copyTextByType: (ids: string[], type: string) => writes.push({ids: Array.from(ids), type}),
    };
    const exports = {} as {commonHotkey: (...args: unknown[]) => boolean};
    runInNewContext(source, {exports, require: () => dependencies,
        window: {siyuan: {config: {keymap: {editor: {general: {copyBlockEmbed: "embed"}}}}}}});
    const result = exports.commonHotkey({block: {rootID: "document"}, wysiwyg: {element: {
        querySelectorAll: () => (options.selected || []).map(block),
        contains: () => !options.outside,
    }}}, {preventDefault: () => prevented = true, stopPropagation() {}}, options.document ? undefined : block("caret"));
    assert.equal(result, true);
    assert.equal(prevented, true);
    return {writes, rangeReads};
};

test("copy block embeds uses all blocks in a text range in document order", () => {
    const result = copy({rangeBlocks: ["first", "middle", "last"]});
    assert.deepEqual(result.writes, [{ids: ["first", "middle", "last"], type: "blockEmbed"}]);
    assert.equal(result.rangeReads, 1);
});

test("explicit block selection takes precedence over a retained text selection", () => {
    const result = copy({selected: ["selected-first", "selected-last"], rangeBlocks: ["stale"]});
    assert.deepEqual(result.writes, [{ids: ["selected-first", "selected-last"], type: "blockEmbed"}]);
    assert.equal(result.rangeReads, 0);
});

test("collapsed and foreign selections retain the current block and document fallbacks", () => {
    for (const options of [{collapsed: true}, {outside: true}, {rangeBlocks: [] as string[]}]) {
        assert.deepEqual(copy(options).writes, [{ids: ["caret"], type: "blockEmbed"}]);
    }
    assert.deepEqual(copy({document: true}).writes, [{ids: ["document"], type: "blockEmbed"}]);
});
