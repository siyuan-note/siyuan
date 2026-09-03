import {getFrontend} from "./functions";
import {getHostCapabilities} from "./hostCapabilities";

export const isBazaarAvailableForFrontend = (
    frontend: string,
    disabledFeatures: readonly string[] | undefined,
): boolean => frontend !== "mobile" || !disabledFeatures?.includes("bazaar");

export const isBazaarAvailable = (): boolean => getHostCapabilities().customAppearance &&
    getHostCapabilities().plugins && isBazaarAvailableForFrontend(
        getFrontend(),
        window.siyuan.config.system.disabledFeatures,
    );
