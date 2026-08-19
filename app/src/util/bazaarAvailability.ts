import {getFrontend} from "./functions";

export const isBazaarAvailableForFrontend = (
    frontend: string,
    disabledFeatures: readonly string[] | undefined,
): boolean => frontend !== "mobile" || !disabledFeatures?.includes("bazaar");

export const isBazaarPackageTypeAvailableForFrontend = (
    bazaarType: TBazaarType,
    frontend: string,
): boolean => frontend !== "mobile" || bazaarType !== "themes";

export const isBazaarAvailable = (): boolean => isBazaarAvailableForFrontend(
    getFrontend(),
    window.siyuan.config.system.disabledFeatures,
);

export const isBazaarPackageTypeAvailable = (bazaarType: TBazaarType): boolean =>
    isBazaarPackageTypeAvailableForFrontend(bazaarType, getFrontend());
