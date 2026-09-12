import {strict as assert} from "node:assert";
import {test} from "node:test";
import {highlightSearchText} from "./searchHighlight";

test("highlights literal terms with the configured case sensitivity", () => {
    assert.equal(highlightSearchText("Test/Math math", "math", true), "Test/Math <mark>math</mark>");
    assert.equal(highlightSearchText("Test/Math math", "math", false), "Test/<mark>Math</mark> <mark>math</mark>");
    assert.equal(highlightSearchText("a+b [x]", "a+b [x]", false), "<mark>a+b</mark> <mark>[x]</mark>");
    assert.equal(highlightSearchText("数学,数学笔记", "数学笔记 数学", false), "<mark>数学</mark>,<mark>数学笔记</mark>");
});

test("escapes text without highlighting generated HTML or entities", () => {
    assert.equal(highlightSearchText("<img> & amp", "img amp", false), "&lt;<mark>img</mark>> &amp; <mark>amp</mark>");
    assert.equal(highlightSearchText("<mark>&", "<mark>", false), "<mark>&lt;mark></mark>&amp;");
    assert.equal(highlightSearchText("<>&", " ", false), "&lt;>&amp;");
});
