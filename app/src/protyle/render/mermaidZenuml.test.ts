import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {isZenumlDiagram} from "./mermaidZenuml";

describe("isZenumlDiagram", () => {
    it("detects ZenUML diagrams using the upstream detector rule", () => {
        assert.equal(isZenumlDiagram("zenuml\n  Alice->Bob: Hello"), true);
        assert.equal(isZenumlDiagram("  \nzenuml\n  Alice->Bob: Hello"), true);
    });

    it("ignores other Mermaid diagrams and empty content", () => {
        assert.equal(isZenumlDiagram("sequenceDiagram\n  Alice->>Bob: Hello"), false);
        assert.equal(isZenumlDiagram(""), false);
        assert.equal(isZenumlDiagram(), false);
    });
});
