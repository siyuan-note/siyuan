import {test} from "node:test";
import * as assert from "node:assert/strict";
import {bindMobileOrientationChange, isMobileLandscape} from "./orientation";

const createBrowser = (type = "portrait-primary") => {
    const orientation = Object.assign(new EventTarget(), {type, angle: 0});
    const target = Object.assign(new EventTarget(), {
        screen: {orientation, width: 800, height: 1200},
        navigator: {platform: "Linux armv8l", userAgent: "Android", maxTouchPoints: 5},
        orientation: 0,
        innerWidth: 800,
        innerHeight: 1200,
    });
    return {target, browser: target as unknown as typeof window};
};

test("screen orientation stays portrait across keyboard and split-pane viewport resizing", () => {
    const {target, browser} = createBrowser();
    for (const [width, height] of [[800, 1200], [800, 450], [400, 300], [800, 1200]]) {
        target.innerWidth = width;
        target.innerHeight = height;
        assert.equal(isMobileLandscape(browser), false);
    }
    target.screen.orientation.type = "landscape-primary";
    target.innerWidth = 400;
    target.innerHeight = 1000;
    assert.equal(isMobileLandscape(browser), true);
});

test("orientation type takes precedence on naturally landscape devices", () => {
    const {target, browser} = createBrowser("landscape-primary");
    assert.equal(isMobileLandscape(browser), true);
    target.screen.orientation.type = "portrait-primary";
    target.screen.orientation.angle = 90;
    target.orientation = 90;
    assert.equal(isMobileLandscape(browser), false);
    target.screen.orientation.type = "landscape-secondary";
    assert.equal(isMobileLandscape(browser), true);
    target.screen.orientation.type = "portrait-secondary";
    assert.equal(isMobileLandscape(browser), false);
});

test("legacy iOS orientation handles phones and desktop-mode iPads", () => {
    for (const navigator of [
        {platform: "iPhone", userAgent: "iPhone", maxTouchPoints: 5},
        {platform: "MacIntel", userAgent: "Macintosh", maxTouchPoints: 5},
    ]) {
        const {target, browser} = createBrowser("");
        target.navigator = navigator;
        for (const angle of [0, 90, -90, 180]) {
            target.orientation = angle;
            assert.equal(isMobileLandscape(browser), Math.abs(angle) === 90);
        }
    }
});

test("non-iOS fallback uses stable screen dimensions, not legacy angles or viewport heights", () => {
    const {target, browser} = createBrowser("");
    Reflect.deleteProperty(target.screen, "orientation");
    target.orientation = 90;
    target.innerHeight = 450;
    assert.equal(isMobileLandscape(browser), false);
    target.screen.width = 1200;
    target.screen.height = 800;
    target.orientation = 0;
    assert.equal(isMobileLandscape(browser), true);
});

test("keyboard-only resize does not trigger rotation effects and real rotation is deduplicated", () => {
    const {target, browser} = createBrowser();
    let calls = 0;
    const dispose = bindMobileOrientationChange(() => calls++, browser);
    for (const height of [450, 1200, 450]) {
        target.innerHeight = height;
        target.dispatchEvent(new Event("resize"));
    }
    assert.equal(calls, 0);
    target.screen.orientation.type = "portrait-secondary";
    target.screen.orientation.dispatchEvent(new Event("change"));
    assert.equal(calls, 0);
    target.screen.orientation.type = "landscape-primary";
    target.screen.orientation.dispatchEvent(new Event("change"));
    target.dispatchEvent(new Event("orientationchange"));
    target.dispatchEvent(new Event("resize"));
    assert.equal(calls, 1);
    target.screen.orientation.type = "landscape-secondary";
    target.screen.orientation.dispatchEvent(new Event("change"));
    assert.equal(calls, 1);
    target.screen.orientation.type = "portrait-secondary";
    target.dispatchEvent(new Event("resize"));
    target.screen.orientation.dispatchEvent(new Event("change"));
    assert.equal(calls, 2);
    dispose();
    target.screen.orientation.type = "landscape-secondary";
    target.screen.orientation.dispatchEvent(new Event("change"));
    target.dispatchEvent(new Event("orientationchange"));
    target.dispatchEvent(new Event("resize"));
    assert.equal(calls, 2);
});

test("legacy and screen-dimension fallback rotation events remain supported", () => {
    const {target, browser} = createBrowser("");
    Reflect.deleteProperty(target.screen, "orientation");
    target.navigator.userAgent = "iPad";
    let calls = 0;
    const dispose = bindMobileOrientationChange(() => calls++, browser);
    target.orientation = 90;
    target.dispatchEvent(new Event("orientationchange"));
    target.dispatchEvent(new Event("resize"));
    assert.equal(calls, 1);
    target.navigator.userAgent = "Android";
    target.dispatchEvent(new Event("resize"));
    assert.equal(calls, 2);
    target.screen.width = 1200;
    target.screen.height = 800;
    target.dispatchEvent(new Event("resize"));
    assert.equal(calls, 3);
    dispose();
});
