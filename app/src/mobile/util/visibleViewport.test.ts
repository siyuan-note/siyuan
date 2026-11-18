import * as assert from "node:assert/strict";
import {test} from "node:test";
import {loadModule} from "../../testSupport/loadModule";

const bounds = (platform: "browser" | "iOS" | "Android" | "Harmony", height: number, viewport?: {offsetTop: number, height: number}) =>
    ({...loadModule<typeof import("./visibleViewport")>("src/mobile/util/visibleViewport.ts", {
        require: () => ({isInMobileApp: () => platform !== "browser", isIOSDevice: () => platform === "iOS"}),
        window: {innerHeight: height, visualViewport: viewport},
    }).getVisibleViewportBounds()});

test("mobile browser bounds clamp transient viewport offsets and heights during rotation", () => {
    assert.deepEqual(bounds("browser", 325, {offsetTop: 35, height: 340}), {top: 35, bottom: 325});
    assert.deepEqual(bounds("browser", 325, {offsetTop: -20, height: 240}), {top: 0, bottom: 220});
    assert.deepEqual(bounds("browser", 325, {offsetTop: 400, height: 240}), {top: 325, bottom: 325});
    assert.deepEqual(bounds("browser", 325, {offsetTop: 35, height: 0}), {top: 35, bottom: 35});
});

test("iOS WebView bounds follow keyboard insets and a resized layout viewport", () => {
    assert.deepEqual(bounds("iOS", 812, {offsetTop: 0, height: 483}), {top: 0, bottom: 483});
    assert.deepEqual(bounds("iOS", 812, {offsetTop: 25, height: 483}), {top: 25, bottom: 508});
    assert.deepEqual(bounds("iOS", 483, {offsetTop: 0, height: 483}), {top: 0, bottom: 483});
    assert.deepEqual(bounds("iOS", 812, {offsetTop: 0, height: 812}), {top: 0, bottom: 812});
});

test("Android and Harmony native bounds use the resized window and missing visual viewports fall back to it", () => {
    for (const platform of ["Android", "Harmony"] as const) {
        assert.deepEqual(bounds(platform, 300, {offsetTop: 35, height: 100}), {top: 0, bottom: 300});
    }
    assert.deepEqual(bounds("browser", 300), {top: 0, bottom: 300});
    assert.deepEqual(bounds("iOS", 300), {top: 0, bottom: 300});
});
