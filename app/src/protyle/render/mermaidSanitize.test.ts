import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {MERMAID_SANITIZE_OPTIONS} from "./mermaidSanitize";

describe("mermaidSanitize", () => {
    it("allows HTML labels inside SVG foreign objects", () => {
        assert.equal(MERMAID_SANITIZE_OPTIONS.USE_PROFILES.html, true);
        assert.equal(MERMAID_SANITIZE_OPTIONS.HTML_INTEGRATION_POINTS.foreignobject, true);
        assert.equal(MERMAID_SANITIZE_OPTIONS.ADD_TAGS.includes("foreignObject"), true);
    });

    it("keeps SVG, filter, and MathML profiles enabled", () => {
        assert.equal(MERMAID_SANITIZE_OPTIONS.USE_PROFILES.svg, true);
        assert.equal(MERMAID_SANITIZE_OPTIONS.USE_PROFILES.svgFilters, true);
        assert.equal(MERMAID_SANITIZE_OPTIONS.USE_PROFILES.mathMl, true);
    });

    it("keeps URI validation enabled", () => {
        assert.equal("ALLOW_UNKNOWN_PROTOCOLS" in MERMAID_SANITIZE_OPTIONS, false);
        assert.equal("ALLOWED_URI_REGEXP" in MERMAID_SANITIZE_OPTIONS, false);
        assert.equal(MERMAID_SANITIZE_OPTIONS.ADD_TAGS.includes("script"), false);
    });
});
