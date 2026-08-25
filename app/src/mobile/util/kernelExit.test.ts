import * as assert from "node:assert/strict";
import {describe, it} from "node:test";
import {handleMobileKernelExit} from "./kernelExit";

describe("mobile kernel exit", () => {
    it("quits the native mobile host", () => {
        let quitCalls = 0;
        let redirectCalls = 0;

        handleMobileKernelExit({
            inMobileApp: true,
            forceQuit: () => quitCalls++,
            redirectBrowser: () => redirectCalls++,
        });

        assert.equal(quitCalls, 1);
        assert.equal(redirectCalls, 0);
    });

    it("redirects a mobile browser", () => {
        let quitCalls = 0;
        let redirectCalls = 0;

        handleMobileKernelExit({
            inMobileApp: false,
            forceQuit: () => quitCalls++,
            redirectBrowser: () => redirectCalls++,
        });

        assert.equal(quitCalls, 0);
        assert.equal(redirectCalls, 1);
    });
});
