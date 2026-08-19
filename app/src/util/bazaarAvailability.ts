import {getFrontend} from "./functions";

export const isBazaarAvailableForFrontend = (
    frontend: string,
    disabledFeatures: readonly string[] | undefined,
): boolean => frontend !== "mobile" || !disabledFeatures?.includes("bazaar");

export const isBazaarAvailable = (): boolean => isBazaarAvailableForFrontend(
    getFrontend(),
    window.siyuan.config.system.disabledFeatures,
);
