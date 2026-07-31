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
        return `<div class="fn__flex-column" style="height: 100%">
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
        <div class="fn__flex config-bazaar__title">
            <button data-type="myPlugin" class="b3-button">${window.siyuan.languages.plugin}</button>
            <div class="fn__space"></div>
            <button data-type="myUpdate" class="b3-button b3-button--outline">${window.siyuan.languages.update}</button>
            <div class="fn__space"></div>
            <button data-type="myTheme" class="b3-button b3-button--outline">${window.siyuan.languages.theme}</button>
            <div class="fn__space"></div>
            <button data-type="myIcon" class="b3-button b3-button--outline">${window.siyuan.languages.icon}</button>
            <div class="fn__space"></div>
            <button data-type="myTemplate" class="b3-button b3-button--outline">${window.siyuan.languages.template}</button>
            <div class="fn__space"></div>
            <button data-type="myWidget" class="b3-button b3-button--outline">${window.siyuan.languages.widget}</button>
            <div class="fn__space"></div>
            <input data-type="downloaded-filter" class="b3-text-field fn__size200" placeholder="${window.siyuan.languages.enterKey} ${window.siyuan.languages.search}">
            <div data-type="downloaded-filter" class="fn__space"></div>
            <div class="fn__flex-1"></div>
            <svg data-type="downloaded-sort" class="svg ft__on-surface fn__flex-center"><use xlink:href="#iconSort"></use></svg>
            <div data-type="downloaded-sort" class="fn__space"></div>
            <select class="b3-select" data-type="downloaded-sort">
                <option ${localSort.downloadedPlugin === "0" ? "selected" : ""} value="0">${window.siyuan.languages.sortDefault}</option>
                <option ${localSort.downloadedPlugin === "1" ? "selected" : ""} value="1">${window.siyuan.languages.sortByInstallTimeDesc}</option>
                <option ${localSort.downloadedPlugin === "2" ? "selected" : ""} value="2">${window.siyuan.languages.sortByInstallTimeAsc}</option>
                <option ${localSort.downloadedPlugin === "3" ? "selected" : ""} value="3">${window.siyuan.languages.sortByUpdateTimeDesc}</option>
                <option ${localSort.downloadedPlugin === "4" ? "selected" : ""} value="4">${window.siyuan.languages.sortByUpdateTimeAsc}</option>
                <option ${localSort.downloadedPlugin === "5" ? "selected" : ""} data-plugin-only="true" value="5">${window.siyuan.languages.sortByEnabledFirst}</option>
                <option ${localSort.downloadedPlugin === "6" ? "selected" : ""} data-plugin-only="true" value="6">${window.siyuan.languages.sortByDisabledFirst}</option>
            </select>
            <div data-type="downloaded-sort" class="fn__space"></div>
            <button class="b3-button fn__none" data-type="install-all">${window.siyuan.languages.updateAll}</button>
            <div data-type="install-all" class="fn__space fn__none"></div>
            <input ${window.siyuan.config.bazaar.petalDisabled ? "" : " checked"} data-type="plugins-enable" type="checkbox" class="b3-switch fn__flex-center" style="margin-right: 8px">
            <div class="counter counter--bg fn__none fn__flex-center ariaLabel" data-position="north" aria-label="${window.siyuan.languages.total}"></div>
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
    _genIncompatibleChipHTML(item: IBazaarItem, source: "installed" | "bazaar") {
        const incompatible = source === "installed" ? item.installedIncompatible : item.bazaarIncompatible;
        if (!incompatible) {
            return "";
        }
        return `<span class="fn__space"></span><span data-position="north" class="fn__flex-center ariaLabel b3-chip b3-chip--error b3-chip--small" aria-label="${window.siyuan.languages.incompatiblePluginTip}">${window.siyuan.languages.incompatible}</span>`;
    },
    _genCardHTML(item: IBazaarItem, bazaarType: TBazaarType) {
        const showSwitch = item.installed && !item.current && ["icons", "themes"].includes(bazaarType);
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
            ${bazaar._genIncompatibleChipHTML(item, "bazaar")}
            <span class="fn__space--small"></span>
            <div class="fn__flex-1"></div>
            <div class="fn__space--small${showSwitch ? "" : " fn__none"}"></div>
            <span data-position="north" class="ariaLabel block__icon block__icon--show${showSwitch ? "" : " fn__none"}" data-type="switch" aria-label="${window.siyuan.languages.use}">
                <svg><use xlink:href="#iconSelect"></use></svg>
            </span>
            <div class="fn__space--small${item.outdated ? "" : " fn__none"}"></div>
            ${bazaar._genUpdateButtonHTML(item)}
        </div>
    </div>
</div>`;
    },
    _genInstallButtonAriaLabel(item: IBazaarItem) {
        if (!item.disallowInstall) {
            return window.siyuan.languages.download;
        }
        if (item.bazaarIncompatible) {
            return window.siyuan.languages.incompatiblePluginTip;
        }
        return window.siyuan.languages.bazaarNeedVersion.replace("${x}", item.minAppVersion || "");
    },
    _genUpdateButtonAriaLabel(item: IBazaarItem) {
        if (!item.disallowUpdate) {
            return window.siyuan.languages.update;
        }
        if (item.bazaarIncompatible) {
            return window.siyuan.languages.incompatiblePluginTip;
        }
        return window.siyuan.languages.bazaarNeedVersion.replace("${x}", item.updateRequiredMinAppVer || "");
    },
    _genUpdateButtonHTML(item?: IBazaarItem, reserveSpace = false) {
        if (!item?.outdated && !reserveSpace) {
            return "";
        }
        const ariaLabel = item ? this._genUpdateButtonAriaLabel(item) : window.siyuan.languages.update;
        return `<span data-position="north" data-type="install-t" ${item?.disallowUpdate ? "disabled" : ""} aria-label="${ariaLabel}" class="ariaLabel block__icon block__icon--show${item?.outdated ? "" : " fn__hidden"}">
    <svg class="ft__primary"><use xlink:href="#iconRefresh"></use></svg>
</span>`;
    },
    _genReadmeUpdateButtonHTML(item?: IBazaarItem, reserveSpace = false) {
        if (!item?.outdated && !reserveSpace) {
            return "";
        }
        const ariaLabel = item ? this._genUpdateButtonAriaLabel(item) : window.siyuan.languages.update;
        return `<div data-type="readme-update-slot" class="${item?.outdated ? "" : "fn__hidden"}">
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
        ${bazaar._genIncompatibleChipHTML(available, "bazaar")}
        ${bazaar._genFundingHTML(installed.preferredFunding)}
        <span data-position="north" class="ariaLabel block__icon block__icon--show${isBrowser() ? " fn__none" : ""}" data-type="open" aria-label="${window.siyuan.languages.showInFolder}">
            <svg><use xlink:href="#iconFolder"></use></svg>
        </span>
        ${bazaar._genUpdateButtonHTML(available)}
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
        const installAllSpaceElement = contentElement.previousElementSibling.querySelector('[data-type="install-all"].fn__space');
        installAllElement?.classList.add("fn__none");
        installAllSpaceElement?.classList.add("fn__none");
        if (this._updateState === "loading" || this._updateState === "idle") {
            counterElement.classList.add("fn__none");
            contentElement.innerHTML = "<div class=\"fn__flex-center\" style=\"height: 96px\"><img src=\"/stage/loading-pure.svg\"></div>";
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
        installAllElement?.classList.remove("fn__none");
        installAllSpaceElement?.classList.remove("fn__none");
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
            slot.outerHTML = bazaar._genUpdateButtonHTML(available, true);
        });
        const sideElement = bazaar.element.querySelector("#configBazaarReadme.config__view--show .item__side");
        if (sideElement?.getAttribute("data-from") === "downloaded") {
            const type = sideElement.getAttribute("data-package-type") as TBazaarType;
            const name = sideElement.getAttribute("data-name");
            const slot = sideElement.querySelector('[data-type="readme-update-slot"]');
            const available = type && name ? bazaar._getUpdatedItem(type, name)?.available : undefined;
            if (slot) {
                slot.outerHTML = bazaar._genReadmeUpdateButtonHTML(available, true);
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
        ${bazaar._genUpdateButtonHTML(available, true)}
        ${bazaar._genIncompatibleChipHTML(bazaarItem, "installed")}
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
        <span class="fn__space${bazaarType === "plugins" ? "" : " fn__none"}"></span>
        <span class="fn__space${bazaarType === "plugins" ? "" : " fn__none"}"></span>
        <input ${((bazaarItem.disallowInstall && !bazaarItem.enabled) || bazaarItem.installedIncompatible) ? "disabled" : ""} 
aria-label="${(bazaarItem.disallowInstall && !bazaarItem.enabled) ? window.siyuan.languages.bazaarNeedVersion.replace("${x}", bazaarItem.minAppVersion) : ""}" 
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
    _renderReadme(bazaarType: TBazaarType, from: "downloaded" | "updated" | "bazaar", data: IBazaarItem) {
        const readmeElement = bazaar.element.querySelector("#configBazaarReadme") as HTMLElement;
        const urls = data.repoURL.split("/");
        urls.pop();
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
        const isDownload = from === "downloaded";
        const updateData = isDownload ? bazaar._getUpdatedItem(bazaarType, data.name)?.available : data;
        readmeElement.innerHTML = ` <div class="item__side" data-from="${from}" data-name="${escapeAttr(data.name)}" data-package-type="${bazaarType}" data-repourl="${escapeAttr(data.repoURL)}" data-progress-id="${escapeAttr(updateData?.repoURL || data.repoURL)}">
    <div class="block__icons">
        <div class="block__logo fn__pointer fn__flex-1" data-type="goBack">
            <svg class="block__logoicon"><use xlink:href="#iconLeft"></use></svg>
            <span class="ft__breakword">${navTitles[bazaarType]}</span>
        </div>
    </div>
    <div class="fn__flex-1">
        <img class="item__img" src="${data.iconURL}" loading="lazy" onerror="this.src='/stage/images/icon.png'">
        <div>
            <a href="${data.repoURL}" target="_blank" class="item__title" title="GitHub Repo">${escapeHtml(data.preferredName)}</a>
        </div>
        <div class="fn__hr"></div>
        <div>
            <a href="${data.repoURL}" target="_blank" class="ft__on-surface ft__smaller" title="GitHub Repo">${escapeHtml(data.name)}</a>
        </div>
        <div class="block__icons">
            <span class="fn__flex-1"></span>
            ${data.preferredFunding ?
                bazaar._genFundingHTML(data.preferredFunding) :
                '<span class="block__icon block__icon--show block__icon--text" style="cursor: default"><svg><use xlink:href="#iconAccount"></use></svg></span>'
            }
            <span class="fn__space"></span>
            <a href="${urls.join("/")}" target="_blank" title="Creator">${escapeHtml(data.author)}</a>
            <span class="fn__flex-1"></span>
        </div>
        <div class="fn__hr--b"></div>
        <div class="fn__hr--b"></div>
        <div class="ft__on-surface ft__smaller" style="line-height: 20px;">${window.siyuan.languages.currentVer}<br>v${escapeHtml(data.version)}</div>
        <div class="fn__hr"></div>
        <div class="ft__on-surface ft__smaller" style="line-height: 20px;">${isDownload ? window.siyuan.languages.installDate : window.siyuan.languages.releaseDate}<br>${isDownload ? data.hInstallDate : data.hUpdated}</div>
        <div class="fn__hr${isDownload ? " fn__none" : ""}"></div>
        <div class="ft__on-surface ft__smaller${isDownload ? " fn__none" : ""}" style="line-height: 20px;">${window.siyuan.languages.pkgSize}<br>${data.hSize}</div>
        <div class="fn__hr"></div>
        <div class="ft__on-surface ft__smaller" style="line-height: 20px;">${window.siyuan.languages.installSize}<br><span data-type="installed-size">${isDownload ? window.siyuan.languages.loading : data.hInstallSize}</span></div>
        <div class="fn__hr--b"></div>
        <div class="fn__hr--b"></div>
        <div${data.installed ? ' class="fn__none"' : ""}>
            <button ${data.disallowInstall ? `disabled aria-label="${bazaar._genInstallButtonAriaLabel(data)}" data-position="north"` : ""} class="b3-button ariaLabel" style="width: 168px"  data-type="install">${window.siyuan.languages.download}</button>
        </div>
        ${bazaar._genReadmeUpdateButtonHTML(updateData, isDownload)}
        <div class="fn__hr--b"></div>
        <div>
            <a href="${data.repoURL}/issues" target="_blank" title="Feedback via GitHub Issues" class="b3-button b3-button--success" style="width: 168px" data-type="feedback">${window.siyuan.languages.feedback}</a>
        </div>
        <div class="fn__hr--b${isDownload ? " fn__none" : ""}"></div>
        <div class="fn__hr--b${isDownload ? " fn__none" : ""}"></div>
        <div class="fn__flex${isDownload ? " fn__none" : ""}" style="justify-content: center;">
            <svg class="svg ft__on-surface fn__flex-center"><use xlink:href="#iconGithub"></use></svg>
            <span class="fn__space"></span>
            <a href="${data.repoURL}" target="_blank" title="GitHub Repo">Repo</a>
            <span class="fn__space"></span>
            <span class="fn__space"></span>
            <svg class="svg ft__on-surface fn__flex-center"><use xlink:href="#iconStar"></use></svg>
            <span class="fn__space"></span>
            <a href="${data.repoURL}/stargazers" target="_blank" title="Stars">${formatCount(data.stars)}</a>
            <span class="fn__space"></span>
            <span class="fn__space"></span>
            <svg class="svg ft__on-surface fn__flex-center"><use xlink:href="#iconGitHubI"></use></svg>
            <span class="fn__space"></span>
            <a href="${data.repoURL}/issues" target="_blank" title="Open issues">${formatCount(data.openIssues)}</a>
            <span class="fn__space"></span>
            <span class="fn__space"></span>
            <svg class="svg ft__on-surface fn__flex-center"><use xlink:href="#iconDownload"></use></svg>
            <span class="fn__space"></span>
            ${formatCount(data.downloads)}
        </div>
        <div class="fn__hr--b"></div>
        <div class="fn__hr--b"></div>
        <div class="fn__flex-1"></div>
    </div>
</div>
<div class="item__main">
    <div class="item__preview" style="background-image: url(${data.previewURL})"></div>
    <div class="b3-typography${data.preferredDesc ? "" : " fn__none"}">
        <blockquote>
            <p>
                ${escapeHtml(data.preferredDesc)}
            </p>
         </blockquote>
    </div>
    <div class="item__readme b3-typography b3-typography--default">
        <img data-type="img-loading" style="height: 64px;width: 100%;padding: 16px 0;" src="/stage/loading-pure.svg">
    </div>
</div>`;
        if (isDownload) {
            const mdElement = readmeElement.querySelector(".item__readme");
            mdElement.innerHTML = window.DOMPurify.sanitize(data.preferredReadme || "", {FORBID_TAGS: ["iframe", "frame", "frameset"]});
            highlightRender(mdElement);
            fetchPost("/api/bazaar/getInstalledPackageSize", {
                packageType: bazaarType,
                packageName: data.name,
            }, response => {
                const sideElement = readmeElement.querySelector(".item__side");
                if (sideElement?.getAttribute("data-from") !== "downloaded" ||
                    sideElement.getAttribute("data-package-type") !== bazaarType ||
                    sideElement.getAttribute("data-name") !== data.name) {
                    return;
                }
                const sizeElement = sideElement.querySelector('[data-type="installed-size"]');
                if (sizeElement) {
                    sizeElement.textContent = response.code === 0 && response.data?.hInstallSize ? response.data.hInstallSize : "-";
                }
            });
        } else {
            fetchPost("/api/bazaar/getBazaarPackageREADME", {
                repoURL: data.repoURL,
                repoHash: data.repoHash,
                packageType: bazaarType
            }, response => {
                const mdElement = readmeElement.querySelector(".item__readme");
                mdElement.innerHTML = window.DOMPurify.sanitize(response.data.html, {FORBID_TAGS: ["iframe", "frame", "frameset"]});
                highlightRender(mdElement);
            });
        }
        readmeElement.classList.add("config__view--show");
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
        titleElement?.querySelectorAll('[data-type="downloaded-filter"], [data-type="downloaded-sort"]').forEach((element) => {
            element.classList.toggle("fn__none", isUpdate);
        });
        titleElement?.querySelector('[data-type="plugins-enable"]')?.classList.toggle("fn__none", type !== "plugins");
        if (!isUpdate) {
            titleElement?.querySelector('[data-type="install-all"].b3-button')?.classList.add("fn__none");
            titleElement?.querySelector('[data-type="install-all"].fn__space')?.classList.add("fn__none");
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
                fetchPost("/api/bazaar/getBazaarTheme", {}, response => {
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
        (["plugins", "themes", "icons", "templates", "widgets"] as TBazaarType[]).forEach((type) => {
            this._data.update[type] = [];
        });
        this._genMyHTML("plugins", app);
        this._checkUpdate(true);
        bazaar.element.firstElementChild.addEventListener("click", (event) => {
            let target = event.target as HTMLElement;
            const packageElement = hasClosestByAttribute(target, "data-name", null);
            let pkgType: TBazaarType | undefined;
            let pkgItem: IBazaarItem;
            let updatedItem: IUpdatedBazaarItem;
            let packageSource: "downloaded" | "updated" | "bazaar";
            if (packageElement) {
                const packageName = packageElement.getAttribute("data-name");
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
                } else if (type === "open" && pkgItem && pkgType) {
                    /// #if !BROWSER
                    if (["icons", "themes"].includes(pkgType)) {
                        useShell("openPath", path.join(window.siyuan.config.system.confDir, "appearance", pkgType, pkgItem.name));
                    } else {
                        useShell("openPath", path.join(window.siyuan.config.system.dataDir, pkgType, pkgItem.name));
                    }
                    /// #endif
                    event.preventDefault();
                    event.stopPropagation();
                    break;
                } else if (["myTheme", "myTemplate", "myIcon", "myWidget", "myPlugin", "myUpdate"].includes(type)) {
                    if (target.classList.contains("b3-button--outline") &&
                        !bazaar.element.querySelector("#configBazaarDownloaded").getAttribute("data-loading")) {
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
                    if (!target.classList.contains("b3-button--progress") && !target.hasAttribute("disabled") && pkgItem && pkgType) {
                        const installAPI: Record<TBazaarType, string> = {
                            plugins: "/api/bazaar/installBazaarPlugin",
                            themes: "/api/bazaar/installBazaarTheme",
                            icons: "/api/bazaar/installBazaarIcon",
                            templates: "/api/bazaar/installBazaarTemplate",
                            widgets: "/api/bazaar/installBazaarWidget",
                        };
                        fetchPost(installAPI[pkgType], {
                            keyword: (bazaar.element.querySelector(`.config-bazaar__panel[data-type="${bazaar._type2tabType(pkgType)}"] .b3-text-field`) as HTMLInputElement).value,
                            repoURL: pkgItem.repoURL,
                            packageName: pkgItem.name,
                            repoHash: pkgItem.repoHash,
                            mode: pkgItem.modes?.toString() === "dark" ? 1 : 0,
                            frontend: getFrontend()
                        }, response => {
                            if (response.code !== 0) {
                                return;
                            }
                            bazaar._onBazaar(response, pkgType);
                            bazaar._genMyHTML(pkgType, app, false);
                            if (pkgType === "plugins") {
                                if (window.siyuan.config.bazaar.petalDisabled) {
                                    confirmDialog(window.siyuan.languages.confirm, window.siyuan.languages.enablePluginTip2);
                                } else {
                                    confirmDialog("💡 " + window.siyuan.languages.enablePlugin, window.siyuan.languages.enablePluginTip, () => {
                                        fetchPost("/api/petal/setPetalEnabled", {
                                            packageName: pkgItem.name,
                                            enabled: true,
                                            app: Constants.SIYUAN_APPID,
                                        }, (response) => {
                                            loadPlugin(app, response.data).then(() => {
                                                bazaar._genMyHTML(pkgType, app, false);
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
                } else if (type === "uninstall" && pkgItem && pkgType) {
                    event.preventDefault();
                    event.stopPropagation();
                    const uninstallAPI: Record<TBazaarType, string> = {
                        plugins: "/api/bazaar/uninstallBazaarPlugin",
                        themes: "/api/bazaar/uninstallBazaarTheme",
                        icons: "/api/bazaar/uninstallBazaarIcon",
                        templates: "/api/bazaar/uninstallBazaarTemplate",
                        widgets: "/api/bazaar/uninstallBazaarWidget",
                    };
                    const packageName = pkgItem.name;
                    if (window.siyuan.config.appearance.themeDark === packageName ||
                        window.siyuan.config.appearance.themeLight === packageName ||
                        window.siyuan.config.appearance.icon === packageName) {
                        showMessage(window.siyuan.languages.uninstallTip);
                    } else {
                        confirmDialog("⚠️ " + window.siyuan.languages.uninstall, window.siyuan.languages.confirmUninstall.replace("${name}", packageName), () => {
                            fetchPost(uninstallAPI[pkgType], {
                                packageName,
                                keyword: (bazaar.element.querySelector(`.config-bazaar__panel[data-type="${bazaar._type2tabType(pkgType)}"] .b3-text-field`) as HTMLInputElement).value,
                                frontend: getFrontend()
                            }, response => {
                                this._genMyHTML(pkgType, app);
                                bazaar._onBazaar(response, pkgType);
                                bazaar._checkUpdate(true);
                            });
                        });
                    }
                    break;
                } else if (type === "switch" && pkgItem && pkgType) {
                    const packageName = pkgItem.name;
                    const mode = pkgItem.modes?.toString() === "dark" ? 1 : 0;
                    if (pkgType === "icons") {
                        fetchPost("/api/setting/setAppearance", {
                            ...window.siyuan.config.appearance,
                            icon: packageName,
                        }, (appearanceResponse) => {
                            this._genMyHTML(pkgType, app, false);
                            fetchPost("/api/bazaar/getBazaarIcon", {}, response => {
                                response.data.appearance = appearanceResponse.data;
                                bazaar._onBazaar(response, "icons");
                                bazaar._data.icons = response.data.packages;
                            });
                        });
                    } else if (pkgType === "themes") {
                        fetchPost("/api/setting/setAppearance", {
                            ...window.siyuan.config.appearance,
                            mode,
                            modeOS: false,
                            themeDark: mode === 1 ? packageName : window.siyuan.config.appearance.themeDark,
                            themeLight: mode === 0 ? packageName : window.siyuan.config.appearance.themeLight,
                        }, (appearanceResponse) => {
                            this._genMyHTML("themes", app, false);
                            fetchPost("/api/bazaar/getBazaarTheme", {}, response => {
                                response.data.appearance = appearanceResponse.data;
                                bazaar._onBazaar(response, "themes");
                                bazaar._data.themes = response.data.packages;
                            });
                        });
                    }
                    event.preventDefault();
                    event.stopPropagation();
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
                } else if (type === "plugin-enable" && pkgItem) {
                    if (!target.hasAttribute("disabled")) {
                        target.setAttribute("disabled", "disabled");
                        const enabled = (target as HTMLInputElement).checked;
                        pkgItem.enabled = enabled;
                        fetchPost("/api/petal/setPetalEnabled", {
                            packageName: pkgItem.name,
                            enabled,
                            app: Constants.SIYUAN_APPID,
                        }, (response) => {
                            target.removeAttribute("disabled");
                            if (enabled) {
                                if (window.siyuan.config.bazaar.petalDisabled) {
                                    target.parentElement.querySelector('[data-type="setting"]')?.classList.add("fn__none");
                                    showMessage(window.siyuan.languages.pluginGlobalDisabledTip);
                                    return;
                                }
                                loadPlugin(app, response.data).then(() => {
                                    this._genMyHTML("plugins", app, true);
                                });
                            } else {
                                uninstall(app, pkgItem.name, true);
                                target.parentElement.querySelector('[data-type="setting"]')?.classList.add("fn__none");
                                const disableTip = target.getAttribute("data-disabletip");
                                if (disableTip) {
                                    target.setAttribute("disabled", "disabled");
                                    target.setAttribute("aria-label", disableTip);
                                }
                            }
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
                        fetchPost("/api/bazaar/getBazaarTheme", {keyword}, response => {
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
                        const activeType = inputElement.parentElement.querySelector('.b3-button[data-type^="my"]:not(.b3-button--outline)')?.getAttribute("data-type");
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
