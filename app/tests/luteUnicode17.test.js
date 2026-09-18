const assert = require("node:assert/strict");
const {describe, it} = require("node:test");
const sequences = require("./fixtures/unicode17-emoji.json");

require("../stage/protyle/js/lute/lute.min.js");

describe("Lute Unicode 17 emoji", () => {
    const lute = globalThis.Lute.New();
    lute.SetCallout(true);
    const aliases = new Map(Object.entries(lute.GetEmojis()).map(([alias, emoji]) => [emoji, alias]));

    for (const sequence of sequences) {
        it(`renders ${sequence} as inline text, shortcode, and callout icon`, () => {
            const emoji = String.fromCodePoint(...sequence.split("-").map(code => parseInt(code, 16)));
            const alias = aliases.get(emoji);
            assert.ok(alias, `missing emoji mapping: ${sequence}`);
            for (const input of [emoji, `:${alias}:`]) {
                assert.equal(lute.MarkdownStr("", input), `<p>${emoji}</p>\n`);
                const html = lute.MarkdownStr("", `> [!NOTE] ${input} Title\n> Content\n`);
                assert.ok(html.includes(`<span class="callout-icon">${emoji}</span><span class="callout-title">Title</span>`), html);
            }
        });
    }

    it("keeps the public shortcodes for the eight new emoji", () => {
        for (const [alias, sequence] of Object.entries({
            distorted_face: "1faea",
            fight_cloud: "1faef",
            hairy_creature: "1fac8",
            ballet_dancer: "1f9d1-200d-1fa70",
            orca: "1facd",
            landslide: "1f6d8",
            trombone: "1fa8a",
            treasure_chest: "1fa8e",
        })) {
            const emoji = String.fromCodePoint(...sequence.split("-").map(code => parseInt(code, 16)));
            assert.equal(lute.GetEmojis()[alias], emoji);
        }
    });
});
