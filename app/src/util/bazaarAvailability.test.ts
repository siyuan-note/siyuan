import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {
    isBazaarAvailableForFrontend,
    isBazaarPackageTypeAvailableForFrontend,
} from "./bazaarAvailability";

describe("bazaar frontend availability", () => {
    it("disables the marketplace only for disabled native mobile builds", () => {
        assert.equal(isBazaarAvailableForFrontend("mobile", ["bazaar"]), false);
        assert.equal(isBazaarAvailableForFrontend("mobile", ["ai", "bazaar"]), false);
    });

    it("keeps native mobile builds enabled when the feature is not disabled", () => {
        assert.equal(isBazaarAvailableForFrontend("mobile", undefined), true);
        assert.equal(isBazaarAvailableForFrontend("mobile", []), true);
        assert.equal(isBazaarAvailableForFrontend("mobile", ["ai"]), true);
    });

    it("does not apply native channel restrictions to browser frontends", () => {
        assert.equal(isBazaarAvailableForFrontend("browser-mobile", ["bazaar"]), true);
        assert.equal(isBazaarAvailableForFrontend("browser-desktop", ["bazaar"]), true);
        assert.equal(isBazaarAvailableForFrontend("desktop", ["bazaar"]), true);
        assert.equal(isBazaarAvailableForFrontend("desktop-window", ["bazaar"]), true);
    });

    it("keeps themes out of the first native mobile release", () => {
        assert.equal(isBazaarPackageTypeAvailableForFrontend("themes", "mobile"), false);
        assert.equal(isBazaarPackageTypeAvailableForFrontend("plugins", "mobile"), true);
        assert.equal(isBazaarPackageTypeAvailableForFrontend("icons", "mobile"), true);
        assert.equal(isBazaarPackageTypeAvailableForFrontend("templates", "mobile"), true);
        assert.equal(isBazaarPackageTypeAvailableForFrontend("widgets", "mobile"), true);
    });

    it("keeps themes available through browser and desktop frontends", () => {
        assert.equal(isBazaarPackageTypeAvailableForFrontend("themes", "browser-mobile"), true);
        assert.equal(isBazaarPackageTypeAvailableForFrontend("themes", "browser-desktop"), true);
        assert.equal(isBazaarPackageTypeAvailableForFrontend("themes", "desktop"), true);
    });
});
