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

// 扩选到块首/块尾必须保留选区锚点（只移动光标），锚点不在块内时才回退到改写范围。
// 是否已到达块的首行/末行以选区活动端（光标）为准，否则多行选区会按选区首行处理。
const expandToBlockEdge = (direction: "up" | "down", options: {
    backward?: boolean,
    start: number,
    end: number,
    focusTop: number,
    focusBottom: number,
    extendable?: boolean,
    nextBlock?: boolean,
}) => {
    const calls: string[] = [];
    const editable = {
        innerText: "abcdefghij\nklmnopqrst\nuvwxyz",
        getBoundingClientRect: () => ({top: 0, bottom: 100}),
    };
    const textNode = {nodeType: 3};
    const range = {
        startContainer: textNode,
        startOffset: options.start,
        endContainer: textNode,
        endOffset: options.end,
        collapsed: false,
        getBoundingClientRect: () => ({top: 0, bottom: 100}),
        collapse: () => calls.push("collapse"),
    };
    const caretRange = {
        setStart: () => caretRange,
        collapse: () => caretRange,
        getClientRects: () => [{
            top: options.focusTop,
            bottom: options.focusBottom,
            height: options.focusBottom - options.focusTop,
        }],
    };
    let prevented = false;
    const dependencies = {
        matchHotKey: () => false,
        isMac: () => true,
        hasClosestByTag: (): undefined => undefined,
        getContenteditableElement: () => editable,
        getSelectionOffset: () => ({start: options.start, end: options.end}),
        getNextBlock: () => options.nextBlock ? {} : undefined,
        selectTextToEditorBoundary: (element: unknown, toStart: boolean) => {
            calls.push(`boundary:${element === editable}:${toStart}`);
            return options.extendable ? range : undefined;
        },
        setFirstNodeRange: () => calls.push("setFirstNodeRange"),
        setLastNodeRange: () => calls.push("setLastNodeRange"),
        hideElements: () => calls.push("hideElements"),
        countBlockWord: () => calls.push("countBlockWord"),
    };
    const exports = {} as {upSelect: (options: unknown) => void, downSelect: (options: unknown) => void};
    runInNewContext(source, {
        exports,
        require: () => dependencies,
        getComputedStyle: () => ({paddingTop: "0px", paddingBottom: "0px"}),
        getSelection: () => ({
            direction: options.backward ? "backward" : "forward",
            anchorNode: textNode,
            anchorOffset: options.backward ? options.end : options.start,
        }),
        document: {createRange: () => caretRange},
        window: {siyuan: {config: {keymap: {editor: {general: {expandUp: "⌥⇧↑", expandDown: "⌥⇧↓"}}}}}},
    });
    const selectOptions = {
        protyle: {wysiwyg: {element: {querySelectorAll: (): never[] => []}}},
        event: {preventDefault: () => prevented = true, stopPropagation: (): undefined => undefined},
        nodeElement: {
            classList: {contains: () => false, add: () => calls.push("classList.add")},
            getAttribute: () => "block-id",
        },
        editorElement: editable,
        range,
        cb: (): undefined => undefined,
    };
    if (direction === "up") {
        exports.upSelect(selectOptions);
    } else {
        exports.downSelect(selectOptions);
    }
    return {calls, prevented};
};

test("expand up preserves the selection anchor instead of rewriting the range", () => {
    assert.deepEqual(expandToBlockEdge("up", {start: 2, end: 6, focusTop: 0, focusBottom: 18, extendable: true}).calls,
        ["boundary:true:true"]);
    assert.deepEqual(expandToBlockEdge("down", {start: 2, end: 25, focusTop: 82, focusBottom: 100, extendable: true}).calls,
        ["boundary:true:false"]);
});

test("expand up and down fall back to the legacy range rewrite only for a foreign anchor", () => {
    assert.deepEqual(expandToBlockEdge("up", {start: 2, end: 6, focusTop: 0, focusBottom: 18}).calls,
        ["boundary:true:true", "setFirstNodeRange"]);
    assert.deepEqual(expandToBlockEdge("down", {start: 2, end: 25, focusTop: 82, focusBottom: 100}).calls,
        ["boundary:true:false", "setLastNodeRange"]);
    assert.equal(expandToBlockEdge("up", {start: 2, end: 6, focusTop: 0, focusBottom: 18}).prevented, true);
});

test("expand looks at the selection focus instead of the whole range", () => {
    const noOp = {calls: [] as string[], prevented: false};
    // 锚点在首行、光标在末行：不能因为 Range 从首行开始就把光标收至块首
    assert.deepEqual(expandToBlockEdge("up", {start: 2, end: 25, focusTop: 64, focusBottom: 82}), noOp);
    assert.deepEqual(expandToBlockEdge("up", {start: 2, end: 25, focusTop: 64, focusBottom: 82, extendable: true}), noOp);
    // 反向选区以偏移较小的一端为活动端，光标在末行时同样不应收至块首
    const backward = expandToBlockEdge("up", {backward: true, start: 25, end: 2, focusTop: 64, focusBottom: 82,
        extendable: true});
    assert.deepEqual(backward, noOp);
    // 首行/末行自然换行时活动端不在块的首行/末行，交回浏览器继续向上/下移动一行
    assert.deepEqual(expandToBlockEdge("up", {start: 2, end: 6, focusTop: 30, focusBottom: 48, extendable: true}), noOp);
    assert.deepEqual(expandToBlockEdge("down", {start: 2, end: 25, focusTop: 64, focusBottom: 82, extendable: true}), noOp);
    // 非最后一个块时交由浏览器移动到下一个块
    assert.deepEqual(expandToBlockEdge("down", {start: 2, end: 25, focusTop: 82, focusBottom: 100, nextBlock: true,
        extendable: true}), noOp);
});

test("expand keeps the block selection step when the focus is already at the block edge", () => {
    // 向上：活动端已在块首
    const up = expandToBlockEdge("up", {start: 0, end: 0, focusTop: 0, focusBottom: 18});
    assert.deepEqual(up.calls, ["collapse", "hideElements", "classList.add", "countBlockWord"]);
    assert.equal(up.prevented, true);
    // 向下：活动端已在块尾
    const down = expandToBlockEdge("down", {start: 28, end: 28, focusTop: 64, focusBottom: 82});
    assert.deepEqual(down.calls, ["collapse", "hideElements", "classList.add", "countBlockWord"]);
    assert.equal(down.prevented, true);
});
