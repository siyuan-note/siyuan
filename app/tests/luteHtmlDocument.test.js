const {test} = require("node:test");
const assert = require("node:assert/strict");
require("../stage/protyle/js/lute/lute.min.js");
const {Lute} = globalThis;

test("HTML documents convert with DOCTYPE and leading comments", () => {
    for (const prefix of ["", "<!DOCTYPE html>", "<!-- comment --><!doctype html>"]) {
        const engine = Lute.New();
        const source = prefix + "<html><head><title>Hidden title</title></head><body><h1>Heading</h1><p>Page content</p></body></html>";
        assert.match(engine.HTML2Md(source), /# Heading\n\nPage content/);
        assert.equal(engine.HTML2Text(source), "HeadingPage content");
        assert.doesNotMatch(engine.HTML2Md(source), /Hidden title/);
    }
    for (const source of ["", "<!DOCTYPE html>", "<!-- comment -->"]) {
        assert.equal(Lute.New().HTML2Md(source).trim(), "");
    }
});
