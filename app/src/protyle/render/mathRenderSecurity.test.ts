import * as assert from "node:assert/strict";
import {describe, it} from "node:test";
import {getMathRenderSecurity, isSafeMathURLProtocol} from "./mathRenderSecurity";

const katex = require("../../../stage/protyle/js/katex/katex.min.js");

// 与 mathRender 相同的调用方式：把配置里的 trust 原样传给 KaTeX
const renderWith = (security: {trust: unknown; sanitize: boolean}, tex: string) => {
    return katex.renderToString(tex, {
        output: "html",
        throwOnError: false,
        strict: () => "ignore",
        macros: {},
        trust: security.trust,
    });
};

const renderLocalMath = (tex: string) => renderWith(getMathRenderSecurity(false, false), tex);

// KaTeX 对 <a> 用双引号、对 \includegraphics 的 <img> 用单引号，两种都要覆盖
const attributeValue = (html: string, attribute: string) => {
    const matched = new RegExp(`${attribute}=["']([^"']*)["']`).exec(html);
    return matched ? matched[1].trim() : null;
};

const activeURLPattern = new RegExp("\\b(?:href|src)=[\"']?\\s*(?:javascript|data|vbscript|file|siyuan)\\s*:", "i");

describe("math render security", () => {
    it("always disables trusted KaTeX commands for safe fragments", () => {
        assert.deepEqual(getMathRenderSecurity(false, true), {trust: false, sanitize: true});
        assert.deepEqual(getMathRenderSecurity(true, true), {trust: false, sanitize: true});
        assert.deepEqual(getMathRenderSecurity(true, false), {trust: false, sanitize: true});
    });

    it("no longer trusts KaTeX commands unconditionally in the local editor path", () => {
        const security = getMathRenderSecurity(false, false);
        assert.notEqual(security.trust, true);
        assert.equal(typeof security.trust, "function");
        assert.equal(security.sanitize, false);
    });

    it("keeps safe URLs in the local editor path", () => {
        const hrefFixtures: Array<[string, string]> = [
            ["\\href{https://example.com}{link}", "https://example.com"],
            ["\\href{http://example.com}{link}", "http://example.com"],
            ["\\href{mailto:test@example.com}{mail}", "mailto:test@example.com"],
            ["\\href{/assets/image.png}{asset}", "/assets/image.png"],
            ["\\href{https://example.com/a?b=c#d}{link}", "https://example.com/a?b=c#d"],
        ];
        hrefFixtures.forEach(([fixture, expected]) => {
            assert.equal(attributeValue(renderLocalMath(fixture), "href"), expected, fixture);
        });

        // \url 与 \includegraphics 走同一套信任判定，\includegraphics 生成 <img src>
        assert.equal(attributeValue(renderLocalMath("\\url{https://example.com}"), "href"),
            "https://example.com");
        assert.equal(attributeValue(renderLocalMath("\\includegraphics{https://example.com/image.png}"), "src"),
            "https://example.com/image.png");
        assert.equal(attributeValue(renderLocalMath("\\includegraphics{/assets/image.png}"), "src"),
            "/assets/image.png");
    });

    it("does not render active URLs from untrusted KaTeX commands in the local editor path", () => {
        const blockedFixtures = [
            "\\href{javascript:alert(1)}{link}",
            "\\href{JaVaScRiPt:alert(1)}{link}",
            "\\href{data:text/html,<script>alert(1)</script>}{link}",
            "\\href{vbscript:msgbox(1)}{link}",
            "\\href{file:///etc/passwd}{link}",
            "\\href{siyuan://blocks/20260903150000-abcdefg}{link}",
            "\\url{javascript:alert(1)}",
            "\\includegraphics{javascript:alert(1)}",
            "\\includegraphics{data:image/svg+xml,<svg onload=alert(1)>}",
        ];
        blockedFixtures.forEach((fixture) => {
            const html = renderLocalMath(fixture);
            assert.doesNotMatch(html, activeURLPattern, fixture);
            assert.equal(attributeValue(html, "href"), null, fixture);
            assert.equal(attributeValue(html, "src"), null, fixture);
        });
    });

    it("only allows the expected URL protocols", () => {
        ["http", "https", "mailto", "_relative"].forEach((protocol) => {
            assert.equal(isSafeMathURLProtocol(protocol), true, protocol);
        });
        ["javascript", "JaVaScRiPt", "data", "vbscript", "file", "siyuan", "blob", "ftp", "", undefined].forEach((protocol) => {
            assert.equal(isSafeMathURLProtocol(protocol), false, String(protocol));
        });
    });

    it("keeps KaTeX HTML attribute commands working in the local editor path", () => {
        // \htmlClass 等命令不携带 URL，因此不受协议白名单影响，公式排版能力保持不变
        assert.match(renderLocalMath("\\htmlClass{probe}{x}"), /class="[^"]*probe/);
        assert.match(renderLocalMath("\\htmlId{probe}{x}"), /id="[^"]*probe/);
        assert.match(renderLocalMath("\\htmlStyle{color:red}{x}"), /color:\s*red/);
        assert.match(renderLocalMath("\\htmlData{foo=bar}{x}"), /data-foo="bar"/);
    });

    it("does not render active markup from untrusted KaTeX commands", () => {
        const security = getMathRenderSecurity(false, true);
        const fixtures = [
            "\\href{javascript:alert(1)}{link}",
            "\\includegraphics{https://example.com/image.png}",
            "\\htmlStyle{background:url(https://example.com/image.png)}{x}",
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
