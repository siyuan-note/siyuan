import {test} from "node:test";
import * as assert from "node:assert/strict";
import {memoryOverviewMarkdown, renderMemoryOverview} from "./overview";

test("overview hides only trailing record references and preserves source text, links and code", () => {
    const id = "20261030081347-eyy3fb5";
    const markdown = `# MEMORY.md\n\n## Writing preference\n- Keep punctuation [${id}]\n` +
        `Order 20261030081347\n[Guide](https://example.com/${id})\n` +
        `Inline \`[${id}]\`\n\n\`\`\`text\nExample [${id}]\n\`\`\`\n    Code [${id}]`;
    const result = memoryOverviewMarkdown(markdown);
    assert.equal(result, markdown.replace(`Keep punctuation [${id}]`, "Keep punctuation"));
    assert.ok(markdown.includes(`Keep punctuation [${id}]`), "the stored source is unchanged");
    assert.equal(memoryOverviewMarkdown(`- Fact [${id}] [20261030101010-abcdef1]`), "- Fact");
    assert.equal(memoryOverviewMarkdown("- Number [20261030081347]"), "- Number [20261030081347]");
    assert.equal(memoryOverviewMarkdown(`[${id}]`), "");
    assert.equal(memoryOverviewMarkdown(`- Fact [${id}](siyuan://blocks/${id})`), "- Fact");
    assert.equal(memoryOverviewMarkdown(`[Reference](siyuan://blocks/${id})`), `[Reference](siyuan://blocks/${id})`);
});

test("overview renders bundled Markdown then always passes through a static sanitizer policy", () => {
    if (typeof Lute === "undefined") { require("../../../stage/protyle/js/lute/lute.min.js"); }
    let rendered = "";
    let policy: {ALLOWED_TAGS: string[]; ALLOWED_ATTR: string[]; ALLOW_DATA_ATTR: boolean; ALLOW_ARIA_ATTR: boolean; ALLOWED_URI_REGEXP: RegExp};
    const prior = globalThis.window;
    try {
        Object.assign(globalThis, {window: {DOMPurify: {sanitize: (html: string, options: typeof policy) => {
            rendered = html;
            policy = options;
            return "sanitized-only";
        }}}});
        const links = ["https://example.com", "mailto:user@example.com", "#heading"].map(href => {
            const attributes = new Map([["href", href]]);
            return {attributes, getAttribute: (key: string) => attributes.get(key),
                setAttribute: (key: string, value: string) => attributes.set(key, value),
                removeAttribute: (key: string) => attributes.delete(key)};
        });
        const element = {innerHTML: "", querySelectorAll: () => links} as unknown as HTMLElement;
        renderMemoryOverview(element, "# MEMORY.md\n\n- **Preference** [20261030081347-eyy3fb5]\n<script>alert(1)</script>");
        assert.match(rendered, /<h1>MEMORY.md<\/h1>/);
        assert.match(rendered, /<strong>Preference<\/strong>/);
        assert.doesNotMatch(rendered, /20261030081347-eyy3fb5/);
        assert.equal(element.innerHTML, "sanitized-only");
        assert.equal(links[0].attributes.get("target"), "_blank");
        assert.equal(links[0].attributes.get("rel"), "noopener noreferrer");
        assert.equal(links[1].attributes.get("target"), "_blank");
        assert.equal(links[2].attributes.has("href"), false);
        for (const tag of ["script", "img", "iframe", "style", "form", "input", "video", "audio", "svg"]) {
            assert.ok(!policy.ALLOWED_TAGS.includes(tag));
        }
        for (const attr of ["src", "style", "class", "onclick", "onerror", "id"]) {
            assert.ok(!policy.ALLOWED_ATTR.includes(attr));
        }
        assert.equal(policy.ALLOW_DATA_ATTR, false);
        assert.equal(policy.ALLOW_ARIA_ATTR, false);
        for (const href of ["javascript:alert(1)", "siyuan://blocks/id", "command:exec", "/api/unsafe", "data:text/html,test"]) {
            assert.equal(policy.ALLOWED_URI_REGEXP.test(href), false);
        }
        for (const href of ["https://example.com", "http://example.com", "mailto:user@example.com", "#heading"]) {
            assert.equal(policy.ALLOWED_URI_REGEXP.test(href), true);
        }
    } finally {
        Object.assign(globalThis, {window: prior});
    }
});
