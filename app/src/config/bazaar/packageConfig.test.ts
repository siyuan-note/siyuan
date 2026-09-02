import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {
    BAZAAR_PACKAGE_CONFIG,
    BAZAAR_PACKAGE_TYPES,
    getBazaarTypeByMyType,
    getBazaarTypeByTab,
    isBazaarPackageType,
} from "./packageConfig";

describe("bazaar package configuration", () => {
    it("defines explicit mappings for every package type", () => {
        assert.deepEqual(BAZAAR_PACKAGE_TYPES.map((type) => BAZAAR_PACKAGE_CONFIG[type].tabType), [
            "plugin", "theme", "icon", "template", "widget",
        ]);
        assert.deepEqual(BAZAAR_PACKAGE_TYPES.map((type) => BAZAAR_PACKAGE_CONFIG[type].myType), [
            "myPlugin", "myTheme", "myIcon", "myTemplate", "myWidget",
        ]);
    });

    it("resolves tab and downloaded tab types without string transformations", () => {
        BAZAAR_PACKAGE_TYPES.forEach((type) => {
            const config = BAZAAR_PACKAGE_CONFIG[type];
            assert.equal(getBazaarTypeByTab(config.tabType), type);
            assert.equal(getBazaarTypeByMyType(config.myType), type);
        });
    });

    it("rejects values that are not package types", () => {
        assert.equal(isBazaarPackageType("plugins"), true);
        assert.equal(isBazaarPackageType("updates"), false);
        assert.equal(getBazaarTypeByTab("downloaded"), undefined);
        assert.equal(getBazaarTypeByMyType("myUpdate"), undefined);
        assert.equal(getBazaarTypeByMyType(undefined), undefined);
    });
});
