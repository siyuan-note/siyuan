import * as assert from "node:assert/strict";
import {describe, it} from "node:test";
import {getMathRenderSecurity} from "./mathRenderSecurity";

describe("math render security", () => {
    it("always disables trusted KaTeX commands for safe fragments", () => {
        assert.deepEqual(getMathRenderSecurity(false, true), {trust: false, sanitize: true});
        assert.deepEqual(getMathRenderSecurity(true, true), {trust: false, sanitize: true});
        assert.deepEqual(getMathRenderSecurity(false, false), {trust: true, sanitize: false});
    });

    it("does not render active markup from untrusted KaTeX commands", () => {
        const katex = require("../../../stage/protyle/js/katex/katex.min.js");
        const security = getMathRenderSecurity(false, true);
        const fixtures = [
            String.raw`\href{javascript:alert(1)}{link}`,
            String.raw`\includegraphics{https://example.com/image.png}`,
            String.raw`\htmlStyle{background:url(https://example.com/image.png)}{x}`,
        ];

        fixtures.forEach((fixture) => {
            const html = katex.renderToString(fixture, {
                output: "html",
                throwOnError: false,
                trust: security.trust,
            });
            assert.doesNotMatch(html, /href=["']javascript:/i);
            assert.doesNotMatch(html, /<img\b/i);
            assert.doesNotMatch(html, /background\s*:\s*url/i);
        });
    });
});
