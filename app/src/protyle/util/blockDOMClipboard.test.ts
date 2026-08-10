import * as assert from "node:assert/strict";
import {describe, it} from "node:test";
import {buildBlockDOMClipboardData} from "./blockDOMClipboard";

describe("buildBlockDOMClipboardData", () => {
    it("builds Markdown, exported HTML and SiYuan BlockDOM clipboard formats", () => {
        const blockDOM = '<div data-node-id="20260809200000-test" data-type="NodeHeading">Title</div>';
        const data = buildBlockDOMClipboardData({
            BlockDOM2StdMd: () => "## Title\n\nContent\n",
            BlockDOM2HTML: () => "<h2>Title</h2><p>Content</p>\u200d```\n",
        }, blockDOM);

        assert.deepEqual(data, {
            textPlain: "## Title\n\nContent",
            textHTML: "<h2>Title</h2><p>Content</p>```",
            textSiyuan: blockDOM + "\u200b",
        });
    });
});
