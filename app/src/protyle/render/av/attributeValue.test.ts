import * as assert from "node:assert/strict";
import {describe, it} from "node:test";
import * as escape from "../../../util/escape";
import * as imageURL from "../../../util/imageURL";
import {loadModule} from "../../../testSupport/loadModule";

// 属性面板把 genAVValueHTML() 的结果直接赋给 innerHTML，用例按真实转义和 URL 处理加载渲染器。
const attributeValue = loadModule<typeof import("./attributeValue")>(
    "src/protyle/render/av/attributeValue.ts", {
        require: (id: string) => {
            switch (id) {
                case "../../../util/escape":
                    return escape;
                case "../../../util/image":
                case "../../../util/imageURL":
                    return imageURL;
                case "./cellValue":
                    return {
                        createEmptyAVValue: () => ({}),
                        hasAVRenderTemplateResult: () => false,
                        cloneAVCellValueSnapshot: (value: unknown) => value,
                        getAVBlockRefSubtype: () => "",
                    };
                case "./capabilities":
                    return {usesAVRollupCellRenderer: (type: string) => type === "mAsset"};
                default:
                    return {};
            }
        },
        window: {siyuan: {languages: {empty: "Empty"}}},
    });

const assetCell = (content: string) => ({
    type: "mAsset",
    mAsset: [{type: "image", name: "poc", content}],
} as IAVCellValue);

describe("attribute panel asset rendering", () => {
    it("escapes a quote-bearing image source instead of adding an event handler", () => {
        const payload = "assets/poc.png?x=1\" onerror=\"require('child_process').execSync('id')\"";
        const html = attributeValue.genAVValueHTML(assetCell(payload));

        assert.equal(html.includes(' onerror="'), false);
        assert.match(html, /src="assets\/poc\.png\?x=1&quot; onerror=&quot;/);
    });

    it("escapes asset images reached through a rollup", () => {
        const html = attributeValue.genAVValueHTML({
            type: "rollup",
            rollup: {contents: [assetCell("assets/poc.png\" onerror=\"alert(1)")]},
        } as IAVCellValue);

        assert.equal(html.includes(' onerror="'), false);
        assert.match(html, /src="assets\/poc\.png&quot; onerror=&quot;alert\(1\)"/);
    });

    it("keeps thumbnail compression and encoded URLs intact", () => {
        assert.match(attributeValue.genAVValueHTML(assetCell("assets/poc.png")),
            /src="assets\/poc\.png\?style=thumb"/);
        assert.match(attributeValue.genAVValueHTML(assetCell("assets/poc.png?box=1")),
            /src="assets\/poc\.png\?box=1&style=thumb"/);
        assert.match(attributeValue.genAVValueHTML(assetCell("assets/%E6%B5%8B%E8%AF%95.png")),
            /src="assets\/%E6%B5%8B%E8%AF%95\.png\?style=thumb"/);
        assert.match(attributeValue.genAVValueHTML(assetCell("https://example.com/a%20b.png")),
            /src="https:\/\/example\.com\/a%20b\.png"/);
    });
});
