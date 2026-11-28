import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {flashcardV2GroupNumber, loadFlashcardV2GroupNumbers} from "./flashcardV2GroupNumber";

const config = {groups: [{id: "849", displayOrder: 1}, {id: "f971", displayOrder: 0}]};
const cards = [
    {card: {id: "9aee", sourceID: "source", variantKey: "group:849"}, sourceType: "cloze"},
    {card: {id: "b6b", sourceID: "source", variantKey: "group:f971"}, sourceType: "cloze"},
];

test("group labels follow configuration rather than card UUID or filtered position", async () => {
    let calls = 0;
    const result = await loadFlashcardV2GroupNumbers(cards, async () => { calls++; return config; });
    assert.equal(calls, 1);
    assert.equal(result.get("9aee"), 2);
    assert.equal(result.get("b6b"), 1);
    const filtered = await loadFlashcardV2GroupNumbers(cards.slice(0, 1), async () => config);
    assert.equal(filtered.get("9aee"), 2);
    assert.equal(flashcardV2GroupNumber({groups: [
        {id: "849", displayOrder: 0}, {id: "f971", displayOrder: 1},
    ]}, "group:849"), 1);
});

test("missing or malformed groups never invent a number", async () => {
    for (const value of [undefined, null, {}, {groups: null}, {groups: []},
        {groups: [{id: "849", displayOrder: -1}]},
        {groups: [{id: "849", displayOrder: 0}, {id: "849", displayOrder: 1}]}]) {
        assert.equal(flashcardV2GroupNumber(value, "group:849"), undefined);
    }
    assert.equal(flashcardV2GroupNumber(config, "group:unknown"), undefined);
    assert.equal(flashcardV2GroupNumber(config, "variant:849"), undefined);
    const failed = await loadFlashcardV2GroupNumbers(cards, async () => { throw new Error("failed"); });
    assert.equal(failed.size, 0);
});

test("image groups share numbering while other card types require no lookup", async () => {
    let calls = 0;
    const result = await loadFlashcardV2GroupNumbers([
        {...cards[0], sourceType: "image-occlusion"},
        {...cards[1], sourceType: "anki"},
        {...cards[1], sourceType: "ordered"},
    ], async () => { calls++; return config; });
    assert.equal(calls, 1);
    assert.equal(result.get("9aee"), 2);
    assert.equal(result.has("b6b"), false);
});

test("management loads group numbers into the current type and selection labels without replacing the prompt", () => {
    const source = readFileSync("src/card/flashcardV2.ts", "utf8");
    const start = source.indexOf("void loadFlashcardV2GroupNumbers(cards");
    const end = source.indexOf("owner.view.setRefresh", start);
    const snippet = source.slice(start, end);
    assert.ok(start > source.indexOf("owner.dialog = new Dialog"));
    assert.match(snippet, /undefined, false, signal/);
    assert.match(snippet, /!isCurrent\(\) \|\| listenerOptions.signal.aborted/);
    assert.match(snippet, /querySelector\("\[data-card-kind\]"\).textContent = kind/);
    assert.match(snippet, /setAttribute\("aria-label", kind\)/);
    assert.doesNotMatch(snippet, /preview|innerHTML|outerHTML|\.focus\(|\.refresh\(/);
    const title = source.slice(source.indexOf("const groupedTitle ="), source.indexOf("const statuses ="));
    assert.match(title, /\["cloze", "image-occlusion"\]/);
    assert.match(title, /variant \|\| position \+ 1/);
});
