import * as assert from "node:assert/strict";
import {describe, it} from "node:test";

const loadBlockDOMClipboard = async () => {
    Object.assign(globalThis, {
        NODE_ENV: "test",
        SIYUAN_VERSION: "test",
    });
    return import("./blockDOMClipboard");
};

describe("buildBlockDOMClipboardData", () => {
    it("builds normalized rich clipboard formats independently", async () => {
        const {buildBlockDOMClipboardRichData} = await loadBlockDOMClipboard();
        const blockDOM = '<div data-node-id="20260809200000-test" data-type="NodeHeading">Title</div>';

        assert.deepEqual(buildBlockDOMClipboardRichData({
            BlockDOM2HTML: () => "<h2>Title</h2><p>Content</p>\n",
        }, blockDOM), {
            textHTML: "<h2>Title</h2><p>Content</p>",
            textSiyuan: blockDOM + "\u200b",
        });
    });

    it("builds Markdown, exported HTML and SiYuan BlockDOM clipboard formats", async () => {
        const {buildBlockDOMClipboardData} = await loadBlockDOMClipboard();
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
