import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {
    collectEmojiMatches,
    getActiveEmojiCategory,
    getEmojiItemMap,
    getEmojiPanelResizeAction,
    getEmojiVirtualChunks,
    getRandomEmojiCategories,
    groupCustomEmojiItems,
} from "./panel";

const createEmoji = (unicode: string) => ({
    unicode,
    description: unicode,
    description_zh_cn: unicode,
    description_ja_jp: unicode,
    keywords: unicode,
});

describe("groupCustomEmojiItems", () => {
    it("places root items before groups and uses the first folder as the group name", () => {
        const groups = groupCustomEmojiItems([
            createEmoji("animals/cat.png"),
            createEmoji("root.png"),
            createEmoji("animals/mammals/dog.png"),
            createEmoji("games/icon.png"),
        ]);

        assert.deepEqual(groups.map((group) => group.name), ["", "animals", "games"]);
        assert.deepEqual(groups[0].items.map((item) => item.unicode), ["root.png"]);
        assert.deepEqual(groups[1].items.map((item) => item.unicode), [
            "animals/cat.png",
            "animals/mammals/dog.png",
        ]);
    });
});

describe("getEmojiVirtualChunks", () => {
    it("splits items at complete row boundaries", () => {
        const items = Array.from({length: 15}, (_, index) => createEmoji(index.toString()));
        const chunks = getEmojiVirtualChunks(items, 3, 2);
        assert.deepEqual(chunks.map((chunk) => chunk.length), [6, 6, 3]);
    });
});

describe("getEmojiPanelResizeAction", () => {
    it("refreshes visible built-in chunks when a hidden panel becomes visible at the same column count", () => {
        assert.equal(getEmojiPanelResizeAction("common", 10, 10), "refresh");
    });

    it("rerenders common and custom pages when the column count changes", () => {
        assert.equal(getEmojiPanelResizeAction("common", 10, 8), "render");
        assert.equal(getEmojiPanelResizeAction("custom", 10, 8), "render");
    });

    it("does not refresh unchanged custom or search pages", () => {
        assert.equal(getEmojiPanelResizeAction("custom", 10, 10), "none");
        assert.equal(getEmojiPanelResizeAction("search", 10, 10), "none");
    });
});

describe("getActiveEmojiCategory", () => {
    const offsets = [{id: "recent", top: 0}, {id: "people", top: 100}, {id: "nature", top: 500}];

    it("selects the section at the sticky boundary", () => {
        assert.equal(getActiveEmojiCategory(offsets, 98), "recent");
        assert.equal(getActiveEmojiCategory(offsets, 99), "people");
    });

    it("selects the last section at the scroll boundary", () => {
        assert.equal(getActiveEmojiCategory(offsets, 200, true), "nature");
    });
});

describe("emoji filtering", () => {
    const categories: IEmoji[] = [{
        id: "custom",
        title: "Custom",
        title_zh_cn: "自定义",
        title_ja_jp: "カスタム",
        items: [createEmoji("custom-a.png"), createEmoji("custom-b.png")],
    }, {
        id: "people",
        title: "People",
        title_zh_cn: "人物",
        title_ja_jp: "人々",
        items: [createEmoji("1f600"), createEmoji("1f601")],
    }];

    it("limits search results without exceeding the requested maximum", () => {
        const result = collectEmojiMatches(categories, () => true, 3);
        assert.equal(result.customItems.length + result.builtInItems.length, 3);
        assert.deepEqual(result.builtInItems.map((item) => item.unicode), ["1f600"]);
    });

    it("stops matching after reaching the requested maximum", () => {
        let matchCount = 0;
        collectEmojiMatches(categories, () => {
            matchCount++;
            return true;
        }, 2);
        assert.equal(matchCount, 2);
    });

    it("excludes custom items from recent lookup when custom icons are hidden", () => {
        const emojiMap = getEmojiItemMap(categories, true);
        assert.equal(emojiMap.has("custom-a.png"), false);
        assert.equal(emojiMap.has("1f600"), true);
    });

    it("reuses emoji indexes for an unchanged configuration", () => {
        assert.equal(getEmojiItemMap(categories), getEmojiItemMap(categories));
        assert.equal(getEmojiItemMap(categories, true), getEmojiItemMap(categories, true));
    });
});

describe("getRandomEmojiCategories", () => {
    const categories: IEmoji[] = [{
        id: "custom",
        title: "Custom",
        title_zh_cn: "自定义",
        title_ja_jp: "カスタム",
        items: [createEmoji("custom.png")],
    }, {
        id: "people",
        title: "People",
        title_zh_cn: "人物",
        title_ja_jp: "人々",
        items: [createEmoji("1f600")],
    }, {
        id: "empty",
        title: "Empty",
        title_zh_cn: "空",
        title_ja_jp: "空",
        items: [],
    }];

    it("keeps random choices within the selected emoji page", () => {
        assert.deepEqual(getRandomEmojiCategories(categories, "builtIn").map((item) => item.id), ["people"]);
        assert.deepEqual(getRandomEmojiCategories(categories, "custom").map((item) => item.id), ["custom"]);
        assert.deepEqual(getRandomEmojiCategories(categories, "all").map((item) => item.id), ["custom", "people"]);
    });
});
