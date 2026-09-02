export type TBazaarTabType = "plugin" | "theme" | "icon" | "template" | "widget";

export type TBazaarMyType = "myPlugin" | "myTheme" | "myIcon" | "myTemplate" | "myWidget";

type TBazaarLanguageKey = "plugin" | "theme" | "icon" | "template" | "widget";

interface IBazaarPackageConfig {
    tabType: TBazaarTabType;
    myType: TBazaarMyType;
    languageKey: TBazaarLanguageKey;
    panelID: string;
    downloadedSortKey: "downloadedPlugin" | "downloadedTheme" | "downloadedIcon" |
        "downloadedTemplate" | "downloadedWidget";
    bazaarRequestUsesFrontend: boolean;
    api: {
        bazaar: string;
        installed: string;
        install: string;
        uninstall: string;
    };
}

export const BAZAAR_PACKAGE_TYPES = ["plugins", "themes", "icons", "templates", "widgets"] as const satisfies readonly TBazaarType[];

export const BAZAAR_PACKAGE_CONFIG = {
    plugins: {
        tabType: "plugin",
        myType: "myPlugin",
        languageKey: "plugin",
        panelID: "configBazaarPlugin",
        downloadedSortKey: "downloadedPlugin",
        bazaarRequestUsesFrontend: true,
        api: {
            bazaar: "/api/bazaar/getBazaarPlugin",
            installed: "/api/bazaar/getInstalledPlugin",
            install: "/api/bazaar/installBazaarPlugin",
            uninstall: "/api/bazaar/uninstallBazaarPlugin",
        },
    },
    themes: {
        tabType: "theme",
        myType: "myTheme",
        languageKey: "theme",
        panelID: "configBazaarTheme",
        downloadedSortKey: "downloadedTheme",
        bazaarRequestUsesFrontend: true,
        api: {
            bazaar: "/api/bazaar/getBazaarTheme",
            installed: "/api/bazaar/getInstalledTheme",
            install: "/api/bazaar/installBazaarTheme",
            uninstall: "/api/bazaar/uninstallBazaarTheme",
        },
    },
    icons: {
        tabType: "icon",
        myType: "myIcon",
        languageKey: "icon",
        panelID: "configBazaarIcon",
        downloadedSortKey: "downloadedIcon",
        bazaarRequestUsesFrontend: false,
        api: {
            bazaar: "/api/bazaar/getBazaarIcon",
            installed: "/api/bazaar/getInstalledIcon",
            install: "/api/bazaar/installBazaarIcon",
            uninstall: "/api/bazaar/uninstallBazaarIcon",
        },
    },
    templates: {
        tabType: "template",
        myType: "myTemplate",
        languageKey: "template",
        panelID: "configBazaarTemplate",
        downloadedSortKey: "downloadedTemplate",
        bazaarRequestUsesFrontend: false,
        api: {
            bazaar: "/api/bazaar/getBazaarTemplate",
            installed: "/api/bazaar/getInstalledTemplate",
            install: "/api/bazaar/installBazaarTemplate",
            uninstall: "/api/bazaar/uninstallBazaarTemplate",
        },
    },
    widgets: {
        tabType: "widget",
        myType: "myWidget",
        languageKey: "widget",
        panelID: "configBazaarWidget",
        downloadedSortKey: "downloadedWidget",
        bazaarRequestUsesFrontend: false,
        api: {
            bazaar: "/api/bazaar/getBazaarWidget",
            installed: "/api/bazaar/getInstalledWidget",
            install: "/api/bazaar/installBazaarWidget",
            uninstall: "/api/bazaar/uninstallBazaarWidget",
        },
    },
} satisfies Record<TBazaarType, IBazaarPackageConfig>;

const BAZAAR_TYPE_BY_TAB = Object.fromEntries(BAZAAR_PACKAGE_TYPES.map((type) => [
    BAZAAR_PACKAGE_CONFIG[type].tabType,
    type,
])) as Record<TBazaarTabType, TBazaarType>;

const BAZAAR_TYPE_BY_MY_TYPE = Object.fromEntries(BAZAAR_PACKAGE_TYPES.map((type) => [
    BAZAAR_PACKAGE_CONFIG[type].myType,
    type,
])) as Record<TBazaarMyType, TBazaarType>;

export const isBazaarPackageType = (value: string | null | undefined): value is TBazaarType =>
    Boolean(value && Object.prototype.hasOwnProperty.call(BAZAAR_PACKAGE_CONFIG, value));

export const getBazaarTypeByTab = (value: string | null | undefined): TBazaarType | undefined =>
    value && Object.prototype.hasOwnProperty.call(BAZAAR_TYPE_BY_TAB, value) ?
        BAZAAR_TYPE_BY_TAB[value as TBazaarTabType] : undefined;

export const getBazaarTypeByMyType = (value: string | null | undefined): TBazaarType | undefined =>
    value && Object.prototype.hasOwnProperty.call(BAZAAR_TYPE_BY_MY_TYPE, value) ?
        BAZAAR_TYPE_BY_MY_TYPE[value as TBazaarMyType] : undefined;
