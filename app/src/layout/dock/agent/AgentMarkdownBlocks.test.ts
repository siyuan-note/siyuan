import * as assert from "node:assert/strict";
import {test} from "node:test";
import {AgentMarkdownBlocks} from "./AgentMarkdownBlocks";
import {getAgentLute} from "../../../protyle/render/setLute";

require("../../../../stage/protyle/js/lute/lute.min.js");
const lute = getAgentLute({emojiSite: "/emojis", emojis: {}, sanitize: true});
const normalize = (html: string) => html.replace(/ (?:id|updated)="[^"]*"/g, "");
const padding = "A completed **paragraph**.\n\n".repeat(82);
const samples = [
    "# Heading\n\nParagraph\n\nLast\n",
    "- one\n  - nested\n\n    continuation\n- two\n\nAfter\n",
    "1. first\n\n2. second\n\nAfter\n",
    "> quote\n>\n> - item\n>   continuation\n\nAfter\n",
    "> [!NOTE]\n> a callout\n\nAfter\n",
    "````md\n```ts\n\nText\n\n```\n````\n\nAfter\n",
    "```ts\n\n    ```\n\nStill code\n\n```\n\nAfter\n",
    "  ~~~ts\n\nCode\n\n  ~~~\n\nAfter\n",
    "- ```ts\n  value\n\n  more\n  ```\n\nAfter\n",
    "| A | B |\n| --- | --- |\n| 1 | 2 |\n\nAfter\n",
    "Header | other\n--- | ---\nvalue | more\n\nAfter\n",
    "[link](https://example.com/a_(b))\n\nAfter\n",
    "`multi\nline` **strong**\n\nAfter\n",
    "中文 **粗体** 😀\r\n\r\n第二段\r\n",
    "Bare\r\rCR\r\rAfter\r",
    "$$\n\nx^2\n\n$$\n\nAfter\n",
    "Text <span\n\nclass=\"foo\">inline</span>\n\nAfter\n",
    "<!-- comment\n\nText\n\n-->\n\nAfter\n",
    "<div>\n\n**bold**\n\n</div>\n\nAfter\n",
    "<pre>\n\n```\n\nRaw\n\n</pre>\n\nAfter\n",
    "{{{row\n\nLeft\n\n{{{col\n\nNested\n\n}}}\n\n}}}\n\nAfter\n",
    "{{select * from blocks\n\nwhere type = 'p'\n\n}}\n\nAfter\n",
    "\\[\n\nx^2\n\n\\]\n\nAfter\n",
    "=== \"Tab\"\n\nText\n\n=== \"Next\"\n\nOther\n",
    "Paragraph\n{: id=\"20240101000000-abcdefg\" custom-test=\"value\"}\n\nAfter\n",
    "[ref]: https://example.com\n\nReference [ref]\n\nAfter\n",
    ("# Section\n\n**bold** with `code`\n\n- one\n- two\n\n```ts\nconst a = 1;\n```\n\n").repeat(35),
];

test("streaming block groups match full Lute parsing across append boundaries", () => {
    for (const sample of samples) {
        // 将待测结构放在缓存阈值前后，防止仅在未触发分组的小输入上验证。
        for (const prefix of [padding, padding.slice(0, 1800) + "\n\n"]) {
            const source = prefix + sample + padding + "Tail\n";
            const blocks = new AgentMarkdownBlocks();
            let start = 0;
            let committed = "";
            for (let end = 1; end < source.length + 113; end += 113) {
                const partial = source.slice(0, end);
                for (const boundary of blocks.scan(partial)) {
                    assert.ok(boundary > start);
                    committed += lute.ProtylePreviewStr("", partial.slice(start, boundary))
                        .replace(/<\/pre>$/, "</pre>\n");
                    start = boundary;
                }
                assert.equal(normalize(committed + lute.ProtylePreviewStr("", partial.slice(start))),
                    normalize(lute.ProtylePreviewStr("", partial)), sample + " at " + end);
            }
        }
    }
});

test("only completed independent lines commit groups, preserving split CRLF and IAL", () => {
    for (const suffix of ["{: id=\"test\"}\n", "  continuation\n", "- item\n", "1. item\n", "> quote\n"]) {
        const blocks = new AgentMarkdownBlocks();
        const source = "x".repeat(2200) + "\r\n\r\n";
        assert.deepEqual(blocks.scan(source), []);
        for (let i = 1; i <= suffix.length; i++) {
            assert.deepEqual(blocks.scan(source + suffix.slice(0, i)), []);
        }
    }
    const blocks = new AgentMarkdownBlocks();
    const source = "x".repeat(2200) + "\r\n\r\nNext\r";
    assert.deepEqual(blocks.scan(source), []);
    assert.deepEqual(blocks.scan(source + "\n"), [2204]);
    assert.deepEqual(blocks.scan(source + "\n"), []);
});

test("ordinary long replies produce bounded groups without splitting open containers", () => {
    const blocks = new AgentMarkdownBlocks();
    const source = padding.repeat(80) + "Tail\n";
    const boundaries = blocks.scan(source);
    assert.ok(boundaries.length > 70);
    assert.ok(boundaries.every((end, i) => end - (boundaries[i - 1] || 0) < 2200));
    for (const opening of ["```\n", "<!--\n", "$$\n", "{{{row\n", "=== \"Tab\"\n"]) {
        assert.deepEqual(new AgentMarkdownBlocks().scan(opening + source), []);
    }
});
