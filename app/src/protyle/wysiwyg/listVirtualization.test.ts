import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {
    buildLargeListVirtualizationStyle,
    getListVirtualizationPlans,
    LARGE_LIST_CONTENT_BLOCK_THRESHOLD,
    type IListVirtualizationNodeState,
} from "./listVirtualization";

interface ITestNode {
    id?: string;
    type?: string;
    folded?: boolean;
    ignored?: boolean;
    children: ITestNode[];
}

const node = (type?: string, children: ITestNode[] = [], options?: {
    id?: string,
    folded?: boolean,
    ignored?: boolean,
}): ITestNode => ({
    type,
    id: options?.id,
    children,
    folded: options?.folded,
    ignored: options?.ignored,
});

const getState = (item: ITestNode): IListVirtualizationNodeState<ITestNode> => ({
    id: item.id,
    type: item.type,
    folded: item.folded,
    ignoreSubtree: item.ignored,
    children: item.children,
});

describe("large list virtualization", () => {
    it("starts after 192 content blocks", () => {
        const itemCount = LARGE_LIST_CONTENT_BLOCK_THRESHOLD / 2;
        const exactThreshold = node("NodeList", Array.from({length: itemCount}, () =>
            node("NodeListItem", [node("NodeParagraph")])
        ), {id: "exact"});
        const aboveThreshold = node("NodeList", [
            ...exactThreshold.children,
            node("NodeListItem", [node("NodeParagraph")]),
        ], {id: "above"});

        assert.deepEqual(getListVirtualizationPlans(exactThreshold, getState), []);
        assert.deepEqual(getListVirtualizationPlans(aboveThreshold, getState), [{
            listID: "above",
            excludedItemIDs: [],
        }]);
    });

    it("does not count container blocks but includes their content", () => {
        const list = node("NodeList", [
            node("NodeListItem", [
                node("NodeBlockquote", [node("NodeParagraph")]),
                node("NodeSuperBlock", [node("NodeParagraph")]),
                node("NodeCallout", [node("NodeParagraph")]),
            ]),
        ], {id: "list"});

        assert.deepEqual(getListVirtualizationPlans(list, getState, 3), [{
            listID: "list",
            excludedItemIDs: [],
        }]);
        assert.deepEqual(getListVirtualizationPlans(list, getState, 4), []);
    });

    it("skips folded descendants and rendered embed results", () => {
        const list = node("NodeList", [
            node("NodeListItem", [node("NodeParagraph"), node("NodeParagraph")], {folded: true}),
            node("NodeListItem", [
                node("NodeBlockQueryEmbed", [
                    node(undefined, [node("NodeParagraph"), node("NodeParagraph")], {ignored: true}),
                ]),
            ]),
        ], {id: "list"});

        assert.deepEqual(getListVirtualizationPlans(list, getState, 3), []);
        assert.deepEqual(getListVirtualizationPlans(list, getState, 2), [{
            listID: "list",
            excludedItemIDs: [],
        }]);
    });

    it("virtualizes nested lists without containing their parent item", () => {
        const nested = node("NodeList", [node("NodeListItem"), node("NodeListItem")], {id: "nested"});
        const list = node("NodeList", [node("NodeListItem", [nested], {id: "parent"})], {id: "outer"});
        const plans = getListVirtualizationPlans(list, getState, 1);

        assert.deepEqual(plans, [{
            listID: "nested",
            excludedItemIDs: [],
        }, {
            listID: "outer",
            excludedItemIDs: ["parent"],
        }]);
    });

    it("does not exclude a folded item whose nested list is hidden", () => {
        const nested = node("NodeList", [node("NodeListItem"), node("NodeListItem")], {id: "nested"});
        const list = node("NodeList", [
            node("NodeListItem", [nested], {id: "parent", folded: true}),
            node("NodeListItem", [], {id: "sibling"}),
        ], {id: "outer"});

        assert.deepEqual(getListVirtualizationPlans(list, getState, 1), [{
            listID: "outer",
            excludedItemIDs: [],
        }]);
    });

    it("skips an outer plan when its nested parent item has no ID", () => {
        const nested = node("NodeList", [node("NodeListItem"), node("NodeListItem")], {id: "nested"});
        const list = node("NodeList", [node("NodeListItem", [nested])], {id: "outer"});

        assert.deepEqual(getListVirtualizationPlans(list, getState, 1), [{
            listID: "nested",
            excludedItemIDs: [],
        }]);
    });

    it("excludes only the outer item that contains a deeply nested list", () => {
        const nested = node("NodeList", [node("NodeListItem"), node("NodeListItem")], {id: "nested"});
        const list = node("NodeList", [
            node("NodeListItem", [node("NodeBlockquote", [nested])], {id: "parent"}),
            node("NodeListItem", [], {id: "sibling"}),
        ], {id: "outer"});
        const plans = getListVirtualizationPlans(list, getState, 1);

        assert.deepEqual(plans, [{
            listID: "nested",
            excludedItemIDs: [],
        }, {
            listID: "outer",
            excludedItemIDs: ["parent"],
        }]);
    });

    it("builds screen-only rules without changing block DOM", () => {
        const style = buildLargeListVirtualizationStyle("scope", [{
            listID: "list-b",
            excludedItemIDs: [],
        }, {
            listID: "list-a",
            excludedItemIDs: ["parent"],
        }, {
            listID: "list-a",
            excludedItemIDs: ["parent-2"],
        }]);

        assert.match(style, /^@supports/);
        assert.match(style, /@media screen/);
        assert.ok(style.indexOf('data-node-id="list-a"') < style.indexOf('data-node-id="list-b"'));
        assert.match(style, /content-visibility: auto/);
        assert.match(style, /contain-intrinsic-block-size: auto/);
        assert.match(style, /protyle-wysiwyg__embed[^\n]+data-node-id="list-a"/);
        assert.match(style, /data-node-id="parent"/);
        assert.match(style, /data-node-id="parent-2"/);
        assert.match(style, /content-visibility: visible/);
    });
});
