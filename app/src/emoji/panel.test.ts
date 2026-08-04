import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {collectEmojiMatches, getCustomEmojiBatch, getEmojiItemMap, groupCustomEmojiItems} from "./panel";

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

describe("getCustomEmojiBatch", () => {
    it("continues a group without duplicating its heading across batches", () => {
        const groups = groupCustomEmojiItems([
            createEmoji("root.png"),
            createEmoji("animals/cat.png"),
            createEmoji("animals/dog.png"),
            createEmoji("games/icon.png"),
        ]);

        const first = getCustomEmojiBatch(groups, 0, 2);
        assert.deepEqual(first.groups.map((group) => [group.name, group.items.length]), [["", 1], ["animals", 1]]);
        assert.equal(first.nextOffset, 2);
        assert.equal(first.hasMore, true);

        const second = getCustomEmojiBatch(groups, first.nextOffset, 2);
        assert.deepEqual(second.groups.map((group) => [group.name, group.items.length]), [["animals", 1], ["games", 1]]);
        assert.equal(second.nextOffset, 4);
        assert.equal(second.hasMore, false);
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

    it("excludes custom items from recent lookup when custom icons are hidden", () => {
        const emojiMap = getEmojiItemMap(categories, true);
        assert.equal(emojiMap.has("custom-a.png"), false);
        assert.equal(emojiMap.has("1f600"), true);
    });
});
