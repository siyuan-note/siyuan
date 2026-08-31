import {showMessage} from "../dialog/message";
import {fetchPost} from "../util/fetch";
import {confirmDialog} from "../dialog/confirmDialog";
import {highlightRender} from "../protyle/render/highlightRender";
import {Constants} from "../constants";
/// #if !BROWSER
import * as path from "path";
/// #endif
import {getFrontend, isBrowser, isMobile} from "../util/functions";
import {setStorageVal, writeText} from "../protyle/util/compatibility";
import {hasClosestByAttribute, hasClosestByClassName} from "../protyle/util/hasClosest";
import {Plugin} from "../plugin";
import type {App} from "../index";
import {escapeAttr, escapeHtml} from "../util/escape";
import {formatCount} from "../util/number";
import {loadPlugin, unloadPlugin} from "../plugin/loader";
import {setGlobalPluginsDisabled, subscribeGlobalPluginState} from "../plugin/globalState";
import {useShell} from "../util/pathName";
import {switchSettingPanelSubTab} from "./setting/mount";
import {isThemeFrontendSupported} from "../util/themeCompatibility";
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
    getDisplayableBazaarRating,
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
    normalizeBazaarPackageRatingResponse,
    normalizeBazaarPackageRatingsResponse,
    normalizeBazaarPackageUserRatingsResponse,
    normalizeBazaarUserRating,
    sortBazaarPackagesByRating,
} from "../util/bazaarPackage";
import {Dialog} from "../dialog";
import {previewImages} from "../protyle/preview/image";
import {BAZAAR_README_SANITIZE_OPTIONS} from "./bazaarReadmeSanitize";

interface IBazaarMountSnapshot {
    element: HTMLElement;
    generation: number;
    requestID?: number;
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
    if (bazaar._syncRatingUser()) {
        bazaar._refreshVisibleRatingUI();
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
    _activateMount(element: HTMLElement, force = false) {
        if (!force && this.element === element) {
            return;
        }
        this._invalidateMount();
        this.element = element;
    },
    _invalidateMount() {
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
    <div data-type="theme" class="config-bazaar__panel fn__none">
        <div class="fn__flex config-bazaar__title">
            <svg class="svg ft__on-surface fn__flex-center"><use xlink:href="#iconSort"></use></svg>
            <div class="fn__space"></div>
            <select class="b3-select">
                <option ${localSort.theme === "0" ? "selected" : ""} value="0">${window.siyuan.languages.sortByUpdateTimeDesc}</option>
                <option ${localSort.theme === "1" ? "selected" : ""} value="1">${window.siyuan.languages.sortByUpdateTimeAsc}</option>
                <option ${localSort.theme === "2" ? "selected" : ""} value="2">${window.siyuan.languages.sortByDownloadsDesc}</option>
                <option ${localSort.theme === "3" ? "selected" : ""} value="3">${window.siyuan.languages.sortByDownloadsAsc}</option>
                <option ${localSort.theme === "4" ? "selected" : ""} value="4">${window.siyuan.languages.sortByRatingDesc}</option>
                <option ${localSort.theme === "5" ? "selected" : ""} value="5">${window.siyuan.languages.sortByRatingAsc}</option>
            </select>
            <div class="fn__space"></div>
            <select id="bazaarSelect" class="b3-select">
                <option selected value="2">${window.siyuan.languages.all}</option>
                <option value="0">${window.siyuan.languages.themeLight}</option>
                <option value="1">${window.siyuan.languages.themeDark}</option>
            </select>
            <div class="fn__space"></div>
            <div class="fn__flex config-bazaar__filter-row">
                <input class="b3-text-field" placeholder="${window.siyuan.languages.enterKey} ${window.siyuan.languages.search}">
                <div class="counter counter--bg fn__flex-center ariaLabel" data-position="north" aria-label="${window.siyuan.languages.total}"></div>
            </div>
        </div>
        <div id="configBazaarTheme" class="config-bazaar__content">
            ${loadingHTML}
        </div>
    </div>
    <div class="fn__none config-bazaar__panel" data-type="template">
        <div class="fn__flex config-bazaar__title">
            <svg class="svg ft__on-surface fn__flex-center"><use xlink:href="#iconSort"></use></svg>
            <div class="fn__space"></div>
            <select class="b3-select">
                <option ${localSort.template === "0" ? "selected" : ""} value="0">${window.siyuan.languages.sortByUpdateTimeDesc}</option>
                <option ${localSort.template === "1" ? "selected" : ""} value="1">${window.siyuan.languages.sortByUpdateTimeAsc}</option>
                <option ${localSort.template === "2" ? "selected" : ""} value="2">${window.siyuan.languages.sortByDownloadsDesc}</option>
                <option ${localSort.template === "3" ? "selected" : ""} value="3">${window.siyuan.languages.sortByDownloadsAsc}</option>
                <option ${localSort.template === "4" ? "selected" : ""} value="4">${window.siyuan.languages.sortByRatingDesc}</option>
                <option ${localSort.template === "5" ? "selected" : ""} value="5">${window.siyuan.languages.sortByRatingAsc}</option>
            </select>
            <div class="fn__space"></div>
            <div class="fn__flex config-bazaar__filter-row">
                <input class="b3-text-field" placeholder="${window.siyuan.languages.enterKey} ${window.siyuan.languages.search}">
                <div class="counter counter--bg fn__flex-center ariaLabel" data-position="north" aria-label="${window.siyuan.languages.total}"></div>
            </div>
        </div>
        <div id="configBazaarTemplate" class="config-bazaar__content">
            ${loadingHTML}
        </div>
    </div>
    <div class="fn__none config-bazaar__panel" data-type="plugin">
        <div class="fn__flex config-bazaar__title">
            <svg class="svg ft__on-surface fn__flex-center"><use xlink:href="#iconSort"></use></svg>
            <div class="fn__space"></div>
            <select class="b3-select">
                <option ${localSort.plugin === "0" ? "selected" : ""} value="0">${window.siyuan.languages.sortByUpdateTimeDesc}</option>
                <option ${localSort.plugin === "1" ? "selected" : ""} value="1">${window.siyuan.languages.sortByUpdateTimeAsc}</option>
                <option ${localSort.plugin === "2" ? "selected" : ""} value="2">${window.siyuan.languages.sortByDownloadsDesc}</option>
                <option ${localSort.plugin === "3" ? "selected" : ""} value="3">${window.siyuan.languages.sortByDownloadsAsc}</option>
                <option ${localSort.plugin === "4" ? "selected" : ""} value="4">${window.siyuan.languages.sortByRatingDesc}</option>
                <option ${localSort.plugin === "5" ? "selected" : ""} value="5">${window.siyuan.languages.sortByRatingAsc}</option>
            </select>
            <div class="fn__space"></div>
            <div class="fn__flex config-bazaar__filter-row">
                <input class="b3-text-field" placeholder="${window.siyuan.languages.enterKey} ${window.siyuan.languages.search}">
                <div class="counter counter--bg fn__flex-center ariaLabel" data-position="north" aria-label="${window.siyuan.languages.total}"></div>
            </div>
        </div>
        <div id="configBazaarPlugin" class="config-bazaar__content">
            ${loadingHTML}
        </div>
    </div>
    <div class="fn__none config-bazaar__panel" data-type="icon">
        <div class="fn__flex config-bazaar__title">
            <svg class="svg ft__on-surface fn__flex-center"><use xlink:href="#iconSort"></use></svg>
            <div class="fn__space"></div>
            <select class="b3-select">
                <option ${localSort.icon === "0" ? "selected" : ""} value="0">${window.siyuan.languages.sortByUpdateTimeDesc}</option>
                <option ${localSort.icon === "1" ? "selected" : ""} value="1">${window.siyuan.languages.sortByUpdateTimeAsc}</option>
                <option ${localSort.icon === "2" ? "selected" : ""} value="2">${window.siyuan.languages.sortByDownloadsDesc}</option>
                <option ${localSort.icon === "3" ? "selected" : ""} value="3">${window.siyuan.languages.sortByDownloadsAsc}</option>
                <option ${localSort.icon === "4" ? "selected" : ""} value="4">${window.siyuan.languages.sortByRatingDesc}</option>
                <option ${localSort.icon === "5" ? "selected" : ""} value="5">${window.siyuan.languages.sortByRatingAsc}</option>
            </select>
            <div class="fn__space"></div>
            <div class="fn__flex config-bazaar__filter-row">
                <input class="b3-text-field" placeholder="${window.siyuan.languages.enterKey} ${window.siyuan.languages.search}">
                <div class="counter counter--bg fn__flex-center ariaLabel" data-position="north" aria-label="${window.siyuan.languages.total}"></div>
            </div>
        </div>
        <div id="configBazaarIcon" class="config-bazaar__content">
            ${loadingHTML}
        </div>
    </div>
    <div class="fn__none config-bazaar__panel" data-type="widget">
        <div class="fn__flex config-bazaar__title">
            <svg class="svg ft__on-surface fn__flex-center"><use xlink:href="#iconSort"></use></svg>
            <div class="fn__space"></div>
            <select class="b3-select">
                <option ${localSort.widget === "0" ? "selected" : ""} value="0">${window.siyuan.languages.sortByUpdateTimeDesc}</option>
                <option ${localSort.widget === "1" ? "selected" : ""} value="1">${window.siyuan.languages.sortByUpdateTimeAsc}</option>
                <option ${localSort.widget === "2" ? "selected" : ""} value="2">${window.siyuan.languages.sortByDownloadsDesc}</option>
                <option ${localSort.widget === "3" ? "selected" : ""} value="3">${window.siyuan.languages.sortByDownloadsAsc}</option>
                <option ${localSort.widget === "4" ? "selected" : ""} value="4">${window.siyuan.languages.sortByRatingDesc}</option>
                <option ${localSort.widget === "5" ? "selected" : ""} value="5">${window.siyuan.languages.sortByRatingAsc}</option>
            </select>
            <div class="fn__space"></div>
            <div class="fn__flex config-bazaar__filter-row">
                <input class="b3-text-field" placeholder="${window.siyuan.languages.enterKey} ${window.siyuan.languages.search}">
                <div class="counter counter--bg fn__flex-center ariaLabel" data-position="north" aria-label="${window.siyuan.languages.total}"></div>
            </div>
        </div>
        <div id="configBazaarWidget" class="config-bazaar__content">
            ${loadingHTML}
        </div>
    </div>
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
    _getInvalidPackageTip(reason: IBazaarItem["invalidReason"]) {
        return window.siyuan.languages[getBazaarPackageInvalidLanguageKey(reason)];
    },
    _genInvalidDownloadedCardHTML(item: IBazaarItem, bazaarType: TBazaarType) {
        const tip = bazaar._getInvalidPackageTip(item.invalidReason);
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
    </div>
</div>`;
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
    _getRatingKey(bazaarType: TBazaarType, packageName: string) {
        return `${bazaarType}:${packageName}`;
    },
    _syncRatingUser() {
        const userID = window.siyuan.user ? `${window.siyuan.config.cloudRegion}:${window.siyuan.user.userId}` : "";
        if (bazaar._ratingUserID !== userID) {
            bazaar._ratingUserID = userID;
            bazaar._data.userRatings.clear();
            bazaar._data.userRatingKeys.clear();
            bazaar._data.userRatingLoadingKeys.clear();
            bazaar._data.userRatingSubmitRequestIDs.clear();
            bazaar._data.userRatingBatchRequestIDs.clear();
            return true;
        }
        return false;
    },
    _refreshVisibleRatingUI() {
        const keys = new Set<string>();
        bazaar.element?.querySelectorAll<HTMLElement>("[data-package-type][data-name]").forEach((element) => {
            const bazaarType = element.dataset.packageType as TBazaarType;
            const packageName = element.dataset.name;
            if (bazaarType && packageName) {
                keys.add(bazaar._getRatingKey(bazaarType, packageName));
            }
        });
        keys.forEach((key) => {
            const separator = key.indexOf(":");
            bazaar._refreshRatingUI(key.slice(0, separator) as TBazaarType, key.slice(separator + 1));
        });
        const sideElement = bazaar.element?.querySelector("#configBazaarReadme.config__view--show .item__side");
        const bazaarType = sideElement?.getAttribute("data-package-type") as TBazaarType;
        const packageName = sideElement?.getAttribute("data-name");
        const from = sideElement?.getAttribute("data-from") as "downloaded" | "updated" | "bazaar";
        if (bazaarType && packageName && from) {
            bazaar._loadReadmeRating(bazaarType, packageName, from);
        }
        if (window.siyuan.user) {
            if (bazaar._isUpdatePanelActive()) {
                bazaar._loadUpdatedRatings();
            } else if (bazaar._data.downloadedType) {
                bazaar._loadDownloadedUserRatings(bazaar._data.downloadedType, bazaar._data.downloadedDefault);
            }
        }
    },
    _bindRatingUserChange() {
        if (bazaar._ratingUserChangeHandler) {
            window.removeEventListener("siyuan-login-success", bazaar._ratingUserChangeHandler);
        }
        const mount = bazaar._captureMount();
        bazaar._ratingUserChangeHandler = () => {
            if (!bazaar._isMountCurrent(mount)) {
                return;
            }
            bazaar._syncRatingUser();
            bazaar._refreshVisibleRatingUI();
        };
        window.addEventListener("siyuan-login-success", bazaar._ratingUserChangeHandler);
    },
    _getRatingSummaryText(rating?: IBazaarRating) {
        const normalized = getDisplayableBazaarRating(rating);
        if (!normalized) {
            return window.siyuan.languages.bazaarNoRatings;
        }
        return window.siyuan.languages.bazaarRatingSummary
            .replace("${average}", normalized.average.toLocaleString(undefined, {
                minimumFractionDigits: 1,
                maximumFractionDigits: 1,
            }))
            .replace("${count}", normalized.count.toLocaleString());
    },
    _genRatingStarsHTML(value: number) {
        const activePercentage = Math.max(0, Math.min(100, value / 5 * 100));
        const inactiveStars = Array.from({length: 5}, () => '<svg class="config-bazaar__rating-star config-bazaar__rating-star--outline"><use xlink:href="#iconStar"></use></svg>').join("");
        const activeStars = Array.from({length: 5}, () => '<svg class="config-bazaar__rating-star"><use xlink:href="#iconStar"></use></svg>').join("");
        return `<span class="config-bazaar__rating-stars" aria-hidden="true">
    ${inactiveStars}
    <span class="config-bazaar__rating-stars--active" style="width: ${activePercentage}%">${activeStars}</span>
</span>`;
    },
    _genCardRatingHTML(item: Pick<IBazaarItem, "rating">, loaded = true) {
        const rating = getDisplayableBazaarRating(item.rating);
        const hidden = !loaded || !rating;
        const summary = bazaar._getRatingSummaryText(rating);
        const average = rating?.average.toLocaleString(undefined, {
            minimumFractionDigits: 1,
            maximumFractionDigits: 1,
        });
        return `<span data-rating-card-slot data-position="north" class="ariaLabel block__icon block__icon--show block__icon--text${hidden ? " fn__none" : ""}" aria-label="${escapeAttr(summary)}">
    <svg aria-hidden="true"><use xlink:href="#iconStar"></use></svg>
    <span class="fn__space--small"></span>
    <span>${escapeHtml(average || "")}</span>
</span>`;
    },
    _genRatePackageActionHTML(loaded: boolean, rating?: unknown) {
        const userRating = normalizeBazaarUserRating(rating);
        const rated = userRating !== undefined && userRating > 0;
        const ariaLabel = rated ? window.siyuan.languages.bazaarYourRatingValue.replace("${rating}", userRating.toString()) :
            window.siyuan.languages.bazaarRatePackage;
        return `<span data-rating-card-slot data-position="north" data-type="rate-package"${rated ? ` data-user-rating="${userRating}"` : ""} class="ariaLabel block__icon block__icon--show${loaded ? "" : " fn__none"}" aria-label="${escapeAttr(ariaLabel)}">
    <svg aria-hidden="true"><use xlink:href="#iconStar"></use></svg>
</span>`;
    },
    _genRatingDistributionHTML(rating?: IBazaarRating) {
        const normalized = getDisplayableBazaarRating(rating);
        return [5, 4, 3, 2, 1].map((star) => {
            const count = normalized?.distribution[star - 1] || 0;
            const ratio = normalized ? Math.min(1, count / normalized.count) : 0;
            const percentage = ratio * 100;
            const percentageText = new Intl.NumberFormat(undefined, {
                style: "percent",
                maximumFractionDigits: 0,
            }).format(ratio);
            const label = window.siyuan.languages.bazaarRatingDistributionLabel
                .replace("${star}", star.toString())
                .replace("${count}", count.toLocaleString());
            return `<div class="config-bazaar__rating-row" aria-label="${escapeAttr(`${label} ${percentageText}`)}">
    <span>${star}</span>
    <svg class="config-bazaar__rating-star" aria-hidden="true"><use xlink:href="#iconStar"></use></svg>
    <span class="config-bazaar__rating-track" aria-hidden="true"><span style="width: ${percentage}%"></span></span>
    <span>${escapeHtml(percentageText)}</span>
    <span>${count.toLocaleString()}</span>
</div>`;
        }).join("");
    },
    _genReadmeRatingHTML(bazaarType: TBazaarType, item: IBazaarItem, loaded: boolean) {
        if (!loaded) {
            return "";
        }
        bazaar._syncRatingUser();
        const rating = getDisplayableBazaarRating(item.rating);
        const userRating = bazaar._data.userRatings.get(bazaar._getRatingKey(bazaarType, item.name)) || 0;
        let action = "";
        if (item.installed) {
            if (window.siyuan.user) {
                const actionText = userRating ? window.siyuan.languages.bazaarYourRatingValue.replace("${rating}", userRating.toString()) :
                    window.siyuan.languages.bazaarRatePackage;
                action = `<button type="button" class="config-bazaar__rating-action" data-type="rate-package" aria-label="${escapeAttr(actionText)}">
    ${bazaar._genRatingStarsHTML(userRating)}
    <span>${escapeHtml(actionText)}</span>
</button>`;
            } else {
                action = `<div class="config-bazaar__rating-tip">${window.siyuan.languages.bazaarRatingLoginTip}</div>`;
            }
        } else {
            action = `<div class="config-bazaar__rating-tip">${window.siyuan.languages.bazaarRatingInstallTip}</div>`;
        }
        const summary = rating ? bazaar._getRatingSummaryText(rating) : "";
        const aggregate = rating ? `<div class="config-bazaar__rating-summary" aria-label="${escapeAttr(summary)}">
        ${bazaar._genRatingStarsHTML(rating.average)}
        <span>${escapeHtml(summary)}</span>
    </div>
    <div class="config-bazaar__rating-distribution">${bazaar._genRatingDistributionHTML(rating)}</div>` : "";
        return `<section class="item__meta-section config-bazaar__rating-detail">
    <div class="item__meta-title">${window.siyuan.languages.bazaarRating}</div>
    ${aggregate}
    ${action}
</section>`;
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
            ${bazaar._genCardRatingHTML(item,
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
        const ratingKey = bazaar._getRatingKey(bazaarType, installed.name);
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
        ${bazaar._genUpdateButtonHTML(available, bazaarType)}
        ${bazaar._genRatePackageActionHTML(ratingLoaded, bazaar._data.userRatings.get(ratingKey))}
    </div>
</div>`;
    },
    _getUpdatedItems(): Array<{type: TBazaarType, item: IUpdatedBazaarItem}> {
        const items: Array<{type: TBazaarType, item: IUpdatedBazaarItem}> = [];
        (["plugins", "themes", "icons", "templates", "widgets"] as TBazaarType[]).forEach((type) => {
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
        this._loadUpdatedRatings();
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
        const bazaarAPI: Record<TBazaarType, string> = {
            plugins: "/api/bazaar/getBazaarPlugin",
            themes: "/api/bazaar/getBazaarTheme",
            icons: "/api/bazaar/getBazaarIcon",
            templates: "/api/bazaar/getBazaarTemplate",
            widgets: "/api/bazaar/getBazaarWidget",
        };
        const mount = bazaar._captureMount();
        bazaar._data.deprecationTypesLoading.add(bazaarType);
        const requestData = ["plugins", "themes"].includes(bazaarType) ? {frontend: getFrontend()} : {};
        fetchPost(bazaarAPI[bazaarType], requestData, response => {
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
            if (activeBtn?.getAttribute("data-type") === bazaar._type2myType(bazaarType)) {
                bazaar._genMyHTML(bazaarType, app, true);
            }
        });
    },
    _genMyHTML(bazaarType: TBazaarType, app: App, preserveOrder = false) {
        const contentElement = bazaar.element.querySelector("#configBazaarDownloaded");
        const myType = bazaar._type2myType(bazaarType);
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
        const installedAPI: Record<TBazaarType, string> = {
            plugins: "/api/bazaar/getInstalledPlugin",
            themes: "/api/bazaar/getInstalledTheme",
            icons: "/api/bazaar/getInstalledIcon",
            templates: "/api/bazaar/getInstalledTemplate",
            widgets: "/api/bazaar/getInstalledWidget",
        };
        if (!(bazaarType in installedAPI)) {
            contentElement.removeAttribute("data-loading");
            return false;
        }
        bazaar._updateDownloadedSortSelect(bazaarType);
        const initialSortValue = bazaar._getDownloadedSortValue(bazaarType);
        const mount = bazaar._captureMount();
        fetchPost(installedAPI[bazaarType], {
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
                    let hasSetting = false;
                    if (bazaarType === "plugins") {
                        const plugin = app.plugins.find((p: Plugin) => p.name === bazaarItem.name);
                        // @ts-ignore
                        hasSetting = plugin && (plugin.setting || plugin.__proto__.hasOwnProperty("openSetting"));
                    }
                    const showPublishSwitch = bazaarType === "plugins" && window.siyuan.config.publish.enable;
                    const publishEnabled = isBazaarPluginEnabledInPublish(bazaarItem);
                    const publishSwitchHTML = showPublishSwitch ? `<label data-type="plugin-publish-enable-label" class="config-bazaar__publish-switch" title="${escapeAttr(bazaarItem.disabledInPublish ? window.siyuan.languages.pluginDisabledInPublishTip : window.siyuan.languages.publishService)}">
                <input data-type="plugin-publish-enable" data-position="north" class="b3-switch fn__flex-center" type="checkbox"${publishEnabled ? " checked" : ""}${bazaarItem.disabledInPublish ? " disabled" : ""}>
                <span class="fn__space--small"></span>
                <span class="fn__flex-center ft__on-surface">${window.siyuan.languages.publishService}</span>
            </label>` : "";
                    const available = bazaar._getUpdatedItem(bazaarType, bazaarItem.name)?.available;
                    const ratingKey = bazaar._getRatingKey(bazaarType, bazaarItem.name);
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
        ${bazaar._genRatePackageActionHTML(bazaar._data.downloadedRatingKeys.has(ratingKey), bazaar._data.userRatings.get(ratingKey))}
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
            bazaar._loadDownloadedRatings(bazaarType, packageItems);
            bazaar._loadDownloadedUserRatings(bazaarType, packageItems);
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
        const navTitles: Record<TBazaarType, string> = {
            plugins: window.siyuan.languages.plugin,
            themes: window.siyuan.languages.theme,
            icons: window.siyuan.languages.icon,
            templates: window.siyuan.languages.template,
            widgets: window.siyuan.languages.widget,
        };
        if (!(bazaarType in navTitles)) {
            return;
        }
        bazaar._upsertReadmeData(bazaarType, from, data);
        const updatedDetail = from === "updated" ? bazaar._getUpdatedItem(bazaarType, data.name) : undefined;
        const installed = detail?.installed || updatedDetail?.installed || (from === "downloaded" ? data : undefined);
        const available = detail?.available || updatedDetail?.available ||
            (from === "downloaded" ? bazaar._getUpdatedItem(bazaarType, data.name)?.available : data);
        const displayData = from === "downloaded" ? installed || data : available || data;
        const ratingKey = bazaar._getRatingKey(bazaarType, displayData.name);
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
        <span class="b3-list-item__text ft__breakword">${navTitles[bazaarType]}</span>
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
            <div data-type="rating-detail-slot">${bazaar._genReadmeRatingHTML(bazaarType, displayData, ratingLoaded)}</div>
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
        bazaar._loadReadmeRating(bazaarType, displayData.name, from);
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
    _myType2Type(myType: string) {
        return myType.replace("my", "").toLowerCase() + "s" as TBazaarType;
    },
    _type2tabType(type: TBazaarType) {
        return type.slice(0, -1);
    },
    _type2myType(type: TBazaarType) {
        const tab = bazaar._type2tabType(type);
        return "my" + tab.charAt(0).toUpperCase() + tab.slice(1);
    },
    _getDownloadedSortStorageKey(type: TBazaarType) {
        const tab = bazaar._type2tabType(type);
        return "downloaded" + tab.charAt(0).toUpperCase() + tab.slice(1);
    },
    _getDownloadedSortValue(type: TBazaarType) {
        const value = window.siyuan.storage[Constants.LOCAL_BAZAAR][bazaar._getDownloadedSortStorageKey(type)] || "0";
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
    _applyPackageRating(bazaarType: TBazaarType, packageName: string, rating?: IBazaarRating, refreshUI = true) {
        const key = bazaar._getRatingKey(bazaarType, packageName);
        if (rating) {
            bazaar._data.ratings.set(key, rating);
        } else {
            bazaar._data.ratings.delete(key);
        }
        const updateItem = (item?: IBazaarItem) => {
            applyBazaarPackageRatingToItem(item, packageName, rating);
        };
        bazaar._data[bazaarType].forEach(updateItem);
        if (bazaar._data.downloadedType === bazaarType) {
            bazaar._data.downloadedDefault.forEach(updateItem);
            bazaar._data.downloaded.forEach(updateItem);
        }
        bazaar._data.update[bazaarType].forEach((item) => {
            updateItem(item.installed);
            updateItem(item.available);
        });
        const detail = bazaar._getPackageDetail(bazaarType, packageName);
        updateItem(detail?.installed);
        updateItem(detail?.available);
        if (refreshUI) {
            bazaar._refreshRatingUI(bazaarType, packageName);
        }
    },
    _applyPackageRatingResponse(bazaarType: TBazaarType, packageName: string, data: {
        ratingAvailable?: unknown;
        rating?: Partial<IBazaarRating> | null;
    }, refreshUI = true) {
        const key = bazaar._getRatingKey(bazaarType, packageName);
        const publicRating = normalizeBazaarPackageRatingResponse(data);
        if (publicRating.loaded) {
            bazaar._data.downloadedRatingKeys.add(key);
            bazaar._applyPackageRating(bazaarType, packageName, publicRating.rating, refreshUI);
        } else {
            bazaar._data.downloadedRatingKeys.delete(key);
            if (refreshUI) {
                bazaar._refreshRatingUI(bazaarType, packageName);
            }
        }
        return publicRating.loaded;
    },
    _getRatingItem(bazaarType: TBazaarType, packageName: string, from: "downloaded" | "updated" | "bazaar") {
        const detail = bazaar._getPackageDetail(bazaarType, packageName);
        if (from === "downloaded") {
            return detail?.installed || (bazaar._data.downloadedType === bazaarType ?
                bazaar._data.downloaded.find((item) => item.name === packageName) : undefined);
        }
        if (from === "updated") {
            return detail?.available || bazaar._getUpdatedItem(bazaarType, packageName)?.available;
        }
        return detail?.available || bazaar._data[bazaarType].find((item) => item.name === packageName);
    },
    _refreshRatingUI(bazaarType: TBazaarType, packageName: string) {
        bazaar._syncRatingUser();
        bazaar.element?.querySelectorAll(`.b3-card[data-package-type="${bazaarType}"]`).forEach((card) => {
            if (card.getAttribute("data-name") !== packageName) {
                return;
            }
            const source = card.getAttribute("data-package-source") as "downloaded" | "updated" | "bazaar";
            const item = bazaar._getRatingItem(bazaarType, packageName, source);
            const slot = card.querySelector<HTMLElement>("[data-rating-card-slot]");
            if (item && slot) {
                const key = bazaar._getRatingKey(bazaarType, packageName);
                const loaded = isBazaarPackageRatingLoaded(source, bazaar._data.downloadedRatingKeys.has(key),
                    item.ratingAvailable);
                if (source === "bazaar") {
                    const rating = loaded ? getDisplayableBazaarRating(item.rating) : undefined;
                    slot.classList.toggle("fn__none", !rating);
                    if (rating) {
                        slot.setAttribute("aria-label", bazaar._getRatingSummaryText(rating));
                        const averageElement = slot.lastElementChild;
                        if (averageElement) {
                            averageElement.textContent = rating.average.toLocaleString(undefined, {
                                minimumFractionDigits: 1,
                                maximumFractionDigits: 1,
                            });
                        }
                    }
                } else {
                    slot.classList.toggle("fn__none", !loaded);
                    const userRating = bazaar._data.userRatingKeys.has(key) ?
                        normalizeBazaarUserRating(bazaar._data.userRatings.get(key)) : undefined;
                    if (userRating !== undefined && userRating > 0) {
                        slot.dataset.userRating = userRating.toString();
                        slot.setAttribute("aria-label", window.siyuan.languages.bazaarYourRatingValue
                            .replace("${rating}", userRating.toString()));
                    } else {
                        slot.removeAttribute("data-user-rating");
                        slot.setAttribute("aria-label", window.siyuan.languages.bazaarRatePackage);
                    }
                }
            }
        });
        const sideElement = bazaar.element?.querySelector("#configBazaarReadme.config__view--show .item__side");
        if (sideElement?.getAttribute("data-package-type") !== bazaarType ||
            sideElement.getAttribute("data-name") !== packageName) {
            return;
        }
        const from = sideElement.getAttribute("data-from") as "downloaded" | "updated" | "bazaar";
        const item = bazaar._getRatingItem(bazaarType, packageName, from);
        const slot = sideElement.querySelector('[data-type="rating-detail-slot"]');
        if (item && slot) {
            const key = bazaar._getRatingKey(bazaarType, packageName);
            const loaded = isBazaarPackageRatingLoaded(from, bazaar._data.downloadedRatingKeys.has(key),
                item.ratingAvailable);
            const displayItem = from === "bazaar" ? item : {...item, rating: bazaar._data.ratings.get(key)};
            slot.innerHTML = bazaar._genReadmeRatingHTML(bazaarType, displayItem, loaded);
        }
    },
    _loadDownloadedRatings(bazaarType: TBazaarType, packages: IBazaarItem[]) {
        const packageNames = packages.filter((item) => !item.invalidReason).map((item) => item.name);
        if (packageNames.length === 0) {
            return;
        }
        const requestID = (bazaar._data.ratingBatchRequestIDs.get(bazaarType) || 0) + 1;
        bazaar._data.ratingBatchRequestIDs.set(bazaarType, requestID);
        const mutationVersions = new Map(packageNames.map((packageName) => {
            const key = bazaar._getRatingKey(bazaarType, packageName);
            return [packageName, getBazaarRatingMutationVersion(bazaar._data.ratingMutationVersions, key)];
        }));
        const mount = bazaar._captureMount();
        fetchPost("/api/bazaar/getBazaarPackageRatings", {
            packageType: bazaarType,
            packageNames,
        }, response => {
            if (response.code !== 0 || bazaar._data.ratingBatchRequestIDs.get(bazaarType) !== requestID ||
                !bazaar._isMountCurrent(mount) || !bazaar.element?.isConnected) {
                return;
            }
            const ratings = normalizeBazaarPackageRatingsResponse(packageNames, response.data);
            if (!ratings) {
                return;
            }
            ratings.forEach((ratingResponse, packageName) => {
                const key = bazaar._getRatingKey(bazaarType, packageName);
                if (isBazaarRatingMutationVersionCurrent(bazaar._data.ratingMutationVersions, key,
                    mutationVersions.get(packageName) || 0)) {
                    bazaar._applyPackageRatingResponse(bazaarType, packageName, ratingResponse);
                }
            });
        });
    },
    _loadDownloadedUserRatings(bazaarType: TBazaarType, packages: IBazaarItem[]) {
        bazaar._syncRatingUser();
        if (!window.siyuan.user) {
            return;
        }
        const requestedUserID = bazaar._ratingUserID;
        const packageNames = Array.from(new Set(packages.filter((item) => !item.invalidReason).map((item) => item.name)))
            .filter((packageName) => {
                const key = bazaar._getRatingKey(bazaarType, packageName);
                return !bazaar._data.userRatingKeys.has(key) &&
                    !bazaar._data.userRatingLoadingKeys.has(`${requestedUserID}|${key}`);
            });
        if (packageNames.length === 0) {
            return;
        }
        const requestKey = `${requestedUserID}|${bazaarType}|${JSON.stringify(packageNames)}`;
        const requestID = (bazaar._data.userRatingBatchRequestIDs.get(requestKey) || 0) + 1;
        bazaar._data.userRatingBatchRequestIDs.set(requestKey, requestID);
        const loadingKeys = packageNames.map((packageName) => {
            const loadingKey = `${requestedUserID}|${bazaar._getRatingKey(bazaarType, packageName)}`;
            bazaar._data.userRatingLoadingKeys.add(loadingKey);
            return loadingKey;
        });
        const mutationVersions = new Map(packageNames.map((packageName) => {
            const key = bazaar._getRatingKey(bazaarType, packageName);
            return [packageName, getBazaarRatingMutationVersion(bazaar._data.ratingMutationVersions, key)];
        }));
        const mount = bazaar._captureMount();
        fetchPost("/api/bazaar/getBazaarPackageUserRatings", {
            packageType: bazaarType,
            packageNames,
        }, response => {
            bazaar._syncRatingUser();
            if (response.code !== 0 || requestedUserID !== bazaar._ratingUserID ||
                bazaar._data.userRatingBatchRequestIDs.get(requestKey) !== requestID ||
                !bazaar._isMountCurrent(mount) || !bazaar.element?.isConnected) {
                return;
            }
            const userRatings = normalizeBazaarPackageUserRatingsResponse(packageNames, response.data);
            if (!userRatings) {
                return;
            }
            userRatings.forEach((userRating, packageName) => {
                const key = bazaar._getRatingKey(bazaarType, packageName);
                if (isBazaarRatingMutationVersionCurrent(bazaar._data.ratingMutationVersions, key,
                    mutationVersions.get(packageName) || 0)) {
                    bazaar._data.userRatings.set(key, userRating);
                    bazaar._data.userRatingKeys.add(key);
                    bazaar._refreshRatingUI(bazaarType, packageName);
                }
            });
        }).finally(() => {
            loadingKeys.forEach((loadingKey) => bazaar._data.userRatingLoadingKeys.delete(loadingKey));
            if (bazaar._data.userRatingBatchRequestIDs.get(requestKey) === requestID) {
                bazaar._data.userRatingBatchRequestIDs.delete(requestKey);
            }
        });
    },
    _loadUpdatedRatings() {
        (["plugins", "themes", "icons", "templates", "widgets"] as TBazaarType[]).forEach((bazaarType) => {
            const items = bazaar._data.update[bazaarType];
            const installed = items.map((item) => item.installed);
            if (items.length && !items.every((item) => bazaar._data.downloadedRatingKeys.has(
                bazaar._getRatingKey(bazaarType, item.installed.name)))) {
                bazaar._loadDownloadedRatings(bazaarType, installed);
            }
            if (items.length && window.siyuan.user) {
                bazaar._loadDownloadedUserRatings(bazaarType, installed);
            }
        });
    },
    _fetchPackageRating(bazaarType: TBazaarType, packageName: string, callback?: () => void, silent = true) {
        bazaar._syncRatingUser();
        const requestedUserID = bazaar._ratingUserID;
        const key = bazaar._getRatingKey(bazaarType, packageName);
        const loadingKey = `${requestedUserID}|${key}`;
        bazaar._data.userRatingLoadingKeys.add(loadingKey);
        const mount = bazaar._captureMount();
        let handled = false;
        fetchPost("/api/bazaar/getBazaarPackageRating", {
            packageType: bazaarType,
            packageName,
        }, response => {
            handled = true;
            bazaar._syncRatingUser();
            if (requestedUserID !== bazaar._ratingUserID || !bazaar._isMountCurrent(mount)) {
                return;
            }
            if (response.code !== 0 || !response.data) {
                if (!silent) {
                    const languageKey = getBazaarRatingErrorLanguageKey(response.data);
                    showMessage(languageKey ? window.siyuan.languages[languageKey] :
                        response.msg || window.siyuan.languages.bazaarRatingFailed);
                }
                return;
            }
            const userRating = response.data.userRating;
            bazaar._data.userRatings.set(key, normalizeBazaarUserRating(userRating) || 0);
            bazaar._data.userRatingKeys.add(key);
            if (!bazaar._applyPackageRatingResponse(bazaarType, packageName, response.data)) {
                if (!silent) {
                    showMessage(window.siyuan.languages.bazaarRatingFailed);
                }
                return;
            }
            callback?.();
        }).finally(() => {
            bazaar._data.userRatingLoadingKeys.delete(loadingKey);
            if (!handled && !silent && requestedUserID === bazaar._ratingUserID) {
                showMessage(window.siyuan.languages.bazaarRatingFailed);
            }
        });
    },
    _loadReadmeRating(bazaarType: TBazaarType, packageName: string, from: "downloaded" | "updated" | "bazaar") {
        bazaar._syncRatingUser();
        const key = bazaar._getRatingKey(bazaarType, packageName);
        const loadingKey = `${bazaar._ratingUserID}|${key}`;
        if (bazaar._getRatingItem(bazaarType, packageName, from)?.installed && window.siyuan.user &&
            !bazaar._data.userRatingKeys.has(key) &&
            !bazaar._data.userRatingLoadingKeys.has(loadingKey)) {
            bazaar._fetchPackageRating(bazaarType, packageName);
        }
    },
    _submitPackageRating(bazaarType: TBazaarType, packageName: string, rating: number, callback: (success: boolean) => void) {
        bazaar._syncRatingUser();
        const mount = bazaar._captureMount();
        const removing = rating === 0;
        const failureMessage = removing ? window.siyuan.languages.bazaarRemoveRatingFailed :
            window.siyuan.languages.bazaarRatingFailed;
        if (normalizeBazaarUserRating(rating) === undefined) {
            showMessage(failureMessage);
            callback(false);
            return;
        }
        const requestedUserID = bazaar._ratingUserID;
        const key = bazaar._getRatingKey(bazaarType, packageName);
        const requestKey = `${requestedUserID}|${key}`;
        if (!beginBazaarRatingSubmission(bazaar._data.userRatingSubmittingKeys, requestKey)) {
            showMessage(window.siyuan.languages.loading);
            callback(false);
            return;
        }
        const requestID = beginBazaarRatingRequest(bazaar._data.userRatingSubmitRequestIDs, requestKey);
        let handled = false;
        let settled = false;
        const isLatestRequest = () => requestedUserID === bazaar._ratingUserID &&
            isLatestBazaarRatingRequest(bazaar._data.userRatingSubmitRequestIDs, requestKey, requestID);
        const settle = (success: boolean) => {
            if (!settled) {
                settled = true;
                callback(success);
            }
        };
        fetchPost("/api/bazaar/setBazaarPackageRating", {
            packageType: bazaarType,
            packageName,
            rating,
        }, response => {
            handled = true;
            bazaar._syncRatingUser();
            if (!isLatestRequest()) {
                settle(false);
                return;
            }
            if (response.code !== 0 || !response.data) {
                const languageKey = getBazaarRatingErrorLanguageKey(response.data);
                showMessage(languageKey ? window.siyuan.languages[languageKey] :
                    response.msg || failureMessage);
                settle(false);
                return;
            }
            const userRating = response.data.userRating;
            bazaar._data.userRatings.set(key, normalizeBazaarUserRating(userRating) ?? rating);
            bazaar._data.userRatingKeys.add(key);
            beginBazaarRatingRequest(bazaar._data.ratingMutationVersions, key);
            const refreshUI = bazaar._isMountCurrent(mount);
            bazaar._applyPackageRatingResponse(bazaarType, packageName, response.data, refreshUI);
            const sortValue = window.siyuan.storage[Constants.LOCAL_BAZAAR][bazaar._type2tabType(bazaarType)];
            if (refreshUI && ["4", "5"].includes(sortValue)) {
                bazaar._renderBazaarCards(
                    bazaar.element.querySelector({
                        plugins: "#configBazaarPlugin",
                        themes: "#configBazaarTheme",
                        icons: "#configBazaarIcon",
                        templates: "#configBazaarTemplate",
                        widgets: "#configBazaarWidget",
                    }[bazaarType]),
                    bazaar._sortPackages(bazaar._data[bazaarType], sortValue),
                    bazaarType,
                    bazaarType === "themes" ? (bazaar.element.querySelector("#bazaarSelect") as HTMLSelectElement)?.value : undefined,
                );
            }
            showMessage(removing ? window.siyuan.languages.bazaarRatingRemoved :
                window.siyuan.languages.bazaarRatingSubmitted);
            settle(true);
        }).finally(() => {
            bazaar._data.userRatingSubmittingKeys.delete(requestKey);
            if (settled) {
                return;
            }
            bazaar._syncRatingUser();
            if (!handled && isLatestRequest()) {
                showMessage(failureMessage);
            }
            settle(false);
        });
    },
    _openRatingDialog(bazaarType: TBazaarType, packageName: string) {
        bazaar._syncRatingUser();
        if (!window.siyuan.user) {
            showMessage(window.siyuan.languages.bazaarRatingLoginTip);
            return;
        }
        const key = bazaar._getRatingKey(bazaarType, packageName);
        const submitKey = `${bazaar._ratingUserID}|${key}`;
        if (bazaar._data.userRatingSubmittingKeys.has(submitKey)) {
            showMessage(window.siyuan.languages.loading);
            return;
        }
        if (!bazaar._data.userRatingKeys.has(key)) {
            const loadingKey = `${bazaar._ratingUserID}|${key}`;
            if (bazaar._data.userRatingLoadingKeys.has(loadingKey)) {
                showMessage(window.siyuan.languages.loading);
                return;
            }
            bazaar._fetchPackageRating(bazaarType, packageName, () => {
                bazaar._openRatingDialog(bazaarType, packageName);
            }, false);
            return;
        }
        const previousActiveElement = document.activeElement as HTMLElement;
        let selectedRating = bazaar._data.userRatings.get(key) || 0;
        const canRemoveRating = isBazaarRatingRemovalAvailable(selectedRating);
        const buttons = [1, 2, 3, 4, 5].map((rating) => {
            const label = window.siyuan.languages.bazaarRatingStarLabel.replace("${star}", rating.toString());
            return `<button type="button" role="radio" data-rating-value="${rating}" aria-checked="${selectedRating === rating}" aria-label="${escapeAttr(label)}" tabindex="${selectedRating === rating || (!selectedRating && rating === 1) ? "0" : "-1"}">
    <svg class="config-bazaar__rating-star config-bazaar__rating-star--outline" aria-hidden="true"><use xlink:href="#iconStar"></use></svg>
</button>`;
        }).join("");
        const dialog = new Dialog({
            title: window.siyuan.languages.bazaarRatePackage,
            content: `<div class="b3-dialog__content">
    <div class="config-bazaar__rating-picker" role="radiogroup" aria-label="${escapeAttr(window.siyuan.languages.bazaarYourRating)}">${buttons}</div>
</div>
<div class="b3-dialog__action">
    ${canRemoveRating ? `<button type="button" class="b3-button b3-button--remove" data-type="rating-remove">${window.siyuan.languages.bazaarRemoveRating}</button><div class="fn__space"></div>` : ""}
    <button type="button" class="b3-button b3-button--cancel" data-type="rating-cancel">${window.siyuan.languages.cancel}</button>
    <div class="fn__space"></div>
    <button type="button" class="b3-button b3-button--text" data-type="rating-confirm"${selectedRating ? "" : " disabled"}>${window.siyuan.languages.confirm}</button>
</div>`,
            width: isMobile() ? "92vw" : "360px",
            destroyCallback: () => {
                if (previousActiveElement?.isConnected) {
                    previousActiveElement.focus({preventScroll: true});
                }
            },
        });
        const picker = dialog.element.querySelector(".config-bazaar__rating-picker") as HTMLElement;
        const cancelButton = dialog.element.querySelector('[data-type="rating-cancel"]') as HTMLButtonElement;
        const confirmButton = dialog.element.querySelector('[data-type="rating-confirm"]') as HTMLButtonElement;
        const removeButton = dialog.element.querySelector('[data-type="rating-remove"]') as HTMLButtonElement | null;
        let submitting = false;
        const setSubmitting = (value: boolean) => {
            submitting = value;
            picker.querySelectorAll<HTMLButtonElement>("[data-rating-value]").forEach((button) => {
                button.disabled = value;
            });
            if (removeButton) {
                removeButton.disabled = value;
            }
            cancelButton.disabled = value;
            confirmButton.disabled = value || !selectedRating;
        };
        const highlightRating = (rating: number) => {
            picker.querySelectorAll<HTMLButtonElement>("[data-rating-value]").forEach((button) => {
                button.classList.toggle("config-bazaar__rating-picker--active", Number(button.dataset.ratingValue) <= rating);
            });
        };
        const selectRating = (rating: number, focus = false) => {
            if (submitting) {
                return;
            }
            selectedRating = rating;
            highlightRating(rating);
            picker.querySelectorAll<HTMLButtonElement>("[data-rating-value]").forEach((button) => {
                const value = Number(button.dataset.ratingValue);
                button.setAttribute("aria-checked", (value === rating).toString());
                button.tabIndex = value === rating ? 0 : -1;
                if (focus && value === rating) {
                    button.focus();
                }
            });
            confirmButton.disabled = false;
        };
        if (selectedRating) {
            selectRating(selectedRating);
        }
        picker.addEventListener("click", (event) => {
            const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-rating-value]");
            if (button) {
                selectRating(Number(button.dataset.ratingValue));
            }
        });
        picker.addEventListener("mouseover", (event) => {
            const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-rating-value]");
            if (button) {
                highlightRating(Number(button.dataset.ratingValue));
            }
        });
        picker.addEventListener("mouseleave", () => highlightRating(selectedRating));
        picker.addEventListener("keydown", (event: KeyboardEvent) => {
            if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) {
                return;
            }
            let next = selectedRating || Number((event.target as HTMLElement).closest<HTMLElement>("[data-rating-value]")?.dataset.ratingValue) || 1;
            if (["ArrowLeft", "ArrowUp"].includes(event.key)) {
                next = next === 1 ? 5 : next - 1;
            } else if (["ArrowRight", "ArrowDown"].includes(event.key)) {
                next = next === 5 ? 1 : next + 1;
            } else {
                next = event.key === "Home" ? 1 : 5;
            }
            selectRating(next, true);
            event.preventDefault();
        });
        cancelButton.addEventListener("click", () => {
            if (!submitting) {
                dialog.destroy();
            }
        });
        removeButton?.addEventListener("click", () => {
            if (submitting) {
                return;
            }
            setSubmitting(true);
            bazaar._submitPackageRating(bazaarType, packageName, 0, (success) => {
                if (success) {
                    dialog.destroy();
                } else {
                    setSubmitting(false);
                }
            });
        });
        confirmButton.addEventListener("click", () => {
            if (!selectedRating || submitting) {
                return;
            }
            setSubmitting(true);
            bazaar._submitPackageRating(bazaarType, packageName, selectedRating, (success) => {
                if (success) {
                    dialog.destroy();
                } else {
                    setSubmitting(false);
                }
            });
        });
        (picker.querySelector('[tabindex="0"]') as HTMLButtonElement)?.focus({preventScroll: true});
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
        const bazaarAPI: Record<TBazaarType, string> = {
            plugins: "/api/bazaar/getBazaarPlugin",
            themes: "/api/bazaar/getBazaarTheme",
            icons: "/api/bazaar/getBazaarIcon",
            templates: "/api/bazaar/getBazaarTemplate",
            widgets: "/api/bazaar/getBazaarWidget",
        };
        const mount = bazaar._beginBazaarRequest(bazaarType);
        fetchPost(bazaarAPI[bazaarType], {
            frontend: getFrontend(),
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
    _initBazaarPanel(app: App, bazaarType: TBazaarType, panel: HTMLElement) {
        if (panel.getAttribute("data-init")) {
            return;
        }
        const mount = bazaar._beginBazaarRequest(bazaarType);
        switch (bazaar._type2tabType(bazaarType)) {
            case "template":
                fetchPost("/api/bazaar/getBazaarTemplate", {}, response => {
                    bazaar._onBazaar(response, "templates", mount);
                });
                break;
            case "icon":
                fetchPost("/api/bazaar/getBazaarIcon", {}, response => {
                    bazaar._onBazaar(response, "icons", mount);
                });
                break;
            case "widget":
                fetchPost("/api/bazaar/getBazaarWidget", {}, response => {
                    bazaar._onBazaar(response, "widgets", mount);
                });
                break;
            case "theme":
                fetchPost("/api/bazaar/getBazaarTheme", {frontend: getFrontend()}, response => {
                    bazaar._onBazaar(response, "themes", mount);
                });
                break;
            case "plugin":
                fetchPost("/api/bazaar/getBazaarPlugin", {
                    frontend: getFrontend()
                }, response => {
                    bazaar._onBazaar(response, "plugins", mount);
                });
                break;
        }
        panel.setAttribute("data-init", "true");
    },
    /** 切换集市顶部 Tab */
    switchBazaarTab(app: App, bazaarType: TBazaarType, from: "downloaded" | "updated" | "bazaar") {
        if (!bazaar.element) {
            return;
        }
        const layoutTabType = from === "bazaar" ? bazaar._type2tabType(bazaarType) : "downloaded";
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
            if (isActive && from === "bazaar") {
                bazaar._initBazaarPanel(app, bazaarType, panel as HTMLElement);
            }
        });
        if (from !== "bazaar") {
            const myType = from === "updated" ? "myUpdate" : bazaar._type2myType(bazaarType);
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
        this._syncRatingUser();
        this._bindRatingUserChange();
        const mount = this._captureMount();
        (["plugins", "themes", "icons", "templates", "widgets"] as TBazaarType[]).forEach((type) => {
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
        bazaar.element.firstElementChild.addEventListener("click", (event) => {
            if (bazaar._syncRatingUser()) {
                bazaar._refreshVisibleRatingUI();
            }
            let target = event.target as HTMLElement;
            const packageElement = hasClosestByAttribute(target, "data-name", null);
            let pkgType: TBazaarType | undefined;
            let pkgItem: IBazaarItem;
            let updatedItem: IUpdatedBazaarItem;
            let packageSource: "downloaded" | "updated" | "bazaar";
            let packageName: string | undefined;
            if (packageElement) {
                packageName = packageElement.getAttribute("data-name") || undefined;
                pkgType = packageElement.getAttribute("data-package-type") as TBazaarType;
                packageSource = (packageElement.getAttribute("data-package-source") ||
                    packageElement.getAttribute("data-from")) as "downloaded" | "updated" | "bazaar";
                if (packageName && pkgType && packageSource === "downloaded") {
                    pkgItem = bazaar._data.downloaded.find((item) => item.name === packageName);
                } else if (packageName && pkgType && packageSource === "updated") {
                    updatedItem = bazaar._getUpdatedItem(pkgType, packageName);
                    pkgItem = updatedItem?.available;
                } else if (packageName && pkgType && packageSource === "bazaar") {
                    pkgItem = bazaar._data[pkgType]?.find((item) => item.name === packageName);
                }
            }
            const packageDetail = packageName && pkgType ? bazaar._getPackageDetail(pkgType, packageName) : undefined;
            const installedItem = packageDetail?.installed || updatedItem?.installed ||
                (packageSource === "downloaded" ? pkgItem : undefined);
            const availableItem = packageDetail?.available || updatedItem?.available ||
                (packageSource === "bazaar" ? pkgItem : undefined);
            while (target && !target.isEqualNode(bazaar.element)) {
                const type = target.getAttribute("data-type");
                if (target.tagName === "A") {
                    break;
                }
                const packageInstalled = Boolean(installedItem) ||
                    (packageSource === "bazaar" && pkgItem?.installed === true);
                if (type === "rate-package" && pkgType && packageName &&
                    isBazaarPackageRatingEditable(packageSource, packageInstalled)) {
                    bazaar._openRatingDialog(pkgType, packageName);
                    event.preventDefault();
                    event.stopPropagation();
                    break;
                } else if (type === "copy-funding") {
                    const funding = target.getAttribute("data-funding");
                    if (funding) {
                        writeText(funding);
                        showMessage(window.siyuan.languages.copied);
                    }
                    event.preventDefault();
                    event.stopPropagation();
                    break;
                } else if (type === "keywords-expand") {
                    target.parentElement?.querySelectorAll("[data-keyword-hidden]").forEach((item) => {
                        item.classList.remove("fn__none");
                    });
                    target.remove();
                    event.preventDefault();
                    event.stopPropagation();
                    break;
                } else if (type === "bazaar-alternative") {
                    const alternativeType = target.getAttribute("data-package-type") as TBazaarType;
                    const alternativeName = target.getAttribute("data-package-name");
                    if (alternativeType && alternativeName) {
                        bazaar._openBazaarAlternative(alternativeType, alternativeName);
                    }
                    event.preventDefault();
                    event.stopPropagation();
                    break;
                } else if (type === "open" && (installedItem || pkgItem) && pkgType) {
                    const item = installedItem || pkgItem;
                    /// #if !BROWSER
                    if (["icons", "themes"].includes(pkgType)) {
                        useShell("openPath", path.join(window.siyuan.config.system.confDir, "appearance", pkgType, item.name));
                    } else {
                        useShell("openPath", path.join(window.siyuan.config.system.dataDir, pkgType, item.name));
                    }
                    /// #endif
                    event.preventDefault();
                    event.stopPropagation();
                    break;
                } else if (["myTheme", "myTemplate", "myIcon", "myWidget", "myPlugin", "myUpdate"].includes(type)) {
                    const downloadedLoading = bazaar.element.querySelector("#configBazaarDownloaded")
                        .getAttribute("data-loading");
                    if (target.classList.contains("b3-button--outline") &&
                        (type === "myUpdate" || !downloadedLoading)) {
                        target.parentElement.querySelectorAll('.b3-button[data-type^="my"]').forEach((item: HTMLElement) => {
                            item.classList.add("b3-button--outline");
                        });
                        target.classList.remove("b3-button--outline");
                        if (type === "myUpdate") {
                            bazaar._updateDownloadedToolbar("update");
                            bazaar._renderUpdatePanel();
                            bazaar._checkUpdate();
                        } else {
                            this._genMyHTML(bazaar._myType2Type(type), app);
                        }
                    }
                    event.preventDefault();
                    event.stopPropagation();
                    break;
                } else if (type === "retry-update") {
                    bazaar._checkUpdate(true);
                    event.preventDefault();
                    event.stopPropagation();
                    break;
                } else if (type === "goBack") {
                    bazaar.element.querySelector("#configBazaarReadme").classList.remove("config__view--show");
                    event.preventDefault();
                    event.stopPropagation();
                    break;
                } else if (type === "install") {
                    event.preventDefault();
                    event.stopPropagation();
                    const installItem = availableItem || pkgItem;
                    if (!target.classList.contains("b3-button--progress") && !target.hasAttribute("disabled") && installItem && pkgType) {
                        const installAPI: Record<TBazaarType, string> = {
                            plugins: "/api/bazaar/installBazaarPlugin",
                            themes: "/api/bazaar/installBazaarTheme",
                            icons: "/api/bazaar/installBazaarIcon",
                            templates: "/api/bazaar/installBazaarTemplate",
                            widgets: "/api/bazaar/installBazaarWidget",
                        };
                        const themeAppearanceMode = pkgType === "themes" ?
                            bazaar._resolveThemeAppearanceMode(installItem) : {};
                        const request = bazaar._beginBazaarRequest(pkgType, mount);
                        fetchPost(installAPI[pkgType], {
                            keyword: (mount.element.querySelector(`.config-bazaar__panel[data-type="${bazaar._type2tabType(pkgType)}"] .b3-text-field`) as HTMLInputElement).value,
                            repoURL: installItem.repoURL,
                            packageName: installItem.name,
                            repoHash: installItem.repoHash,
                            repoRef: installItem.repoRef || "",
                            ...themeAppearanceMode,
                            frontend: getFrontend()
                        }, response => {
                            bazaar._onBazaar(response, pkgType, request);
                            if (response.code !== 0) {
                                if (bazaar._isBazaarRequestCurrent(pkgType, request)) {
                                    bazaar._refreshReadmeDetail(pkgType, installItem.name);
                                }
                                return;
                            }
                            if (bazaar._isMountCurrent(mount)) {
                                bazaar._genMyHTML(pkgType, app, false);
                                bazaar._refreshReadmeDetail(pkgType, installItem.name);
                            }
                            if (pkgType === "plugins") {
                                if (window.siyuan.config.bazaar.petalDisabled) {
                                    confirmDialog(window.siyuan.languages.confirm, window.siyuan.languages.enablePluginTip2);
                                } else {
                                    confirmDialog("💡 " + window.siyuan.languages.enablePlugin, window.siyuan.languages.enablePluginTip, () => {
                                        bazaar._setPluginEnabled(app, installItem, true, () => {
                                            if (bazaar._isMountCurrent(mount)) {
                                                bazaar._genMyHTML(pkgType, app, false);
                                                bazaar._refreshReadmeDetail(pkgType, installItem.name);
                                            }
                                        });
                                    });
                                }
                            }
                        });
                    }
                    break;
                } else if (type === "install-all") {
                    confirmDialog("⬆️ " + window.siyuan.languages.updateAll, window.siyuan.languages.confirmUpdateAll, () => {
                        fetchPost("/api/bazaar/batchUpdatePackage", {frontend: getFrontend()}, (response) => {
                            if (response.code !== 0) {
                                showMessage(response.msg);
                                return;
                            }
                            if (bazaar._isMountCurrent(mount)) {
                                mount.element.querySelector("#configBazaarReadme")?.classList.remove("config__view--show");
                                bazaar._checkUpdate(true);
                            }
                        });
                    });
                    event.preventDefault();
                    event.stopPropagation();
                    break;
                } else if (type === "feedback") {
                    event.preventDefault();
                    event.stopPropagation();
                    break;
                } else if (type === "install-t") {
                    const packageName = updatedItem?.installed.name || pkgItem?.name;
                    if (!target.classList.contains("b3-button--progress") && !target.hasAttribute("disabled") && packageName && pkgType) {
                        confirmDialog("⬆️ " + window.siyuan.languages.update, window.siyuan.languages.confirmUpdate, () => {
                            if (!target.classList.contains("b3-button")) {
                                target.parentElement.insertAdjacentHTML("afterend", '<img data-type="img-loading" style="position: absolute;top: 0;left: 0;height: 100%;width: 100%;padding: 16px;box-sizing: border-box;" src="/stage/loading-pure.svg">');
                            }
                            const request = bazaar._beginBazaarRequest(pkgType, mount);
                            fetchPost("/api/bazaar/updateBazaarPackage", {
                                packageType: pkgType,
                                packageName,
                                frontend: getFrontend()
                            }, response => {
                                if (response.code !== 0) {
                                    showMessage(response.msg);
                                    target.parentElement.parentElement.querySelector("img[data-type='img-loading']")?.remove();
                                    return;
                                }
                                bazaar._onBazaar(response, pkgType, request);
                                if (bazaar._isMountCurrent(mount)) {
                                    mount.element.querySelector("#configBazaarReadme")?.classList.remove("config__view--show");
                                    this._genMyHTML(pkgType, app);
                                    bazaar._checkUpdate(true);
                                }
                            });
                        });
                    }
                    event.preventDefault();
                    event.stopPropagation();
                    break;
                } else if (type === "uninstall" && installedItem && pkgType) {
                    event.preventDefault();
                    event.stopPropagation();
                    const uninstallAPI: Record<TBazaarType, string> = {
                        plugins: "/api/bazaar/uninstallBazaarPlugin",
                        themes: "/api/bazaar/uninstallBazaarTheme",
                        icons: "/api/bazaar/uninstallBazaarIcon",
                        templates: "/api/bazaar/uninstallBazaarTemplate",
                        widgets: "/api/bazaar/uninstallBazaarWidget",
                    };
                    const uninstallName = installedItem.name;
                    const keyword = (mount.element.querySelector(`.config-bazaar__panel[data-type="${bazaar._type2tabType(pkgType)}"] .b3-text-field`) as HTMLInputElement).value;
                    confirmDialog("⚠️ " + window.siyuan.languages.uninstall, window.siyuan.languages.confirmUninstall.replace("${name}", escapeHtml(uninstallName)), () => {
                        const request = bazaar._beginBazaarRequest(pkgType, mount);
                        fetchPost(uninstallAPI[pkgType], {
                            packageName: uninstallName,
                            keyword,
                            frontend: getFrontend()
                        }, response => {
                            if (response.code !== 0) {
                                showMessage(response.msg);
                                return;
                            }
                            bazaar._data.details.delete(bazaar._getDetailKey(pkgType, uninstallName));
                            bazaar._onBazaar(response, pkgType, request);
                            if (bazaar._isMountCurrent(mount)) {
                                mount.element.querySelector("#configBazaarReadme")?.classList.remove("config__view--show");
                                this._genMyHTML(pkgType, app);
                                bazaar._checkUpdate(true);
                            }
                        });
                    });
                    break;
                } else if (type === "switch" && (installedItem || pkgItem) && pkgType && ["icons", "themes"].includes(pkgType)) {
                    event.preventDefault();
                    event.stopPropagation();
                    if (target.hasAttribute("disabled")) {
                        break;
                    }
                    const appearanceItem = installedItem || pkgItem;
                    target.setAttribute("disabled", "disabled");
                    bazaar._setAppearancePackage(pkgType as "themes" | "icons", appearanceItem, true, () => {
                        if (bazaar._isMountCurrent(mount)) {
                            bazaar._refreshPackageUI(pkgType, appearanceItem.name, app);
                        }
                    });
                    break;
                } else if (["package-enable", "package-disable"].includes(type) && (installedItem || pkgItem) && pkgType) {
                    event.preventDefault();
                    event.stopPropagation();
                    if (target.hasAttribute("disabled")) {
                        break;
                    }
                    const enabled = type === "package-enable";
                    const actionItem = installedItem || pkgItem;
                    target.setAttribute("disabled", "disabled");
                    if (pkgType === "plugins" && installedItem) {
                        bazaar._setPluginEnabled(app, installedItem, enabled, () => {
                            if (bazaar._isMountCurrent(mount)) {
                                bazaar._refreshPackageUI(pkgType, installedItem.name, app);
                            }
                        });
                    } else if (["icons", "themes"].includes(pkgType)) {
                        bazaar._setAppearancePackage(pkgType as "themes" | "icons", actionItem, enabled, () => {
                            if (bazaar._isMountCurrent(mount)) {
                                bazaar._refreshPackageUI(pkgType, actionItem.name, app);
                            }
                        });
                    }
                    break;
                } else if (type === "setting" && pkgItem) {
                    if (window.siyuan.config.bazaar.petalDisabled) {
                        event.preventDefault();
                        event.stopPropagation();
                        break;
                    }
                    app.plugins.find((item: Plugin) => {
                        if (item.name === pkgItem.name) {
                            item.openSetting();
                            return true;
                        }
                    });
                    event.preventDefault();
                    event.stopPropagation();
                    break;
                } else if (type === "plugins-enable") {
                    if (!target.getAttribute("disabled")) {
                        const requestID = ++this._pluginGlobalRequestID;
                        this._pluginGlobalRequestPending = true;
                        this._syncPluginGlobalSwitch();
                        void setGlobalPluginsDisabled(app, !(target as HTMLInputElement).checked).catch((error) => {
                            console.error(error);
                        }).finally(() => {
                            if (requestID !== this._pluginGlobalRequestID) {
                                return;
                            }
                            this._pluginGlobalRequestPending = false;
                            this._syncPluginGlobalSwitch();
                        });
                    }
                    event.stopPropagation();
                    break;
                } else if (type === "plugin-publish-enable-label") {
                    event.stopPropagation();
                    break;
                } else if (type === "plugin-publish-enable" && installedItem) {
                    if (!target.hasAttribute("disabled")) {
                        target.setAttribute("disabled", "disabled");
                        const enabled = (target as HTMLInputElement).checked;
                        bazaar._setPluginPublishEnabled(installedItem, enabled, () => {
                            if (bazaar._isMountCurrent(mount)) {
                                target.removeAttribute("disabled");
                                this._genMyHTML("plugins", app, true);
                            }
                        });
                    }
                    event.stopPropagation();
                    break;
                } else if (type === "plugin-enable" && (installedItem || pkgItem)) {
                    if (!target.hasAttribute("disabled")) {
                        target.setAttribute("disabled", "disabled");
                        const enabled = (target as HTMLInputElement).checked;
                        const pluginItem = installedItem || pkgItem;
                        bazaar._setPluginEnabled(app, pluginItem, enabled, () => {
                            if (bazaar._isMountCurrent(mount)) {
                                target.removeAttribute("disabled");
                                this._genMyHTML("plugins", app, true);
                            }
                        });
                    }
                    event.stopPropagation();
                    break;
                } else if (target.classList.contains("b3-card")) {
                    if (!hasClosestByClassName(event.target as HTMLElement, "b3-card__actions--right") &&
                        pkgItem && !pkgItem.invalidReason && pkgType) {
                        bazaar._renderReadme(pkgType, packageSource, pkgItem);
                    }
                    event.preventDefault();
                    event.stopPropagation();
                    break;
                } else if (target.classList.contains("item") && !target.classList.contains("item--focus")) {
                    // switch tab
                    bazaar.element.querySelector(".layout-tab-bar .item--focus").classList.remove("item--focus");
                    target.classList.add("item--focus");
                    bazaar.element.querySelectorAll(".config-bazaar__panel").forEach(item => {
                        if (type === item.getAttribute("data-type")) {
                            item.classList.remove("fn__none");
                            if (type !== "downloaded") {
                                bazaar._initBazaarPanel(app, (type + "s") as TBazaarType, item as HTMLElement);
                            }
                        } else {
                            item.classList.add("fn__none");
                        }
                    });
                    event.preventDefault();
                    event.stopPropagation();
                    break;
                } else if (target.classList.contains("item__preview")) {
                    if (isMobile()) {
                        const previewURL = target.dataset.previewUrl;
                        if (previewURL) {
                            previewImages([previewURL], previewURL);
                        }
                    } else {
                        target.classList.toggle("item__preview--fullscreen");
                    }
                    event.preventDefault();
                    event.stopPropagation();
                    break;
                }
                target = target.parentElement;
            }
        });

        bazaar.element.querySelectorAll(".config-bazaar__panel .b3-text-field").forEach((inputElement: HTMLInputElement) => {
            inputElement.addEventListener("keydown", (event) => {
                if (event.isComposing) {
                    return;
                }
                if (event.key === "Enter") {
                    const keyword = inputElement.value.trim();
                    const type = (hasClosestByClassName(inputElement, "config-bazaar__panel") as HTMLElement).getAttribute("data-type");
                    if (type === "template") {
                        const request = bazaar._beginBazaarRequest("templates", mount);
                        fetchPost("/api/bazaar/getBazaarTemplate", {keyword}, response => {
                            bazaar._onBazaar(response, "templates", request);
                        });
                    } else if (type === "icon") {
                        const request = bazaar._beginBazaarRequest("icons", mount);
                        fetchPost("/api/bazaar/getBazaarIcon", {keyword}, response => {
                            bazaar._onBazaar(response, "icons", request);
                        });
                    } else if (type === "widget") {
                        const request = bazaar._beginBazaarRequest("widgets", mount);
                        fetchPost("/api/bazaar/getBazaarWidget", {keyword}, response => {
                            bazaar._onBazaar(response, "widgets", request);
                        });
                    } else if (type === "theme") {
                        const request = bazaar._beginBazaarRequest("themes", mount);
                        fetchPost("/api/bazaar/getBazaarTheme", {frontend: getFrontend(), keyword}, response => {
                            bazaar._onBazaar(response, "themes", request);
                        });
                    } else if (type === "plugin") {
                        const request = bazaar._beginBazaarRequest("plugins", mount);
                        fetchPost("/api/bazaar/getBazaarPlugin", {
                            frontend: getFrontend(),
                            keyword
                        }, response => {
                            bazaar._onBazaar(response, "plugins", request);
                        });
                    } else if (type === "downloaded") {
                        const activeType = inputElement.closest(".config-bazaar__title")?.querySelector('.b3-button[data-type^="my"]:not(.b3-button--outline)')?.getAttribute("data-type");
                        if (activeType && activeType !== "myUpdate") {
                            this._genMyHTML(bazaar._myType2Type(activeType), app);
                        }
                    }
                    event.preventDefault();
                    return;
                }
            });
        });

        bazaar.element.querySelectorAll(".b3-select").forEach((selectElement: HTMLSelectElement) => {
            selectElement.addEventListener("change", () => {
                if (selectElement.getAttribute("data-type") === "downloaded-sort") {
                    const activeBtn = bazaar.element.querySelector("#configBazaarDownloaded")?.previousElementSibling?.querySelector('.b3-button[data-type^="my"]:not(.b3-button--outline)') as HTMLElement;
                    if (activeBtn?.getAttribute("data-type") === "myUpdate") {
                        return;
                    }
                    const bazaarType = bazaar._myType2Type(activeBtn.getAttribute("data-type"));
                    window.siyuan.storage[Constants.LOCAL_BAZAAR][bazaar._getDownloadedSortStorageKey(bazaarType)] = selectElement.value;
                    setStorageVal(Constants.LOCAL_BAZAAR, window.siyuan.storage[Constants.LOCAL_BAZAAR]);
                    bazaar._reorderDownloadedCards(bazaar._sortDownloadedPackages(bazaar._data.downloadedDefault, selectElement.value));
                } else if (selectElement.id === "bazaarSelect") {
                    bazaar._renderBazaarCards(
                        bazaar.element.querySelector("#configBazaarTheme"),
                        bazaar._data.themes,
                        "themes",
                        selectElement.value
                    );
                } else {
                    // sort
                    const panelElement = selectElement.parentElement.parentElement;
                    const panelType = panelElement.getAttribute("data-type");
                    const bazaarType = {
                        plugin: "plugins",
                        theme: "themes",
                        icon: "icons",
                        template: "templates",
                        widget: "widgets",
                    }[panelType] as TBazaarType;
                    bazaar._renderBazaarCards(
                        panelElement.querySelector(".config-bazaar__content"),
                        bazaar._sortPackages(bazaar._data[bazaarType], selectElement.value),
                        bazaarType,
                        bazaarType === "themes" ? (bazaar.element.querySelector("#bazaarSelect") as HTMLSelectElement).value : undefined
                    );
                    window.siyuan.storage[Constants.LOCAL_BAZAAR][panelType] = selectElement.value;
                    setStorageVal(Constants.LOCAL_BAZAAR, window.siyuan.storage[Constants.LOCAL_BAZAAR]);
                }
            });
        });
    },
    _sortPackages(packages: IBazaarItem[], sortValue: string): IBazaarItem[] {
        const sorted = [...packages];
        // 更新时间降序
        if (sortValue === "0") {
            return sorted.sort((a, b) => (b.updated < a.updated ? -1 : 1));
        }
        // 更新时间升序
        if (sortValue === "1") {
            return sorted.sort((a, b) => (b.updated < a.updated ? 1 : -1));
        }
        // 下载次数降序
        if (sortValue === "2") {
            return sorted.sort((a, b) => (b.downloads < a.downloads ? -1 : 1));
        }
        // 下载次数升序
        if (sortValue === "3") {
            return sorted.sort((a, b) => (b.downloads < a.downloads ? 1 : -1));
        }
        if (["4", "5"].includes(sortValue)) {
            return sortBazaarPackagesByRating(sorted, sortValue === "4");
        }
        return sorted;
    },
    _renderBazaarCards(container: Element, packages: IBazaarItem[], bazaarType: TBazaarType, themeModeValue?: string) {
        const htmlParts: string[] = [];
        for (const item of packages) {
            if (bazaarType === "themes" && themeModeValue && themeModeValue !== "2" && (
                (themeModeValue === "0" && item.modes?.includes("dark")) ||
                (themeModeValue === "1" && item.modes?.includes("light"))
            )) {
                continue;
            }
            htmlParts.push(bazaar._genCardHTML(item, bazaarType));
        }
        const html = htmlParts.join("");
        container.innerHTML = `<div class="b3-cards${html ? "" : " b3-cards--nowrap"}">${html || `<ul class="b3-list b3-list--background"><li class="b3-list--empty">${window.siyuan.languages.emptyContent}</li></ul>`}</div>`;
        container.parentElement.querySelector(".counter").textContent = htmlParts.length.toString();
    },
    _onBazaar(response: IWebSocketData, bazaarType: TBazaarType, mount: IBazaarMountSnapshot) {
        if (!bazaar._isBazaarRequestCurrent(bazaarType, mount)) {
            return;
        }
        const panelSelector: Record<TBazaarType, string> = {
            plugins: "#configBazaarPlugin",
            themes: "#configBazaarTheme",
            icons: "#configBazaarIcon",
            templates: "#configBazaarTemplate",
            widgets: "#configBazaarWidget",
        };
        const element = bazaar.element.querySelector(panelSelector[bazaarType]);
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
        const sortValue = window.siyuan.storage[Constants.LOCAL_BAZAAR][bazaar._type2tabType(bazaarType)];
        const packages = sortValue && sortValue !== "0" ? bazaar._sortPackages(response.data.packages, sortValue) : response.data.packages;
        bazaar._renderBazaarCards(element, packages, bazaarType,
            bazaarType === "themes" ? (bazaar.element.querySelector("#bazaarSelect") as HTMLSelectElement)?.value : undefined);
    }
};
