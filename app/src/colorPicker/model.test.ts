import * as assert from "node:assert/strict";
import test from "node:test";
import {parseColor, parseRGBText} from "./model";
import {ColorSession} from "./session";

test("sRGB colors normalize equivalent HEX and integer RGB without clamping or CSS parsing", () => {
    for (const input of ["abc", " #AbC ", "#AABBCC", {r: 170, g: 187, b: 204}]) {
        assert.deepEqual(parseColor(input), {hex: "#aabbcc", rgb: {r: 170, g: 187, b: 204}});
    }
    for (const input of ["", "#", "#ab", "#abcd", "#12345678", "red", "rgb(0,0,0)", "#gggggg",
        {r: -1, g: 0, b: 0}, {r: 256, g: 0, b: 0}, {r: NaN, g: 0, b: 0},
        {r: Infinity, g: 0, b: 0}, {r: 1.5, g: 0, b: 0}]) {
        assert.equal(parseColor(input), undefined);
    }
    assert.equal(parseRGBText([" 000 ", "255", "001"]).hex, "#00ff01");
    for (const red of ["", " ", "-1", "+1", "1.0", "1e2", "256", "Infinity", "NaN"]) {
        assert.equal(parseRGBText([red, "0", "0"]), undefined);
    }
});

test("color sessions preserve the baseline, deduplicate bytes and terminate exactly once", () => {
    const session = new ColorSession("#AbC");
    assert.equal(session.update("aabbcc"), false);
    assert.equal(session.update("#"), false);
    assert.equal(session.value.hex, "#aabbcc");
    assert.equal(session.update({r: 0, g: 0, b: 0}), true);
    assert.deepEqual(session.finish(), {type: "confirm", changed: true, value: parseColor("#000")});
    assert.equal(session.update("#fff"), false);
    assert.equal(session.finish("cancel"), undefined);
    const unchanged = new ColorSession("#fff");
    unchanged.update("#000"); unchanged.update("#FFFFFF");
    assert.deepEqual(unchanged.finish(), {type: "confirm", changed: false, value: parseColor("#fff")});
    assert.throws(() => new ColorSession("bad color"), TypeError);
});
