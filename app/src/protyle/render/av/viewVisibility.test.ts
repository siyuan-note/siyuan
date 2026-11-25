import {before, describe, it} from "node:test";
import * as assert from "node:assert/strict";

let visibleViewsAttribute: string;
let currentViewAttribute: string;
let getAVCurrentViewID: typeof import("./viewVisibility").getAVCurrentViewID;
let getAVVisibleViewIDs: typeof import("./viewVisibility").getAVVisibleViewIDs;
let getAVVisibleViewIDsAfterHidingAll: typeof import("./viewVisibility").getAVVisibleViewIDsAfterHidingAll;
let setAVVisibleViewIDs: typeof import("./viewVisibility").setAVVisibleViewIDs;
let updateAVVisibleViews: typeof import("./viewVisibility").updateAVVisibleViews;
let getAVViewPageSize: typeof import("./viewVisibility").getAVViewPageSize;
let serializeAVViewPageSizes: typeof import("./viewVisibility").serializeAVViewPageSizes;

before(async () => {
    Object.assign(globalThis, {NODE_ENV: "test", SIYUAN_VERSION: ""});
    const [{Constants}, visibility] = await Promise.all([
        import("../../../constants"),
        import("./viewVisibility"),
    ]);
    visibleViewsAttribute = Constants.CUSTOM_SY_AV_VISIBLE_VIEWS;
    currentViewAttribute = Constants.CUSTOM_SY_AV_VIEW;
    getAVCurrentViewID = visibility.getAVCurrentViewID;
    getAVVisibleViewIDs = visibility.getAVVisibleViewIDs;
    getAVVisibleViewIDsAfterHidingAll = visibility.getAVVisibleViewIDsAfterHidingAll;
    setAVVisibleViewIDs = visibility.setAVVisibleViewIDs;
    updateAVVisibleViews = visibility.updateAVVisibleViews;
    getAVViewPageSize = visibility.getAVViewPageSize;
    serializeAVViewPageSizes = visibility.serializeAVViewPageSizes;
});

const createBlockElement = (value?: string, currentViewID?: string, renderedViewID?: string, focusedViewID?: string) => {
    const attrs = new Map<string, string>();
    if (value !== undefined) {
        attrs.set(visibleViewsAttribute, value);
    }
    if (currentViewID !== undefined) {
        attrs.set(currentViewAttribute, currentViewID);
    }
    return {
        getAttribute: (name: string) => attrs.get(name) ?? null,
        setAttribute: (name: string, attrValue: string) => attrs.set(name, attrValue),
        querySelector: (selector: string) => {
            if (selector === ".av__header" && renderedViewID !== undefined) {
                return {
                    getAttribute: (name: string) => name === "data-current-view-id" ? renderedViewID : null,
                };
            }
            if (selector === ".layout-tab-bar .item--focus" && focusedViewID !== undefined) {
                return {
                    getAttribute: (name: string) => name === "data-id" ? focusedViewID : null,
                };
            }
            return null;
        },
    } as unknown as Element;
};

const views = [
    {id: "view-a"},
    {id: "view-b"},
    {id: "view-c"},
] as IAVView[];

describe("database block visible views", () => {
    it("reads the current view even when its tab was already hidden", () => {
        assert.equal(getAVCurrentViewID(createBlockElement(undefined, undefined, "view-b")), "view-b");
    });

    it("switches to the nearest visible tab on the left, then on the right", () => {
        const order = ["a", "b", "c", "d", "e"];
        for (const [before, after, next] of [
            [["a", "b", "c", "d"], ["a", "b", "d"], "b"],
            [["a", "c", "d"], ["a", "d"], "a"],
            [["c", "e"], ["e"], "e"],
        ] as const) {
            const block = createBlockElement(before.join(","), "c");
            const {operations, undoOperations} = updateAVVisibleViews(block, order, [...before], [...after]);
            assert.deepEqual(operations.map(op => op.action), ["setAttrViewBlockVisibleViews", "setAttrViewBlockView"]);
            assert.deepEqual(undoOperations.map(op => op.action), ["setAttrViewBlockVisibleViews", "setAttrViewBlockView"]);
            assert.equal(getAVCurrentViewID(block), next);
            assert.equal(getAVVisibleViewIDs(block, order).join(","), after.join(","));
            assert.equal(undoOperations.find(op => op.action === "setAttrViewBlockView").id, "c");
        }
    });

    it("leaves a current view alone when another tab is hidden", () => {
        for (const before of [["a", "b", "c"], ["a", "b"]]) {
            const block = createBlockElement(before.join(","), "c");
            const {operations} = updateAVVisibleViews(block, ["a", "b", "c"], before, before.filter(id => id !== "b"));
            assert.equal(operations.length, 1);
            assert.equal(getAVCurrentViewID(block), "c");
        }
    });

    it("prefers the persisted current view and supports legacy focused tabs", () => {
        assert.equal(getAVCurrentViewID(createBlockElement(undefined, "view-c", "view-b", "view-a")), "view-c");
        assert.equal(getAVCurrentViewID(createBlockElement(undefined, undefined, undefined, "view-a")), "view-a");
    });

    it("shows all views for legacy blocks without a visibility attribute", () => {
        assert.deepEqual(getAVVisibleViewIDs(createBlockElement(), views), ["view-a", "view-b", "view-c"]);
    });

    it("filters stale IDs and keeps the database view order", () => {
        assert.deepEqual(
            getAVVisibleViewIDs(createBlockElement("view-c,missing,view-a"), views),
            ["view-a", "view-c"]
        );
    });

    it("falls back to the first view when the configured views are stale", () => {
        assert.deepEqual(getAVVisibleViewIDs(createBlockElement("missing"), views), ["view-a"]);
    });

    it("serializes an explicit visible view set", () => {
        const blockElement = createBlockElement();
        setAVVisibleViewIDs(blockElement, ["view-a", "view-c"]);

        assert.equal(
            blockElement.getAttribute(visibleViewsAttribute),
            "view-a,view-c"
        );
    });

    it("keeps one view visible when hiding all views", () => {
        assert.deepEqual(getAVVisibleViewIDsAfterHidingAll(["view-a", "view-b"], "view-b"), ["view-b"]);
        assert.deepEqual(getAVVisibleViewIDsAfterHidingAll(["view-a", "view-b"], "view-c"), ["view-a"]);
        assert.deepEqual(getAVVisibleViewIDsAfterHidingAll(["view-a"], "view-a"), ["view-a"]);
        assert.deepEqual(getAVVisibleViewIDsAfterHidingAll([], "view-a"), []);
    });

    it("keeps page sizes available for hidden views", () => {
        const value = serializeAVViewPageSizes([
            {id: "view-a", pageSize: 25},
            {id: "view-b", pageSize: 100},
        ] as IAVView[]);

        assert.equal(getAVViewPageSize(value, "view-b"), "100");
        assert.equal(getAVViewPageSize(value, "missing"), undefined);
        assert.equal(getAVViewPageSize("invalid", "view-a"), undefined);
    });
});
