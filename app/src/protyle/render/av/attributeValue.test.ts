import * as assert from "node:assert/strict";
import {describe, it} from "node:test";
import * as escape from "../../../util/escape";
import * as imageURL from "../../../util/imageURL";
import {DOMFixture} from "./testDOM";
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
                case "./blockIcon":
                    return {renderAVBlockIcon: () => ""};
                case "./capabilities":
                    return {
                        usesAVRollupCellRenderer: (type: string) => ["mAsset", "relation"].includes(type),
                        isAVLinkType: () => false,
                        isAVTimestampType: () => false,
                        hasAVAttributePlaceholder: () => false,
                    };
                default:
                    return {};
            }
        },
        window: {siyuan: {languages: {empty: "Empty", showAll: "Show all"}}},
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

const relationCell = (count: number) => ({
    type: "relation", keyID: "relation", blockID: "row",
    relation: {
        blockIDs: Array.from({length: count}, (_, index) => `row-${index}`),
        contents: Array.from({length: count}, (_, index) => ({
            type: "block", block: {id: `block-${index}`, content: `Related ${index}`},
        })),
    },
} as IAVCellValue);

const relationCount = (html: string) => (html.match(/class="av__cell--relation"/g) || []).length;

describe("attribute panel relation preview", () => {
    for (const count of [0, 5, 6, 100]) {
        it(`shows at most five of ${count} relations without changing stored values`, () => {
            const value = relationCell(count);
            const original = JSON.stringify(value);
            const html = attributeValue.genAVAttributeRowHTML({
                nodeID: "node", avID: "av", keyID: "relation", type: "relation",
                name: "Relation", typeIcon: "iconDatabase", value, empty: count === 0,
            });
            assert.equal(relationCount(html), Math.min(count, 5));
            assert.equal(html.includes('data-type="av-relation-show-all"'), count > 5);
            assert.equal(JSON.stringify(value), original);
            assert.equal(decodeURIComponent(html.match(/data-cell-value="([^"]+)"/)[1]), original);
            assert.equal(relationCount(attributeValue.genAVValueHTML(value)), count);
        });
    }

    it("skips missing blocks without shifting relation row IDs or counting invisible entries", () => {
        for (const count of [7, 8]) {
            const value = relationCell(count);
            value.relation.contents[1] = null;
            value.relation.contents[3] = {} as IAVCellValue;
            const html = attributeValue.genAVValueHTML(value, "", undefined, 5);
            assert.equal(relationCount(html), 5);
            assert.match(html, /data-row-id="row-6"/);
            assert.equal(html.includes('data-type="av-relation-show-all"'), count === 8);
        }
    });

    it("does not collapse relations nested in rollups", () => {
        const html = attributeValue.genAVValueHTML({
            type: "rollup", rollup: {contents: [relationCell(8)]},
        } as IAVCellValue, "", undefined, 5);
        assert.equal(relationCount(html), 8);
        assert.equal(html.includes('data-type="av-relation-show-all"'), false);
    });
});

const createRelationPanel = (disabled: boolean) => {
    const dom = new DOMFixture();
    const panel = dom.createElement("div");
    dom.body.append(panel);
    const mocks: Record<string, unknown> = {
        "./attributeValue": attributeValue,
        "../../../util/fetch": {fetchPost: (url: string, _data: unknown, callback: (response: unknown) => void) => {
            if (url === "/api/av/getAttributeViewKeys") callback({data: []});
            return Promise.resolve();
        }},
        "../../../template/http": {guardTemplateHTTPRequest: () => ({dispose() {}})},
        "./binding": {preserveAVBindingRange: () => () => {}},
        "./relatedView": {preserveRelatedAVViews() {}, mountRelatedAVViews() {}},
        "./richText": {renderAVRichTextElements() {}},
        "./attributePanelLayout": {observeAVAttributeLayout() {}},
    };
    const blockAttr = loadModule<typeof import("./blockAttr")>("src/protyle/render/av/blockAttr.ts", {
        require: (id: string) => mocks[id] || {}, window: {siyuan: {}},
    });
    const protyle = {disabled, options: {}, wysiwyg: {element: {querySelectorAll: (): HTMLElement[] => []}}} as unknown as IProtyle;
    blockAttr.renderAVAttribute(panel as unknown as HTMLElement, "document", protyle);
    panel.innerHTML = attributeValue.genAVAttributeRowHTML({
        nodeID: "node", avID: "av", keyID: "relation", type: "relation",
        name: "Relation", typeIcon: "iconDatabase", value: relationCell(12), empty: false,
    });
    return {dom, panel, protyle};
};

describe("attribute panel show all interaction", () => {
    for (const disabled of [false, true]) {
        it(`shows every remaining relation in ${disabled ? "readonly" : "editable"} panels without editing or bubbling`, () => {
            const {dom, panel, protyle} = createRelationPanel(disabled);
            let bubbled = false;
            dom.body.addEventListener("click", () => { bubbled = true; });
            const cell = panel.querySelector('.custom-attr__avvalue[data-type="relation"]');
            const original = cell.dataset.cellValue;
            const event = cell.querySelector('[data-type="av-relation-show-all"]').dispatch("click");
            assert.equal(event.defaultPrevented, true);
            assert.equal(bubbled, false);
            assert.equal(relationCount(cell.innerHTML), 12);
            assert.equal(cell.dataset.relationExpanded, "true");
            assert.equal(cell.dataset.cellValue, original);
            assert.equal(cell.querySelector('[data-type="av-relation-show-all"]'), null);

            const cells = loadModule<typeof import("./cell")>("src/protyle/render/av/cell.ts", {
                require: (id: string) => ({
                    "./attributeValue": attributeValue,
                    "./cellValue": {cloneAVCellValueSnapshot: (value: unknown) => value, cellValueIsEmpty: () => false},
                    "./richText": {renderAVRichTextElements() {}},
                }[id] || {}),
                document: {querySelectorAll: () => [cell]},
            });
            for (const expanded of ["true", "false"]) {
                cell.dataset.relationExpanded = expanded;
                cells.updateAttrViewCellInOtherElements(protyle, "av", "row", "relation", relationCell(14));
                assert.equal(relationCount(cell.innerHTML), expanded === "true" ? 14 : 5);
                assert.equal(JSON.parse(decodeURIComponent(cell.dataset.cellValue)).relation.contents.length, 14);
            }
        });
    }
});
