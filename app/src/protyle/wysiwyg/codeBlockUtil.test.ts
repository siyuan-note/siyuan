import * as assert from "node:assert/strict";
import test from "node:test";
import {
    getCodeBlockOutdentRange,
    getCodeBlockLineRange,
    getCodeTabSpace,
    resolveCodeTabSpaces,
    updateCodeBlockLines,
} from "./codeBlockUtil";

test("code block Tab spaces inherit the global value unless explicitly overridden", () => {
    assert.equal(resolveCodeTabSpaces(null, 4), 4);
    assert.equal(resolveCodeTabSpaces("", 4), 4);
    assert.equal(resolveCodeTabSpaces("3", 4), 4);
    assert.equal(resolveCodeTabSpaces("0", 4), 0);
    assert.equal(resolveCodeTabSpaces("2", 4), 2);
    assert.equal(resolveCodeTabSpaces("8", 4), 8);
    assert.equal(getCodeTabSpace(0), "\t");
    assert.equal(getCodeTabSpace(4), "    ");
});

test("code block selections start at the first touched line and exclude a trailing line start", () => {
    const text = "first\nsecond\nthird\n";
    assert.deepEqual(getCodeBlockLineRange(text, 2, 10), {start: 0, end: 10});
    assert.deepEqual(getCodeBlockLineRange(text, 2, 13), {start: 0, end: 12});
    assert.deepEqual(getCodeBlockLineRange(text, 6, 12), {start: 6, end: 12});
    assert.deepEqual(getCodeBlockLineRange(text, 0, text.length), {start: 0, end: text.length - 1});
    assert.deepEqual(getCodeBlockLineRange("\nfirst", 0, 1), {start: 0, end: 0});
});

test("code block line indentation handles spaces, tabs, partial indentation and blank lines", () => {
    assert.equal(updateCodeBlockLines("one\ntwo", "  "), "  one\n  two");
    assert.equal(updateCodeBlockLines("one\n\ntwo", "\t"), "\tone\n\t\n\ttwo");
    assert.equal(updateCodeBlockLines("    one\n  two\n\tthree\nfour", "    ", true),
        "one\ntwo\nthree\nfour");
    assert.equal(updateCodeBlockLines("  one\n\ttwo", "\t", true), "  one\ntwo");
});

const outdentAtCaret = (text: string, caret: number, tabSpace = "    ") => {
    const range = getCodeBlockOutdentRange(text, caret, tabSpace);
    return {text: text.substring(0, range.start) + text.substring(range.end), caret: range.caret};
};

test("collapsed code block outdent removes leading indentation from any caret position", () => {
    for (const [caret, expected] of [[0, 0], [2, 0], [4, 0], [6, 2], [9, 5]]) {
        assert.deepEqual(outdentAtCaret("    value", caret), {text: "value", caret: expected});
    }
    assert.deepEqual(outdentAtCaret("      value", 5), {text: "  value", caret: 1});
    assert.deepEqual(outdentAtCaret("  value", 7), {text: "value", caret: 5});
    assert.deepEqual(outdentAtCaret("    value", 9, "  "), {text: "  value", caret: 7});
});

test("collapsed code block outdent uses the configured unit and preserves other whitespace", () => {
    assert.deepEqual(outdentAtCaret("\tvalue", 6), {text: "value", caret: 5});
    assert.deepEqual(outdentAtCaret("\t\tvalue", 7, "\t"), {text: "\tvalue", caret: 6});
    assert.deepEqual(outdentAtCaret("  value", 7, "\t"), {text: "  value", caret: 7});
    assert.deepEqual(outdentAtCaret("  \tvalue", 8), {text: "\tvalue", caret: 6});
    assert.deepEqual(outdentAtCaret("value    ", 9), {text: "value    ", caret: 9});
    assert.deepEqual(outdentAtCaret("    value  tail\t", 16), {text: "value  tail\t", caret: 12});
});

test("collapsed code block outdent changes only the current line, including blank lines", () => {
    assert.deepEqual(outdentAtCaret("    first\n    value\n    last", 10),
        {text: "    first\nvalue\n    last", caret: 10});
    assert.deepEqual(outdentAtCaret("    first\n    value\n    last", 19),
        {text: "    first\nvalue\n    last", caret: 15});
    assert.deepEqual(outdentAtCaret("value\n  \nnext", 7), {text: "value\n\nnext", caret: 6});
    assert.deepEqual(outdentAtCaret("value\n\n    next", 6), {text: "value\n\n    next", caret: 6});
    assert.deepEqual(outdentAtCaret("value\n", 6), {text: "value\n", caret: 6});
    assert.deepEqual(outdentAtCaret("", 0), {text: "", caret: 0});
});
