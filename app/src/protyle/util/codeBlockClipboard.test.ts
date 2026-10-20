import * as assert from "node:assert/strict";
import {describe, it} from "node:test";

describe("code block Markdown clipboard fences", () => {
    for (const [content, fence] of [
        ["ordinary code\n", "```"],
        ["before\n```\nafter\n", "````"],
        ["```\n`````\n````\n", "``````"],
        ["\u200d```\n", "````"],
    ]) {
        it(`round-trips ${JSON.stringify(content)} through the bundled engine`, () => {
            if (typeof Lute === "undefined") {
                require("../../../stage/protyle/js/lute/lute.min.js");
            }
            const lute = Lute.New();
            lute.SetProtyleWYSIWYG(true);
            const block = '<div data-type="NodeCodeBlock" class="code-block">' +
                '<div class="protyle-action"><span class="protyle-action__language">text</span></div>' +
                `<div contenteditable="true">${content}</div></div>`;
            const markdown = lute.BlockDOM2StdMd(block).replace(/\u200d```/g, "```");
            assert.equal(markdown.trimEnd(), `${fence}text\n${content.replace(/\u200d```/g, "```")}${fence}`);
            assert.equal(lute.MarkdownStr("", markdown),
                `<pre><code class="language-text">${content.replace(/\u200d```/g, "```")}</code></pre>\n`);
        });
    }
});
