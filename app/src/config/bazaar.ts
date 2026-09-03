import {showMessage} from "../dialog/message";
import {fetchPost} from "../util/fetch";
import {confirmDialog} from "../dialog/confirmDialog";
import {highlightRender} from "../protyle/render/highlightRender";
import {Constants} from "../constants";
import {getFrontend, isBrowser, isMobile} from "../util/functions";
import {hasPluginSetting, Plugin} from "../plugin";
import type {App} from "../index";
import {escapeAttr, escapeHtml} from "../util/escape";
import {formatCount} from "../util/number";
import {loadPlugin, unloadPlugin} from "../plugin/loader";
import {subscribeGlobalPluginState} from "../plugin/globalState";
import {switchSettingPanelSubTab} from "./setting/mount";
import {isThemeFrontendSupported} from "../util/themeCompatibility";
import {
    applyBazaarPackageDeprecation,
    getBazaarBackendSystemLabels,
    getBazaarCompatibilityData,
    getBazaarCompatibilityFieldVisibility,
    getBazaarDeprecationData,
    getBazaarFundingItems,
    getBazaarKernelSystemLabels,
    getBazaarPackageInvalidLanguageKey,
    getBazaarThemeModeLabels,
    isBazaarPackageEnableDisabled,
    isBazaarPackageRatingLoaded,
    isBazaarPluginEnabledInPublish,
    sortBazaarPackages,
} from "../util/bazaarPackage";
import {BAZAAR_README_SANITIZE_OPTIONS} from "./bazaarReadmeSanitize";
import {
    BAZAAR_PACKAGE_CONFIG,
    BAZAAR_PACKAGE_TYPES,
} from "./bazaar/packageConfig";
import {genBazaarPackagePanelHTML} from "./bazaar/html";
import {bindBazaarEvents} from "./bazaar/events";
import {
    bindRatingUserChange,
    genCardRatingHTML,
    genRatePackageActionHTML,
    genReadmeRatingHTML,
    getRatingKey,
    loadDownloadedRatings,
    loadDownloadedUserRatings,
    loadReadmeRating,
    loadUpdatedRatings,
    refreshVisibleRatingUI,
    syncRatingUser,
} from "./bazaar/rating";
import {
    filterBazaarPackagesByThemeMode,
    getNextBazaarCardBatch,
} from "./bazaar/batchRenderer";

interface IBazaarMountSnapshot {
    element: HTMLElement;
    generation: number;
    requestID?: number;
}

interface IBazaarCardRenderState {
    container: Element;
    panel: HTMLElement;
    cardsElement: HTMLElement;
    packages: IBazaarItem[];
    bazaarType: TBazaarType;
    cursor: number;
    active: boolean;
    mount: IBazaarMountSnapshot;
    observer?: IntersectionObserver;
    scrollHandler?: () => void;
    frameID?: number;
}

/** 集市 Tab 挂载（面板页，不走注册表渲染） */
export const mountBazaarTab = (root: HTMLElement, keywords?: string, app?: App) => {
    if (isMobile()) {
        root.classList.add("config--mobile");
    }
    const isEmpty = root.innerHTML === "";
    bazaar._activateMount(root, isEmpty);
    if (isEmpty) {
        root.innerHTML = bazaar.genHTML();
        if (app) {
            bazaar.bindEvent(app);
        }
    }
    if (syncRatingUser(bazaar)) {
        refreshVisibleRatingUI(bazaar);
    }
    if (keywords) {
        switchSettingPanelSubTab(root, keywords, [
            {type: "downloaded", label: window.siyuan.languages.downloaded},
            {type: "plugin", label: window.siyuan.languages.plugin},
            {type: "theme", label: window.siyuan.languages.theme},
            {type: "icon", label: window.siyuan.languages.icon},
            {type: "template", label: window.siyuan.languages.template},
            {type: "widget", label: window.siyuan.languages.widget},
        ]);
    }
};

/** 释放集市 Tab 挂载状态 */
export const unmountBazaarTab = (root: HTMLElement) => {
    if (bazaar.element === root) {
        bazaar._invalidateMount();
    }
};

/**
 * 渲染集市 README
 */
export const renderReadme = (bazaarType: TBazaarType, from: "downloaded" | "updated" | "bazaar", data: IBazaarItem) => {
    if (bazaar.element == null || data.invalidReason) return;
    bazaar._renderReadme(bazaarType, from, data);
};

export const bazaar = {
    element: undefined as HTMLElement,
    _mountGeneration: 0,
    _bazaarRequestIDs: new Map<TBazaarType, number>(),
    _updateState: "idle" as "idle" | "loading" | "loaded" | "error",
    _updateRequestID: 0,
    _localPackageUploading: false,
    _pluginEnablePending: new Set<string>(),
    _downloadedPluginsReady: false,
    _pluginGlobalRequestPending: false,
    _pluginGlobalLifecyclePending: false,
    _pluginGlobalRequestID: 0,
    _lastGlobalPluginSettledRevision: -1,
    _globalPluginStateUnsubscribe: undefined as (() => void) | undefined,
    _ratingUserID: "",
    _ratingUserChangeHandler: undefined as (() => void) | undefined,
    _bazaarCardRenderStates: new Map<Element, IBazaarCardRenderState>(),
    _activateMount(element: HTMLElement, force = false) {
        if (!force && this.element === element) {
            return;
        }
        this._invalidateMount();
        this.element = element;
    },
    _invalidateMount() {
        Array.from(this._bazaarCardRenderStates.keys()).forEach((container) => {
            this._disposeBazaarCardRender(container);
        });
        this._mountGeneration++;
        this._updateRequestID++;
        this._pluginGlobalRequestID++;
        this._downloadedPluginsReady = false;
        this._pluginGlobalRequestPending = false;
        this._pluginGlobalLifecyclePending = false;
        this._lastGlobalPluginSettledRevision = -1;
        this._globalPluginStateUnsubscribe?.();
        this._globalPluginStateUnsubscribe = undefined;
        this._data.deprecationMetadata.clear();
        this._data.deprecationTypesLoaded.clear();
        this._data.deprecationTypesLoading.clear();
        if (this._ratingUserChangeHandler) {
            window.removeEventListener("siyuan-login-success", this._ratingUserChangeHandler);
            this._ratingUserChangeHandler = undefined;
        }
    },
    _captureMount(): IBazaarMountSnapshot {
        return {
            element: this.element,
            generation: this._mountGeneration,
        };
    },
    _beginBazaarRequest(bazaarType: TBazaarType, mount = this._captureMount()): IBazaarMountSnapshot {
        if (!this._isMountCurrent(mount)) {
            return mount;
        }
        const requestID = (this._bazaarRequestIDs.get(bazaarType) || 0) + 1;
        this._bazaarRequestIDs.set(bazaarType, requestID);
        return {
            ...mount,
            requestID,
        };
    },
    _isMountCurrent(mount: IBazaarMountSnapshot) {
        return mount.element === this.element && mount.generation === this._mountGeneration;
    },
    _isBazaarRequestCurrent(bazaarType: TBazaarType, mount: IBazaarMountSnapshot) {
        return this._isMountCurrent(mount) && (mount.requestID === undefined ||
            this._bazaarRequestIDs.get(bazaarType) === mount.requestID);
    },
    _syncPluginGlobalSwitch() {
        const switchElement = this.element?.querySelector('[data-type="plugins-enable"]') as HTMLInputElement;
        if (!switchElement) {
            return;
        }
        const petalDisabled = this._pluginGlobalRequestPending ?
            !switchElement.checked : window.siyuan.config.bazaar.petalDisabled;
        if (!this._pluginGlobalRequestPending) {
            switchElement.checked = !petalDisabled;
        }
        switchElement.disabled = !this._downloadedPluginsReady || this._pluginGlobalRequestPending ||
            this._pluginGlobalLifecyclePending;
        switchElement.setAttribute("aria-label", window.siyuan.languages[petalDisabled ? "enable" : "disableAll"]);
    },
    genHTML() {
        if (!window.siyuan.config.bazaar.trust) {
            return `<div class="config-bazaar__trust fn__flex-column" style="margin: 0 48px;">
<div class="fn__flex-1"></div>
<div class="b3-label">
    <div>${window.siyuan.languages.bazaarTrust}</div>
    <div class="fn__hr--b"></div>
    <div>${window.siyuan.languages.bazaarTrust3}</div>
</div>
<div class="fn__flex b3-label">
    <svg class="b3-label__icon"><use xlink:href="#iconEye"></use></svg>
    <div>
        ${window.siyuan.languages.bazaarTrustCodeReview}
        <div class="b3-label__text">${window.siyuan.languages.bazaarTrustCodeReviewTip}</div>
    </div>
</div>
<div class="fn__flex b3-label">
    <svg class="b3-label__icon"><use xlink:href="#iconGithub"></use></svg>
    <div>
        ${window.siyuan.languages.bazaarTrustOpenSource}
        <div class="b3-label__text">${window.siyuan.languages.bazaarTrustOpenSourceTip}</div>
    </div>
</div>
<div class="fn__flex b3-label">
    <svg class="b3-label__icon"><use xlink:href="#iconUsers"></use></svg>
    <div>
        ${window.siyuan.languages.bazaarCommunityReview}
        <div class="b3-label__text">${window.siyuan.languages.bazaarPeerReviewTip}</div>
    </div>
</div>
<div class="fn__flex b3-label">
    <svg class="b3-label__icon"><use xlink:href="#iconInfo"></use></svg>
    <div>
        ${window.siyuan.languages.bazaarUserReport}
        <div class="b3-label__text">${window.siyuan.languages.bazaarUserReportTip}</div>
    </div>
</div>
<div class="b3-label b3-label--noborder">
    <div>${window.siyuan.languages.bazaarTrust1}</div>
    <div class="fn__hr--b"></div>
    <div>${window.siyuan.languages.bazaarTrust2}</div>
</div>
<div class="ft__center b3-label b3-label--noborder">
    <button class="b3-button fn__size200">${window.siyuan.languages.trust}</button>
</div>
<div class="fn__flex-1"></div>
</div>`;
        }
        const localSort = window.siyuan.storage[Constants.LOCAL_BAZAAR];
        const loadingHTML = `<div style="height: ${bazaar.element.clientHeight - 160}px;display: flex;align-items: center;justify-content: center;"><img src="/stage/loading-pure.svg"></div>`;
        return `<div class="config-bazaar fn__flex-column" style="height: 100%">
<div class="config-bazaar__main fn__flex-column fn__flex-1">
<div class="config-bazaar__drop fn__none">
    <svg><use xlink:href="#iconUpload"></use></svg>
    <div>${window.siyuan.languages.dropLocalBazaarPackage}</div>
</div>
<div class="layout-tab-bar fn__flex">
    <div data-type="downloaded" class="item item--full item--focus"><span class="fn__flex-1"></span><span class="item__text">${window.siyuan.languages.downloaded}</span><span class="fn__flex-1"></span></div>
    <div data-type="plugin" class="item item--full"><span class="fn__flex-1"></span><span class="item__text">${window.siyuan.languages.plugin}</span><span class="fn__flex-1"></span></div>
    <div data-type="theme" class="item item--full"><span class="fn__flex-1"></span><span class="item__text">${window.siyuan.languages.theme}</span><span class="fn__flex-1"></span></div>
    <div data-type="icon" class="item item--full"><span class="fn__flex-1"></span><span class="item__text">${window.siyuan.languages.icon}</span><span class="fn__flex-1"></span></div>
    <div data-type="template" class="item item--full"><span class="fn__flex-1"></span><span class="item__text">${window.siyuan.languages.template}</span><span class="fn__flex-1"></span></div>
    <div data-type="widget" class="item item--full"><span class="fn__flex-1"></span><span class="item__text">${window.siyuan.languages.widget}</span><span class="fn__flex-1"></span></div>
</div>
<div class="fn__flex-1">
    <div class="config-bazaar__panel" data-type="downloaded" data-init="true">
        <div class="fn__flex config-bazaar__title config-bazaar__title--downloaded">
            <div class="fn__flex config-bazaar__tabs">
                <button data-type="myUpdate" class="b3-button b3-button--outline config-bazaar__update-tab">${window.siyuan.languages.update}<span data-type="update-tab-count" class="config-bazaar__update-count fn__none"></span></button>
                <button data-type="myPlugin" class="b3-button">${window.siyuan.languages.plugin}</button>
                <button data-type="myTheme" class="b3-button b3-button--outline">${window.siyuan.languages.theme}</button>
                <button data-type="myIcon" class="b3-button b3-button--outline">${window.siyuan.languages.icon}</button>
                <button data-type="myTemplate" class="b3-button b3-button--outline">${window.siyuan.languages.template}</button>
                <button data-type="myWidget" class="b3-button b3-button--outline">${window.siyuan.languages.widget}</button>
            </div>
            <div class="fn__flex config-bazaar__tools">
                <div class="fn__flex config-bazaar__sort">
                    <svg class="svg ft__on-surface fn__flex-center"><use xlink:href="#iconSort"></use></svg>
                    <select class="b3-select" data-type="downloaded-sort">
                        <option ${localSort.downloadedPlugin === "0" ? "selected" : ""} value="0">${window.siyuan.languages.sortDefault}</option>
                        <option ${localSort.downloadedPlugin === "1" ? "selected" : ""} value="1">${window.siyuan.languages.sortByInstallTimeDesc}</option>
                        <option ${localSort.downloadedPlugin === "2" ? "selected" : ""} value="2">${window.siyuan.languages.sortByInstallTimeAsc}</option>
                        <option ${localSort.downloadedPlugin === "3" ? "selected" : ""} value="3">${window.siyuan.languages.sortByUpdateTimeDesc}</option>
                        <option ${localSort.downloadedPlugin === "4" ? "selected" : ""} value="4">${window.siyuan.languages.sortByUpdateTimeAsc}</option>
                        <option ${localSort.downloadedPlugin === "5" ? "selected" : ""} data-plugin-only="true" value="5">${window.siyuan.languages.sortByEnabledFirst}</option>
                        <option ${localSort.downloadedPlugin === "6" ? "selected" : ""} data-plugin-only="true" value="6">${window.siyuan.languages.sortByDisabledFirst}</option>
                    </select>
                </div>
                <input data-type="downloaded-filter" class="b3-text-field config-bazaar__filter" placeholder="${window.siyuan.languages.enterKey} ${window.siyuan.languages.search}">
                <div class="fn__flex config-bazaar__actions">
                    <label class="block__icon block__icon--show config-bazaar__local-package ariaLabel" data-type="install-local-package" data-position="north" aria-label="${window.siyuan.languages.installLocalBazaarPackage}">
                        <svg class="b3-button__icon"><use xlink:href="#iconUpload"></use></svg>
                        <input class="b3-form__upload" data-type="local-package-file" type="file" accept=".zip,application/zip">
                    </label>
                    <button class="b3-button fn__none" data-type="install-all">${window.siyuan.languages.updateAll}</button>
                    <input ${window.siyuan.config.bazaar.petalDisabled ? "" : " checked"} data-type="plugins-enable" data-position="north" type="checkbox" class="b3-switch fn__flex-center ariaLabel" aria-label="${window.siyuan.languages[window.siyuan.config.bazaar.petalDisabled ? "enable" : "disableAll"]}" disabled>
                    <div class="counter counter--bg fn__none fn__flex-center ariaLabel" data-position="north" aria-label="${window.siyuan.languages.total}"></div>
                </div>
            </div>
        </div>
        <div id="configBazaarDownloaded" class="config-bazaar__content b3-cards b3-cards--nowrap">
            ${loadingHTML}
        </div>
    </div>
    ${genBazaarPackagePanelHTML("themes", localSort.theme, loadingHTML)}
    ${genBazaarPackagePanelHTML("templates", localSort.template, loadingHTML)}
    ${genBazaarPackagePanelHTML("plugins", localSort.plugin, loadingHTML)}
    ${genBazaarPackagePanelHTML("icons", localSort.icon, loadingHTML)}
    ${genBazaarPackagePanelHTML("widgets", localSort.widget, loadingHTML)}
</div>
</div>
<div id="configBazaarReadme" class="config-bazaar__readme config__view"></div>
</div>`;
    },
    _genFundingHTML(funding: string, reserveSpace = true): string {
        if (!funding) {
            return "";
        }
        const space = reserveSpace ? '<span class="fn__space--small"></span>' : "";
        try {
            const url = new URL(funding);
            if (!["http:", "https:", "mailto:"].includes(url.protocol)) {
                throw new Error("not an allowed URL protocol");
            }
            return `${space}<a target="_blank" href="${escapeAttr(funding)}" class="block__icon block__icon--show ariaLabel" data-position="north" aria-label="${window.siyuan.languages.sponsor} ${escapeAttr(funding)}"><svg class="ft__pink"><use xlink:href="#iconHeart"></use></svg></a>`;
        } catch (e) {
            return `${space}<span data-type="copy-funding" data-funding="${escapeAttr(funding)}" class="block__icon block__icon--show ariaLabel" data-position="north" aria-label="${window.siyuan.languages.sponsor} ${escapeAttr(funding)}"><svg class="ft__pink"><use xlink:href="#iconHeart"></use></svg></span>`;
        }
    },
    _genReadmeFundingHTML(funding: {url: string, label?: string}): string {
        try {
            const url = new URL(funding.url);
            if (!["http:", "https:", "mailto:"].includes(url.protocol)) {
                throw new Error("not an allowed URL protocol");
            }
            const displayFunding = funding.label?.trim() || url.host || url.pathname || funding.url;
            return `<a target="_blank" href="${escapeAttr(funding.url)}" title="${escapeAttr(funding.url)}" class="item__meta-funding">${escapeHtml(displayFunding)}</a>`;
        } catch (e) {
            const displayFunding = funding.label?.trim() || funding.url;
            return `<span data-type="copy-funding" data-funding="${escapeAttr(funding.url)}" title="${escapeAttr(funding.url)}" class="item__meta-funding ft__primary fn__pointer">${escapeHtml(displayFunding)}</span>`;
        }
    },
    _genPackageIconHTML(iconURL: string, detail = false): string {
        if (iconURL) {
            const className = detail ? " class=\"item__img\"" : "";
            return `<img${className} src="${escapeAttr(iconURL)}" loading="lazy" onerror="this.src='/stage/images/icon.png'">`;
        }
        if (detail) {
            return "<svg class=\"item__img item__img--placeholder\"><use xlink:href=\"#iconBazaar\"></use></svg>";
        }
        return "<span><svg class=\"b3-card__icon\"><use xlink:href=\"#iconBazaar\"></use></svg></span>";
    },
    _genIncompatibleChipHTML(item: IBazaarItem, source: "installed" | "bazaar", bazaarType: TBazaarType) {
        const incompatible = bazaarType === "themes" ?
            !isThemeFrontendSupported(item.frontends, getFrontend()) :
            source === "installed" ? item.installedIncompatible : item.bazaarIncompatible;
        if (!incompatible) {
            return "";
        }
        const tooltip = bazaarType === "themes" ? "" :
            ` data-position="north" aria-label="${window.siyuan.languages.incompatiblePluginTip}"`;
        const tooltipClass = bazaarType === "themes" ? "" : " ariaLabel";
        return `<span class="fn__space"></span><span${tooltip} class="fn__flex-center${tooltipClass} b3-chip b3-chip--error b3-chip--small">${window.siyuan.languages.incompatible}</span>`;
    },
    _genDeprecatedChipHTML(item: IBazaarItem, reserveSpace = true) {
        if (!item.deprecated) {
            return "";
        }
        const space = reserveSpace ? '<span class="fn__space"></span>' : "";
        const tip = item.preferredDeprecatedReason || window.siyuan.languages.bazaarDeprecatedTip;
        return `${space}<span data-position="north" aria-label="${escapeAttr(tip)}" class="fn__flex-center ariaLabel b3-chip b3-chip--warning b3-chip--small">${escapeHtml(window.siyuan.languages.bazaarDeprecated)}</span>`;
    },
    _genDeprecatedDetailHTML(item: IBazaarItem, bazaarType: TBazaarType) {
        if (!item.deprecated) {
            return "";
        }
        const reason = item.preferredDeprecatedReason || window.siyuan.languages.bazaarDeprecatedTip;
        const alternatives = Array.isArray(item.alternatives) ? item.alternatives.filter((name) =>
            typeof name === "string" && name.length > 0) : [];
        const alternativesHTML = alternatives.map((name) => `<button type="button" data-type="bazaar-alternative" data-package-type="${bazaarType}" data-package-name="${escapeAttr(name)}" class="b3-chip b3-chip--small b3-chip--pointer config-bazaar__deprecated-button">${escapeHtml(name)}</button>`).join("");
        return `<section class="config-bazaar__deprecated">
    <div class="config-bazaar__deprecated-title">${escapeHtml(window.siyuan.languages.bazaarDeprecated)}</div>
    <div class="config-bazaar__deprecated-reason">${escapeHtml(reason)}</div>
    ${alternativesHTML ? `<div class="config-bazaar__deprecated-alternatives">
        <span class="config-bazaar__deprecated-label">${window.siyuan.languages.bazaarAlternatives}</span>
        <div class="config-bazaar__deprecated-list">${alternativesHTML}</div>
    </div>` : ""}
</section>`;
    },
    _genInvalidDownloadedCardHTML(item: IBazaarItem, bazaarType: TBazaarType) {
        const tip = window.siyuan.languages[getBazaarPackageInvalidLanguageKey(item.invalidReason)];
        return `<div data-name="${escapeAttr(item.name)}" data-package-type="${bazaarType}" data-package-source="downloaded" class="b3-card">
    <div class="b3-card__img">${bazaar._genPackageIconHTML("")}</div>
    <div class="fn__flex-1 fn__flex-column">
        <div class="b3-card__info b3-card__info--left fn__flex-1">${escapeHtml(item.name)}</div>
    </div>
    <div class="b3-card__actions b3-card__actions--right">
        <span data-position="north" aria-label="${escapeAttr(tip)}" class="fn__flex-center ariaLabel b3-chip b3-chip--error b3-chip--small">${window.siyuan.languages.bazaarPackageInvalid}</span>
        <span data-position="north" class="ariaLabel block__icon block__icon--show" data-type="uninstall" aria-label="${window.siyuan.languages.uninstall}">
            <svg><use xlink:href="#iconTrashcan"></use></svg>
        </span>
        <span data-position="north" class="ariaLabel block__icon block__icon--show${isBrowser() ? " fn__none" : ""}" data-type="open" aria-label="${window.siyuan.languages.showInFolder}">
            <svg><use xlink:href="#iconFolder"></use></svg>
        </span>
        ${bazaar._genOpenStorageHTML(item, bazaarType)}
    </div>
</div>`;
    },
    _genOpenStorageHTML(item: IBazaarItem, bazaarType: TBazaarType) {
        if (bazaarType !== "plugins" || !item.hasStorageData) {
            return "";
        }
        return `<span data-position="north" class="ariaLabel block__icon block__icon--show${isBrowser() ? " fn__none" : ""}" data-type="open-storage" aria-label="${window.siyuan.languages.openStorageLocation}">
    <svg><use xlink:href="#iconDatabase"></use></svg>
</span>`;
    },
    _getDetailKey(bazaarType: TBazaarType, packageName: string) {
        return `${bazaarType}:${packageName}`;
    },
    _getPackageDetail(bazaarType: TBazaarType, packageName: string) {
        return bazaar._data.details.get(bazaar._getDetailKey(bazaarType, packageName));
    },
    _setPackageDetail(bazaarType: TBazaarType, packageName: string, detail: IBazaarPackageDetail) {
        bazaar._data.details.set(bazaar._getDetailKey(bazaarType, packageName), detail);
    },
    _fetchPackageDetail(bazaarType: TBazaarType, packageName: string, callback: (detail: IBazaarPackageDetail) => void) {
        const mount = bazaar._captureMount();
        fetchPost("/api/bazaar/getBazaarPackage", {
            packageType: bazaarType,
            packageName,
            frontend: getFrontend(),
        }, response => {
            if (!bazaar._isMountCurrent(mount)) {
                return;
            }
            if (response.code !== 0 || !response.data) {
                callback(bazaar._getPackageDetail(bazaarType, packageName) || {});
                return;
            }
            const detail = response.data as IBazaarPackageDetail;
            bazaar._setPackageDetail(bazaarType, packageName, detail);
            callback(detail);
        });
    },
    _openBazaarAlternative(bazaarType: TBazaarType, packageName: string) {
        const detail = bazaar._getPackageDetail(bazaarType, packageName);
        const cached = detail?.available || bazaar._data[bazaarType].find((item) => item.name === packageName) ||
            bazaar._data.deprecationMetadata.get(bazaarType)?.get(packageName);
        if (cached) {
            bazaar._renderReadme(bazaarType, "bazaar", cached, detail);
            return;
        }
        bazaar._fetchPackageDetail(bazaarType, packageName, (packageDetail) => {
            if (packageDetail.available) {
                bazaar._renderReadme(bazaarType, "bazaar", packageDetail.available, packageDetail);
                return;
            }
            showMessage(window.siyuan.languages.bazaarPackageNotFound.replace("${name}", escapeHtml(packageName)));
        });
    },
    _genReadmeMetaRow(label: string, value: string, valueHTML = false) {
        if (!value) {
            return "";
        }
        return `<div class="item__meta-row">
    <span>${escapeHtml(label)}</span>
    <span>${valueHTML ? value : escapeHtml(value)}</span>
</div>`;
    },
    _genReadmeChips(values: string[], plainAll = false) {
        if (plainAll && values.length === 1 && values[0] === window.siyuan.languages.all) {
            return escapeHtml(values[0]);
        }
        return values.map((value) => `<span class="b3-chip b3-chip--small">${escapeHtml(value)}</span>`).join("");
    },
    _genReadmeKeywords(values: string[]) {
        const visibleCount = 5;
        const chips = values.map((value, index) => `<span${index >= visibleCount ? " data-keyword-hidden" : ""} class="b3-chip b3-chip--small${index >= visibleCount ? " fn__none" : ""}">${escapeHtml(value)}</span>`).join("");
        if (values.length <= visibleCount) {
            return chips;
        }
        return `${chips}<button type="button" data-type="keywords-expand" data-position="north" aria-label="${escapeAttr(window.siyuan.languages.showMore)}" class="item__keywords-more b3-chip b3-chip--small b3-chip--hover ariaLabel">...</button>`;
    },
    _getFrontendLabels(frontends: string[], requireMobileDeclaration = false) {
        if (!frontends?.length) {
            return requireMobileDeclaration && ["mobile", "browser-mobile"].includes(getFrontend()) ?
                [] : [window.siyuan.languages.all];
        }
        if (frontends.includes("all")) {
            return [window.siyuan.languages.all];
        }
        const labels = new Set<string>();
        frontends.forEach((frontend) => {
            if (["desktop", "desktop-window"].includes(frontend)) {
                labels.add(window.siyuan.languages.desktop);
            } else if (frontend === "mobile") {
                labels.add(window.siyuan.languages.mobile);
            } else if (["browser-desktop", "browser-mobile"].includes(frontend)) {
                labels.add(window.siyuan.languages.bazaarWeb);
            } else {
                labels.add(frontend);
            }
        });
        return Array.from(labels);
    },
    _genReadmeActionsHTML(bazaarType: TBazaarType, installed?: IBazaarItem, available?: IBazaarItem) {
        if (!installed) {
            if (!available || available.installed) {
                return "";
            }
            return `<button ${available.disallowInstall ? `disabled aria-label="${bazaar._genInstallButtonAriaLabel(available, bazaarType)}" data-position="north"` : ""} class="b3-button ariaLabel fn__block" data-type="install">${window.siyuan.languages.download}</button>`;
        }

        let primaryAction = "";
        const enableDisabled = isBazaarPackageEnableDisabled(bazaarType, installed) ? " disabled" : "";
        if (bazaarType === "plugins") {
            primaryAction = `<button${enableDisabled} class="b3-button fn__block" data-type="${installed.enabled ? "package-disable" : "package-enable"}">${installed.enabled ? window.siyuan.languages.disable : window.siyuan.languages.enable}</button>`;
        } else if (["themes", "icons"].includes(bazaarType)) {
            primaryAction = `<button${enableDisabled} class="b3-button fn__block" data-type="${installed.current ? "package-disable" : "package-enable"}">${installed.current ? window.siyuan.languages.disable : window.siyuan.languages.use}</button>`;
        }

        return `${primaryAction}
${primaryAction ? '<div class="fn__hr"></div>' : ""}
<button class="b3-button b3-button--remove fn__block" data-type="uninstall">${window.siyuan.languages.uninstall}</button>`;
    },
    _genCardHTML(item: IBazaarItem, bazaarType: TBazaarType) {
        const showSwitch = item.installed && !item.current && ["icons", "themes"].includes(bazaarType);
        const showDisable = item.installed && item.current && ["icons", "themes"].includes(bazaarType);
        return `<div data-name="${escapeAttr(item.name)}" data-package-type="${bazaarType}" data-package-source="bazaar" class="b3-card${item.current ? " b3-card--current" : ""}">
    <div class="b3-card__img">
        ${bazaar._genPackageIconHTML(item.iconURL)}
    </div>
    <div class="fn__flex-1 fn__flex-column">
        <div class="b3-card__info fn__flex-1">
            ${escapeHtml(item.preferredName)}
            <div class="b3-card__desc" title="${escapeAttr(item.preferredDesc)}">
                ${escapeHtml(item.preferredDesc)}
            </div>
        </div>
        <div class="b3-card__actions">
            <span class="block__icon block__icon--show block__icon--text">
                <svg><use xlink:href="#iconDownload"></use></svg>
                <span class="fn__space--small"></span>
                ${formatCount(item.downloads)}
            </span>
            ${genCardRatingHTML(item,
                isBazaarPackageRatingLoaded("bazaar", false, item.ratingAvailable))}
            <span class="block__icon block__icon--show block__icon--text">
                <svg><use xlink:href="#iconAccount"></use></svg>
                <span class="fn__space--small"></span>
                <span class="b3-card__author">${escapeHtml(item.author)}</span>
            </span>
            ${bazaar._genFundingHTML(item.preferredFunding)}
            ${bazaar._genIncompatibleChipHTML(item, "bazaar", bazaarType)}
            ${bazaar._genDeprecatedChipHTML(item)}
            <span class="fn__space--small"></span>
            <div class="fn__flex-1"></div>
            <div class="fn__space--small${showSwitch ? "" : " fn__none"}"></div>
            <span data-position="north" class="ariaLabel block__icon block__icon--show${showSwitch ? "" : " fn__none"}" data-type="switch" aria-label="${window.siyuan.languages.use}">
                <svg><use xlink:href="#iconSelect"></use></svg>
            </span>
            <span data-position="north" class="ariaLabel block__icon block__icon--show${showDisable ? "" : " fn__none"}" data-type="package-disable" aria-label="${window.siyuan.languages.disable}">
                <svg><use xlink:href="#iconClose"></use></svg>
            </span>
            <div class="fn__space--small${item.outdated ? "" : " fn__none"}"></div>
            ${bazaar._genUpdateButtonHTML(item, bazaarType)}
        </div>
    </div>
</div>`;
    },
    _genInstallButtonAriaLabel(item: IBazaarItem, bazaarType: TBazaarType) {
        if (!item.disallowInstall) {
            return window.siyuan.languages.download;
        }
        if (item.bazaarIncompatible) {
            return bazaarType === "themes" ? window.siyuan.languages.incompatible :
                window.siyuan.languages.incompatiblePluginTip;
        }
        return window.siyuan.languages.bazaarNeedVersion.replace("${x}", item.minAppVersion || "");
    },
    _genUpdateButtonAriaLabel(item: IBazaarItem, bazaarType: TBazaarType) {
        if (!item.disallowUpdate) {
            return window.siyuan.languages.update;
        }
        if (item.bazaarIncompatible) {
            return bazaarType === "themes" ? window.siyuan.languages.incompatible :
                window.siyuan.languages.incompatiblePluginTip;
        }
        return window.siyuan.languages.bazaarNeedVersion.replace("${x}", item.updateRequiredMinAppVer || "");
    },
    _genUpdateButtonHTML(item: IBazaarItem | undefined, bazaarType: TBazaarType, reserveSpace = false) {
        if (!item?.outdated && !reserveSpace) {
            return "";
        }
        const ariaLabel = item ? this._genUpdateButtonAriaLabel(item, bazaarType) : window.siyuan.languages.update;
        return `<span data-position="north" data-type="install-t" ${item?.disallowUpdate ? "disabled" : ""} aria-label="${ariaLabel}" class="ariaLabel block__icon block__icon--show${item?.outdated ? "" : " fn__hidden"}">
    <svg class="ft__primary"><use xlink:href="#iconRefresh"></use></svg>
</span>`;
    },
    _genReadmeUpdateButtonHTML(item: IBazaarItem | undefined, bazaarType: TBazaarType, reserveSpace = false) {
        if (!item?.outdated && !reserveSpace) {
            return "";
        }
        const ariaLabel = item ? this._genUpdateButtonAriaLabel(item, bazaarType) : window.siyuan.languages.update;
        return `<div data-type="readme-update-slot" class="${item?.outdated ? "" : "fn__none"}">
    ${reserveSpace ? '<div class="fn__hr"></div>' : ""}
    <button ${item?.disallowUpdate ? `disabled aria-label="${ariaLabel}" data-position="north"` : ""} class="b3-button ariaLabel" style="width: 168px" data-type="install-t">${window.siyuan.languages.update}</button>
</div>`;
    },
    _genUpdateItemHTML(item: IUpdatedBazaarItem, bazaarType: TBazaarType) {
        const installed = item.installed;
        const available = item.available;
        const ratingKey = getRatingKey(bazaarType, installed.name);
        const ratingLoaded = isBazaarPackageRatingLoaded("updated", bazaar._data.downloadedRatingKeys.has(ratingKey));
        return `<div class="b3-card" data-name="${escapeAttr(installed.name)}" data-package-type="${bazaarType}" data-package-source="updated">
    <div class="b3-card__img">${bazaar._genPackageIconHTML(installed.iconURL)}</div>
    <div class="fn__flex-1 fn__flex-column">
        <div class="b3-card__info b3-card__info--left fn__flex-1">
            ${escapeHtml(installed.preferredName)}
            <div class="b3-card__desc" title="${escapeAttr(installed.preferredDesc)}">${escapeHtml(installed.preferredDesc)}</div>
        </div>
    </div>
    <div class="b3-card__actions b3-card__actions--right">
        ${bazaar._genIncompatibleChipHTML(available, "bazaar", bazaarType)}
        ${bazaar._genDeprecatedChipHTML(available, false)}
        ${bazaar._genFundingHTML(installed.preferredFunding, false)}
        <span data-position="north" class="ariaLabel block__icon block__icon--show${isBrowser() ? " fn__none" : ""}" data-type="open" aria-label="${window.siyuan.languages.showInFolder}">
            <svg><use xlink:href="#iconFolder"></use></svg>
        </span>
        ${bazaar._genOpenStorageHTML(installed, bazaarType)}
        ${bazaar._genUpdateButtonHTML(available, bazaarType)}
        ${genRatePackageActionHTML(ratingLoaded, bazaar._data.userRatings.get(ratingKey))}
    </div>
</div>`;
    },
    _getUpdatedItems(): Array<{type: TBazaarType, item: IUpdatedBazaarItem}> {
        const items: Array<{type: TBazaarType, item: IUpdatedBazaarItem}> = [];
        BAZAAR_PACKAGE_TYPES.forEach((type) => {
            bazaar._data.update[type].forEach((item) => items.push({type, item}));
        });
        return items;
    },
    _getUpdatedItem(type: TBazaarType, name: string): IUpdatedBazaarItem | undefined {
        return bazaar._data.update[type].find((item) => item.installed.name === name);
    },
    _isUpdatePanelActive() {
        return !bazaar.element.querySelector('[data-type="myUpdate"]')?.classList.contains("b3-button--outline");
    },
    _syncUpdateTabCounter() {
        const counterElement = bazaar.element?.querySelector('[data-type="update-tab-count"]');
        if (!counterElement) {
            return;
        }
        const count = this._updateState === "loaded" ? this._getUpdatedItems().length : 0;
        counterElement.classList.toggle("fn__none", count === 0);
        counterElement.textContent = count.toString();
    },
    _checkUpdate(force = false) {
        if (!force && ["loading", "loaded"].includes(this._updateState)) {
            return;
        }
        this._updateState = "loading";
        this._syncUpdateTabCounter();
        const requestID = ++this._updateRequestID;
        const mount = this._captureMount();
        if (this._isUpdatePanelActive()) {
            this._renderUpdatePanel();
        }
        fetchPost("/api/bazaar/getUpdatedPackage", {frontend: getFrontend()}, (response) => {
            if (requestID !== this._updateRequestID || !this._isMountCurrent(mount) || !this.element?.isConnected) {
                return;
            }
            if (response.code !== 0 || !response.data) {
                this._updateState = "error";
                this._syncUpdateTabCounter();
                if (this._isUpdatePanelActive()) {
                    this._renderUpdatePanel();
                }
                return;
            }
            this._data.update = response.data;
            this._updateState = "loaded";
            this._syncUpdateTabCounter();
            this._syncDownloadedUpdateButtons();
            if (this._isUpdatePanelActive()) {
                this._renderUpdatePanel();
            }
        });
    },
    _renderUpdatePanel() {
        const contentElement = bazaar.element.querySelector("#configBazaarDownloaded");
        const counterElement = contentElement.previousElementSibling.querySelector(".counter");
        const installAllElement = contentElement.previousElementSibling.querySelector('[data-type="install-all"].b3-button');
        installAllElement?.classList.add("fn__none");
        if (this._updateState === "loading" || this._updateState === "idle") {
            counterElement.classList.add("fn__none");
            contentElement.innerHTML = `<div style="height: ${bazaar.element.clientHeight - 160}px;display: flex;align-items: center;justify-content: center;"><img src="/stage/loading-pure.svg"></div>`;
            return;
        }
        if (this._updateState === "error") {
            counterElement.classList.add("fn__none");
            contentElement.innerHTML = `<div class="fn__flex-center" style="height: 96px">
    <span>${window.siyuan.languages.bazaarCheckUpdateFailed}</span>
    <span class="fn__space"></span>
    <button class="b3-button" data-type="retry-update">${window.siyuan.languages.retry}</button>
</div>`;
            return;
        }
        const items: Array<{type: TBazaarType, item: IUpdatedBazaarItem}> = this._getUpdatedItems();
        if (items.length === 0) {
            counterElement.classList.add("fn__none");
            contentElement.innerHTML = `<ul class="b3-list b3-list--background"><li class="b3-list--empty">${window.siyuan.languages.emptyContent}</li></ul>`;
            return;
        }
        counterElement.classList.remove("fn__none");
        counterElement.textContent = items.length.toString();
        installAllElement?.classList.toggle("fn__none",
            !items.some(({item}) => !item.available.disallowUpdate));
        contentElement.innerHTML = items.map(({type, item}) => this._genUpdateItemHTML(item, type)).join("");
        loadUpdatedRatings(this);
    },
    _syncDownloadedUpdateButtons() {
        bazaar.element.querySelectorAll("#configBazaarDownloaded .b3-card[data-package-source='downloaded']").forEach((card) => {
            const type = card.getAttribute("data-package-type") as TBazaarType;
            const name = card.getAttribute("data-name");
            const slot = card.querySelector('[data-type="install-t"]');
            if (!slot || !type || !name) {
                return;
            }
            const available = bazaar._getUpdatedItem(type, name)?.available;
            slot.outerHTML = bazaar._genUpdateButtonHTML(available, type, true);
        });
        const sideElement = bazaar.element.querySelector("#configBazaarReadme.config__view--show .item__side");
        if (sideElement?.getAttribute("data-from") === "downloaded") {
            const type = sideElement.getAttribute("data-package-type") as TBazaarType;
            const name = sideElement.getAttribute("data-name");
            const slot = sideElement.querySelector('[data-type="readme-update-slot"]');
            const available = type && name ? bazaar._getUpdatedItem(type, name)?.available : undefined;
            if (slot) {
                slot.outerHTML = bazaar._genReadmeUpdateButtonHTML(available, type, true);
                sideElement.setAttribute("data-progress-id", available?.repoURL || sideElement.getAttribute("data-repourl") || "");
            }
        }
    },
    _cacheBazaarDeprecations(bazaarType: TBazaarType, packages: IBazaarItem[]) {
        const metadata = new Map<string, IBazaarItem>();
        packages.forEach((item) => {
            metadata.set(item.name, item);
        });
        bazaar._data.deprecationMetadata.set(bazaarType, metadata);
        bazaar._data.deprecationTypesLoaded.add(bazaarType);
    },
    _applyDownloadedDeprecations(bazaarType: TBazaarType, packages: IBazaarItem[]) {
        if (!bazaar._data.deprecationTypesLoaded.has(bazaarType)) {
            return;
        }
        const metadata = bazaar._data.deprecationMetadata.get(bazaarType);
        packages.forEach((item) => {
            applyBazaarPackageDeprecation(item, metadata?.get(item.name));
        });
    },
    _loadDownloadedDeprecations(bazaarType: TBazaarType, app: App) {
        if (bazaar._data.deprecationTypesLoaded.has(bazaarType) ||
            bazaar._data.deprecationTypesLoading.has(bazaarType)) {
            return;
        }
        const mount = bazaar._captureMount();
        bazaar._data.deprecationTypesLoading.add(bazaarType);
        const config = BAZAAR_PACKAGE_CONFIG[bazaarType];
        const requestData = config.bazaarRequestUsesFrontend ? {frontend: getFrontend()} : {};
        fetchPost(config.api.bazaar, requestData, response => {
            bazaar._data.deprecationTypesLoading.delete(bazaarType);
            if (!bazaar._isMountCurrent(mount) || response.code !== 0 || !Array.isArray(response.data?.packages)) {
                return;
            }
            bazaar._cacheBazaarDeprecations(bazaarType, response.data.packages);
            if (bazaar._data.downloadedType !== bazaarType) {
                return;
            }
            const contentElement = bazaar.element.querySelector("#configBazaarDownloaded");
            const activeBtn = contentElement?.previousElementSibling?.querySelector(
                '.b3-button[data-type^="my"]:not(.b3-button--outline)'
            ) as HTMLElement;
            if (activeBtn?.getAttribute("data-type") === config.myType) {
                bazaar._genMyHTML(bazaarType, app, true);
            }
        });
    },
    _genMyHTML(bazaarType: TBazaarType, app: App, preserveOrder = false) {
        const contentElement = bazaar.element.querySelector("#configBazaarDownloaded");
        const config = BAZAAR_PACKAGE_CONFIG[bazaarType];
        const myType = config.myType;
        const typeBtn = contentElement.previousElementSibling.querySelector(`[data-type="${myType}"]`) as HTMLElement;
        if (contentElement.getAttribute("data-loading") === "true" ||
            typeBtn?.classList.contains("b3-button--outline")) {
            return false;
        }
        if (bazaarType === "plugins") {
            bazaar._downloadedPluginsReady = false;
            bazaar._syncPluginGlobalSwitch();
        }
        bazaar._updateDownloadedToolbar(bazaarType);
        contentElement.setAttribute("data-loading", "true");
        bazaar._updateDownloadedSortSelect(bazaarType);
        const initialSortValue = bazaar._getDownloadedSortValue(bazaarType);
        const mount = bazaar._captureMount();
        fetchPost(config.api.installed, {
            frontend: getFrontend(),
            keyword: (contentElement.previousElementSibling.querySelector(".b3-text-field") as HTMLInputElement)?.value || "",
        }, response => {
            if (!bazaar._isMountCurrent(mount)) {
                return;
            }
            contentElement.removeAttribute("data-loading");
            const activeBtn = contentElement.previousElementSibling.querySelector('.b3-button[data-type^="my"]:not(.b3-button--outline)') as HTMLElement;
            if (activeBtn?.getAttribute("data-type") !== myType) {
                return;
            }
            const packageItems = response.data.packages as IBazaarItem[];
            bazaar._applyDownloadedDeprecations(bazaarType, packageItems);
            const currentSortValue = bazaar._getDownloadedSortValue(bazaarType);
            const packages = preserveOrder && initialSortValue === currentSortValue ?
                bazaar._preserveDownloadedOrder(packageItems) :
                bazaar._sortDownloadedPackages(packageItems, currentSortValue);
            let html = "";
            const counterElement = contentElement.previousElementSibling.querySelector(".counter");
            if (packages.length === 0) {
                counterElement.classList.add("fn__none");
            } else {
                counterElement.classList.remove("fn__none");
                counterElement.textContent = packages.length.toString();
                html = packages.map((bazaarItem: IBazaarItem) => {
                    if (bazaarItem.invalidReason) {
                        return bazaar._genInvalidDownloadedCardHTML(bazaarItem, bazaarType);
                    }
                    const showSwitch = ["icons", "themes"].includes(bazaarType) && !bazaarItem.current;
                    const showDisable = ["icons", "themes"].includes(bazaarType) && bazaarItem.current;
                    const plugin = bazaarType === "plugins" ?
                        app.plugins.find((item: Plugin) => item.name === bazaarItem.name) : undefined;
                    const hasSetting = plugin ? hasPluginSetting(plugin) : false;
                    const showPublishSwitch = bazaarType === "plugins" && window.siyuan.config.publish.enable;
                    const publishEnabled = isBazaarPluginEnabledInPublish(bazaarItem);
                    const publishSwitchHTML = showPublishSwitch ? `<label data-type="plugin-publish-enable-label" class="config-bazaar__publish-switch" title="${escapeAttr(bazaarItem.disabledInPublish ? window.siyuan.languages.pluginDisabledInPublishTip : window.siyuan.languages.publishService)}">
                <input data-type="plugin-publish-enable" data-position="north" class="b3-switch fn__flex-center" type="checkbox"${publishEnabled ? " checked" : ""}${bazaarItem.disabledInPublish ? " disabled" : ""}>
                <span class="fn__space--small"></span>
                <span class="fn__flex-center ft__on-surface">${window.siyuan.languages.publishService}</span>
            </label>` : "";
                    const available = bazaar._getUpdatedItem(bazaarType, bazaarItem.name)?.available;
                    const ratingKey = getRatingKey(bazaarType, bazaarItem.name);
                    return `<div data-name="${escapeAttr(bazaarItem.name)}" data-package-type="${bazaarType}" data-package-source="downloaded" class="b3-card${bazaarItem.current ? " b3-card--current" : ""}">
    <div class="b3-card__img">${bazaar._genPackageIconHTML(bazaarItem.iconURL)}</div>
    <div class="fn__flex-1 fn__flex-column">
        <div class="b3-card__info b3-card__info--left fn__flex-1">
            ${escapeHtml(bazaarItem.preferredName)}
            <div class="b3-card__desc" title="${escapeAttr(bazaarItem.preferredDesc)}">${escapeHtml(bazaarItem.preferredDesc)}</div>
            ${showPublishSwitch && !isMobile() ? `<div class="fn__hr--b"></div>${publishSwitchHTML}` : ""}
        </div>
    </div>
    <div class="b3-card__actions b3-card__actions--right">
        ${isMobile() ? publishSwitchHTML : ""}
        ${bazaar._genUpdateButtonHTML(available, bazaarType, true)}
        ${genRatePackageActionHTML(bazaar._data.downloadedRatingKeys.has(ratingKey), bazaar._data.userRatings.get(ratingKey))}
        ${bazaar._genIncompatibleChipHTML(bazaarItem, "installed", bazaarType)}
        ${bazaar._genDeprecatedChipHTML(bazaarItem, false)}
        ${bazaar._genFundingHTML(bazaarItem.preferredFunding, false)}
        ${hasSetting ? `<span data-position="north" class="ariaLabel block__icon block__icon--show${window.siyuan.config.bazaar.petalDisabled ? " fn__none" : ""}" data-type="setting" aria-label="${window.siyuan.languages.config}">
            <svg><use xlink:href="#iconSettings"></use></svg>
        </span>` : ""}
        <span data-position="north" class="ariaLabel block__icon block__icon--show" data-type="uninstall" aria-label="${window.siyuan.languages.uninstall}">
            <svg><use xlink:href="#iconTrashcan"></use></svg>
        </span>
        <span data-position="north" class="ariaLabel block__icon block__icon--show${isBrowser() ? " fn__none" : ""}" data-type="open" aria-label="${window.siyuan.languages.showInFolder}">
            <svg><use xlink:href="#iconFolder"></use></svg>
        </span>
        ${bazaar._genOpenStorageHTML(bazaarItem, bazaarType)}
        <span data-position="north" class="ariaLabel block__icon block__icon--show${showSwitch ? "" : " fn__none"}" data-type="switch" aria-label="${window.siyuan.languages.use}">
            <svg><use xlink:href="#iconSelect"></use></svg>
        </span>
        <span data-position="north" class="ariaLabel block__icon block__icon--show${showDisable ? "" : " fn__none"}" data-type="package-disable" aria-label="${window.siyuan.languages.disable}">
            <svg><use xlink:href="#iconClose"></use></svg>
        </span>
        <span class="fn__space${bazaarType === "plugins" ? "" : " fn__none"}"></span>
        <span class="fn__space${bazaarType === "plugins" ? "" : " fn__none"}"></span>
        <input ${((bazaarItem.disallowInstall && !bazaarItem.enabled) || bazaarItem.installedIncompatible) ? "disabled" : ""} 
aria-label="${(bazaarItem.disallowInstall && !bazaarItem.enabled) ? window.siyuan.languages.bazaarNeedVersion.replace("${x}", bazaarItem.minAppVersion) : window.siyuan.languages[bazaarItem.enabled ? "disable" : "enable"]}"
data-position="north" class="ariaLabel b3-switch fn__flex-center${bazaarType === "plugins" ? "" : " fn__none"}" 
${bazaarItem.enabled ? "checked" : ""} 
data-type="plugin-enable" 
data-disabletip="${bazaarItem.disallowInstall ? window.siyuan.languages.bazaarNeedVersion.replace("${x}", bazaarItem.minAppVersion) : ""}"
type="checkbox">
    </div>
</div>`;
                }).join("");
            }
            bazaar._data.downloadedDefault = packageItems;
            bazaar._data.downloaded = packages;
            bazaar._data.downloadedType = bazaarType;
            contentElement.innerHTML = html ? html : `<ul class="b3-list b3-list--background"><li class="b3-list--empty">${window.siyuan.languages.emptyContent}</li></ul>`;
            if (bazaarType === "plugins") {
                bazaar._downloadedPluginsReady = true;
                bazaar._syncPluginGlobalSwitch();
            }
            loadDownloadedRatings(bazaar, bazaarType, packageItems);
            loadDownloadedUserRatings(bazaar, bazaarType, packageItems);
            bazaar._loadDownloadedDeprecations(bazaarType, app);
            const sideElement = bazaar.element.querySelector("#configBazaarReadme.config__view--show .item__side");
            // 仅刷新「已下载」详情，避免通过 URI 打开的在线详情被本地数据覆盖
            if (sideElement?.getAttribute("data-from") === "downloaded" &&
                sideElement.getAttribute("data-package-type") === bazaarType) {
                const packageName = sideElement.getAttribute("data-name");
                const downloadedItem = bazaar._data.downloaded.find((item) => item.name === packageName);
                if (downloadedItem) {
                    const detail = bazaar._getPackageDetail(bazaarType, packageName);
                    bazaar._setPackageDetail(bazaarType, packageName, {
                        ...detail,
                        installed: downloadedItem,
                    });
                    bazaar._refreshReadmeDetail(bazaarType, packageName);
                }
            }
        });
        return true;
    },
    _data: {
        themes: [] as IBazaarItem[],
        templates: [] as IBazaarItem[],
        icons: [] as IBazaarItem[],
        widgets: [] as IBazaarItem[],
        plugins: [] as IBazaarItem[],
        downloadedDefault: [] as IBazaarItem[],
        downloaded: [] as IBazaarItem[],
        downloadedType: undefined as TBazaarType | undefined,
        deprecationMetadata: new Map<TBazaarType, Map<string, IBazaarItem>>(),
        deprecationTypesLoaded: new Set<TBazaarType>(),
        deprecationTypesLoading: new Set<TBazaarType>(),
        downloadedRatingKeys: new Set<string>(),
        ratings: new Map<string, IBazaarRating>(),
        userRatings: new Map<string, number>(),
        userRatingKeys: new Set<string>(),
        userRatingLoadingKeys: new Set<string>(),
        userRatingSubmittingKeys: new Set<string>(),
        userRatingSubmitRequestIDs: new Map<string, number>(),
        userRatingBatchRequestIDs: new Map<string, number>(),
        ratingBatchRequestIDs: new Map<TBazaarType, number>(),
        ratingMutationVersions: new Map<string, number>(),
        details: new Map<string, IBazaarPackageDetail>(),
        update: {
            themes: [] as IUpdatedBazaarItem[],
            templates: [] as IUpdatedBazaarItem[],
            icons: [] as IUpdatedBazaarItem[],
            widgets: [] as IUpdatedBazaarItem[],
            plugins: [] as IUpdatedBazaarItem[],
        }
    },
    _upsertReadmeData(bazaarType: TBazaarType, from: "downloaded" | "updated" | "bazaar", data: IBazaarItem) {
        const upsert = (list: IBazaarItem[]) => {
            const index = list.findIndex((item) => item.name === data.name);
            if (index >= 0) {
                list[index] = data;
            } else {
                list.push(data);
            }
        };
        if (from === "downloaded") {
            upsert(bazaar._data.downloaded);
        } else if (from === "updated") {
            const updated = bazaar._data.update[bazaarType].find((item) => item.installed.name === data.name);
            if (updated) {
                updated.available = data;
            }
        } else {
            upsert(bazaar._data[bazaarType]);
        }
    },
    _renderReadme(bazaarType: TBazaarType, from: "downloaded" | "updated" | "bazaar", data: IBazaarItem, detail?: IBazaarPackageDetail) {
        const mount = bazaar._captureMount();
        const readmeElement = bazaar.element.querySelector("#configBazaarReadme") as HTMLElement;
        const navTitle = window.siyuan.languages[BAZAAR_PACKAGE_CONFIG[bazaarType].languageKey];
        bazaar._upsertReadmeData(bazaarType, from, data);
        const updatedDetail = from === "updated" ? bazaar._getUpdatedItem(bazaarType, data.name) : undefined;
        const installed = detail?.installed || updatedDetail?.installed || (from === "downloaded" ? data : undefined);
        const available = detail?.available || updatedDetail?.available ||
            (from === "downloaded" ? bazaar._getUpdatedItem(bazaarType, data.name)?.available : data);
        const displayData = from === "downloaded" ? installed || data : available || data;
        const ratingKey = getRatingKey(bazaarType, displayData.name);
        const ratingLoaded = isBazaarPackageRatingLoaded(from, bazaar._data.downloadedRatingKeys.has(ratingKey),
            displayData.ratingAvailable);
        if (from !== "bazaar" && ratingLoaded) {
            const rating = bazaar._data.ratings.get(ratingKey);
            if (rating) {
                displayData.rating = rating;
            } else {
                delete displayData.rating;
            }
        }
        const compatibilityData = getBazaarCompatibilityData(from, installed, available, data);
        const deprecationData = getBazaarDeprecationData(installed, available, data);
        const resourceData = available || displayData;
        bazaar._setPackageDetail(bazaarType, data.name, {installed, available});
        const urls = resourceData.repoURL.split("/");
        urls.pop();
        const compatibilityFieldVisibility = getBazaarCompatibilityFieldVisibility(bazaarType);
        const frontendLabels = compatibilityFieldVisibility.frontends ?
            bazaar._getFrontendLabels(compatibilityData.frontends, bazaarType === "themes") : [];
        const systemLabels = compatibilityFieldVisibility.systems ?
            getBazaarBackendSystemLabels(compatibilityData.backends, window.siyuan.languages.all) : [];
        const kernelSystemLabels = compatibilityFieldVisibility.kernelSystems ?
            getBazaarKernelSystemLabels(compatibilityData.kernels, window.siyuan.languages.all) : [];
        const modeLabels = compatibilityFieldVisibility.modes ? getBazaarThemeModeLabels(
            compatibilityData.modes,
            window.siyuan.languages.themeLight,
            window.siyuan.languages.themeDark,
        ) : [];
        const installSection = installed ? `<section class="item__meta-section">
    <div class="item__meta-title">${window.siyuan.languages.bazaarInstallInfo}</div>
    ${bazaar._genReadmeMetaRow(window.siyuan.languages.version, `v${installed.version}`)}
    ${bazaar._genReadmeMetaRow(window.siyuan.languages.installDate, installed.hInstallDate)}
    ${bazaar._genReadmeMetaRow(window.siyuan.languages.installSize, `<span data-type="installed-size">${window.siyuan.languages.loading}</span>`, true)}
</section>` : "";
        const compatibilitySection = `<section class="item__meta-section">
    <div class="item__meta-title">${window.siyuan.languages.bazaarCompatibility}</div>
    ${bazaar._genReadmeMetaRow(window.siyuan.languages.bazaarMinAppVersion, compatibilityData.minAppVersion ? `v${compatibilityData.minAppVersion}` : "-")}
    ${compatibilityFieldVisibility.frontends ? bazaar._genReadmeMetaRow(window.siyuan.languages.bazaarPlatforms, frontendLabels.length ? bazaar._genReadmeChips(frontendLabels, true) : "-", true) : ""}
    ${compatibilityFieldVisibility.systems ? bazaar._genReadmeMetaRow(window.siyuan.languages.bazaarSystems, bazaar._genReadmeChips(systemLabels, true), true) : ""}
    ${kernelSystemLabels.length ? bazaar._genReadmeMetaRow(window.siyuan.languages.bazaarKernelPlugin, bazaar._genReadmeChips(kernelSystemLabels, true), true) : ""}
    ${compatibilityFieldVisibility.disabledInPublish ? bazaar._genReadmeMetaRow(window.siyuan.languages.publishService, compatibilityData.disabledInPublish ? window.siyuan.languages.disable : window.siyuan.languages.enable) : ""}
    ${compatibilityFieldVisibility.modes ? bazaar._genReadmeMetaRow(window.siyuan.languages.appearanceMode, modeLabels.length ? bazaar._genReadmeChips(modeLabels) : "-", true) : ""}
</section>`;
        const marketSection = available ? `<section class="item__meta-section">
    <div class="item__meta-title">${window.siyuan.languages.bazaarMarketInfo}</div>
    ${bazaar._genReadmeMetaRow(window.siyuan.languages.version, `v${available.version}`)}
    ${bazaar._genReadmeMetaRow(window.siyuan.languages.releaseDate, available.hUpdated)}
    ${bazaar._genReadmeMetaRow(window.siyuan.languages.pkgSize, available.hSize)}
    ${available.keywords?.length ? bazaar._genReadmeMetaRow(window.siyuan.languages.keywords, bazaar._genReadmeKeywords(available.keywords), true) : ""}
</section>` : "";
        const resourceStats = available ? `<div class="fn__hr"></div>
<div class="fn__flex">
    <svg class="svg ft__on-surface"><use xlink:href="#iconStar"></use></svg>
    <span class="fn__space--small"></span>
    <a href="${escapeAttr(resourceData.repoURL)}/stargazers" target="_blank" title="Stars">${formatCount(resourceData.stars)}</a>
    <span class="fn__space"></span>
    <svg class="svg ft__on-surface"><use xlink:href="#iconGitHubI"></use></svg>
    <span class="fn__space--small"></span>
    <a href="${escapeAttr(resourceData.repoURL)}/issues" target="_blank" title="Open issues">${formatCount(resourceData.openIssues)}</a>
    <span class="fn__space"></span>
    <svg class="svg ft__on-surface"><use xlink:href="#iconDownload"></use></svg>
    <span class="fn__space--small"></span>
    ${formatCount(resourceData.downloads)}
</div>` : "";
        const fundingItems = getBazaarFundingItems(resourceData.funding);
        if (fundingItems.length === 0 && resourceData.preferredFunding) {
            fundingItems.push({url: resourceData.preferredFunding});
        }
        const packageSection = `<section class="item__meta-section">
    <div class="item__meta-title">${window.siyuan.languages.bazaarPackageInfo}</div>
    ${bazaar._genReadmeMetaRow(window.siyuan.languages.bazaarPackageName, displayData.name)}
    ${displayData.author ? bazaar._genReadmeMetaRow(window.siyuan.languages.author, `<a href="${escapeAttr(urls.join("/"))}" target="_blank" title="${escapeAttr(urls.join("/"))}">${escapeHtml(displayData.author)}</a>`, true) : ""}
    ${fundingItems.length ? bazaar._genReadmeMetaRow(window.siyuan.languages.bazaarFunding, fundingItems.map((item) => bazaar._genReadmeFundingHTML(item)).join("<br>"), true) : ""}
</section>`;
        const backHeaderHTML = `<div class="item__header fn__pointer" data-type="goBack">
        <svg class="b3-list-item__graphic"><use xlink:href="#iconLeft"></use></svg>
        <span class="b3-list-item__text ft__breakword">${navTitle}</span>
    </div>`;
        const readmeActionsHTML = `<div class="item__actions${isMobile() ? " item__actions--mobile" : ""}" data-from="${from}" data-name="${escapeAttr(displayData.name)}" data-package-type="${bazaarType}">
        ${bazaar._genReadmeActionsHTML(bazaarType, installed, available)}
        ${bazaar._genReadmeUpdateButtonHTML(available, bazaarType, Boolean(installed))}
    </div>`;
        const previewHTML = displayData.previewURL ?
            `<div class="item__preview" data-preview-url="${escapeAttr(displayData.previewURL)}"></div>` : "";
        readmeElement.innerHTML = `${isMobile() ? backHeaderHTML : ""}<div class="item__body"><div class="item__side" data-from="${from}" data-name="${escapeAttr(displayData.name)}" data-package-type="${bazaarType}" data-repourl="${escapeAttr(resourceData.repoURL)}" data-progress-id="${escapeAttr(available?.repoURL || resourceData.repoURL)}">
    ${isMobile() ? "" : backHeaderHTML}
    <div class="fn__flex-1">
        ${bazaar._genPackageIconHTML(displayData.iconURL, true)}
        <div>
            <span class="item__title">${escapeHtml(displayData.preferredName)}</span>
        </div>
        <div class="item__meta">
            ${bazaar._genDeprecatedDetailHTML(deprecationData, bazaarType)}
            ${packageSection}
            ${installSection}
            ${marketSection}
            ${compatibilitySection}
            <div data-type="rating-detail-slot">${genReadmeRatingHTML(bazaar, bazaarType, displayData, ratingLoaded)}</div>
            <section class="item__meta-section item__resources">
                <div class="item__meta-title">${window.siyuan.languages.bazaarResources}</div>
                <div class="fn__flex">
                    <a href="${escapeAttr(resourceData.repoURL)}" target="_blank" title="${escapeAttr(resourceData.repoURL)}">GitHub</a>
                    <span class="fn__space"></span>
                    <a href="${escapeAttr(resourceData.repoURL)}/issues" target="_blank" title="Feedback via GitHub Issues" data-type="feedback">${window.siyuan.languages.feedback}</a>
                </div>
                ${resourceStats}
            </section>
        </div>
        <div class="fn__hr--b"></div>
    </div>
    ${isMobile() ? "" : readmeActionsHTML}
</div>
<div class="item__main">
    ${previewHTML}
    <div class="b3-typography${displayData.preferredDesc ? "" : " fn__none"}">
        <blockquote>
            <p>
                ${escapeHtml(displayData.preferredDesc)}
            </p>
         </blockquote>
    </div>
    <div class="item__readme b3-typography b3-typography--default">
        <img data-type="img-loading" style="height: 64px;width: 100%;padding: 16px 0;" src="/stage/loading-pure.svg">
    </div>
</div></div>${isMobile() ? readmeActionsHTML : ""}`;
        const previewElement = readmeElement.querySelector<HTMLElement>(".item__preview");
        if (previewElement) {
            previewElement.style.backgroundImage = `url(${JSON.stringify(displayData.previewURL)})`;
        }
        const isInstalledReadme = from === "downloaded";
        if (isInstalledReadme) {
            const mdElement = readmeElement.querySelector(".item__readme");
            mdElement.innerHTML = window.DOMPurify.sanitize(displayData.preferredReadme || "", BAZAAR_README_SANITIZE_OPTIONS);
            highlightRender(mdElement);
        } else {
            fetchPost("/api/bazaar/getBazaarPackageREADME", {
                repoURL: displayData.repoURL,
                repoHash: displayData.repoHash,
                packageType: bazaarType
            }, response => {
                if (!bazaar._isMountCurrent(mount)) {
                    return;
                }
                const sideElement = readmeElement.querySelector(".item__side");
                if (response.code !== 0 ||
                    sideElement?.getAttribute("data-package-type") !== bazaarType ||
                    sideElement.getAttribute("data-name") !== displayData.name) {
                    return;
                }
                const mdElement = readmeElement.querySelector(".item__readme");
                mdElement.innerHTML = window.DOMPurify.sanitize(response.data.html, BAZAAR_README_SANITIZE_OPTIONS);
                highlightRender(mdElement);
            });
        }
        const needsPackageDetail = !detail && (from === "downloaded" || (from === "bazaar" && data.installed));
        if (installed && !needsPackageDetail) {
            fetchPost("/api/bazaar/getInstalledPackageSize", {
                packageType: bazaarType,
                packageName: installed.name,
            }, response => {
                if (!bazaar._isMountCurrent(mount)) {
                    return;
                }
                const sideElement = readmeElement.querySelector(".item__side");
                if (sideElement?.getAttribute("data-package-type") !== bazaarType ||
                    sideElement.getAttribute("data-name") !== installed.name) {
                    return;
                }
                const sizeElement = sideElement.querySelector('[data-type="installed-size"]');
                if (sizeElement) {
                    sizeElement.textContent = response.code === 0 && response.data?.hInstallSize ? response.data.hInstallSize : "-";
                }
            });
        }
        readmeElement.classList.add("config__view--show");
        loadReadmeRating(bazaar, bazaarType, displayData.name, from);
        if (needsPackageDetail) {
            bazaar._fetchPackageDetail(bazaarType, data.name, (packageDetail) => {
                if (!readmeElement.classList.contains("config__view--show")) {
                    return;
                }
                const sideElement = readmeElement.querySelector(".item__side");
                if (sideElement?.getAttribute("data-from") !== from ||
                    sideElement.getAttribute("data-package-type") !== bazaarType ||
                    sideElement.getAttribute("data-name") !== data.name) {
                    return;
                }
                const refreshedData = from === "downloaded" ? packageDetail.installed || data : packageDetail.available || data;
                bazaar._renderReadme(bazaarType, from, refreshedData, packageDetail);
            });
        }
    },
    _getDownloadedSortValue(type: TBazaarType) {
        const value = window.siyuan.storage[Constants.LOCAL_BAZAAR][BAZAAR_PACKAGE_CONFIG[type].downloadedSortKey] || "0";
        if (type !== "plugins" && ["5", "6"].includes(value)) {
            return "0";
        }
        return value;
    },
    _updateDownloadedSortSelect(type: TBazaarType) {
        const selectElement = bazaar.element.querySelector('[data-type="downloaded-sort"]') as HTMLSelectElement;
        if (!selectElement) {
            return;
        }
        selectElement.value = bazaar._getDownloadedSortValue(type);
        selectElement.querySelectorAll('[data-plugin-only="true"]').forEach((option: HTMLOptionElement) => {
            option.hidden = type !== "plugins";
        });
    },
    _updateDownloadedToolbar(type: TBazaarType | "update") {
        const titleElement = bazaar.element.querySelector('.config-bazaar__panel[data-type="downloaded"] .config-bazaar__title');
        const isUpdate = type === "update";
        titleElement?.querySelectorAll(".config-bazaar__filter, .config-bazaar__sort").forEach((element) => {
            element.classList.toggle("fn__none", isUpdate);
        });
        titleElement?.querySelector('[data-type="plugins-enable"]')?.classList.toggle("fn__none", type !== "plugins");
        if (!isUpdate) {
            titleElement?.querySelector('[data-type="install-all"].b3-button')?.classList.add("fn__none");
        }
    },
    _preserveDownloadedOrder(packages: IBazaarItem[]) {
        const positions = new Map(bazaar._data.downloaded.map((item, index) => [item.name, index]));
        return packages.map((item, index) => ({item, index})).sort((a, b) => {
            const aPosition = positions.get(a.item.name);
            const bPosition = positions.get(b.item.name);
            if (aPosition === undefined && bPosition === undefined) {
                return a.index - b.index;
            }
            if (aPosition === undefined) {
                return 1;
            }
            if (bPosition === undefined) {
                return -1;
            }
            return aPosition - bPosition;
        }).map((entry) => entry.item);
    },
    _sortDownloadedPackages(packages: IBazaarItem[], sortValue: string) {
        const indexed = packages.map((item, index) => ({item, index}));
        const sortByTime = (field: "installTime" | "updateTime", descending: boolean) => {
            return indexed.sort((a, b) => {
                const aTime = a.item[field] || 0;
                const bTime = b.item[field] || 0;
                if (aTime < 1 && bTime < 1) {
                    return a.index - b.index;
                }
                if (aTime < 1) {
                    return 1;
                }
                if (bTime < 1) {
                    return -1;
                }
                const result = descending ? bTime - aTime : aTime - bTime;
                return result || a.index - b.index;
            }).map((entry) => entry.item);
        };
        if (sortValue === "1") {
            return sortByTime("installTime", true);
        }
        if (sortValue === "2") {
            return sortByTime("installTime", false);
        }
        if (sortValue === "3") {
            return sortByTime("updateTime", true);
        }
        if (sortValue === "4") {
            return sortByTime("updateTime", false);
        }
        if (["5", "6"].includes(sortValue)) {
            return indexed.sort((a, b) => {
                const aEnabled = a.item.enabled ? 1 : 0;
                const bEnabled = b.item.enabled ? 1 : 0;
                const result = sortValue === "5" ? bEnabled - aEnabled : aEnabled - bEnabled;
                return result || a.index - b.index;
            }).map((entry) => entry.item);
        }
        return [...packages];
    },
    _reorderDownloadedCards(packages: IBazaarItem[]) {
        const contentElement = bazaar.element.querySelector("#configBazaarDownloaded");
        const cards = new Map(Array.from(contentElement.children).filter((item) => item.classList.contains("b3-card")).map((card) => [
            card.getAttribute("data-name"),
            card,
        ]));
        const fragment = document.createDocumentFragment();
        packages.forEach((item) => {
            const card = cards.get(item.name);
            if (card) {
                fragment.append(card);
            }
        });
        contentElement.append(fragment);
        bazaar._data.downloaded = packages;
    },
    _refreshReadmeDetail(bazaarType: TBazaarType, packageName: string) {
        const sideElement = bazaar.element.querySelector("#configBazaarReadme.config__view--show .item__side");
        if (sideElement?.getAttribute("data-package-type") !== bazaarType ||
            sideElement.getAttribute("data-name") !== packageName) {
            return;
        }
        const from = sideElement.getAttribute("data-from") as "downloaded" | "updated" | "bazaar";
        const cached = bazaar._getPackageDetail(bazaarType, packageName);
        const fallback = from === "downloaded" ? cached?.installed : cached?.available;
        if (!fallback) {
            return;
        }
        bazaar._fetchPackageDetail(bazaarType, packageName, (detail) => {
            const currentSideElement = bazaar.element.querySelector("#configBazaarReadme.config__view--show .item__side");
            if (currentSideElement?.getAttribute("data-from") !== from ||
                currentSideElement.getAttribute("data-package-type") !== bazaarType ||
                currentSideElement.getAttribute("data-name") !== packageName) {
                return;
            }
            const refreshedData = from === "downloaded" ? detail.installed || fallback : detail.available || fallback;
            bazaar._renderReadme(bazaarType, from, refreshedData, detail);
        });
    },
    _reloadBazaarType(bazaarType: TBazaarType) {
        const config = BAZAAR_PACKAGE_CONFIG[bazaarType];
        const mount = bazaar._beginBazaarRequest(bazaarType);
        const keyword = (mount.element.querySelector(
            `.config-bazaar__panel[data-type="${config.tabType}"] .b3-text-field`) as HTMLInputElement)?.value.trim() || "";
        fetchPost(config.api.bazaar, {
            ...(config.bazaarRequestUsesFrontend ? {frontend: getFrontend()} : {}),
            keyword,
        }, response => {
            if (response.code === 0) {
                bazaar._onBazaar(response, bazaarType, mount);
            }
        });
    },
    _refreshPackageUI(bazaarType: TBazaarType, packageName: string, app: App) {
        const sideElement = bazaar.element.querySelector("#configBazaarReadme.config__view--show .item__side");
        const refreshFromDownloadedList = sideElement?.getAttribute("data-from") === "downloaded" &&
            sideElement.getAttribute("data-package-type") === bazaarType;
        const refreshDownloadedList = bazaar._genMyHTML(bazaarType, app);
        if (bazaarType !== "plugins") {
            bazaar._reloadBazaarType(bazaarType);
        }
        if (!refreshFromDownloadedList || !refreshDownloadedList) {
            bazaar._refreshReadmeDetail(bazaarType, packageName);
        }
    },
    _updateReadmePluginAction(packageName: string, enabled?: boolean, disabled = false) {
        const readmeElement = bazaar.element?.querySelector("#configBazaarReadme.config__view--show");
        const sideElement = readmeElement?.querySelector(".item__side");
        if (sideElement?.getAttribute("data-package-type") !== "plugins" ||
            sideElement.getAttribute("data-name") !== packageName) {
            return;
        }
        const actionElement = readmeElement.querySelector(
            '.item__actions [data-type="package-enable"], .item__actions [data-type="package-disable"]'
        ) as HTMLButtonElement;
        if (!actionElement) {
            return;
        }
        if (typeof enabled === "boolean") {
            actionElement.dataset.type = enabled ? "package-disable" : "package-enable";
            actionElement.textContent = window.siyuan.languages[enabled ? "disable" : "enable"];
        }
        actionElement.toggleAttribute("disabled", disabled);
    },
    _setPluginEnabled(app: App, item: Pick<IBazaarItem, "name" | "enabled">, enabled: boolean, callback: () => void) {
        if (bazaar._pluginEnablePending.has(item.name)) {
            bazaar._updateReadmePluginAction(item.name, undefined, true);
            return;
        }
        bazaar._pluginEnablePending.add(item.name);
        bazaar._updateReadmePluginAction(item.name, undefined, true);
        fetchPost("/api/petal/setPetalEnabled", {
            packageName: item.name,
            enabled,
            app: Constants.SIYUAN_APPID,
        }, response => {
            if (response.code !== 0) {
                showMessage(response.msg);
                bazaar._pluginEnablePending.delete(item.name);
                bazaar._updateReadmePluginAction(item.name, item.enabled, false);
                callback();
                return;
            }
            item.enabled = enabled;
            const installed = bazaar._getPackageDetail("plugins", item.name)?.installed;
            if (installed) {
                installed.enabled = enabled;
            }
            bazaar._updateReadmePluginAction(item.name, enabled, true);
            const finish = () => {
                bazaar._pluginEnablePending.delete(item.name);
                bazaar._updateReadmePluginAction(item.name, enabled, false);
                callback();
            };
            if (!enabled) {
                unloadPlugin(app, item.name).then(finish);
                return;
            }
            if (window.siyuan.config.bazaar.petalDisabled) {
                showMessage(window.siyuan.languages.pluginGlobalDisabledTip);
                finish();
                return;
            }
            loadPlugin(app, response.data).then(finish, (error) => {
                console.error(error);
                finish();
            });
        });
    },
    _setPluginPublishEnabled(item: IBazaarItem, enabled: boolean, callback: () => void) {
        fetchPost("/api/petal/setPetalPublishEnabled", {
            packageName: item.name,
            enabled,
        }, response => {
            if (response.code !== 0) {
                showMessage(response.msg);
                callback();
                return;
            }
            item.userDisabledInPublish = !enabled;
            callback();
        });
    },
    _resolveThemeAppearanceMode(item: IBazaarItem) {
        const appearance = window.siyuan.config.appearance;
        const modes = item.modes || [];
        const currentMode = appearance.mode;
        const supportsCurrentMode = modes.length === 0 ||
            modes.includes(currentMode === 0 ? "light" : "dark");
        if (supportsCurrentMode) {
            return {
                mode: currentMode,
                modeOS: appearance.modeOS,
            };
        }
        return {
            mode: modes.includes("dark") ? 1 : 0,
            modeOS: false,
        };
    },
    _setAppearancePackage(bazaarType: "themes" | "icons", item: IBazaarItem, enabled: boolean, callback: () => void) {
        const appearance = {...window.siyuan.config.appearance};
        if (bazaarType === "icons") {
            appearance.icon = enabled ? item.name : "litheness";
        } else if (enabled) {
            const modes = item.modes || [];
            const supportsLight = modes.length === 0 ? appearance.mode === 0 : modes.includes("light");
            const supportsDark = modes.length === 0 ? appearance.mode === 1 : modes.includes("dark");
            if (supportsLight) {
                appearance.themeLight = item.name;
            }
            if (supportsDark) {
                appearance.themeDark = item.name;
            }
            const themeAppearanceMode = bazaar._resolveThemeAppearanceMode(item);
            appearance.mode = themeAppearanceMode.mode;
            appearance.modeOS = themeAppearanceMode.modeOS;
        } else {
            if (appearance.themeLight === item.name) {
                appearance.themeLight = "daylight";
            }
            if (appearance.themeDark === item.name) {
                appearance.themeDark = "midnight";
            }
        }
        fetchPost("/api/setting/setAppearance", appearance, response => {
            if (response.code !== 0) {
                showMessage(response.msg);
                callback();
                return;
            }
            window.siyuan.config.appearance = response.data;
            callback();
        });
    },
    _initBazaarPanel(bazaarType: TBazaarType, panel: HTMLElement) {
        if (panel.getAttribute("data-init")) {
            return;
        }
        const mount = bazaar._beginBazaarRequest(bazaarType);
        const config = BAZAAR_PACKAGE_CONFIG[bazaarType];
        fetchPost(config.api.bazaar, config.bazaarRequestUsesFrontend ? {frontend: getFrontend()} : {}, response => {
            bazaar._onBazaar(response, bazaarType, mount);
        });
        panel.setAttribute("data-init", "true");
    },
    /** 切换集市顶部 Tab */
    switchBazaarTab(app: App, bazaarType: TBazaarType, from: "downloaded" | "updated" | "bazaar") {
        if (!bazaar.element) {
            return;
        }
        const layoutTabType = from === "bazaar" ? BAZAAR_PACKAGE_CONFIG[bazaarType].tabType : "downloaded";
        const focusItem = bazaar.element.querySelector(`.layout-tab-bar .item[data-type="${layoutTabType}"]`);
        const currentFocus = bazaar.element.querySelector(".layout-tab-bar .item--focus");
        if (focusItem && focusItem !== currentFocus) {
            currentFocus?.classList.remove("item--focus");
            focusItem.classList.add("item--focus");
        }
        bazaar.element.querySelectorAll(".config-bazaar__panel").forEach((panel) => {
            const panelType = panel.getAttribute("data-type");
            const isActive = panelType === layoutTabType;
            panel.classList.toggle("fn__none", !isActive);
            bazaar._setBazaarPanelActive(panel, isActive);
            if (isActive && from === "bazaar") {
                bazaar._initBazaarPanel(bazaarType, panel as HTMLElement);
            }
        });
        if (from !== "bazaar") {
            const myType = from === "updated" ? "myUpdate" : BAZAAR_PACKAGE_CONFIG[bazaarType].myType;
            const titleBar = bazaar.element.querySelector('.config-bazaar__panel[data-type="downloaded"] .config-bazaar__title');
            titleBar?.querySelectorAll('.b3-button[data-type^="my"]').forEach((btn) => {
                btn.classList.toggle("b3-button--outline", btn.getAttribute("data-type") !== myType);
            });
            bazaar.element.querySelector("#configBazaarDownloaded")?.removeAttribute("data-loading");
            if (from === "updated") {
                bazaar._updateDownloadedToolbar("update");
                bazaar._renderUpdatePanel();
                bazaar._checkUpdate();
            } else {
                bazaar._genMyHTML(bazaarType, app);
            }
        }
    },
    _setLocalPackageUploading(uploading: boolean, mount: IBazaarMountSnapshot) {
        bazaar._localPackageUploading = uploading;
        if (!bazaar._isMountCurrent(mount)) {
            return;
        }
        const labelElement = mount.element.querySelector('[data-type="install-local-package"]');
        const inputElement = labelElement?.querySelector('input[type="file"]') as HTMLInputElement;
        labelElement?.toggleAttribute("disabled", uploading);
        if (inputElement) {
            inputElement.disabled = uploading;
        }
    },
    _installLocalPackage(file: File, app: App, mount: IBazaarMountSnapshot, overwrite = false) {
        if (bazaar._localPackageUploading) {
            return;
        }
        bazaar._setLocalPackageUploading(true, mount);
        const formData = new FormData();
        formData.append("file", file);
        formData.append("frontend", getFrontend());
        formData.append("overwrite", overwrite.toString());
        fetchPost("/api/bazaar/installLocalBazaarPackage", formData, (response) => {
            const data = response.data as {
                reason?: string;
                packageType?: TBazaarType;
                packageName?: string;
                minAppVersion?: string;
                updated?: boolean;
            };
            if (response.code !== 0) {
                if (data?.reason === "package-exists" && data.packageName) {
                    confirmDialog("⚠️ " + window.siyuan.languages.update,
                        window.siyuan.languages.confirmOverwriteLocalBazaarPackage.replace("${name}", escapeHtml(data.packageName)), () => {
                            bazaar._installLocalPackage(file, app, mount, true);
                        });
                } else if (data?.reason === "package-incompatible") {
                    showMessage(data.minAppVersion ?
                        window.siyuan.languages.bazaarNeedVersion.replace("${x}", data.minAppVersion) :
                        window.siyuan.languages.incompatible);
                } else {
                    showMessage(escapeHtml(response.msg));
                }
                return;
            }
            if (!data?.packageType || !data.packageName) {
                showMessage(window.siyuan.languages.uploadError);
                return;
            }
            bazaar._data.details.delete(bazaar._getDetailKey(data.packageType, data.packageName));
            bazaar._data.update[data.packageType] = bazaar._data.update[data.packageType].filter((item) =>
                item.installed.name !== data.packageName);
            if (bazaar._isMountCurrent(mount)) {
                mount.element.querySelector("#configBazaarReadme")?.classList.remove("config__view--show");
                bazaar._syncUpdateTabCounter();
                bazaar.switchBazaarTab(app, data.packageType, "downloaded");
            }
            if (data.packageType === "plugins" && !data.updated) {
                if (window.siyuan.config.bazaar.petalDisabled) {
                    confirmDialog(window.siyuan.languages.confirm, window.siyuan.languages.enablePluginTip2);
                } else {
                    confirmDialog("💡 " + window.siyuan.languages.enablePlugin, window.siyuan.languages.enablePluginTip, () => {
                        bazaar._setPluginEnabled(app, {name: data.packageName, enabled: false}, true, () => {
                            if (bazaar._isMountCurrent(mount)) {
                                bazaar._genMyHTML("plugins", app, false);
                            }
                        });
                    });
                }
            }
        }).finally(() => {
            const activeMount = bazaar._isMountCurrent(mount) ? mount : bazaar._captureMount();
            bazaar._setLocalPackageUploading(false, activeMount);
        });
    },
    _getLocalPackageFile(files: FileList | null) {
        if (files?.length !== 1 || !files[0].name.toLowerCase().endsWith(".zip")) {
            showMessage(window.siyuan.languages.localBazaarPackageFileError);
            return;
        }
        return files[0];
    },
    _bindLocalPackageEvent(app: App, mount: IBazaarMountSnapshot) {
        const inputElement = mount.element.querySelector('[data-type="local-package-file"]') as HTMLInputElement;
        inputElement?.addEventListener("change", () => {
            const file = bazaar._getLocalPackageFile(inputElement.files);
            inputElement.value = "";
            if (file) {
                bazaar._installLocalPackage(file, app, mount);
            }
        });
        if (getFrontend() === "mobile") {
            return;
        }

        const dropTarget = mount.element.firstElementChild as HTMLElement;
        const dropElement = dropTarget.querySelector(".config-bazaar__drop");
        let dragDepth = 0;
        const isFileDrag = (event: DragEvent) => Array.from(event.dataTransfer?.types || []).includes("Files");
        dropTarget.addEventListener("dragenter", (event: DragEvent) => {
            if (!isFileDrag(event)) {
                return;
            }
            dragDepth++;
            dropElement.classList.remove("fn__none");
            event.preventDefault();
            event.stopPropagation();
        });
        dropTarget.addEventListener("dragover", (event: DragEvent) => {
            if (!isFileDrag(event)) {
                return;
            }
            event.dataTransfer.dropEffect = "copy";
            event.preventDefault();
            event.stopPropagation();
        });
        dropTarget.addEventListener("dragleave", (event: DragEvent) => {
            if (dragDepth === 0) {
                return;
            }
            dragDepth = Math.max(0, dragDepth - 1);
            if (dragDepth === 0) {
                dropElement.classList.add("fn__none");
            }
            event.stopPropagation();
        });
        dropTarget.addEventListener("drop", (event: DragEvent) => {
            if (!isFileDrag(event)) {
                return;
            }
            dragDepth = 0;
            dropElement.classList.add("fn__none");
            event.preventDefault();
            event.stopPropagation();
            const file = bazaar._getLocalPackageFile(event.dataTransfer.files);
            if (file) {
                bazaar._installLocalPackage(file, app, mount);
            }
        });
    },
    bindEvent(app: App) {
        if (!window.siyuan.config.bazaar.trust) {
            bazaar.element.querySelector("button").addEventListener("click", () => {
                const mount = bazaar._captureMount();
                fetchPost("/api/setting/setBazaar", {
                    ...window.siyuan.config.bazaar,
                    trust: true,
                    app: Constants.SIYUAN_APPID,
                }, (response) => {
                    window.siyuan.config.bazaar = response.data;
                    if (!bazaar._isMountCurrent(mount)) {
                        return;
                    }
                    bazaar.element.innerHTML = bazaar.genHTML();
                    bazaar.bindEvent(app);
                });
            });
            return;
        }
        this._updateState = "idle";
        this._updateRequestID++;
        this._data.details.clear();
        syncRatingUser(this);
        bindRatingUserChange(this);
        const mount = this._captureMount();
        BAZAAR_PACKAGE_TYPES.forEach((type) => {
            this._data.update[type] = [];
        });
        this._downloadedPluginsReady = false;
        this._pluginGlobalRequestPending = false;
        this._pluginGlobalLifecyclePending = false;
        let initialGlobalPluginState = true;
        this._globalPluginStateUnsubscribe?.();
        this._globalPluginStateUnsubscribe = subscribeGlobalPluginState(app, (state) => {
            const shouldRefresh = !initialGlobalPluginState && !state.pending &&
                state.revision > this._lastGlobalPluginSettledRevision;
            this._pluginGlobalLifecyclePending = state.pending;
            this._syncPluginGlobalSwitch();
            if (!state.pending) {
                this._lastGlobalPluginSettledRevision = Math.max(
                    this._lastGlobalPluginSettledRevision, state.revision);
            }
            initialGlobalPluginState = false;
            if (shouldRefresh && bazaar._isMountCurrent(mount)) {
                this._genMyHTML("plugins", app, true);
            }
        });
        this._genMyHTML("plugins", app);
        this._checkUpdate(true);
        this._setLocalPackageUploading(this._localPackageUploading, mount);
        this._bindLocalPackageEvent(app, mount);
        bindBazaarEvents(this, app, mount);
    },
    _stopBazaarCardWatcher(state: IBazaarCardRenderState) {
        state.observer?.disconnect();
        state.observer = undefined;
        if (state.scrollHandler) {
            state.panel.removeEventListener("scroll", state.scrollHandler);
            state.scrollHandler = undefined;
        }
        if (state.frameID !== undefined) {
            window.cancelAnimationFrame(state.frameID);
            state.frameID = undefined;
        }
    },
    _disposeBazaarCardRender(container: Element) {
        const state = this._bazaarCardRenderStates.get(container);
        if (!state) {
            return;
        }
        state.active = false;
        this._stopBazaarCardWatcher(state);
        this._bazaarCardRenderStates.delete(container);
    },
    _isBazaarCardRenderCurrent(state: IBazaarCardRenderState) {
        return this._bazaarCardRenderStates.get(state.container) === state &&
            this._isMountCurrent(state.mount) && state.container.isConnected && state.cardsElement.isConnected;
    },
    _scheduleBazaarCardBatch(state: IBazaarCardRenderState) {
        if (state.frameID !== undefined || !state.active || !this._isBazaarCardRenderCurrent(state)) {
            return;
        }
        state.frameID = window.requestAnimationFrame(() => {
            state.frameID = undefined;
            if (state.active && this._isBazaarCardRenderCurrent(state)) {
                this._appendBazaarCardBatch(state);
            }
        });
    },
    _watchBazaarCardBatch(state: IBazaarCardRenderState) {
        if (!state.active || state.cursor >= state.packages.length || !this._isBazaarCardRenderCurrent(state)) {
            return;
        }
        if (typeof window.IntersectionObserver === "function") {
            if (!state.observer) {
                state.observer = new IntersectionObserver((entries) => {
                    if (entries.some((entry) => entry.isIntersecting)) {
                        state.observer?.disconnect();
                        this._scheduleBazaarCardBatch(state);
                    }
                }, {
                    root: state.panel,
                    rootMargin: "640px 0px",
                });
            }
            state.observer.disconnect();
            const lastCard = state.cardsElement.lastElementChild;
            if (lastCard) {
                state.observer.observe(lastCard);
            }
            return;
        }
        if (!state.scrollHandler) {
            state.scrollHandler = () => {
                if (state.panel.scrollTop + state.panel.clientHeight + 640 >= state.panel.scrollHeight) {
                    this._scheduleBazaarCardBatch(state);
                }
            };
            state.panel.addEventListener("scroll", state.scrollHandler, {passive: true});
        }
        if (state.panel.clientHeight > 0 &&
            state.panel.scrollTop + state.panel.clientHeight + 640 >= state.panel.scrollHeight) {
            this._scheduleBazaarCardBatch(state);
        }
    },
    _appendBazaarCardBatch(state: IBazaarCardRenderState) {
        if (!this._isBazaarCardRenderCurrent(state)) {
            return;
        }
        const batch = getNextBazaarCardBatch(state.packages, state.cursor);
        state.cursor = batch.nextCursor;
        state.cardsElement.insertAdjacentHTML("beforeend", batch.packages.map((item) =>
            this._genCardHTML(item, state.bazaarType)).join(""));
        if (batch.complete) {
            this._stopBazaarCardWatcher(state);
        } else {
            this._watchBazaarCardBatch(state);
        }
    },
    _setBazaarPanelActive(panel: Element, active: boolean) {
        this._bazaarCardRenderStates.forEach((state: IBazaarCardRenderState) => {
            if (state.panel !== panel) {
                return;
            }
            state.active = active;
            if (active) {
                this._watchBazaarCardBatch(state);
            } else {
                this._stopBazaarCardWatcher(state);
            }
        });
    },
    _renderBazaarCards(container: Element, packages: IBazaarItem[], bazaarType: TBazaarType, themeModeValue?: string) {
        this._disposeBazaarCardRender(container);
        const visiblePackages = filterBazaarPackagesByThemeMode(packages, bazaarType, themeModeValue);
        container.parentElement.querySelector(".counter").textContent = visiblePackages.length.toString();
        if (visiblePackages.length === 0) {
            container.innerHTML = `<div class="b3-cards b3-cards--nowrap"><ul class="b3-list b3-list--background"><li class="b3-list--empty">${window.siyuan.languages.emptyContent}</li></ul></div>`;
            return;
        }
        container.innerHTML = '<div class="b3-cards"></div>';
        const panel = container.closest(".config-bazaar__panel") as HTMLElement;
        const state: IBazaarCardRenderState = {
            container,
            panel,
            cardsElement: container.firstElementChild as HTMLElement,
            packages: visiblePackages,
            bazaarType,
            cursor: 0,
            active: !panel.classList.contains("fn__none"),
            mount: this._captureMount(),
        };
        this._bazaarCardRenderStates.set(container, state);
        this._appendBazaarCardBatch(state);
    },
    _onBazaar(response: IWebSocketData, bazaarType: TBazaarType, mount: IBazaarMountSnapshot) {
        if (!bazaar._isBazaarRequestCurrent(bazaarType, mount)) {
            return;
        }
        const element = bazaar.element.querySelector(`#${BAZAAR_PACKAGE_CONFIG[bazaarType].panelID}`);
        if (!element) {
            return;
        }
        if (response.code === 1) {
            // 安装集市包 /api/bazaar/installBazaar* 失败
            showMessage(response.msg);
            element.querySelectorAll("img[data-type='img-loading']").forEach((item) => {
                item.remove();
            });
            return;
        }
        bazaar._data[bazaarType] = response.data.packages;
        bazaar._cacheBazaarDeprecations(bazaarType, response.data.packages);
        const sortValue = window.siyuan.storage[Constants.LOCAL_BAZAAR][BAZAAR_PACKAGE_CONFIG[bazaarType].tabType];
        const packages = sortValue && sortValue !== "0" ? sortBazaarPackages(response.data.packages, sortValue) : response.data.packages;
        bazaar._renderBazaarCards(element, packages, bazaarType,
            bazaarType === "themes" ? (bazaar.element.querySelector("#bazaarSelect") as HTMLSelectElement)?.value : undefined);
    }
};
