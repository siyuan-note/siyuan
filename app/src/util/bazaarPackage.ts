const reservedWindowsDeviceNames = new Set([
    "CON", "PRN", "AUX", "NUL",
    "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9",
    "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
]);

export const getBazaarCompatibilityData = <T extends object>(
    source: "downloaded" | "updated" | "bazaar",
    installed: T | undefined,
    available: T | undefined,
    fallback: T,
) => source === "downloaded" ? installed ?? fallback : available ?? installed ?? fallback;

type TBazaarDeprecationFields = {
    deprecated?: boolean;
    deprecatedReason?: Record<string, string>;
    preferredDeprecatedReason?: string;
    alternatives?: string[];
};

export const getBazaarDeprecationData = <T extends object>(
    installed: T | undefined,
    available: T | undefined,
    fallback: T,
) => available ?? installed ?? fallback;

export const applyBazaarPackageDeprecation = <T extends TBazaarDeprecationFields>(
    installed: T,
    available?: TBazaarDeprecationFields,
) => {
    if (available?.deprecated !== true) {
        delete installed.deprecated;
        delete installed.deprecatedReason;
        delete installed.preferredDeprecatedReason;
        delete installed.alternatives;
        return;
    }
    installed.deprecated = true;
    installed.deprecatedReason = available.deprecatedReason ? {...available.deprecatedReason} : {};
    installed.preferredDeprecatedReason = typeof available.preferredDeprecatedReason === "string" ?
        available.preferredDeprecatedReason : "";
    installed.alternatives = Array.isArray(available.alternatives) ?
        available.alternatives.filter((item): item is string => typeof item === "string") : [];
};

export const getBazaarCompatibilityFieldVisibility = (packageType: string) => {
    const isPlugin = packageType === "plugins";
    const isTheme = packageType === "themes";
    return {
        frontends: isPlugin || isTheme,
        systems: isPlugin,
        kernelSystems: isPlugin,
        disabledInPublish: isPlugin,
        modes: isTheme,
    };
};

export const isBazaarPackageEnableDisabled = (
    packageType: string,
    item: {disallowInstall?: boolean, installedIncompatible?: boolean, enabled?: boolean, current?: boolean},
) => (item.disallowInstall === true || item.installedIncompatible === true) && (
    packageType === "plugins" ? item.enabled !== true : packageType === "themes" && item.current !== true
);

export const isBazaarPluginEnabledInPublish = (item: {
    disabledInPublish?: boolean;
    userDisabledInPublish?: boolean;
}) => !item.disabledInPublish && !item.userDisabledInPublish;

export const getBazaarPackageInvalidLanguageKey = (reason?: TBazaarPackageInvalidReason) => {
    switch (reason) {
        case "missing-manifest":
            return "bazaarPackageMissingManifest";
        case "name-mismatch":
            return "bazaarPackageNameMismatch";
        default:
            return "bazaarPackageInvalidManifest";
    }
};

const getBazaarSystemLabels = (systems: string[], allLabel: string) => {
    if (!systems.length || systems.includes("all")) {
        return [allLabel];
    }
    const labels: Record<string, string> = {
        windows: "Windows",
        linux: "Linux",
        darwin: "macOS",
        android: "Android",
        ios: "iOS",
        harmony: "HarmonyOS",
        docker: "Docker",
    };
    return Array.from(new Set(systems.map((system) => labels[system] || system)));
};

export const getBazaarBackendSystemLabels = (backends: string[] | null | undefined, allLabel: string) =>
    getBazaarSystemLabels(backends || [], allLabel);

export const getBazaarKernelSystemLabels = (kernels: string[] | null | undefined, allLabel: string) =>
    kernels?.length ? getBazaarSystemLabels(kernels, allLabel) : [];

export const getBazaarThemeModeLabels = (
    modes: string[] | null | undefined,
    lightLabel: string,
    darkLabel: string,
) => Array.from(new Set((modes || []).filter(Boolean).map((mode) => {
    if (mode === "light") {
        return lightLabel;
    }
    if (mode === "dark") {
        return darkLabel;
    }
    return mode;
})));

const normalizeBazaarFundingURL = (value: string | undefined, base: string) => {
    if (!value) {
        return "";
    }
    if (value.startsWith("https://") || value.startsWith("http://")) {
        return value;
    }
    return `${base}${value}`;
};

export const getBazaarFundingItems = (funding: IBazaarFunding | null | undefined) => {
    if (!funding) {
        return [];
    }
    return [
        normalizeBazaarFundingURL(funding.openCollective, "https://opencollective.com/"),
        normalizeBazaarFundingURL(funding.patreon, "https://www.patreon.com/"),
        normalizeBazaarFundingURL(funding.github, "https://github.com/sponsors/"),
        ...(funding.custom || []),
    ].filter(Boolean);
};

export const normalizeBazaarRating = (rating: Partial<IBazaarRating> | null | undefined): IBazaarRating | undefined => {
    const average = rating?.average;
    const count = rating?.count;
    if (typeof average !== "number" || !Number.isFinite(average) || average < 1 || average > 5 ||
        typeof count !== "number" || !Number.isSafeInteger(count) || count < 1 || !Array.isArray(rating.distribution) ||
        rating.distribution.length !== 5 || rating.distribution.some((value) =>
            typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)) {
        return;
    }
    const distribution = [...rating.distribution] as TBazaarRatingDistribution;
    const distributionCount = distribution.reduce((sum, value) => sum + value, 0);
    const calculatedAverage = distribution.reduce((sum, value, index) => sum + value * (index + 1), 0) / count;
    if (distributionCount !== count || Math.abs(calculatedAverage - average) > 0.01) {
        return;
    }
    return {
        average,
        count,
        distribution,
    };
};

export const normalizeBazaarPackageRatingResponse = (data: {
    ratingAvailable?: unknown;
    rating?: Partial<IBazaarRating> | null;
} | null | undefined): {loaded: boolean, rating?: IBazaarRating} => {
    if (data?.ratingAvailable !== true) {
        return {loaded: false};
    }
    if (!Object.prototype.hasOwnProperty.call(data, "rating")) {
        return {loaded: true};
    }
    const rating = normalizeBazaarRating(data.rating);
    return rating ? {loaded: true, rating} : {loaded: false};
};

export const normalizeBazaarPackageRatingsResponse = (
    packageNames: string[],
    data: {eligiblePackageNames?: unknown, ratings?: unknown} | null | undefined,
) => {
    if (!Array.isArray(data?.eligiblePackageNames) ||
        data.eligiblePackageNames.some((packageName) => typeof packageName !== "string") ||
        !data.ratings || typeof data.ratings !== "object" || Array.isArray(data.ratings)) {
        return;
    }
    const eligiblePackageNames = new Set(data.eligiblePackageNames as string[]);
    const ratings = data.ratings as Record<string, Partial<IBazaarRating> | null>;
    const result = new Map<string, {ratingAvailable: boolean, rating?: IBazaarRating}>();
    packageNames.forEach((packageName) => {
        if (!eligiblePackageNames.has(packageName)) {
            result.set(packageName, {ratingAvailable: false});
            return;
        }
        const response: {ratingAvailable: boolean, rating?: Partial<IBazaarRating> | null} = {
            ratingAvailable: true,
        };
        if (Object.prototype.hasOwnProperty.call(ratings, packageName)) {
            response.rating = ratings[packageName];
        }
        const normalized = normalizeBazaarPackageRatingResponse(response);
        result.set(packageName, normalized.loaded ? {
            ratingAvailable: true,
            ...(normalized.rating ? {rating: normalized.rating} : {}),
        } : {ratingAvailable: false});
    });
    return result;
};

export const normalizeBazaarPackageUserRatingsResponse = (
    packageNames: string[],
    data: {eligiblePackageNames?: unknown, userRatings?: unknown} | null | undefined,
) => {
    if (!Array.isArray(data?.eligiblePackageNames) ||
        data.eligiblePackageNames.some((packageName) => typeof packageName !== "string") ||
        !data.userRatings || typeof data.userRatings !== "object" || Array.isArray(data.userRatings)) {
        return;
    }
    const requestedPackageNames = new Set(packageNames);
    const eligiblePackageNames = new Set(data.eligiblePackageNames as string[]);
    const userRatings = data.userRatings as Record<string, unknown>;
    if (eligiblePackageNames.size !== data.eligiblePackageNames.length ||
        Array.from(eligiblePackageNames).some((packageName) => !requestedPackageNames.has(packageName)) ||
        Object.keys(userRatings).length !== eligiblePackageNames.size ||
        Object.keys(userRatings).some((packageName) => !eligiblePackageNames.has(packageName))) {
        return;
    }
    const result = new Map<string, number>();
    for (const packageName of eligiblePackageNames) {
        const rating = normalizeBazaarUserRating(userRatings[packageName]);
        if (rating === undefined) {
            return;
        }
        result.set(packageName, rating);
    }
    return result;
};

export const normalizeBazaarUserRating = (rating: unknown) => {
    if (!Number.isInteger(rating)) {
        return;
    }
    const normalized = rating as number;
    return normalized >= 0 && normalized <= 5 ? normalized : undefined;
};

export const isBazaarRatingRemovalAvailable = (rating: unknown) => {
    const normalized = normalizeBazaarUserRating(rating);
    return normalized !== undefined && normalized > 0;
};

export const applyBazaarPackageRatingToItem = <T extends {
    name: string;
    ratingAvailable?: boolean;
    rating?: IBazaarRating;
}>(item: T | undefined, packageName: string, rating?: IBazaarRating) => {
    if (!item || item.name !== packageName) {
        return false;
    }
    item.ratingAvailable = true;
    if (rating) {
        item.rating = rating;
    } else {
        delete item.rating;
    }
    return true;
};

export const sortBazaarPackagesByRating = <T extends {
    ratingAvailable?: boolean;
    rating?: IBazaarRating;
    updated?: string;
}>(packages: T[], descending: boolean): T[] => packages.map((item, index) => ({item, index})).sort((a, b) => {
    const aRating = a.item.ratingAvailable === true ? normalizeBazaarRating(a.item.rating) : undefined;
    const bRating = b.item.ratingAvailable === true ? normalizeBazaarRating(b.item.rating) : undefined;
    if (!aRating && !bRating) {
        return a.index - b.index;
    }
    if (!aRating) {
        return 1;
    }
    if (!bRating) {
        return -1;
    }
    const averageResult = descending ? bRating.average - aRating.average : aRating.average - bRating.average;
    if (averageResult) {
        return averageResult;
    }
    const countResult = bRating.count - aRating.count;
    if (countResult) {
        return countResult;
    }
    const updatedResult = (b.item.updated || "").localeCompare(a.item.updated || "");
    return updatedResult || a.index - b.index;
}).map(({item}) => item);

export const isBazaarPackageRatingLoaded = (
    source: "downloaded" | "updated" | "bazaar",
    asynchronouslyLoaded: boolean,
    onlineRatingAvailable?: boolean,
) => {
    return source === "bazaar" ? onlineRatingAvailable === true : asynchronouslyLoaded;
};

export const isBazaarPackageRatingEditable = (
    source: string | undefined,
    installed: boolean,
) => installed && ["downloaded", "updated", "bazaar"].includes(source || "");

export const getBazaarRatingMutationVersion = (versions: Map<string, number>, key: string) => versions.get(key) || 0;

export const isBazaarRatingMutationVersionCurrent = (
    versions: Map<string, number>,
    key: string,
    version: number,
) => getBazaarRatingMutationVersion(versions, key) === version;

export const beginBazaarRatingSubmission = (submittingKeys: Set<string>, key: string) => {
    if (submittingKeys.has(key)) {
        return false;
    }
    submittingKeys.add(key);
    return true;
};

export const beginBazaarRatingRequest = (requestIDs: Map<string, number>, key: string) => {
    const requestID = (requestIDs.get(key) || 0) + 1;
    requestIDs.set(key, requestID);
    return requestID;
};

export const isLatestBazaarRatingRequest = (requestIDs: Map<string, number>, key: string, requestID: number) => {
    return requestIDs.get(key) === requestID;
};

export const getBazaarRatingErrorLanguageKey = (data: unknown): "bazaarRatingRateLimited" | undefined => {
    if (!data || typeof data !== "object" || Array.isArray(data)) {
        return;
    }
    return (data as {errorCode?: unknown}).errorCode === "bazaarRatingRateLimited" ? "bazaarRatingRateLimited" : undefined;
};

export const isValidBazaarPackageName = (name: string) => {
    if (!/^[\x20-\x7E]{1,255}$/.test(name) || /^[. ]/.test(name) || /[. ]$/.test(name)) {
        return false;
    }
    if (/[<>&'":/\\|?*]/.test(name)) {
        return false;
    }
    return !reservedWindowsDeviceNames.has(name.toUpperCase());
};
