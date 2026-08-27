import {afterEach, describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {
    getAvailableAVCustomColorIndex,
    getAVBackgroundColor,
    getAVColorGridHTML,
    getAVColorStyle,
    getNextAVOptionColor,
    normalizeAVColorIndex,
    normalizeAVColorOrder,
} from "./color";
import {INLINE_STYLE_EMPTY, setInlineStylesCache} from "../../toolbar/inlineStyle";

const customColor: IAVCustomColor = {
    index: 15,
    light: {
        color: "#112233",
        backgroundColor: "#ddeeff",
    },
    dark: {
        color: "#fefefe",
        backgroundColor: "#223344",
    },
};

afterEach(() => {
    setInlineStylesCache(INLINE_STYLE_EMPTY);
});

describe("AV color indexes", () => {
    it("accepts only bounded decimal indexes", () => {
        assert.equal(normalizeAVColorIndex("15"), 15);
        assert.equal(normalizeAVColorIndex("15suffix"), 14);
        assert.equal(normalizeAVColorIndex(79), 14);
    });

    it("cycles new options through built-in colors", () => {
        assert.equal(getNextAVOptionColor(0), "1");
        assert.equal(getNextAVOptionColor(13), "14");
        assert.equal(getNextAVOptionColor(14), "1");
    });

    it("skips hidden built-in colors while keeping the neutral color", () => {
        setInlineStylesCache({
            ...INLINE_STYLE_EMPTY,
            builtin: {
                ...INLINE_STYLE_EMPTY.builtin,
                hidden: {
                    ...INLINE_STYLE_EMPTY.builtin.hidden,
                    av: Array.from({length: 13}, (_, index) => index + 1),
                },
            },
        });
        assert.equal(getNextAVOptionColor(0), "14");
        assert.equal(getNextAVOptionColor(12), "14");
        const html = getAVColorGridHTML([], "1", "Manage");
        assert.doesNotMatch(html, /data-color="1"/);
        assert.match(html, /data-color="14" class="color__square" style="background-color:var\(--b3-font-background14\);color:var\(--b3-font-color14\)"/);
    });

    it("finds the first available custom index", () => {
        assert.equal(getAvailableAVCustomColorIndex([{index: 15}, {index: 17}]), 16);
    });
});

describe("AV resolved colors", () => {
    it("renders local light and dark chip colors", () => {
        assert.equal(getAVColorStyle({color: "15", resolvedColor: customColor}),
            "background-color:light-dark(#ddeeff, #223344);color:light-dark(#112233, #fefefe)");
        assert.equal(getAVBackgroundColor({color: "15", resolvedColor: customColor}),
            "light-dark(#ddeeff, #223344)");
    });

    it("uses numbered variables for built-ins including undefined 14", () => {
        assert.equal(getAVColorStyle("13"),
            "background-color:var(--b3-font-background13);color:var(--b3-font-color13)");
        assert.equal(getAVColorStyle("14"),
            "background-color:var(--b3-font-background14);color:var(--b3-font-color14)");
        assert.equal(getAVBackgroundColor("14"), "var(--b3-font-background14)");
        assert.equal(getAVColorStyle("42"),
            "background-color:var(--b3-font-background14);color:var(--b3-font-color14)");
        assert.equal(getAVBackgroundColor("42"), "var(--b3-font-background14)");
        assert.equal(getAVColorStyle({
            color: "15",
            resolvedColor: {
                ...customColor,
                light: {...customColor.light, backgroundColor: "red);background-image:url(javascript:alert(1))"},
            },
        }), "background-color:var(--b3-font-background14);color:var(--b3-font-color14)");
    });

    it("uses workspace custom color variables without inlining hex", () => {
        setInlineStylesCache({
            ...INLINE_STYLE_EMPTY,
            av: {
                colors: [customColor],
                order: INLINE_STYLE_EMPTY.av.order,
            },
        });
        assert.equal(getAVColorStyle("15"),
            "background-color:var(--b3-font-background15);color:var(--b3-font-color15)");
        assert.equal(getAVBackgroundColor("15"), "var(--b3-font-background15)");
    });

    it("renders multi-digit custom swatches and the management entry", () => {
        const html = getAVColorGridHTML([customColor], "15", "Manage");
        assert.match(html, /type="button" data-color="15" class="color__square color__square--current"/);
        assert.match(html, /data-type="manageAVCustomColors"/);
        assert.match(html, /<svg class="svg--mid"><use xlink:href="#iconSettings"><\/use><\/svg>/);
        assert.match(html, /light-dark\(#ddeeff, #223344\)/);
        assert.match(html, /data-color="14" class="color__square" style="background-color:var\(--b3-font-background14\);color:var\(--b3-font-color14\)"/);
    });

    it("renders mixed order and skips hidden custom colors", () => {
        const hiddenColor: IAVCustomColor = {...customColor, index: 16, hidden: true};
        const html = getAVColorGridHTML([customColor, hiddenColor], "15", "Manage", ["15", "1", "14"]);
        const colors = [...html.matchAll(/data-color="(\d+)"/g)].map(match => match[1]);
        assert.deepEqual(colors.slice(0, 3), ["15", "1", "14"]);
        assert.doesNotMatch(html, /data-color="16"/);
        assert.deepEqual(normalizeAVColorOrder(["15", "1", "15", "99", "14"], [customColor]),
            ["15", "1", "14", ...Array.from({length: 12}, (_, index) => (index + 2).toString())]);
    });
});
