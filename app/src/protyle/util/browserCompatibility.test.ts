import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {isIOSPlatform, isIPadOSPlatform, type TBrowserNavigator} from "./browserCompatibility";

const browserNavigator = (
    userAgent: string,
    platform = "",
    maxTouchPoints = 0,
): TBrowserNavigator => ({userAgent, platform, maxTouchPoints});

describe("iOS browser detection", () => {
    it("detects iPhone browsers independently of the browser brand", () => {
        assert.equal(isIOSPlatform(browserNavigator(
            "Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 " +
            "(KHTML, like Gecko) Version/17.6 Mobile/15E148 Safari/604.1",
            "iPhone",
            5,
        )), true);
        assert.equal(isIOSPlatform(browserNavigator(
            "Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 " +
            "(KHTML, like Gecko) CriOS/128.0.6613.69 Mobile/15E148 Safari/604.1",
            "iPhone",
            5,
        )), true);
    });

    it("detects iPad and iPod user agents", () => {
        assert.equal(isIOSPlatform(browserNavigator(
            "Mozilla/5.0 (iPad; CPU OS 17_6 like Mac OS X) AppleWebKit/605.1.15 " +
            "(KHTML, like Gecko) CriOS/128.0.6613.69 Mobile/15E148 Safari/604.1",
            "iPad",
            5,
        )), true);
        assert.equal(isIOSPlatform(browserNavigator(
            "Mozilla/5.0 (iPod touch; CPU iPhone OS 15_7 like Mac OS X) AppleWebKit/605.1.15 " +
            "(KHTML, like Gecko) Version/15.6 Mobile/15E148 Safari/604.1",
            "iPod",
            5,
        )), true);
    });

    it("detects iPadOS when it uses a desktop user agent", () => {
        const iPadOSNavigator = browserNavigator(
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 " +
            "(KHTML, like Gecko) Version/17.6 Mobile/15E148 Safari/604.1",
            "MacIntel",
            5,
        );
        assert.equal(isIPadOSPlatform(iPadOSNavigator), true);
        assert.equal(isIOSPlatform(iPadOSNavigator), true);
    });

    it("does not classify desktop or Android browsers as iOS", () => {
        assert.equal(isIOSPlatform(browserNavigator(
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 " +
            "(KHTML, like Gecko) Version/17.6 Safari/605.1.15",
            "MacIntel",
            0,
        )), false);
        assert.equal(isIOSPlatform(browserNavigator(
            "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 " +
            "(KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36",
            "Linux armv8l",
            5,
        )), false);
    });
});
