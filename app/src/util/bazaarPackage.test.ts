import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {
    applyBazaarPackageDeprecation,
    applyBazaarPackageRatingToItem,
    beginBazaarRatingSubmission,
    beginBazaarRatingRequest,
    getBazaarBackendSystemLabels,
    getBazaarCompatibilityData,
    getBazaarCompatibilityFieldVisibility,
    getBazaarDeprecationData,
    getBazaarFundingItems,
    getBazaarKernelSystemLabels,
    getBazaarPackageInvalidLanguageKey,
    getBazaarRatingErrorLanguageKey,
    getBazaarRatingMutationVersion,
    getBazaarThemeModeLabels,
    isBazaarPackageEnableDisabled,
    isBazaarPackageRatingEditable,
    isBazaarPackageRatingLoaded,
    isBazaarPluginEnabledInPublish,
    isBazaarRatingRemovalAvailable,
    isLatestBazaarRatingRequest,
    isBazaarRatingMutationVersionCurrent,
    isValidBazaarPackageName,
    normalizeBazaarPackageRatingResponse,
    normalizeBazaarPackageRatingsResponse,
    normalizeBazaarPackageUserRatingsResponse,
    normalizeBazaarRating,
    normalizeBazaarUserRating,
    sortBazaarPackagesByRating,
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

describe("bazaar package deprecation metadata", () => {
    it("prefers online metadata for every detail source", () => {
        const installed = {name: "installed"};
        const available = {name: "available"};
        const fallback = {name: "fallback"};
        assert.equal(getBazaarDeprecationData(installed, available, fallback), available);
        assert.equal(getBazaarDeprecationData(installed, undefined, fallback), installed);
        assert.equal(getBazaarDeprecationData(undefined, undefined, fallback), fallback);
    });

    it("copies online deprecation fields onto an installed package", () => {
        const installed: {
            deprecated?: boolean;
            deprecatedReason?: Record<string, string>;
            preferredDeprecatedReason?: string;
            alternatives?: string[];
        } = {};
        const deprecatedReason = {default: "No longer maintained"};
        const alternatives = ["replacement"];
        applyBazaarPackageDeprecation(installed, {
            deprecated: true,
            deprecatedReason,
            preferredDeprecatedReason: "No longer maintained",
            alternatives,
        });
        assert.equal(installed.deprecated, true);
        assert.deepEqual(installed.deprecatedReason, deprecatedReason);
        assert.notEqual(installed.deprecatedReason, deprecatedReason);
        assert.equal(installed.preferredDeprecatedReason, "No longer maintained");
        assert.deepEqual(installed.alternatives, alternatives);
        assert.notEqual(installed.alternatives, alternatives);
    });

    it("clears stale fields when the online package is active or missing", () => {
        const installed = {
            deprecated: true as boolean | undefined,
            deprecatedReason: {default: "Stale"} as Record<string, string> | undefined,
            preferredDeprecatedReason: "Stale" as string | undefined,
            alternatives: ["stale"] as string[] | undefined,
        };
        applyBazaarPackageDeprecation(installed, {deprecated: false});
        assert.equal(installed.deprecated, undefined);
        assert.equal(installed.deprecatedReason, undefined);
        assert.equal(installed.preferredDeprecatedReason, undefined);
        assert.equal(installed.alternatives, undefined);
    });
});

describe("getBazaarPackageInvalidLanguageKey", () => {
    it("maps installed package failures to localized message keys", () => {
        assert.equal(getBazaarPackageInvalidLanguageKey("missing-manifest"), "bazaarPackageMissingManifest");
        assert.equal(getBazaarPackageInvalidLanguageKey("invalid-manifest"), "bazaarPackageInvalidManifest");
        assert.equal(getBazaarPackageInvalidLanguageKey("name-mismatch"), "bazaarPackageNameMismatch");
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

describe("isBazaarPackageEnableDisabled", () => {
    it("disables enabling incompatible plugins and themes", () => {
        assert.equal(isBazaarPackageEnableDisabled("plugins", {installedIncompatible: true, enabled: false}), true);
        assert.equal(isBazaarPackageEnableDisabled("themes", {installedIncompatible: true, current: false}), true);
    });

    it("disables packages that require a newer app version", () => {
        assert.equal(isBazaarPackageEnableDisabled("plugins", {disallowInstall: true, enabled: false}), true);
        assert.equal(isBazaarPackageEnableDisabled("themes", {disallowInstall: true, current: false}), true);
    });

    it("keeps disabling an active incompatible package available", () => {
        assert.equal(isBazaarPackageEnableDisabled("plugins", {installedIncompatible: true, enabled: true}), false);
        assert.equal(isBazaarPackageEnableDisabled("themes", {installedIncompatible: true, current: true}), false);
        assert.equal(isBazaarPackageEnableDisabled("plugins", {disallowInstall: true, enabled: true}), false);
        assert.equal(isBazaarPackageEnableDisabled("themes", {disallowInstall: true, current: true}), false);
    });

    it("does not disable compatible or unsupported package types", () => {
        assert.equal(isBazaarPackageEnableDisabled("plugins", {installedIncompatible: false, enabled: false}), false);
        assert.equal(isBazaarPackageEnableDisabled("icons", {installedIncompatible: true, current: false}), false);
    });
});

describe("isBazaarPluginEnabledInPublish", () => {
    it("requires both the plugin author and the user to allow publishing", () => {
        assert.equal(isBazaarPluginEnabledInPublish({}), true);
        assert.equal(isBazaarPluginEnabledInPublish({disabledInPublish: true}), false);
        assert.equal(isBazaarPluginEnabledInPublish({userDisabledInPublish: true}), false);
        assert.equal(isBazaarPluginEnabledInPublish({
            disabledInPublish: true,
            userDisabledInPublish: true,
        }), false);
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

describe("normalizeBazaarRating", () => {
    it("normalizes a valid rating distribution", () => {
        assert.deepEqual(normalizeBazaarRating({
            average: 4.5,
            count: 6,
            distribution: [0, 0, 1, 1, 4],
        }), {
            average: 4.5,
            count: 6,
            distribution: [0, 0, 1, 1, 4],
        });
    });

    it("rejects invalid averages and inconsistent distributions", () => {
        assert.equal(normalizeBazaarRating({average: 0, count: 0}), undefined);
        assert.equal(normalizeBazaarRating({average: Number.NaN, count: 1}), undefined);
        assert.equal(normalizeBazaarRating({average: 6, count: 1}), undefined);
        assert.equal(normalizeBazaarRating({
            average: 3,
            count: 1,
            distribution: [-1, Number.NaN, 1] as unknown as TBazaarRatingDistribution,
        }), undefined);
        assert.equal(normalizeBazaarRating({
            average: 4,
            count: 2,
            distribution: [0, 0, 0, 1, 0],
        }), undefined);
        assert.equal(normalizeBazaarRating({
            average: 3,
            count: 2,
            distribution: [0, 0, 0, 2, 0],
        }), undefined);
    });
});

describe("normalizeBazaarPackageRatingResponse", () => {
    it("keeps unavailable public ratings hidden", () => {
        assert.deepEqual(normalizeBazaarPackageRatingResponse(undefined), {loaded: false});
        assert.deepEqual(normalizeBazaarPackageRatingResponse({ratingAvailable: false}), {loaded: false});
    });

    it("distinguishes an available zero-rating package from unavailable ratings", () => {
        assert.deepEqual(normalizeBazaarPackageRatingResponse({ratingAvailable: true}), {loaded: true});
    });

    it("accepts a valid public rating only when the public index is available", () => {
        const rating: IBazaarRating = {average: 4.5, count: 2, distribution: [0, 0, 0, 1, 1]};
        assert.deepEqual(normalizeBazaarPackageRatingResponse({ratingAvailable: true, rating}), {
            loaded: true,
            rating,
        });
        assert.deepEqual(normalizeBazaarPackageRatingResponse({ratingAvailable: false, rating}), {loaded: false});
    });

    it("rejects malformed public ratings even when marked available", () => {
        assert.deepEqual(normalizeBazaarPackageRatingResponse({
            ratingAvailable: true,
            rating: {average: 5, count: 2, distribution: [0, 0, 0, 0, 1]},
        }), {loaded: false});
    });
});

describe("normalizeBazaarPackageRatingsResponse", () => {
    it("loads only eligible installed packages and preserves official zero ratings", () => {
        const rating: IBazaarRating = {average: 5, count: 1, distribution: [0, 0, 0, 0, 1]};
        assert.deepEqual(normalizeBazaarPackageRatingsResponse(["rated", "zero", "local"], {
            eligiblePackageNames: ["rated", "zero"],
            ratings: {rated: rating},
        }), new Map([
            ["rated", {ratingAvailable: true, rating}],
            ["zero", {ratingAvailable: true}],
            ["local", {ratingAvailable: false}],
        ]));
    });

    it("ignores eligibility entries outside the current request", () => {
        assert.deepEqual(normalizeBazaarPackageRatingsResponse(["requested"], {
            eligiblePackageNames: ["requested", "extra"],
            ratings: {},
        }), new Map([["requested", {ratingAvailable: true}]]));
    });

    it("rejects malformed batch responses and malformed eligible ratings", () => {
        assert.equal(normalizeBazaarPackageRatingsResponse(["package"], {
            eligiblePackageNames: undefined,
            ratings: {},
        }), undefined);
        assert.equal(normalizeBazaarPackageRatingsResponse(["package"], {
            eligiblePackageNames: ["package", 1],
            ratings: {},
        }), undefined);
        assert.equal(normalizeBazaarPackageRatingsResponse(["package"], {
            eligiblePackageNames: ["package"],
            ratings: [],
        }), undefined);
        assert.deepEqual(normalizeBazaarPackageRatingsResponse(["package"], {
            eligiblePackageNames: ["package"],
            ratings: {package: {average: 5, count: 2, distribution: [0, 0, 0, 0, 1]}},
        }), new Map([["package", {ratingAvailable: false}]]));
    });
});

describe("normalizeBazaarPackageUserRatingsResponse", () => {
    it("preserves rated and explicitly unrated official packages", () => {
        assert.deepEqual(normalizeBazaarPackageUserRatingsResponse(["rated", "unrated", "local"], {
            eligiblePackageNames: ["rated", "unrated"],
            userRatings: {rated: 4, unrated: 0},
        }), new Map([
            ["rated", 4],
            ["unrated", 0],
        ]));
    });

    it("rejects incomplete, unexpected, and malformed user ratings", () => {
        assert.equal(normalizeBazaarPackageUserRatingsResponse(["rated", "unrated"], {
            eligiblePackageNames: ["rated", "unrated"],
            userRatings: {rated: 4},
        }), undefined);
        assert.equal(normalizeBazaarPackageUserRatingsResponse(["rated"], {
            eligiblePackageNames: ["rated"],
            userRatings: {rated: 4, extra: 0},
        }), undefined);
        assert.equal(normalizeBazaarPackageUserRatingsResponse(["rated"], {
            eligiblePackageNames: ["rated"],
            userRatings: {rated: 6},
        }), undefined);
        assert.equal(normalizeBazaarPackageUserRatingsResponse(["rated"], {
            eligiblePackageNames: ["rated", "extra"],
            userRatings: {rated: 4, extra: 0},
        }), undefined);
    });
});

describe("normalizeBazaarUserRating", () => {
    it("accepts removal and star rating values", () => {
        assert.equal(normalizeBazaarUserRating(0), 0);
        assert.equal(normalizeBazaarUserRating(1), 1);
        assert.equal(normalizeBazaarUserRating(5), 5);
    });

    it("rejects values outside the rating protocol", () => {
        assert.equal(normalizeBazaarUserRating(-1), undefined);
        assert.equal(normalizeBazaarUserRating(2.5), undefined);
        assert.equal(normalizeBazaarUserRating(6), undefined);
        assert.equal(normalizeBazaarUserRating("0"), undefined);
    });
});

describe("isBazaarRatingRemovalAvailable", () => {
    it("shows removal only for an existing star rating", () => {
        assert.equal(isBazaarRatingRemovalAvailable(0), false);
        assert.equal(isBazaarRatingRemovalAvailable(1), true);
        assert.equal(isBazaarRatingRemovalAvailable(5), true);
        assert.equal(isBazaarRatingRemovalAvailable(undefined), false);
    });
});

describe("applyBazaarPackageRatingToItem", () => {
    it("propagates public availability with a rating", () => {
        const item = {
            name: "package",
            ratingAvailable: false,
        } as {name: string, ratingAvailable: boolean, rating?: IBazaarRating};
        const rating: IBazaarRating = {average: 5, count: 1, distribution: [0, 0, 0, 0, 1]};
        assert.equal(applyBazaarPackageRatingToItem(item, "package", rating), true);
        assert.deepEqual(item, {name: "package", ratingAvailable: true, rating});
    });

    it("propagates public availability and clears stale data for a zero-rating package", () => {
        const item = {
            name: "package",
            ratingAvailable: false,
            rating: {average: 5, count: 1, distribution: [0, 0, 0, 0, 1]} as IBazaarRating,
        };
        assert.equal(applyBazaarPackageRatingToItem(item, "package"), true);
        assert.deepEqual(item, {name: "package", ratingAvailable: true});
    });

    it("does not update a different package", () => {
        const item = {name: "other", ratingAvailable: false};
        assert.equal(applyBazaarPackageRatingToItem(item, "package"), false);
        assert.deepEqual(item, {name: "other", ratingAvailable: false});
    });
});

describe("sortBazaarPackagesByRating", () => {
    const packages = [
        {name: "unrated", updated: "20260101"},
        {name: "few", updated: "20260104", ratingAvailable: true, rating: {average: 4.5, count: 2, distribution: [0, 0, 0, 1, 1]}},
        {name: "many-old", updated: "20260102", ratingAvailable: true, rating: {average: 4.5, count: 10, distribution: [0, 0, 0, 5, 5]}},
        {name: "many-new", updated: "20260103", ratingAvailable: true, rating: {average: 4.5, count: 10, distribution: [0, 0, 0, 5, 5]}},
        {name: "low", updated: "20260105", ratingAvailable: true, rating: {average: 2, count: 100, distribution: [0, 100, 0, 0, 0]}},
    ] as Array<{name: string, updated: string, ratingAvailable?: boolean, rating?: IBazaarRating}>;

    it("sorts descending with count and update-time tie breakers", () => {
        assert.deepEqual(sortBazaarPackagesByRating(packages, true).map((item) => item.name), [
            "many-new", "many-old", "few", "low", "unrated",
        ]);
    });

    it("sorts ascending while keeping unrated packages last", () => {
        assert.deepEqual(sortBazaarPackagesByRating(packages, false).map((item) => item.name), [
            "low", "many-new", "many-old", "few", "unrated",
        ]);
    });

    it("preserves the original order when all rating tie breakers match", () => {
        const tied = [
            {name: "first", updated: "20260101", ratingAvailable: true, rating: {average: 5, count: 1, distribution: [0, 0, 0, 0, 1]}},
            {name: "second", updated: "20260101", ratingAvailable: true, rating: {average: 5, count: 1, distribution: [0, 0, 0, 0, 1]}},
        ] as Array<{name: string, updated: string, ratingAvailable: boolean, rating: IBazaarRating}>;
        assert.deepEqual(sortBazaarPackagesByRating(tied, true).map((item) => item.name), ["first", "second"]);
    });

    it("treats ratings without an available public index as unrated", () => {
        const unavailable = [
            {name: "available", ratingAvailable: true, rating: {average: 1, count: 1, distribution: [1, 0, 0, 0, 0]}},
            {name: "unavailable", ratingAvailable: false, rating: {average: 5, count: 1, distribution: [0, 0, 0, 0, 1]}},
            {name: "missing-flag", rating: {average: 5, count: 1, distribution: [0, 0, 0, 0, 1]}},
        ] as Array<{name: string, ratingAvailable?: boolean, rating?: IBazaarRating}>;
        assert.deepEqual(sortBazaarPackagesByRating(unavailable, true).map((item) => item.name), [
            "available", "unavailable", "missing-flag",
        ]);
    });
});

describe("isBazaarPackageRatingLoaded", () => {
    it("exposes online ratings only when both public indexes are available", () => {
        assert.equal(isBazaarPackageRatingLoaded("bazaar", false, true), true);
        assert.equal(isBazaarPackageRatingLoaded("bazaar", true, false), false);
        assert.equal(isBazaarPackageRatingLoaded("bazaar", true), false);
    });

    it("waits for an explicit successful load for installed and update packages", () => {
        assert.equal(isBazaarPackageRatingLoaded("downloaded", false, true), false);
        assert.equal(isBazaarPackageRatingLoaded("updated", false, true), false);
        assert.equal(isBazaarPackageRatingLoaded("downloaded", true, false), true);
        assert.equal(isBazaarPackageRatingLoaded("updated", true, false), true);
    });
});

describe("isBazaarPackageRatingEditable", () => {
    it("allows installed packages from every detail source", () => {
        assert.equal(isBazaarPackageRatingEditable("downloaded", true), true);
        assert.equal(isBazaarPackageRatingEditable("updated", true), true);
        assert.equal(isBazaarPackageRatingEditable("bazaar", true), true);
    });

    it("rejects uninstalled online packages and missing sources", () => {
        assert.equal(isBazaarPackageRatingEditable("bazaar", false), false);
        assert.equal(isBazaarPackageRatingEditable(undefined, true), false);
        assert.equal(isBazaarPackageRatingEditable("unknown", true), false);
    });
});

describe("bazaar rating mutation ordering", () => {
    it("rejects a batch snapshot captured before a rating mutation", () => {
        const versions = new Map<string, number>();
        const key = "plugins:package";
        const capturedVersion = getBazaarRatingMutationVersion(versions, key);
        beginBazaarRatingRequest(versions, key);
        assert.equal(isBazaarRatingMutationVersionCurrent(versions, key, capturedVersion), false);
    });

    it("keeps unrelated package snapshots current", () => {
        const versions = new Map<string, number>();
        const firstVersion = getBazaarRatingMutationVersion(versions, "plugins:first");
        const secondVersion = getBazaarRatingMutationVersion(versions, "plugins:second");
        beginBazaarRatingRequest(versions, "plugins:first");
        assert.equal(isBazaarRatingMutationVersionCurrent(versions, "plugins:first", firstVersion), false);
        assert.equal(isBazaarRatingMutationVersionCurrent(versions, "plugins:second", secondVersion), true);
    });
});

describe("bazaar rating submission lock", () => {
    it("allows only one in-flight submission for the same user and package", () => {
        const submittingKeys = new Set<string>();
        const key = "user|plugins:package";
        assert.equal(beginBazaarRatingSubmission(submittingKeys, key), true);
        assert.equal(beginBazaarRatingSubmission(submittingKeys, key), false);
        submittingKeys.delete(key);
        assert.equal(beginBazaarRatingSubmission(submittingKeys, key), true);
    });
});

describe("bazaar rating request ordering", () => {
    it("accepts only the latest request for the same user and package", () => {
        const requestIDs = new Map<string, number>();
        const first = beginBazaarRatingRequest(requestIDs, "user|plugins:package");
        const second = beginBazaarRatingRequest(requestIDs, "user|plugins:package");
        assert.equal(isLatestBazaarRatingRequest(requestIDs, "user|plugins:package", first), false);
        assert.equal(isLatestBazaarRatingRequest(requestIDs, "user|plugins:package", second), true);
    });

    it("tracks different users and packages independently", () => {
        const requestIDs = new Map<string, number>();
        const firstPackage = beginBazaarRatingRequest(requestIDs, "user|plugins:first");
        const secondPackage = beginBazaarRatingRequest(requestIDs, "user|plugins:second");
        const otherUser = beginBazaarRatingRequest(requestIDs, "other-user|plugins:first");
        assert.equal(isLatestBazaarRatingRequest(requestIDs, "user|plugins:first", firstPackage), true);
        assert.equal(isLatestBazaarRatingRequest(requestIDs, "user|plugins:second", secondPackage), true);
        assert.equal(isLatestBazaarRatingRequest(requestIDs, "other-user|plugins:first", otherUser), true);
    });
});

describe("getBazaarRatingErrorLanguageKey", () => {
    it("recognizes only the stable rating rate-limit error code", () => {
        assert.equal(getBazaarRatingErrorLanguageKey({errorCode: "bazaarRatingRateLimited"}),
            "bazaarRatingRateLimited");
        assert.equal(getBazaarRatingErrorLanguageKey({errorCode: "other"}), undefined);
        assert.equal(getBazaarRatingErrorLanguageKey("bazaarRatingRateLimited"), undefined);
        assert.equal(getBazaarRatingErrorLanguageKey(null), undefined);
    });
});
