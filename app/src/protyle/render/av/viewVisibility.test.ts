import {before, describe, it} from "node:test";
import * as assert from "node:assert/strict";

let visibleViewsAttribute: string;
let getAVVisibleViewIDs: typeof import("./viewVisibility").getAVVisibleViewIDs;
let setAVVisibleViewIDs: typeof import("./viewVisibility").setAVVisibleViewIDs;
let getAVViewPageSize: typeof import("./viewVisibility").getAVViewPageSize;
let serializeAVViewPageSizes: typeof import("./viewVisibility").serializeAVViewPageSizes;

before(async () => {
    Object.assign(globalThis, {NODE_ENV: "test", SIYUAN_VERSION: ""});
    const [{Constants}, visibility] = await Promise.all([
        import("../../../constants"),
        import("./viewVisibility"),
    ]);
    visibleViewsAttribute = Constants.CUSTOM_SY_AV_VISIBLE_VIEWS;
    getAVVisibleViewIDs = visibility.getAVVisibleViewIDs;
    setAVVisibleViewIDs = visibility.setAVVisibleViewIDs;
    getAVViewPageSize = visibility.getAVViewPageSize;
    serializeAVViewPageSizes = visibility.serializeAVViewPageSizes;
});

const createBlockElement = (value?: string) => {
    const attrs = new Map<string, string>();
    if (value !== undefined) {
        attrs.set(visibleViewsAttribute, value);
    }
    return {
        getAttribute: (name: string) => attrs.get(name) ?? null,
        setAttribute: (name: string, attrValue: string) => attrs.set(name, attrValue),
    } as unknown as Element;
};

const views = [
    {id: "view-a"},
    {id: "view-b"},
    {id: "view-c"},
] as IAVView[];

describe("database block visible views", () => {
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
