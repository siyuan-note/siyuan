export interface IBazaarCompatibilityFilters {
    hideUnsupportedVersion?: boolean;
    hideIncompatiblePlatform?: boolean;
}

export const filterBazaarPackagesByCompatibility = <T extends {
    bazaarVersionUnsupported?: boolean;
    bazaarIncompatible?: boolean;
}>(packages: T[], filters?: IBazaarCompatibilityFilters) => {
    if (filters?.hideUnsupportedVersion !== true && filters?.hideIncompatiblePlatform !== true) {
        return packages;
    }
    return packages.filter((item) =>
        !(filters.hideUnsupportedVersion === true && item.bazaarVersionUnsupported === true) &&
        !(filters.hideIncompatiblePlatform === true && item.bazaarIncompatible === true));
};
