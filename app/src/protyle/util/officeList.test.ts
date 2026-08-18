import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {
    buildOfficeListPlan,
    classifyPptMarker,
    classifyWordMarker,
    convertOfficeLists,
    detectTaskMarker,
    groupConsecutiveOfficeListItems,
    parseCssLengthToPoints,
    parseInlineStyle,
    parseOrderedMarker,
    parsePptSpecialFormat,
    parseWordListStyle,
} from "./officeList";

describe("Office list style parsing", () => {
    it("parses case-insensitive Word list identities without head styles", () => {
        assert.deepEqual(parseWordListStyle(" color:red; MSO-LIST: l12   LEVEL3 lfo7 ;"), {
            level: 3,
            identity: "word:l12:lfo7",
        });
        assert.equal(parseWordListStyle("mso-list:Ignore"), undefined);
    });

    it("keeps quoted and parenthesized inline style values intact", () => {
        assert.deepEqual(parseInlineStyle("font-family:'A; B'; background:url(data:image/png;a:b); COLOR: red"), {
            "font-family": "'A; B'",
            background: "url(data:image/png;a:b)",
            color: "red",
        });
    });

    it("only accepts actual PowerPoint bullet formats", () => {
        assert.equal(parsePptSpecialFormat("mso-special-format: bullet"), "bullet");
        assert.equal(parsePptSpecialFormat("MSO-SPECIAL-FORMAT:numbullet"), "numbullet");
        assert.equal(parsePptSpecialFormat("mso-special-format:\"numbullet3\\,1\""), "numbullet");
        assert.equal(parsePptSpecialFormat("mso-special-format:nobullet"), undefined);
        assert.equal(parsePptSpecialFormat("mso-special-format:bulletproof"), undefined);
        assert.equal(parsePptSpecialFormat("mso-special-format:lastCR"), undefined);
    });

    it("normalizes common PowerPoint margin units", () => {
        assert.equal(parseCssLengthToPoints(".5in"), 36);
        assert.equal(parseCssLengthToPoints("48px"), 36);
        assert.equal(parseCssLengthToPoints("3pc"), 36);
        assert.equal(parseCssLengthToPoints("invalid"), undefined);
    });
});

describe("Office list marker parsing", () => {
    it("detects numeric, alphabetic, and Roman ordered markers", () => {
        assert.deepEqual(parseOrderedMarker("12.\u00a0"), {ordinal: 12, format: "number"});
        assert.deepEqual(parseOrderedMarker("b)"), {ordinal: 2, format: "letter"});
        assert.deepEqual(parseOrderedMarker("c."), {ordinal: 3, format: "letter"});
        assert.deepEqual(parseOrderedMarker("(iv)"), {ordinal: 4, format: "roman"});
        assert.equal(parseOrderedMarker("bullet"), undefined);
    });

    it("treats Wingdings and Courier markers as unordered", () => {
        assert.deepEqual(classifyWordMarker("l", "Wingdings"), {type: "ul"});
        assert.deepEqual(classifyWordMarker("n", "font-family: Wingdings"), {type: "ul"});
        assert.deepEqual(classifyWordMarker("l", ""), {type: "ul"});
        assert.deepEqual(classifyWordMarker("o", "Courier New"), {type: "ul"});
        assert.deepEqual(classifyWordMarker("3.", "Arial"), {type: "ol", markerOrdinal: 3});
    });

    it("maps explicit Unicode task markers", () => {
        for (const marker of ["□", "☐"]) {
            assert.equal(detectTaskMarker(marker, "Arial"), false);
        }
        for (const marker of ["✔", "✓", "☑", "☒"]) {
            assert.equal(detectTaskMarker(marker, "Arial"), true);
        }
    });

    it("maps Wingdings task markers only with the matching marker font", () => {
        for (const marker of ["£", "\uF0A3"]) {
            assert.equal(detectTaskMarker(marker, "Wingdings 2"), false);
        }
        for (const marker of ["P", "\uF050", "R", "\uF052"]) {
            assert.equal(detectTaskMarker(marker, "Wingdings 2"), true);
        }
        for (const marker of ["p", "\uF070", "q", "\uF071"]) {
            assert.equal(detectTaskMarker(marker, "Wingdings"), false);
        }
        for (const marker of ["ü", "\uF0FC"]) {
            assert.equal(detectTaskMarker(marker, "Wingdings"), true);
        }
        assert.equal(detectTaskMarker("P", "Arial"), undefined);
        assert.equal(detectTaskMarker("p", "Arial"), undefined);
    });

    it("uses the PowerPoint special format after task detection", () => {
        assert.deepEqual(classifyPptMarker("☑", "Arial", "bullet"), {type: "task", checked: true});
        assert.deepEqual(classifyPptMarker("4.", "Arial", "numbullet"), {type: "ol", markerOrdinal: 4});
        assert.deepEqual(classifyPptMarker("•", "Arial", "bullet"), {type: "ul"});
    });
});

describe("Office list planning", () => {
    it("compresses skipped levels and always nests lists inside list items", () => {
        const plan = buildOfficeListPlan([
            {level: 1, type: "ul", identity: "word:l0:lfo1"},
            {level: 3, type: "ul", identity: "word:l0:lfo1"},
            {level: 3, type: "ul", identity: "word:l0:lfo1"},
            {level: 2, type: "ul", identity: "word:l0:lfo1"},
            {level: 1, type: "ul", identity: "word:l0:lfo1"},
        ]);

        assert.equal(plan.length, 1);
        assert.deepEqual(plan[0].items.map(item => item.sourceIndex), [0, 4]);
        assert.equal(plan[0].items[0].children.length, 1);
        assert.deepEqual(plan[0].items[0].children[0].items.map(item => item.sourceIndex), [1, 2, 3]);
    });

    it("splits lists when type, identity, or numbering restarts", () => {
        const plan = buildOfficeListPlan([
            {level: 1, type: "ol", identity: "word:l1:lfo1", markerOrdinal: 1},
            {level: 1, type: "ol", identity: "word:l1:lfo1", markerOrdinal: 2},
            {level: 1, type: "ol", identity: "word:l1:lfo1", markerOrdinal: 5},
            {level: 1, type: "ul", identity: "word:l1:lfo1"},
            {level: 1, type: "ul", identity: "word:l2:lfo2"},
        ]);

        assert.equal(plan.length, 4);
        assert.deepEqual(plan.map(item => item.type), ["ol", "ol", "ul", "ul"]);
        assert.deepEqual(plan.map(item => item.start), [1, 5, undefined, undefined]);
        assert.deepEqual(plan[0].items.map(item => item.sourceIndex), [0, 1]);
    });

    it("separates list runs at ordinary paragraphs", () => {
        assert.deepEqual(groupConsecutiveOfficeListItems([1, 2, undefined, 3, null, 4, 5]), [
            [1, 2],
            [3],
            [4, 5],
        ]);
    });
});

describe("convertOfficeLists", () => {
    it("is a no-op without DOMParser in the Node test environment", () => {
        const html = "<p style=\"mso-list:l0 level1 lfo1\">l item</p>";
        assert.deepEqual(convertOfficeLists(html), {html, convertedCount: 0});
    });
});
