import {showMessage} from "../dialog/message";
import {fetchPost} from "../util/fetch";
import {confirmDialog} from "../dialog/confirmDialog";
import {highlightRender} from "../protyle/render/highlightRender";
import {saveLayout} from "../layout/util";
import {Constants} from "../constants";
/// #if !BROWSER
import * as path from "path";
/// #endif
import {getFrontend, isBrowser} from "../util/functions";
import {setStorageVal, writeText} from "../protyle/util/compatibility";
import {hasClosestByAttribute, hasClosestByClassName} from "../protyle/util/hasClosest";
import {Plugin} from "../plugin";
import type {App} from "../index";
import {escapeAttr, escapeHtml} from "../util/escape";
import {formatCount} from "../util/number";
import {uninstall} from "../plugin/uninstall";
import {afterLoadPlugin, loadPlugin, loadPlugins} from "../plugin/loader";
import {useShell} from "../util/pathName";
import {switchSettingPanelSubTab} from "./setting/mount";
import {isThemeFrontendSupported} from "../util/themeCompatibility";
import {
    getBazaarBackendSystemLabels,
    getBazaarCompatibilityData,
    getBazaarCompatibilityFieldVisibility,
    getBazaarFundingItems,
    getBazaarKernelSystemLabels,
    getBazaarThemeModeLabels,
} from "../util/bazaarPackage";

/** 集市 Tab 侧栏 / 全局搜索索引文案 */
export const collectBazaarTabSearchStrings = (): string[] => [
    window.siyuan.languages.bazaar,
    window.siyuan.languages.downloaded,
    window.siyuan.languages.update,
    window.siyuan.languages.plugin,
    window.siyuan.languages.theme,
    window.siyuan.languages.icon,
    window.siyuan.languages.template,
    window.siyuan.languages.widget,
];

/** 集市 Tab 挂载（面板页，不走注册表渲染） */
export const mountBazaarTab = (root: HTMLElement, keywords?: string, app?: App) => {
    if (root.innerHTML === "") {
        bazaar.element = root;
        root.innerHTML = bazaar.genHTML();
        if (app) {
            bazaar.bindEvent(app);
        }
    } else {
        bazaar.element = root;
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

/**
 * 渲染集市 README
 */
export const renderReadme = (bazaarType: TBazaarType, from: "downloaded" | "updated" | "bazaar", data: IBazaarItem) => {
    if (bazaar.element == null) return;
    bazaar._renderReadme(bazaarType, from, data);
};

export const bazaar = {
    element: undefined as Element,
    _updateState: "idle" as "idle" | "loading" | "loaded" | "error",
    _updateRequestID: 0,
    _localPackageUploading: false,
    genHTML() {
        if (!window.siyuan.config.bazaar.trust) {
            return `<div class="fn__flex-column" style="margin: 0 48px;">
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
    <diiv>${window.siyuan.languages.bazaarTrust2}</diiv>
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
                <button data-type="myUpdate" class="b3-button b3-button--outline">${window.siyuan.languages.update}</button>
                <button data-type="myPlugin" class="b3-button">${window.siyuan.languages.plugin}</button>
                <button data-type="myTheme" class="b3-button b3-button--outline">${window.siyuan.languages.theme}</button>
                <button data-type="myIcon" class="b3-button b3-button--outline">${window.siyuan.languages.icon}</button>
                <button data-type="myTemplate" class="b3-button b3-button--outline">${window.siyuan.languages.template}</button>
                <button data-type="myWidget" class="b3-button b3-button--outline">${window.siyuan.languages.widget}</button>
            </div>
            <div class="fn__flex config-bazaar__tools">
                <input data-type="downloaded-filter" class="b3-text-field config-bazaar__filter" placeholder="${window.siyuan.languages.enterKey} ${window.siyuan.languages.search}">
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
                <div class="fn__flex config-bazaar__actions">
                    <label class="b3-button b3-button--outline config-bazaar__local-package" data-type="install-local-package">
                        <svg class="b3-button__icon"><use xlink:href="#iconUpload"></use></svg>${window.siyuan.languages.installLocalBazaarPackage}
                        <input class="b3-form__upload" data-type="local-package-file" type="file" accept=".zip,application/zip">
                    </label>
                    <button class="b3-button fn__none" data-type="install-all">${window.siyuan.languages.updateAll}</button>
                    <input ${window.siyuan.config.bazaar.petalDisabled ? "" : " checked"} data-type="plugins-enable" data-position="north" type="checkbox" class="b3-switch fn__flex-center ariaLabel" aria-label="${window.siyuan.languages[window.siyuan.config.bazaar.petalDisabled ? "enable" : "disableAll"]}">
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
            </select>
            <div class="fn__space"></div>
            <select id="bazaarSelect" class="b3-select">
                <option selected value="2">${window.siyuan.languages.all}</option>
                <option value="0">${window.siyuan.languages.themeLight}</option>
                <option value="1">${window.siyuan.languages.themeDark}</option>
            </select>
            <div class="fn__space"></div>
            <input class="b3-text-field" placeholder="${window.siyuan.languages.enterKey} ${window.siyuan.languages.search}">
            <div class="fn__space"></div>
            <div class="fn__flex-1"></div>
            <div class="counter counter--bg fn__flex-center ariaLabel" data-position="north" aria-label="${window.siyuan.languages.total}"></div>
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
            </select>
            <div class="fn__space"></div>
            <input class="b3-text-field" placeholder="${window.siyuan.languages.enterKey} ${window.siyuan.languages.search}">
            <div class="fn__space"></div>
            <div class="fn__flex-1"></div>
            <div class="counter counter--bg fn__flex-center ariaLabel" data-position="north" aria-label="${window.siyuan.languages.total}"></div>
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
            </select>
            <div class="fn__space"></div>
            <input class="b3-text-field" placeholder="${window.siyuan.languages.enterKey} ${window.siyuan.languages.search}">
            <div class="fn__space"></div>
            <div class="fn__flex-1"></div>
            <div class="counter counter--bg fn__flex-center ariaLabel" data-position="north" aria-label="${window.siyuan.languages.total}"></div>
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
            </select>
            <div class="fn__space"></div>
            <input class="b3-text-field" placeholder="${window.siyuan.languages.enterKey} ${window.siyuan.languages.search}">
            <div class="fn__space"></div>
            <div class="fn__flex-1"></div>
            <div class="counter counter--bg fn__flex-center ariaLabel" data-position="north" aria-label="${window.siyuan.languages.total}"></div>
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
            </select>
            <div class="fn__space"></div>
            <input class="b3-text-field" placeholder="${window.siyuan.languages.enterKey} ${window.siyuan.languages.search}">
            <div class="fn__space"></div>
            <div class="fn__flex-1"></div>
            <div class="counter counter--bg fn__flex-center ariaLabel" data-position="north" aria-label="${window.siyuan.languages.total}"></div>
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
    _genFundingHTML(funding: string): string {
        if (!funding) {
            return "";
        }
        try {
            const url = new URL(funding);
            if (!["http:", "https:", "mailto:"].includes(url.protocol)) {
                throw new Error("not an allowed URL protocol");
            }
            return `<span class="fn__space--small"></span><a target="_blank" href="${escapeAttr(funding)}" class="block__icon block__icon--show ariaLabel" data-position="north" aria-label="${window.siyuan.languages.sponsor} ${escapeAttr(funding)}"><svg class="ft__pink"><use xlink:href="#iconHeart"></use></svg></a>`;
        } catch (e) {
            return `<span class="fn__space--small"></span><span data-type="copy-funding" data-funding="${escapeAttr(funding)}" class="block__icon block__icon--show ariaLabel" data-position="north" aria-label="${window.siyuan.languages.sponsor} ${escapeAttr(funding)}"><svg class="ft__pink"><use xlink:href="#iconHeart"></use></svg></span>`;
        }
    },
    _genReadmeFundingHTML(funding: string): string {
        try {
            const url = new URL(funding);
            if (!["http:", "https:", "mailto:"].includes(url.protocol)) {
                throw new Error("not an allowed URL protocol");
            }
            const displayFunding = url.host || url.pathname || funding;
            return `<a target="_blank" href="${escapeAttr(funding)}" title="${escapeAttr(funding)}" class="item__meta-funding">${escapeHtml(displayFunding)}</a>`;
        } catch (e) {
            return `<span data-type="copy-funding" data-funding="${escapeAttr(funding)}" title="${escapeAttr(funding)}" class="item__meta-funding ft__primary fn__pointer">${escapeHtml(funding)}</span>`;
        }
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
        fetchPost("/api/bazaar/getBazaarPackage", {
            packageType: bazaarType,
            packageName,
            frontend: getFrontend(),
        }, response => {
            if (response.code !== 0 || !response.data) {
                callback(bazaar._getPackageDetail(bazaarType, packageName) || {});
                return;
            }
            const detail = response.data as IBazaarPackageDetail;
            bazaar._setPackageDetail(bazaarType, packageName, detail);
            callback(detail);
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
    _getFrontendLabels(frontends: string[]) {
        if (!frontends?.length || frontends.includes("all")) {
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
        if (bazaarType === "plugins") {
            primaryAction = `<button class="b3-button fn__block" data-type="${installed.enabled ? "package-disable" : "package-enable"}">${installed.enabled ? window.siyuan.languages.disable : window.siyuan.languages.enable}</button>`;
        } else if (["themes", "icons"].includes(bazaarType)) {
            primaryAction = `<button class="b3-button fn__block" data-type="${installed.current ? "package-disable" : "package-enable"}">${installed.current ? window.siyuan.languages.disable : window.siyuan.languages.use}</button>`;
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
        <img src="${item.iconURL}" loading="lazy" onerror="this.src='/stage/images/icon.png'"/>
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
            <span class="fn__space--small"></span>
            <span class="block__icon block__icon--show block__icon--text">
                <svg><use xlink:href="#iconAccount"></use></svg>
                <span class="fn__space--small"></span>
                <span class="b3-card__author">${escapeHtml(item.author)}</span>
            </span>
            ${bazaar._genFundingHTML(item.preferredFunding)}
            ${bazaar._genIncompatibleChipHTML(item, "bazaar", bazaarType)}
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
        return `<div class="b3-card" data-name="${escapeAttr(installed.name)}" data-package-type="${bazaarType}" data-package-source="updated">
    <div class="b3-card__img"><img src="${installed.iconURL}" loading="lazy" onerror="this.src='/stage/images/icon.png'"/></div>
    <div class="fn__flex-1 fn__flex-column">
        <div class="b3-card__info b3-card__info--left fn__flex-1">
            ${escapeHtml(installed.preferredName)}
            <div class="b3-card__desc" title="${escapeAttr(installed.preferredDesc)}">${escapeHtml(installed.preferredDesc)}</div>
        </div>
    </div>
    <div class="b3-card__actions b3-card__actions--right">
        ${bazaar._genIncompatibleChipHTML(available, "bazaar", bazaarType)}
        ${bazaar._genFundingHTML(installed.preferredFunding)}
        <span data-position="north" class="ariaLabel block__icon block__icon--show${isBrowser() ? " fn__none" : ""}" data-type="open" aria-label="${window.siyuan.languages.showInFolder}">
            <svg><use xlink:href="#iconFolder"></use></svg>
        </span>
        ${bazaar._genUpdateButtonHTML(available, bazaarType)}
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
    _checkUpdate(force = false) {
        if (!force && ["loading", "loaded"].includes(this._updateState)) {
            return;
        }
        this._updateState = "loading";
        const requestID = ++this._updateRequestID;
        if (this._isUpdatePanelActive()) {
            this._renderUpdatePanel();
        }
        fetchPost("/api/bazaar/getUpdatedPackage", {frontend: getFrontend()}, (response) => {
            if (requestID !== this._updateRequestID || !this.element?.isConnected) {
                return;
            }
            if (response.code !== 0 || !response.data) {
                this._updateState = "error";
                if (this._isUpdatePanelActive()) {
                    this._renderUpdatePanel();
                }
                return;
            }
            this._data.update = response.data;
            this._updateState = "loaded";
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
        installAllElement?.classList.toggle("fn__none", !items.some(({item}) => !item.available.disallowUpdate));
        contentElement.innerHTML = items.map(({type, item}) => this._genUpdateItemHTML(item, type)).join("");
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
    _genMyHTML(bazaarType: TBazaarType, app: App, preserveOrder = false) {
        const contentElement = bazaar.element.querySelector("#configBazaarDownloaded");
        const myType = bazaar._type2myType(bazaarType);
        const typeBtn = contentElement.previousElementSibling.querySelector(`[data-type="${myType}"]`) as HTMLElement;
        if (contentElement.getAttribute("data-loading") === "true" ||
            typeBtn?.classList.contains("b3-button--outline")) {
            return;
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
            return;
        }
        bazaar._updateDownloadedSortSelect(bazaarType);
        const initialSortValue = bazaar._getDownloadedSortValue(bazaarType);
        fetchPost(installedAPI[bazaarType], {
            frontend: getFrontend(),
            keyword: (contentElement.previousElementSibling.querySelector(".b3-text-field") as HTMLInputElement)?.value || "",
        }, response => {
            contentElement.removeAttribute("data-loading");
            const activeBtn = contentElement.previousElementSibling.querySelector('.b3-button[data-type^="my"]:not(.b3-button--outline)') as HTMLElement;
            if (activeBtn?.getAttribute("data-type") !== myType) {
                return;
            }
            const currentSortValue = bazaar._getDownloadedSortValue(bazaarType);
            const packages = preserveOrder && initialSortValue === currentSortValue ?
                bazaar._preserveDownloadedOrder(response.data.packages) :
                bazaar._sortDownloadedPackages(response.data.packages, currentSortValue);
            let html = "";
            const counterElement = contentElement.previousElementSibling.querySelector(".counter");
            if (packages.length === 0) {
                counterElement.classList.add("fn__none");
            } else {
                counterElement.classList.remove("fn__none");
                counterElement.textContent = packages.length.toString();
                html = packages.map((bazaarItem: IBazaarItem) => {
                    const showSwitch = ["icons", "themes"].includes(bazaarType) && !bazaarItem.current;
                    const showDisable = ["icons", "themes"].includes(bazaarType) && bazaarItem.current;
                    let hasSetting = false;
                    if (bazaarType === "plugins") {
                        const plugin = app.plugins.find((p: Plugin) => p.name === bazaarItem.name);
                        // @ts-ignore
                        hasSetting = plugin && (plugin.setting || plugin.__proto__.hasOwnProperty("openSetting"));
                    }
                    const available = bazaar._getUpdatedItem(bazaarType, bazaarItem.name)?.available;
                    return `<div data-name="${escapeAttr(bazaarItem.name)}" data-package-type="${bazaarType}" data-package-source="downloaded" class="b3-card${bazaarItem.current ? " b3-card--current" : ""}">
    <div class="b3-card__img"><img src="${bazaarItem.iconURL}" loading="lazy" onerror="this.src='/stage/images/icon.png'"/></div>
    <div class="fn__flex-1 fn__flex-column">
        <div class="b3-card__info b3-card__info--left fn__flex-1">
            ${escapeHtml(bazaarItem.preferredName)}
            <div class="b3-card__desc" title="${escapeAttr(bazaarItem.preferredDesc)}">${escapeHtml(bazaarItem.preferredDesc)}</div>
        </div>
    </div>
    <div class="b3-card__actions b3-card__actions--right">
        ${bazaar._genUpdateButtonHTML(available, bazaarType, true)}
        ${bazaar._genIncompatibleChipHTML(bazaarItem, "installed", bazaarType)}
        ${bazaar._genFundingHTML(bazaarItem.preferredFunding)}
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
            bazaar._data.downloadedDefault = response.data.packages;
            bazaar._data.downloaded = packages;
            contentElement.innerHTML = html ? html : `<ul class="b3-list b3-list--background"><li class="b3-list--empty">${window.siyuan.languages.emptyContent}</li></ul>`;
            const sideElement = bazaar.element.querySelector("#configBazaarReadme.config__view--show .item__side");
            // 仅刷新「已下载」详情，避免通过 URI 打开的在线详情被本地数据覆盖
            if (sideElement?.getAttribute("data-from") === "downloaded" &&
                sideElement.getAttribute("data-package-type") === bazaarType) {
                const packageName = sideElement.getAttribute("data-name");
                bazaar._data.downloaded.find((i) => {
                    if (i.name === packageName) {
                        bazaar._renderReadme(bazaarType, "downloaded", i);
                        return true;
                    }
                });
            }
        });
    },
    _data: {
        themes: [] as IBazaarItem[],
        templates: [] as IBazaarItem[],
        icons: [] as IBazaarItem[],
        widgets: [] as IBazaarItem[],
        plugins: [] as IBazaarItem[],
        downloadedDefault: [] as IBazaarItem[],
        downloaded: [] as IBazaarItem[],
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
        const compatibilityData = getBazaarCompatibilityData(from, installed, available, data);
        const resourceData = available || displayData;
        bazaar._setPackageDetail(bazaarType, data.name, {installed, available});
        const urls = resourceData.repoURL.split("/");
        urls.pop();
        const compatibilityFieldVisibility = getBazaarCompatibilityFieldVisibility(bazaarType);
        const frontendLabels = compatibilityFieldVisibility.frontends ?
            bazaar._getFrontendLabels(compatibilityData.frontends) : [];
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
    ${compatibilityFieldVisibility.frontends ? bazaar._genReadmeMetaRow(window.siyuan.languages.bazaarPlatforms, bazaar._genReadmeChips(frontendLabels, true), true) : ""}
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
    <a href="${resourceData.repoURL}/stargazers" target="_blank" title="Stars">${formatCount(resourceData.stars)}</a>
    <span class="fn__space"></span>
    <svg class="svg ft__on-surface"><use xlink:href="#iconGitHubI"></use></svg>
    <span class="fn__space--small"></span>
    <a href="${resourceData.repoURL}/issues" target="_blank" title="Open issues">${formatCount(resourceData.openIssues)}</a>
    <span class="fn__space"></span>
    <svg class="svg ft__on-surface"><use xlink:href="#iconDownload"></use></svg>
    <span class="fn__space--small"></span>
    ${formatCount(resourceData.downloads)}
</div>` : "";
        const fundingItems = getBazaarFundingItems(resourceData.funding);
        if (fundingItems.length === 0 && resourceData.preferredFunding) {
            fundingItems.push(resourceData.preferredFunding);
        }
        const packageSection = `<section class="item__meta-section">
    <div class="item__meta-title">${window.siyuan.languages.bazaarPackageInfo}</div>
    ${bazaar._genReadmeMetaRow(window.siyuan.languages.bazaarPackageName, displayData.name)}
    ${displayData.author ? bazaar._genReadmeMetaRow(window.siyuan.languages.author, `<a href="${escapeAttr(urls.join("/"))}" target="_blank" title="${escapeAttr(urls.join("/"))}">${escapeHtml(displayData.author)}</a>`, true) : ""}
    ${fundingItems.length ? bazaar._genReadmeMetaRow(window.siyuan.languages.bazaarFunding, fundingItems.map((item) => bazaar._genReadmeFundingHTML(item)).join("<br>"), true) : ""}
</section>`;
        readmeElement.innerHTML = ` <div class="item__side" data-from="${from}" data-name="${escapeAttr(displayData.name)}" data-package-type="${bazaarType}" data-repourl="${escapeAttr(resourceData.repoURL)}" data-progress-id="${escapeAttr(available?.repoURL || resourceData.repoURL)}">
    <div class="item__header fn__pointer" data-type="goBack">
        <svg class="b3-list-item__graphic"><use xlink:href="#iconLeft"></use></svg>
        <span class="b3-list-item__text ft__breakword">${navTitles[bazaarType]}</span>
    </div>
    <div class="fn__flex-1">
        <img class="item__img" src="${displayData.iconURL}" loading="lazy" onerror="this.src='/stage/images/icon.png'">
        <div>
            <span class="item__title">${escapeHtml(displayData.preferredName)}</span>
        </div>
        <div class="item__meta">
            ${packageSection}
            ${installSection}
            ${marketSection}
            ${compatibilitySection}
            <section class="item__meta-section item__resources">
                <div class="item__meta-title">${window.siyuan.languages.bazaarResources}</div>
                <div class="fn__flex">
                    <a href="${resourceData.repoURL}" target="_blank" title="${escapeAttr(resourceData.repoURL)}">GitHub</a>
                    <span class="fn__space"></span>
                    <a href="${resourceData.repoURL}/issues" target="_blank" title="Feedback via GitHub Issues" data-type="feedback">${window.siyuan.languages.feedback}</a>
                </div>
                ${resourceStats}
            </section>
        </div>
        <div class="fn__hr--b"></div>
    </div>
    <div class="item__actions">
        ${bazaar._genReadmeActionsHTML(bazaarType, installed, available)}
        ${bazaar._genReadmeUpdateButtonHTML(available, bazaarType, Boolean(installed))}
    </div>
</div>
<div class="item__main">
    <div class="item__preview" style="background-image: url(${displayData.previewURL})"></div>
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
</div>`;
        const isInstalledReadme = from === "downloaded";
        if (isInstalledReadme) {
            const mdElement = readmeElement.querySelector(".item__readme");
            mdElement.innerHTML = window.DOMPurify.sanitize(displayData.preferredReadme || "", {FORBID_TAGS: ["iframe", "frame", "frameset"]});
            highlightRender(mdElement);
        } else {
            fetchPost("/api/bazaar/getBazaarPackageREADME", {
                repoURL: displayData.repoURL,
                repoHash: displayData.repoHash,
                packageType: bazaarType
            }, response => {
                const sideElement = readmeElement.querySelector(".item__side");
                if (response.code !== 0 ||
                    sideElement?.getAttribute("data-package-type") !== bazaarType ||
                    sideElement.getAttribute("data-name") !== displayData.name) {
                    return;
                }
                const mdElement = readmeElement.querySelector(".item__readme");
                mdElement.innerHTML = window.DOMPurify.sanitize(response.data.html, {FORBID_TAGS: ["iframe", "frame", "frameset"]});
                highlightRender(mdElement);
            });
        }
        if (installed) {
            fetchPost("/api/bazaar/getInstalledPackageSize", {
                packageType: bazaarType,
                packageName: installed.name,
            }, response => {
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
        if (!detail && (from === "downloaded" || (from === "bazaar" && data.installed))) {
            bazaar._fetchPackageDetail(bazaarType, data.name, (packageDetail) => {
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
        fetchPost(bazaarAPI[bazaarType], {
            frontend: getFrontend(),
        }, response => {
            if (response.code === 0) {
                bazaar._onBazaar(response, bazaarType);
            }
        });
    },
    _refreshPackageUI(bazaarType: TBazaarType, packageName: string, app: App) {
        bazaar._genMyHTML(bazaarType, app);
        bazaar._reloadBazaarType(bazaarType);
        bazaar._checkUpdate(true);
        bazaar._refreshReadmeDetail(bazaarType, packageName);
    },
    _setPluginEnabled(app: App, item: IBazaarItem, enabled: boolean, callback: () => void) {
        fetchPost("/api/petal/setPetalEnabled", {
            packageName: item.name,
            enabled,
            app: Constants.SIYUAN_APPID,
        }, response => {
            if (response.code !== 0) {
                showMessage(response.msg);
                callback();
                return;
            }
            item.enabled = enabled;
            if (!enabled) {
                uninstall(app, item.name, true);
                callback();
                return;
            }
            if (window.siyuan.config.bazaar.petalDisabled) {
                showMessage(window.siyuan.languages.pluginGlobalDisabledTip);
                callback();
                return;
            }
            loadPlugin(app, response.data).then(callback);
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
        switch (bazaar._type2tabType(bazaarType)) {
            case "template":
                fetchPost("/api/bazaar/getBazaarTemplate", {}, response => {
                    bazaar._onBazaar(response, "templates");
                    bazaar._data.templates = response.data.packages;
                });
                break;
            case "icon":
                fetchPost("/api/bazaar/getBazaarIcon", {}, response => {
                    bazaar._onBazaar(response, "icons");
                    bazaar._data.icons = response.data.packages;
                });
                break;
            case "widget":
                fetchPost("/api/bazaar/getBazaarWidget", {}, response => {
                    bazaar._onBazaar(response, "widgets");
                    bazaar._data.widgets = response.data.packages;
                });
                break;
            case "theme":
                fetchPost("/api/bazaar/getBazaarTheme", {frontend: getFrontend()}, response => {
                    bazaar._onBazaar(response, "themes");
                    bazaar._data.themes = response.data.packages;
                });
                break;
            case "plugin":
                fetchPost("/api/bazaar/getBazaarPlugin", {
                    frontend: getFrontend()
                }, response => {
                    bazaar._onBazaar(response, "plugins");
                    bazaar._data.plugins = response.data.packages;
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
    _setLocalPackageUploading(uploading: boolean) {
        bazaar._localPackageUploading = uploading;
        const labelElement = bazaar.element.querySelector('[data-type="install-local-package"]');
        const inputElement = labelElement?.querySelector('input[type="file"]') as HTMLInputElement;
        labelElement?.classList.toggle("b3-button--progress", uploading);
        if (inputElement) {
            inputElement.disabled = uploading;
        }
    },
    _installLocalPackage(file: File, app: App, overwrite = false) {
        if (bazaar._localPackageUploading) {
            return;
        }
        bazaar._setLocalPackageUploading(true);
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
                        window.siyuan.languages.confirmOverwriteLocalBazaarPackage.replace("${name}", data.packageName), () => {
                            bazaar._installLocalPackage(file, app, true);
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
            bazaar.element.querySelector("#configBazaarReadme")?.classList.remove("config__view--show");
            bazaar._data.details.delete(bazaar._getDetailKey(data.packageType, data.packageName));
            bazaar._data.update[data.packageType] = bazaar._data.update[data.packageType].filter((item) =>
                item.installed.name !== data.packageName);
            bazaar.switchBazaarTab(app, data.packageType, "downloaded");
            if (data.packageType === "plugins" && !data.updated) {
                if (window.siyuan.config.bazaar.petalDisabled) {
                    confirmDialog(window.siyuan.languages.confirm, window.siyuan.languages.enablePluginTip2);
                } else {
                    confirmDialog("💡 " + window.siyuan.languages.enablePlugin, window.siyuan.languages.enablePluginTip, () => {
                        fetchPost("/api/petal/setPetalEnabled", {
                            packageName: data.packageName,
                            enabled: true,
                            app: Constants.SIYUAN_APPID,
                        }, (enableResponse) => {
                            loadPlugin(app, enableResponse.data).then(() => {
                                bazaar._genMyHTML("plugins", app, false);
                            });
                        });
                    });
                }
            }
        }).finally(() => {
            bazaar._setLocalPackageUploading(false);
        });
    },
    _getLocalPackageFile(files: FileList | null) {
        if (files?.length !== 1 || !files[0].name.toLowerCase().endsWith(".zip")) {
            showMessage(window.siyuan.languages.localBazaarPackageFileError);
            return;
        }
        return files[0];
    },
    _bindLocalPackageEvent(app: App) {
        const inputElement = bazaar.element.querySelector('[data-type="local-package-file"]') as HTMLInputElement;
        inputElement?.addEventListener("change", () => {
            const file = bazaar._getLocalPackageFile(inputElement.files);
            inputElement.value = "";
            if (file) {
                bazaar._installLocalPackage(file, app);
            }
        });

        const dropTarget = bazaar.element.firstElementChild as HTMLElement;
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
                bazaar._installLocalPackage(file, app);
            }
        });
    },
    bindEvent(app: App) {
        if (!window.siyuan.config.bazaar.trust) {
            bazaar.element.querySelector("button").addEventListener("click", () => {
                fetchPost("/api/setting/setBazaar", {
                    ...window.siyuan.config.bazaar,
                    trust: true,
                }, (response) => {
                    window.siyuan.config.bazaar = response.data;
                    bazaar.element.innerHTML = bazaar.genHTML();
                    bazaar.bindEvent(app);
                });
            });
            return;
        }
        this._updateState = "idle";
        this._updateRequestID++;
        this._data.details.clear();
        (["plugins", "themes", "icons", "templates", "widgets"] as TBazaarType[]).forEach((type) => {
            this._data.update[type] = [];
        });
        this._genMyHTML("plugins", app);
        this._checkUpdate(true);
        this._bindLocalPackageEvent(app);
        bazaar.element.firstElementChild.addEventListener("click", (event) => {
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
                if (type === "copy-funding") {
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
                        fetchPost(installAPI[pkgType], {
                            keyword: (bazaar.element.querySelector(`.config-bazaar__panel[data-type="${bazaar._type2tabType(pkgType)}"] .b3-text-field`) as HTMLInputElement).value,
                            repoURL: installItem.repoURL,
                            packageName: installItem.name,
                            repoHash: installItem.repoHash,
                            ...themeAppearanceMode,
                            frontend: getFrontend()
                        }, response => {
                            if (response.code !== 0) {
                                return;
                            }
                            bazaar._onBazaar(response, pkgType);
                            bazaar._genMyHTML(pkgType, app, false);
                            bazaar._refreshReadmeDetail(pkgType, installItem.name);
                            if (pkgType === "plugins") {
                                if (window.siyuan.config.bazaar.petalDisabled) {
                                    confirmDialog(window.siyuan.languages.confirm, window.siyuan.languages.enablePluginTip2);
                                } else {
                                    confirmDialog("💡 " + window.siyuan.languages.enablePlugin, window.siyuan.languages.enablePluginTip, () => {
                                        fetchPost("/api/petal/setPetalEnabled", {
                                            packageName: installItem.name,
                                            enabled: true,
                                            app: Constants.SIYUAN_APPID,
                                        }, (response) => {
                                            loadPlugin(app, response.data).then(() => {
                                                bazaar._genMyHTML(pkgType, app, false);
                                                bazaar._refreshReadmeDetail(pkgType, installItem.name);
                                            });
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
                            bazaar.element.querySelector("#configBazaarReadme")?.classList.remove("config__view--show");
                            bazaar._checkUpdate(true);
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
                                bazaar.element.querySelector("#configBazaarReadme")?.classList.remove("config__view--show");
                                this._genMyHTML(pkgType, app);
                                bazaar._onBazaar(response, pkgType);
                                bazaar._checkUpdate(true);
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
                    confirmDialog("⚠️ " + window.siyuan.languages.uninstall, window.siyuan.languages.confirmUninstall.replace("${name}", uninstallName), () => {
                        fetchPost(uninstallAPI[pkgType], {
                            packageName: uninstallName,
                            keyword: (bazaar.element.querySelector(`.config-bazaar__panel[data-type="${bazaar._type2tabType(pkgType)}"] .b3-text-field`) as HTMLInputElement).value,
                            frontend: getFrontend()
                        }, response => {
                            if (response.code !== 0) {
                                showMessage(response.msg);
                                return;
                            }
                            bazaar.element.querySelector("#configBazaarReadme")?.classList.remove("config__view--show");
                            bazaar._data.details.delete(bazaar._getDetailKey(pkgType, uninstallName));
                            this._genMyHTML(pkgType, app);
                            bazaar._onBazaar(response, pkgType);
                            bazaar._checkUpdate(true);
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
                        bazaar._refreshPackageUI(pkgType, appearanceItem.name, app);
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
                            bazaar._refreshPackageUI(pkgType, installedItem.name, app);
                        });
                    } else if (["icons", "themes"].includes(pkgType)) {
                        bazaar._setAppearancePackage(pkgType as "themes" | "icons", actionItem, enabled, () => {
                            bazaar._refreshPackageUI(pkgType, actionItem.name, app);
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
                        target.setAttribute("disabled", "disabled");
                        window.siyuan.config.bazaar.petalDisabled = !(target as HTMLInputElement).checked;
                        fetchPost("/api/setting/setBazaar", window.siyuan.config.bazaar, () => {
                            target.removeAttribute("disabled");
                            target.setAttribute("aria-label", window.siyuan.languages[
                                window.siyuan.config.bazaar.petalDisabled ? "enable" : "disableAll"
                            ]);
                            if (window.siyuan.config.bazaar.petalDisabled) {
                                bazaar.element.querySelectorAll("#configBazaarDownloaded .b3-card").forEach(item => {
                                    item.querySelector('[data-type="setting"]')?.classList.add("fn__none");
                                    const packageName = item.getAttribute("data-name");
                                    const pkg = bazaar._data.downloaded.find((p: IBazaarItem) => p.name === packageName);
                                    if (pkg) {
                                        uninstall(app, pkg.name, true);
                                    }
                                });
                            } else {
                                loadPlugins(app, null, false).then(() => {
                                    app.plugins.forEach(item => {
                                        afterLoadPlugin(item);
                                    });
                                    this._genMyHTML("plugins", app, false);
                                });
                                saveLayout();
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
                            target.removeAttribute("disabled");
                            this._genMyHTML("plugins", app, true);
                            bazaar._refreshReadmeDetail("plugins", pluginItem.name);
                        });
                    }
                    event.stopPropagation();
                    break;
                } else if (target.classList.contains("b3-card")) {
                    if (!hasClosestByClassName(event.target as HTMLElement, "b3-card__actions--right") && pkgItem && pkgType) {
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
                    target.classList.toggle("item__preview--fullscreen");
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
                        fetchPost("/api/bazaar/getBazaarTemplate", {keyword}, response => {
                            bazaar._onBazaar(response, "templates");
                            bazaar._data.templates = response.data.packages;
                        });
                    } else if (type === "icon") {
                        fetchPost("/api/bazaar/getBazaarIcon", {keyword}, response => {
                            bazaar._onBazaar(response, "icons");
                            bazaar._data.icons = response.data.packages;
                        });
                    } else if (type === "widget") {
                        fetchPost("/api/bazaar/getBazaarWidget", {keyword}, response => {
                            bazaar._onBazaar(response, "widgets");
                            bazaar._data.widgets = response.data.packages;
                        });
                    } else if (type === "theme") {
                        fetchPost("/api/bazaar/getBazaarTheme", {frontend: getFrontend(), keyword}, response => {
                            bazaar._onBazaar(response, "themes");
                            bazaar._data.themes = response.data.packages;
                        });
                    } else if (type === "plugin") {
                        fetchPost("/api/bazaar/getBazaarPlugin", {
                            frontend: getFrontend(),
                            keyword
                        }, response => {
                            bazaar._onBazaar(response, "plugins");
                            bazaar._data.plugins = response.data.packages;
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
    _onBazaar(response: IWebSocketData, bazaarType: TBazaarType) {
        const panelSelector: Record<TBazaarType, string> = {
            plugins: "#configBazaarPlugin",
            themes: "#configBazaarTheme",
            icons: "#configBazaarIcon",
            templates: "#configBazaarTemplate",
            widgets: "#configBazaarWidget",
        };
        const element = bazaar.element.querySelector(panelSelector[bazaarType]);
        if (response.code === 1) {
            // 安装集市包 /api/bazaar/installBazaar* 失败
            showMessage(response.msg);
            element.querySelectorAll("img[data-type='img-loading']").forEach((item) => {
                item.remove();
            });
            return;
        }
        bazaar._data[bazaarType] = response.data.packages;
        const sortValue = window.siyuan.storage[Constants.LOCAL_BAZAAR][bazaar._type2tabType(bazaarType)];
        const packages = sortValue && sortValue !== "0" ? bazaar._sortPackages(response.data.packages, sortValue) : response.data.packages;
        bazaar._renderBazaarCards(element, packages, bazaarType,
            bazaarType === "themes" ? (bazaar.element.querySelector("#bazaarSelect") as HTMLSelectElement)?.value : undefined);
    }
};
