import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {
    getBazaarBackendSystemLabels,
    getBazaarCompatibilityData,
    getBazaarCompatibilityFieldVisibility,
    getBazaarFundingItems,
    getBazaarKernelSystemLabels,
    getBazaarThemeModeLabels,
    isValidBazaarPackageName,
} from "./bazaarPackage";

describe("getBazaarCompatibilityData", () => {
    const installed = {source: "installed"};
    const available = {source: "available"};
    const fallback = {source: "fallback"};

    it("uses installed metadata for downloaded packages", () => {
        assert.equal(getBazaarCompatibilityData("downloaded", installed, available, fallback), installed);
    });

    it("uses available metadata for update and marketplace packages", () => {
        assert.equal(getBazaarCompatibilityData("updated", installed, available, fallback), available);
        assert.equal(getBazaarCompatibilityData("bazaar", installed, available, fallback), available);
    });

    it("falls back without changing the selected source semantics", () => {
        assert.equal(getBazaarCompatibilityData("downloaded", undefined, available, fallback), fallback);
        assert.equal(getBazaarCompatibilityData("updated", installed, undefined, fallback), installed);
        assert.equal(getBazaarCompatibilityData("bazaar", undefined, undefined, fallback), fallback);
    });
});

describe("getBazaarCompatibilityFieldVisibility", () => {
    it("shows shared and dedicated compatibility fields for each package type", () => {
        assert.deepEqual(getBazaarCompatibilityFieldVisibility("plugins"), {
            frontends: true,
            systems: true,
            kernelSystems: true,
            disabledInPublish: true,
            modes: false,
        });
        assert.deepEqual(getBazaarCompatibilityFieldVisibility("themes"), {
            frontends: true,
            systems: false,
            kernelSystems: false,
            disabledInPublish: false,
            modes: true,
        });
        ["icons", "templates", "widgets"].forEach((packageType) => {
            assert.deepEqual(getBazaarCompatibilityFieldVisibility(packageType), {
                frontends: false,
                systems: false,
                kernelSystems: false,
                disabledInPublish: false,
                modes: false,
            });
        });
    });
});

describe("bazaar system labels", () => {
    it("treats missing backends as all systems", () => {
        assert.deepEqual(getBazaarBackendSystemLabels([], "All"), ["All"]);
        assert.deepEqual(getBazaarBackendSystemLabels(undefined, "All"), ["All"]);
    });

    it("hides kernel systems when no kernel plugin is declared", () => {
        assert.deepEqual(getBazaarKernelSystemLabels([], "All"), []);
        assert.deepEqual(getBazaarKernelSystemLabels(undefined, "All"), []);
    });

    it("normalizes backend and kernel systems independently", () => {
        assert.deepEqual(
            getBazaarBackendSystemLabels(["windows", "linux", "windows", "custom"], "All"),
            ["Windows", "Linux", "custom"],
        );
        assert.deepEqual(getBazaarKernelSystemLabels(["docker"], "All"), ["Docker"]);
    });

    it("treats all as unrestricted for each declared field", () => {
        assert.deepEqual(getBazaarBackendSystemLabels(["all"], "All"), ["All"]);
        assert.deepEqual(getBazaarKernelSystemLabels(["all"], "All"), ["All"]);
    });
});

describe("getBazaarThemeModeLabels", () => {
    it("localizes known modes and preserves unknown modes", () => {
        assert.deepEqual(
            getBazaarThemeModeLabels(["light", "dark", "green"], "Light", "Dark"),
            ["Light", "Dark", "green"],
        );
    });

    it("removes duplicate and empty modes", () => {
        assert.deepEqual(getBazaarThemeModeLabels(["dark", "", "dark"], "Light", "Dark"), ["Dark"]);
        assert.deepEqual(getBazaarThemeModeLabels(undefined, "Light", "Dark"), []);
    });
});

describe("getBazaarFundingItems", () => {
    it("normalizes platform values and preserves custom item order", () => {
        assert.deepEqual(getBazaarFundingItems({
            openCollective: "collective",
            patreon: "https://example.com/patreon",
            github: "sponsor",
            custom: ["custom text", "https://example.com/custom", "custom text"],
        }), [
            "https://opencollective.com/collective",
            "https://example.com/patreon",
            "https://github.com/sponsors/sponsor",
            "custom text",
            "https://example.com/custom",
            "custom text",
        ]);
    });

    it("removes empty values without discarding later custom items", () => {
        assert.deepEqual(getBazaarFundingItems({custom: ["", "https://example.com"]}), ["https://example.com"]);
        assert.deepEqual(getBazaarFundingItems(undefined), []);
    });
});

describe("isValidBazaarPackageName", () => {
    it("accepts valid package names", () => {
        assert.equal(isValidBazaarPackageName("plugin-sample"), true);
        assert.equal(isValidBazaarPackageName("plugin.sample_1"), true);
        assert.equal(isValidBazaarPackageName("plugin sample (v1) + beta!"), true);
        assert.equal(isValidBazaarPackageName("a".repeat(255)), true);
    });

    it("rejects invalid package names", () => {
        assert.equal(isValidBazaarPackageName(""), false);
        assert.equal(isValidBazaarPackageName("a".repeat(256)), false);
        assert.equal(isValidBazaarPackageName(".hidden"), false);
        assert.equal(isValidBazaarPackageName(" leading-space"), false);
        assert.equal(isValidBazaarPackageName("trailing-space "), false);
        assert.equal(isValidBazaarPackageName("trailing-period."), false);
        assert.equal(isValidBazaarPackageName("plugin/sample"), false);
        assert.equal(isValidBazaarPackageName("插件"), false);
    });

    it("rejects Windows reserved device names", () => {
        assert.equal(isValidBazaarPackageName("CON"), false);
        assert.equal(isValidBazaarPackageName("com1"), false);
        assert.equal(isValidBazaarPackageName("LPT9"), false);
        assert.equal(isValidBazaarPackageName("CON.123"), true);
    });

    it("rejects decoded HTML payloads", () => {
        const payload = decodeURIComponent("%3Cimg%20src%3Dx%20onerror%3D%22require(%27child_process%27)%22%3E");
        assert.equal(isValidBazaarPackageName(payload), false);
    });
});
