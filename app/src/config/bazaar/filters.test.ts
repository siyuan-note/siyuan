import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {filterBazaarPackagesByCompatibility} from "./filters";
import {filterBazaarPackagesByThemeMode} from "./batchRenderer";
import {BAZAAR_PACKAGE_TYPES} from "./packageConfig";

describe("bazaar compatibility filters", () => {
    const packages = [
        {name: "compatible", bazaarVersionUnsupported: false, bazaarIncompatible: false},
        {name: "version", bazaarVersionUnsupported: true, bazaarIncompatible: false},
        {name: "platform", bazaarVersionUnsupported: false, bazaarIncompatible: true},
        {name: "both", bazaarVersionUnsupported: true, bazaarIncompatible: true},
        {name: "unspecified"},
    ];
    const names = (filters: Parameters<typeof filterBazaarPackagesByCompatibility>[1]) =>
        filterBazaarPackagesByCompatibility(packages, filters).map((item) => item.name);

    it("preserves all packages when filters are absent or disabled", () => {
        assert.equal(filterBazaarPackagesByCompatibility(packages), packages);
        assert.equal(filterBazaarPackagesByCompatibility(packages, {}), packages);
        assert.equal(filterBazaarPackagesByCompatibility(packages, {
            hideUnsupportedVersion: false, hideIncompatiblePlatform: false,
        }), packages);
    });

    it("filters version and platform independently, including packages incompatible with both", () => {
        assert.deepEqual(names({hideUnsupportedVersion: true}), ["compatible", "platform", "unspecified"]);
        assert.deepEqual(names({hideIncompatiblePlatform: true}), ["compatible", "version", "unspecified"]);
        assert.deepEqual(names({hideUnsupportedVersion: true, hideIncompatiblePlatform: true}),
            ["compatible", "unspecified"]);
        assert.equal(packages.length, 5);
    });

    it("does not treat installation state, kernel capabilities or deprecation as platform compatibility", () => {
        const otherMetadata = [{disallowInstall: true, installedIncompatible: true, deprecated: true,
            kernels: [] as string[], bazaarIncompatible: false, bazaarVersionUnsupported: false}];
        assert.deepEqual(filterBazaarPackagesByCompatibility(otherMetadata, {
            hideUnsupportedVersion: true, hideIncompatiblePlatform: true,
        }), otherMetadata);
    });

    it("combines with theme modes without changing other package types", () => {
        const themes = [
            {name: "light", modes: ["light"], bazaarVersionUnsupported: true},
            {name: "dark", modes: ["dark"]},
            {name: "both", modes: ["light", "dark"]},
            {name: "unknown"},
        ];
        const compatible = filterBazaarPackagesByCompatibility(themes, {hideUnsupportedVersion: true});
        for (const type of BAZAAR_PACKAGE_TYPES) {
            assert.deepEqual(filterBazaarPackagesByThemeMode(compatible, type, "0").map((item) => item.name),
                type === "themes" ? ["both", "unknown"] : ["dark", "both", "unknown"]);
        }
    });
});
