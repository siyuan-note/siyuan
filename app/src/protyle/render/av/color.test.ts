import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {
    getAvailableAVCustomColorIndex,
    getAVBackgroundColor,
    getAVColorGridHTML,
    getAVColorStyle,
    getNextAVOptionColor,
    normalizeAVColorIndex,
} from "./color";

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

describe("AV color indexes", () => {
    it("accepts only bounded decimal indexes", () => {
        assert.equal(normalizeAVColorIndex("15"), 15);
        assert.equal(normalizeAVColorIndex("15suffix"), 14);
        assert.equal(normalizeAVColorIndex(79), 14);
    });

    it("cycles new options through built-in colors", () => {
        assert.equal(getNextAVOptionColor(0), "1");
        assert.equal(getNextAVOptionColor(14), "1");
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

    it("uses numbered variables for built-ins and a neutral fallback for unresolved custom colors", () => {
        assert.equal(getAVColorStyle("13"),
            "background-color:var(--b3-font-background13);color:var(--b3-font-color13)");
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

    it("renders multi-digit custom swatches and the management entry", () => {
        const html = getAVColorGridHTML([customColor], "15", "Manage");
        assert.match(html, /type="button" data-color="15" class="color__square color__square--current"/);
        assert.match(html, /data-type="manageAVCustomColors"/);
        assert.match(html, /<svg class="svg--mid"><use xlink:href="#iconSettings"><\/use><\/svg>/);
        assert.match(html, /light-dark\(#ddeeff, #223344\)/);
    });
});
