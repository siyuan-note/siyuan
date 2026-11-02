import * as assert from "node:assert/strict";
import {test} from "node:test";
import {markdownPopoverLabel, markdownUnicodeEmojiHints} from "./editor";

test("mobile popover labels remove only known terminal shortcut hints and retain accessible names", () => {
    const hotkeys = ["⌥Enter", "Alt+Enter", "⌘=", "Ctrl+=", "⌘-", "Ctrl+-",
        "⇧⌘=", "⇧⌘+", "Ctrl+Shift++", "⇧⌘-", "⇧⌘_", "Ctrl+Shift+_",
        ...["L", "C", "R", "F", "G", "U", "D", "X"].flatMap(key => [`⇧⌘${key}`, `Ctrl+Shift+${key}`])];
    for (const label of ["语言", "Language", "脚注", "ID", "Remove"]) {
        for (const hotkey of hotkeys) assert.equal(markdownPopoverLabel(`${label}<${hotkey}>`), label);
    }
    for (const value of ["", "Language", "<Alt+Enter>", "Language<unknown>", "Language<Alt+Enter> extra", "<b>text</b>"]) {
        assert.equal(markdownPopoverLabel(value), value);
    }
});

test("Markdown emoji completion keeps Unicode sequences without modifying the parser map", () => {
    const source = {dog: "🐶", dog2: "🐕", family: "👨‍👩‍👧‍👦", flag: "🇨🇳", skin: "👍🏽", keycap: "1️⃣", heart: "❤️",
        doge: "https://example.com/doge.png", local: "./emoji/doge.png", markup: '<img src="doge.png">',
        empty: "", shortcode: ":doge:"};
    const original = {...source};
    assert.deepEqual(markdownUnicodeEmojiHints(source), {
        dog: "🐶", dog2: "🐕", family: "👨‍👩‍👧‍👦", flag: "🇨🇳", skin: "👍🏽", keycap: "1️⃣", heart: "❤️",
    });
    assert.deepEqual(source, original);
});

test("shared Lute retains existing image shortcodes while completion exposes only Unicode emoji", () => {
    require("../../stage/protyle/js/lute/lute.min.js");
    const {Lute} = globalThis as unknown as {Lute: {New(): {
        GetEmojis(): Record<string, string>;
        Md2VditorIRDOM(markdown: string): string;
        VditorIRDOM2Md(html: string): string;
        Md2VditorDOM(markdown: string): string;
        VditorDOM2Md(html: string): string;
    }}};
    const lute = Lute.New();
    const getEmojis = lute.GetEmojis.bind(lute);
    const original = getEmojis();
    const source = ":doge: :dog: 🐶 👨‍👩‍👧‍👦\n";
    const before = [lute.VditorIRDOM2Md(lute.Md2VditorIRDOM(source)), lute.VditorDOM2Md(lute.Md2VditorDOM(source))];
    assert.match(original.doge, /\/doge\.png$/);
    lute.GetEmojis = () => markdownUnicodeEmojiHints(getEmojis());
    assert.equal(lute.GetEmojis().doge, undefined);
    assert.equal(lute.GetEmojis().dog, original.dog);
    assert.equal(lute.GetEmojis().heart, original.heart);
    const after = [lute.VditorIRDOM2Md(lute.Md2VditorIRDOM(source)), lute.VditorDOM2Md(lute.Md2VditorDOM(source))];
    assert.deepEqual(after, before, "filtering completion must not change serialization");
    for (const markdown of after) {
        assert.ok(markdown.includes(":doge:"));
        assert.ok(markdown.includes("🐶 👨‍👩‍👧‍👦"));
    }
    assert.equal(getEmojis().doge, original.doge, "the original parsing map is not mutated");
});
