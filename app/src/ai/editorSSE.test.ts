import * as assert from "node:assert/strict";
import test, {before} from "node:test";

let createAIEditorSSEParserState: typeof import("./editorSSE").createAIEditorSSEParserState;
let parseAIEditorSSE: typeof import("./editorSSE").parseAIEditorSSE;
before(async () => {
    // 运行时常量通常由 webpack 提供。
    Object.assign(globalThis, {SIYUAN_VERSION: "test", NODE_ENV: "test"});
    ({createAIEditorSSEParserState, parseAIEditorSSE} = await import("./editorSSE"));
});

test("parses fragmented AI editor SSE events", () => {
    const state = createAIEditorSSEParserState();
    assert.deepEqual(parseAIEditorSSE(state, "event:content\ndata:{\"tok"), []);
    assert.deepEqual(parseAIEditorSSE(state, "en\":\"hel\"}\n\nevent:done\n"), [{
        type: "content",
        token: "hel",
    }]);
    assert.deepEqual(parseAIEditorSSE(state, "data:{\"finishReason\":\"stop\"}\n\n"), [{
        type: "done",
        finishReason: "stop",
    }]);
});

test("skips malformed AI editor SSE events", () => {
    const state = createAIEditorSSEParserState();
    assert.deepEqual(parseAIEditorSSE(state,
        "event:content\ndata:not-json\n\nevent:content\ndata:{\"token\":\"ok\"}\n\n"), [{
        type: "content",
        token: "ok",
    }]);
});

test("parses AI editor reasoning events", () => {
    const state = createAIEditorSSEParserState();
    assert.deepEqual(parseAIEditorSSE(state,
        "event:reasoning\ndata:{\"token\":\"thinking\"}\n\n"), [{
        type: "reasoning",
        token: "thinking",
    }]);
});
