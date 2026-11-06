import * as assert from "node:assert/strict";
import {test} from "node:test";
import {loadModule} from "../../testSupport/loadModule";

const bounds = (native: boolean, height: number, viewport?: {offsetTop: number, height: number}) =>
    ({...loadModule<typeof import("./visibleViewport")>("src/mobile/util/visibleViewport.ts", {
        require: () => ({isInMobileApp: () => native}),
        window: {innerHeight: height, visualViewport: viewport},
    }).getVisibleViewportBounds()});

test("mobile browser bounds clamp transient viewport offsets and heights during rotation", () => {
    assert.deepEqual(bounds(false, 325, {offsetTop: 35, height: 340}), {top: 35, bottom: 325});
    assert.deepEqual(bounds(false, 325, {offsetTop: -20, height: 240}), {top: 0, bottom: 220});
    assert.deepEqual(bounds(false, 325, {offsetTop: 400, height: 240}), {top: 325, bottom: 325});
    assert.deepEqual(bounds(false, 325, {offsetTop: 35, height: 0}), {top: 35, bottom: 35});
});

test("native mobile bounds use the resized window and browser fallback uses the whole window", () => {
    assert.deepEqual(bounds(true, 300, {offsetTop: 35, height: 100}), {top: 0, bottom: 300});
    assert.deepEqual(bounds(false, 300), {top: 0, bottom: 300});
});
