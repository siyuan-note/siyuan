const assert = require("node:assert/strict");
const {describe, it} = require("node:test");
const {
    getAppleSiliconDownloadURL,
    shouldDownloadAppleSilicon,
    shouldShowAppleSiliconWarning,
} = require("../electron/appleSilicon");

describe("Apple silicon download URL", () => {
    it("uses the Liuyun mirror for stable releases", () => {
        assert.equal(
            getAppleSiliconDownloadURL("3.7.3"),
            "https://release.liuyun.io/siyuan/siyuan-3.7.3-mac-arm64.dmg",
        );
    });

    it("uses GitHub for prereleases", () => {
        for (const version of ["3.8.0-alpha.1", "3.8.0-beta.3", "3.8.0-rc1"]) {
            assert.equal(
                getAppleSiliconDownloadURL(version),
                `https://github.com/siyuan-note/siyuan/releases/download/v${version}/` +
                `siyuan-${version}-mac-arm64.dmg`,
            );
        }
    });
});

describe("Apple silicon warning detection", () => {
    const productionOptions = {
        isDevelopment: false,
        isPackaged: true,
        platform: "darwin",
        runningUnderARM64Translation: true,
        simulateRosetta: false,
    };

    it("shows for a packaged macOS app running under Rosetta", () => {
        assert.equal(shouldShowAppleSiliconWarning(productionOptions), true);
    });

    it("does not show for native or unsupported production environments", () => {
        assert.equal(shouldShowAppleSiliconWarning({
            ...productionOptions,
            runningUnderARM64Translation: false,
        }), false);
        assert.equal(shouldShowAppleSiliconWarning({...productionOptions, platform: "win32"}), false);
        assert.equal(shouldShowAppleSiliconWarning({...productionOptions, isPackaged: false}), false);
    });

    it("allows simulation only in an unpackaged development environment", () => {
        const simulationOptions = {
            ...productionOptions,
            isDevelopment: true,
            isPackaged: false,
            platform: "win32",
            runningUnderARM64Translation: false,
            simulateRosetta: true,
        };
        assert.equal(shouldShowAppleSiliconWarning(simulationOptions), true);
        assert.equal(shouldShowAppleSiliconWarning({...simulationOptions, simulateRosetta: false}), false);
        assert.equal(shouldShowAppleSiliconWarning({
            ...simulationOptions,
            isDevelopment: false,
        }), false);
        assert.equal(shouldShowAppleSiliconWarning({
            ...simulationOptions,
            isPackaged: true,
        }), false);
    });
});

describe("Apple silicon warning response", () => {
    it("downloads only when the download button is clicked", () => {
        assert.equal(shouldDownloadAppleSilicon(0), true);
        assert.equal(shouldDownloadAppleSilicon(1), false);
        assert.equal(shouldDownloadAppleSilicon(-1), false);
    });
});
