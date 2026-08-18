import * as assert from "node:assert/strict";
import test from "node:test";
import {
    getCodeBlockDeleteStart,
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

test("collapsed code block outdent deletes only the preceding indentation unit", () => {
    assert.equal(getCodeBlockDeleteStart("    value", 4, "    "), 0);
    assert.equal(getCodeBlockDeleteStart("  value", 2, "    "), 0);
    assert.equal(getCodeBlockDeleteStart("value    ", 9, "    "), 5);
    assert.equal(getCodeBlockDeleteStart("\tvalue", 1, "    "), 0);
    assert.equal(getCodeBlockDeleteStart("  value", 2, "\t"), 2);
    assert.equal(getCodeBlockDeleteStart("line\n    value", 9, "    "), 5);
});
