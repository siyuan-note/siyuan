import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {applyMermaidLayout, getMermaidLayout} from "./mermaidLayout";

describe("mermaidLayout", () => {
    it("accepts supported layout names", () => {
        assert.equal(getMermaidLayout("dagre"), "dagre");
        assert.equal(getMermaidLayout(" cose-bilkent "), "cose-bilkent");
        assert.equal(getMermaidLayout("TIDY-TREE"), "tidy-tree");
    });

    it("ignores unsupported layout names", () => {
        assert.equal(getMermaidLayout("elk"), undefined);
        assert.equal(getMermaidLayout(""), undefined);
        assert.equal(getMermaidLayout(), undefined);
    });

    it("keeps content unchanged without a layout", () => {
        const content = "mindmap\n  Root";
        assert.equal(applyMermaidLayout(content), content);
    });

    it("appends a layout directive so the custom attribute takes precedence", () => {
        const content = `---
config:
  layout: dagre
---
mindmap
  Root
%%{init: {"layout":"cose-bilkent"}}%%`;
        const result = applyMermaidLayout(content, "tidy-tree");

        assert.equal(result.startsWith(content), true);
        assert.equal(result.lastIndexOf('{"layout":"tidy-tree"}') > result.lastIndexOf('{"layout":"cose-bilkent"}'), true);
    });
});
