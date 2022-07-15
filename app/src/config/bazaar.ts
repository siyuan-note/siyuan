import {appearance} from "./appearance";
import {showMessage} from "../dialog/message";
import {fetchPost} from "../util/fetch";
import {hasClosestByClassName} from "../protyle/util/hasClosest";
import {confirmDialog} from "../dialog/confirmDialog";
import {highlightRender} from "../protyle/markdown/highlightRender";
import {exportLayout} from "../layout/util";
import {Constants} from "../constants";

export const bazaar = {
    element: undefined as Element,
    genHTML() {
        const localSortString = localStorage.getItem(Constants.LOCAL_BAZAAR);
        let localSort;
        if (!localSortString) {
            localSort = {
                theme: "0",
                template: "0",
                icon: "0",
                widget: "0",
            };
            localStorage.setItem(Constants.LOCAL_BAZAAR, JSON.stringify(localSort));
        } else {
            localSort = JSON.parse(localSortString);
        }
        const loadingHTML = `<div style="height: ${bazaar.element.clientHeight - 72}px;display: flex;align-items: center;justify-content: center;"><img src="/stage/loading-pure.svg"></div>`;
        return `<div class="fn__flex-column" style="height: 100%">
<div class="layout-tab-bar fn__flex">
    <div data-type="theme" class="item item--focus"><span class="item__text">${window.siyuan.languages.theme}</span></div>
    <div data-type="template" class="item"><span class="item__text">${window.siyuan.languages.template}</span></div>
    <div data-type="icon" class="item"><span class="item__text">${window.siyuan.languages.icon}</span></div>
    <div data-type="widget" class="item"><span class="item__text">${window.siyuan.languages.widget}</span></div>
</div>
<div class="fn__flex-1">
    <div data-type="theme" class="bazaarPanel" data-init="true">
        <div class="fn__hr"></div>
        <div class="fn__flex">
            <div class="fn__space"></div>
            <div class="fn__space"></div>
            <svg class="svg ft__on-surface fn__flex-center"><use xlink:href="#iconSort"></use></svg>
            <div class="fn__space"></div>
            <select class="b3-select fn__size200">
                <option ${localSort.theme === "0" ? "selected" : ""} value="0">${window.siyuan.languages.sortByUpdateTimeDesc}</option>
                <option ${localSort.theme === "1" ? "selected" : ""} value="1">${window.siyuan.languages.sortByUpdateTimeAsc}</option>
                <option ${localSort.theme === "2" ? "selected" : ""} value="2">${window.siyuan.languages.sortByDownloadsDesc}</option>
                <option ${localSort.theme === "3" ? "selected" : ""} value="3">${window.siyuan.languages.sortByDownloadsAsc}</option>
            </select>
            <div class="fn__flex-1"></div>
            <select id="bazaarSelect" class="b3-select fn__size200">
                <option selected value="2">${window.siyuan.languages.all}</option>
                <option value="0">${window.siyuan.languages.themeLight}</option>
                <option value="1">${window.siyuan.languages.themeDark}</option>
            </select>
            <div class="fn__space"></div>
            <div class="fn__space"></div>
        </div>
        <div id="configBazaarTheme">
            ${loadingHTML}
        </div>
    </div>
    <div class="fn__none bazaarPanel" data-type="template">
        <div class="fn__hr"></div>
        <div class="fn__flex">
            <div class="fn__space"></div>
            <div class="fn__space"></div>
            <svg class="svg ft__on-surface fn__flex-center"><use xlink:href="#iconSort"></use></svg>
            <div class="fn__space"></div>
            <select class="b3-select fn__size200">
                <option ${localSort.template === "0" ? "selected" : ""} value="0">${window.siyuan.languages.sortByUpdateTimeDesc}</option>
                <option ${localSort.template === "1" ? "selected" : ""} value="1">${window.siyuan.languages.sortByUpdateTimeAsc}</option>
                <option ${localSort.template === "2" ? "selected" : ""} value="2">${window.siyuan.languages.sortByDownloadsDesc}</option>
                <option ${localSort.template === "3" ? "selected" : ""} value="3">${window.siyuan.languages.sortByDownloadsAsc}</option>
            </select>
        </div>
        <div id="configBazaarTemplate">
            ${loadingHTML}
        </div>
    </div>
    <div class="fn__none bazaarPanel" data-type="icon">
        <div class="fn__hr"></div>
        <div class="fn__flex">
            <div class="fn__space"></div>
            <div class="fn__space"></div>
            <svg class="svg ft__on-surface fn__flex-center"><use xlink:href="#iconSort"></use></svg>
            <div class="fn__space"></div>
            <select class="b3-select fn__size200">
                <option ${localSort.icon === "0" ? "selected" : ""} value="0">${window.siyuan.languages.sortByUpdateTimeDesc}</option>
                <option ${localSort.icon === "1" ? "selected" : ""} value="1">${window.siyuan.languages.sortByUpdateTimeAsc}</option>
                <option ${localSort.icon === "2" ? "selected" : ""} value="2">${window.siyuan.languages.sortByDownloadsDesc}</option>
                <option ${localSort.icon === "3" ? "selected" : ""} value="3">${window.siyuan.languages.sortByDownloadsAsc}</option>
            </select>
        </div>
        <div id="configBazaarIcon">
            ${loadingHTML}
        </div>
    </div>
    <div class="fn__none bazaarPanel" data-type="widget">
        <div class="fn__hr"></div>
        <div class="fn__flex">
            <div class="fn__space"></div>
            <div class="fn__space"></div>
            <svg class="svg ft__on-surface fn__flex-center"><use xlink:href="#iconSort"></use></svg>
            <div class="fn__space"></div>
            <select class="b3-select fn__size200">
                <option ${localSort.widget === "0" ? "selected" : ""} value="0">${window.siyuan.languages.sortByUpdateTimeDesc}</option>
                <option ${localSort.widget === "1" ? "selected" : ""} value="1">${window.siyuan.languages.sortByUpdateTimeAsc}</option>
                <option ${localSort.widget === "2" ? "selected" : ""} value="2">${window.siyuan.languages.sortByDownloadsDesc}</option>
                <option ${localSort.widget === "3" ? "selected" : ""} value="3">${window.siyuan.languages.sortByDownloadsAsc}</option>
            </select>
        </div>
        <div id="configBazaarWidget">
            ${loadingHTML}
        </div>
    </div>
</div>
<div id="configBazaarReadme" class="config-bazaar__readme"></div>
</div>`;
    },
    getHTML(item: IBazaarItem, bazaarType: TBazaarType) {
        let hide = false;
        let type = "";
        if (bazaarType === "themes") {
            const themeValue = (bazaar.element.querySelector("#bazaarSelect") as HTMLSelectElement).value;
            if ((themeValue === "0" && item.modes.includes("dark")) ||
                themeValue === "1" && item.modes.includes("light")) {
                hide = true;
            }
            type = item.modes.toString();
        }
        let showSwitch = false;
        if (["icons", "themes"].includes(bazaarType)) {
            showSwitch = true;
        }

        return `<div data-bazaar="${bazaarType}" class="b3-card${hide ? " fn__none" : ""}" data-type="${type}" data-updated="${item.updated}">
    <div class="b3-card__img"><img src="${item.previewURLThumb}"/></div>
    <div class="b3-card__info fn__flex"${item.current ? " style='background-color:var(--b3-theme-primary-lightest)'" : ""}>
        <span class="fn__flex-center fn__ellipsis">${item.name}</span>
        <span class="fn__space"></span>
        <span class="fn__flex-1"></span>
        <svg class="svg fn__flex-center"><use xlink:href="#iconDownload"></use></svg>
        <span class="fn__space"></span>
        <span class="fn__flex-center">${item.downloads}</span>
    </div>
    <div class="b3-card__actions"${item.current ? " style='background-color:var(--b3-theme-primary-lightest)'" : ""} data-name="${item.name}" data-url="${item.repoURL}" data-hash="${item.repoHash}">
        <button data-type="install-t" class="b3-button b3-button--text${item.outdated ? "" : " fn__none"}">${window.siyuan.languages.update}</button>
        <div class="fn__space${item.outdated ? "" : " fn__none"}"></div>
        <button class="b3-button b3-button--text${item.installed ? "" : " fn__none"}" data-type="uninstall">${window.siyuan.languages.uninstall}</button>
        <div class="fn__flex-1 fn__space"></div>
        <button class="b3-button b3-button--text${!item.current && item.installed && showSwitch ? "" : " fn__none"}" data-type="switch">${window.siyuan.languages.use}</button>
    </div>
</div>`;
    },
    data: {
        themes: [] as IBazaarItem[],
        templates: [] as IBazaarItem[],
        icons: [] as IBazaarItem[],
        widgets: [] as IBazaarItem[],
    },
    renderReadme(cardElement: HTMLElement, bazaarType: TBazaarType) {
        const repoURL = cardElement.querySelector(".b3-card__actions").getAttribute("data-url");
        let data: IBazaarItem;
        bazaar.data[bazaarType].find((item: IBazaarItem) => {
            if (item.repoURL === repoURL) {
                data = item;
                return true;
            }
        });
        const readmeElement = bazaar.element.querySelector("#configBazaarReadme") as HTMLElement;
        const urls = data.repoURL.split("/");
        urls.pop();
        let navTitle = window.siyuan.languages.icon;
        if (bazaarType === "themes") {
            if (data.modes.includes("dark")) {
                navTitle = window.siyuan.languages.themeDark + " " + window.siyuan.languages.theme;
            } else {
                navTitle = window.siyuan.languages.themeLight + " " + window.siyuan.languages.theme;
            }
        } else if (bazaarType === "widgets") {
            navTitle = window.siyuan.languages.widget;
        } else if (bazaarType === "templates") {
            navTitle = window.siyuan.languages.template;
        }
        readmeElement.innerHTML = ` <div class="item__side">
    <div class="fn__flex">
        <button class="b3-button b3-button--outline" data-type="goBack" title="Go back"><svg><use xlink:href="#iconLeft"></use></svg></button>
        <div class="item__nav">${navTitle}</div>
    </div>
    <div class="fn__flex-1"></div>
    <a href="${data.repoURL}" target="_blank" class="item__title" title="GitHub Repo">${data.name}</a>
    <div class="fn__hr--b"></div>
    <div class="fn__hr--b"></div>
    <div style="line-height: 20px;"><span class="ft__smaller">Made with ❤️ by</span><br><a href="${urls.join("/")}" target="_blank" title="Creator">${data.author}</a></div>
    <div class="fn__hr--b"></div>
    <div class="fn__hr--b"></div>
    <div class="ft__on-surface ft__smaller" style="line-height: 20px;">${window.siyuan.languages.currentVer}<br>v${data.version}</div>
    <div class="fn__hr"></div>
    <div class="ft__on-surface ft__smaller" style="line-height: 20px;">${window.siyuan.languages.releaseDate}<br>${data.hUpdated}</div>
    <div class="fn__hr"></div>
    <div class="ft__on-surface ft__smaller" style="line-height: 20px;">${window.siyuan.languages.pkgSize}<br>${data.hSize}</div>
    <div class="fn__hr--b"></div>
    <div class="fn__hr--b"></div>
    <div class="${data.installed ? "fn__none" : ""}" data-type="${data.modes?.toString()}">
        <button class="b3-button" style="width: 168px" data-hash="${data.repoHash}" data-name="${data.name}" data-bazaar="${bazaarType}" data-url="${data.repoURL}" data-type="install">${window.siyuan.languages.download}</button>
    </div>
    <div class="fn__hr--b"></div>
    <div class="fn__hr--b"></div>
    <div class="fn__flex" style="justify-content: center;">
        <svg class="svg ft__on-surface fn__flex-center"><use xlink:href="#iconGithub"></use></svg>
        <span class="fn__space"></span>
        <a href="${data.repoURL}" target="_blank" title="GitHub Repo">Repo</a>
        <span class="fn__space"></span>
        <span class="fn__space"></span>
        <svg class="svg ft__on-surface fn__flex-center"><use xlink:href="#iconStar"></use></svg>
        <span class="fn__space"></span>
        <a href="${data.repoURL}/stargazers" target="_blank" title="Starts">${data.stars}</a>
        <span class="fn__space"></span>
        <span class="fn__space"></span>
        <svg class="svg ft__on-surface fn__flex-center"><use xlink:href="#iconGitHubI"></use></svg>
        <span class="fn__space"></span>
        <a href="${data.repoURL}/issues" target="_blank" title="Open issues">${data.openIssues}</a>
        <span class="fn__space"></span>
        <span class="fn__space"></span>
        <svg class="svg ft__on-surface fn__flex-center"><use xlink:href="#iconDownload"></use></svg>
        <span class="fn__space"></span>
        ${data.downloads}
    </div>
    <div class="fn__flex-1"></div>
</div>
<div class="item__main">
    <div class="item__preview" style="background-image: url(${data.previewURL})"></div>
    <div class="item__readme b3-typography" style="position:relative;">
        <img data-type="img-loading" style="position: absolute;top: 0;left: 0;height: 100%;width: 100%;padding: 48px;box-sizing: border-box;" src="/stage/loading-pure.svg">
    </div>
</div>`;
        fetchPost("/api/bazaar/getBazaarPackageREAME", {
            repoURL: data.repoURL,
            repoHash: data.repoHash,
        }, response => {
            const mdElement = readmeElement.querySelector(".item__readme");
            mdElement.innerHTML = response.data.html;
            highlightRender(mdElement);
        });
        readmeElement.style.right = "0";
    },
    bindEvent() {
        fetchPost("/api/bazaar/getBazaarTheme", {}, response => {
            bazaar.onBazaar(response, "themes", false);
            bazaar.data.themes = response.data.packages;
        });
        bazaar.element.addEventListener("click", (event) => {
            let target = event.target as HTMLElement;
            while (target && !target.isEqualNode(bazaar.element)) {
                const type = target.getAttribute("data-type");
                if (type === "goBack") {
                    const readmeElement = bazaar.element.querySelector("#configBazaarReadme") as HTMLElement;
                    readmeElement.style.right = "-100%";
                    event.preventDefault();
                    event.stopPropagation();
                    break;
                } else if (type === "install") {
                    if (!target.classList.contains("b3-button--progress")) {
                        const bazaarType = target.getAttribute("data-bazaar") as TBazaarType;
                        let url = "/api/bazaar/installBazaarTemplate";
                        if (bazaarType === "themes") {
                            url = "/api/bazaar/installBazaarTheme";
                        } else if (bazaarType === "icons") {
                            url = "/api/bazaar/installBazaarIcon";
                        } else if (bazaarType === "widgets") {
                            url = "/api/bazaar/installBazaarWidget";
                        }
                        fetchPost(url, {
                            repoURL: target.getAttribute("data-url"),
                            packageName: target.getAttribute("data-name"),
                            repoHash: target.getAttribute("data-hash"),
                            mode: target.parentElement.getAttribute("data-type") === "dark" ? 1 : 0,
                        }, response => {
                            if (window.siyuan.config.appearance.themeJS && bazaarType === "themes") {
                                exportLayout(true);
                                return;
                            }
                            bazaar.onBazaar(response, bazaarType, ["themes", "icons"].includes(bazaarType));
                        });
                    }
                    event.preventDefault();
                    event.stopPropagation();
                    break;
                } else if (type === "install-t") {
                    confirmDialog(window.siyuan.languages.update, window.siyuan.languages.exportTplTip, () => {
                        const cardElement = hasClosestByClassName(target, "b3-card");
                        let bazaarType: TBazaarType = "themes";
                        if (cardElement) {
                            bazaarType = cardElement.getAttribute("data-bazaar") as TBazaarType;
                        }
                        let url = "/api/bazaar/installBazaarTemplate";
                        if (bazaarType === "themes") {
                            url = "/api/bazaar/installBazaarTheme";
                        } else if (bazaarType === "icons") {
                            url = "/api/bazaar/installBazaarIcon";
                        } else if (bazaarType === "widgets") {
                            url = "/api/bazaar/installBazaarWidget";
                        }
                        target.parentElement.insertAdjacentHTML("afterend", "<img data-type=\"img-loading\" style=\"position: absolute;top: 0;left: 0;height: 100%;width: 100%;padding: 48px;box-sizing: border-box;\" src=\"/stage/loading-pure.svg\">");
                        const name = target.parentElement.getAttribute("data-name");
                        fetchPost(url, {
                            repoURL: target.parentElement.getAttribute("data-url"),
                            packageName: name,
                            repoHash: target.parentElement.getAttribute("data-hash"),
                            mode: target.parentElement.parentElement.getAttribute("data-type") === "dark" ? 1 : 0,
                            update: true,
                        }, response => {
                            // 更新主题后不需要对该主题进行切换 https://github.com/siyuan-note/siyuan/issues/4966
                            bazaar.onBazaar(response, bazaarType, ["icons"].includes(bazaarType));
                            // https://github.com/siyuan-note/siyuan/issues/5411
                            if (bazaarType === "themes" && (
                                (window.siyuan.config.appearance.mode === 0 && window.siyuan.config.appearance.themeLight === name) ||
                                (window.siyuan.config.appearance.mode === 1 && window.siyuan.config.appearance.themeDark === name)
                            )) {
                                if (window.siyuan.config.appearance.themeJS) {
                                    exportLayout(true);
                                } else {
                                    const linkElement = (document.getElementById("themeDefaultStyle") as HTMLLinkElement);
                                    linkElement.href = linkElement.href + "1";
                                }
                            }
                        });
                    });
                    event.preventDefault();
                    event.stopPropagation();
                    break;
                } else if (type === "uninstall") {
                    const cardElement = hasClosestByClassName(target, "b3-card");
                    let bazaarType: TBazaarType = "themes";
                    if (cardElement) {
                        bazaarType = cardElement.getAttribute("data-bazaar") as TBazaarType;
                    }
                    let url = "/api/bazaar/uninstallBazaarTemplate";
                    if (bazaarType === "themes") {
                        url = "/api/bazaar/uninstallBazaarTheme";
                    } else if (bazaarType === "icons") {
                        url = "/api/bazaar/uninstallBazaarIcon";
                    } else if (bazaarType === "widgets") {
                        url = "/api/bazaar/uninstallBazaarWidget";
                    }

                    const packageName = target.parentElement.getAttribute("data-name");
                    if (window.siyuan.config.appearance.themeDark === packageName ||
                        window.siyuan.config.appearance.themeLight === packageName ||
                        window.siyuan.config.appearance.icon === packageName) {
                        showMessage(window.siyuan.languages.uninstallTip);
                    } else {
                        fetchPost(url, {
                            packageName
                        }, response => {
                            bazaar.onBazaar(response, bazaarType, ["themes", "icons"].includes(bazaarType));
                        });
                    }
                    event.preventDefault();
                    event.stopPropagation();
                    break;
                } else if (type === "switch") {
                    const packageName = target.parentElement.getAttribute("data-name");
                    const cardElement = hasClosestByClassName(target, "b3-card");
                    let bazaarType: TBazaarType = "themes";
                    let mode: number;
                    if (cardElement) {
                        bazaarType = cardElement.getAttribute("data-bazaar") as TBazaarType;
                        mode = cardElement.getAttribute("data-type") === "dark" ? 1 : 0;
                    }

                    if (bazaarType === "icons") {
                        fetchPost("/api/setting/setAppearance", {
                            icon: packageName,
                            mode: window.siyuan.config.appearance.mode,
                            codeBlockThemeDark: window.siyuan.config.appearance.codeBlockThemeDark,
                            codeBlockThemeLight: window.siyuan.config.appearance.codeBlockThemeLight,
                            themeDark: window.siyuan.config.appearance.themeDark,
                            themeLight: window.siyuan.config.appearance.themeLight,
                            darkThemes: window.siyuan.config.appearance.darkThemes,
                            lightThemes: window.siyuan.config.appearance.lightThemes,
                            icons: window.siyuan.config.appearance.icons,
                            lang: window.siyuan.config.appearance.lang,
                            customCSS: window.siyuan.config.appearance.customCSS,
                            closeButtonBehavior: window.siyuan.config.appearance.closeButtonBehavior,
                            nativeEmoji: window.siyuan.config.appearance.nativeEmoji,
                        }, response => {
                            appearance.onSetappearance(response.data);
                        });
                    } else if (bazaarType === "themes") {
                        fetchPost("/api/setting/setAppearance", {
                            icon: window.siyuan.config.appearance.icon,
                            mode,
                            codeBlockThemeDark: window.siyuan.config.appearance.codeBlockThemeDark,
                            codeBlockThemeLight: window.siyuan.config.appearance.codeBlockThemeLight,
                            themeDark: mode === 1 ? packageName : window.siyuan.config.appearance.themeDark,
                            themeLight: mode === 0 ? packageName : window.siyuan.config.appearance.themeLight,
                            darkThemes: window.siyuan.config.appearance.darkThemes,
                            lightThemes: window.siyuan.config.appearance.lightThemes,
                            icons: window.siyuan.config.appearance.icons,
                            lang: window.siyuan.config.appearance.lang,
                            customCSS: window.siyuan.config.appearance.customCSS,
                            closeButtonBehavior: window.siyuan.config.appearance.closeButtonBehavior,
                            nativeEmoji: window.siyuan.config.appearance.nativeEmoji,
                        }, response => {
                            if ((mode !== window.siyuan.config.appearance.mode ||
                                    (mode === 1 && window.siyuan.config.appearance.themeDark !== packageName) ||
                                    (mode === 0 && window.siyuan.config.appearance.themeLight !== packageName)) &&
                                window.siyuan.config.appearance.themeJS) {
                                exportLayout(true);
                            } else {
                                appearance.onSetappearance(response.data);
                            }
                        });
                    }
                    event.preventDefault();
                    event.stopPropagation();
                    break;
                } else if (target.classList.contains("b3-card")) {
                    bazaar.renderReadme(target, target.getAttribute("data-bazaar") as TBazaarType);
                    event.preventDefault();
                    event.stopPropagation();
                    break;
                } else if (target.classList.contains("item") && !target.classList.contains("item--focus")) {
                    // switch tab
                    bazaar.element.querySelector(".layout-tab-bar .item--focus").classList.remove("item--focus");
                    target.classList.add("item--focus");
                    const type = target.getAttribute("data-type");
                    bazaar.element.querySelectorAll(".bazaarPanel").forEach(item => {
                        if (type === item.getAttribute("data-type")) {
                            item.classList.remove("fn__none");
                            if (!item.getAttribute("data-init")) {
                                if (type === "template") {
                                    fetchPost("/api/bazaar/getBazaarTemplate", {}, response => {
                                        bazaar.onBazaar(response, "templates", false);
                                        bazaar.data.templates = response.data.packages;
                                    });
                                } else if (type === "icon") {
                                    fetchPost("/api/bazaar/getBazaarIcon", {}, response => {
                                        bazaar.onBazaar(response, "icons", false);
                                        bazaar.data.icons = response.data.packages;
                                    });
                                } else if (type === "widget") {
                                    fetchPost("/api/bazaar/getBazaarWidget", {}, response => {
                                        bazaar.onBazaar(response, "widgets", false);
                                        bazaar.data.widgets = response.data.packages;
                                    });
                                }
                                item.setAttribute("data-init", "true");
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

        bazaar.element.querySelectorAll(".b3-select").forEach((selectElement: HTMLSelectElement) => {
            selectElement.addEventListener("change", () => {
                if (selectElement.id === "bazaarSelect") {
                    // theme select
                    bazaar.element.querySelectorAll("#configBazaarTheme .b3-card").forEach((item) => {
                        if (selectElement.value === "0") {
                            if (item.getAttribute("data-type").indexOf("light") > -1) {
                                item.classList.remove("fn__none");
                            } else {
                                item.classList.add("fn__none");
                            }
                        } else if (selectElement.value === "1") {
                            if (item.getAttribute("data-type").indexOf("dark") > -1) {
                                item.classList.remove("fn__none");
                            } else {
                                item.classList.add("fn__none");
                            }
                        } else {
                            item.classList.remove("fn__none");
                        }
                    });
                } else {
                    // sort
                    const localSort = JSON.parse(localStorage.getItem(Constants.LOCAL_BAZAAR));
                    const panelElement = selectElement.parentElement.parentElement;
                    let html = "";
                    if (selectElement.value === "0") { // 更新时间降序
                        Array.from(panelElement.querySelectorAll(".b3-card")).sort((a, b) => {
                            return b.getAttribute("data-updated") < a.getAttribute("data-updated") ? -1 : 1;
                        }).forEach((item) => {
                            html += item.outerHTML;
                        });
                    } else if (selectElement.value === "1") { // 更新时间升序
                        Array.from(panelElement.querySelectorAll(".b3-card")).sort((a, b) => {
                            return b.getAttribute("data-updated") < a.getAttribute("data-updated") ? 1 : -1;
                        }).forEach((item) => {
                            html += item.outerHTML;
                        });
                    } else if (selectElement.value === "2") { // 下载次数降序
                        Array.from(panelElement.querySelectorAll(".b3-card")).sort((a, b) => {
                            return parseInt(b.querySelector(".b3-card__info").lastElementChild.textContent) < parseInt(a.querySelector(".b3-card__info").lastElementChild.textContent) ? -1 : 1;
                        }).forEach((item) => {
                            html += item.outerHTML;
                        });
                    } else if (selectElement.value === "3") { // 下载次数升序
                        Array.from(panelElement.querySelectorAll(".b3-card")).sort((a, b) => {
                            return parseInt(b.querySelector(".b3-card__info").lastElementChild.textContent) < parseInt(a.querySelector(".b3-card__info").lastElementChild.textContent) ? 1 : -1;
                        }).forEach((item) => {
                            html += item.outerHTML;
                        });
                    }
                    localSort[selectElement.parentElement.parentElement.getAttribute("data-type")] = selectElement.value;
                    localStorage.setItem(Constants.LOCAL_BAZAAR, JSON.stringify(localSort));
                    panelElement.querySelector(".b3-cards").innerHTML = html;
                }
            });
        });
    },
    onBazaar(response: IWebSocketData, bazaarType: TBazaarType, reload: boolean) {
        let id = "#configBazaarTemplate";
        if (bazaarType === "themes") {
            id = "#configBazaarTheme";
        } else if (bazaarType === "icons") {
            id = "#configBazaarIcon";
        } else if (bazaarType === "widgets") {
            id = "#configBazaarWidget";
        }
        const element = bazaar.element.querySelector(id);
        if (response.code === 1) {
            showMessage(response.msg);
            element.querySelectorAll("img[data-type='img-loading']").forEach((item) => {
                item.remove();
            });
        }
        let html = "";
        response.data.packages.forEach((item: IBazaarItem) => {
            html += this.getHTML(item, bazaarType);
        });
        bazaar.data[bazaarType] = response.data.packages;
        element.innerHTML = `<div class="b3-cards">${html}</div>`;

        const localSort = JSON.parse(localStorage.getItem(Constants.LOCAL_BAZAAR));
        if (localSort[bazaarType.replace("s", "")] === "1") {
            html = "";
            Array.from(element.querySelectorAll(".b3-card")).sort((a, b) => {
                return b.getAttribute("data-updated") < a.getAttribute("data-updated") ? 1 : -1;
            }).forEach((item) => {
                html += item.outerHTML;
            });
        } else if (localSort[bazaarType.replace("s", "")] === "2") { // 下载次数降序
            html = "";
            Array.from(element.querySelectorAll(".b3-card")).sort((a, b) => {
                return parseInt(b.querySelector(".b3-card__info").lastElementChild.textContent) < parseInt(a.querySelector(".b3-card__info").lastElementChild.textContent) ? -1 : 1;
            }).forEach((item) => {
                html += item.outerHTML;
            });
        } else if (localSort[bazaarType.replace("s", "")] === "3") { // 下载次数升序
            html = "";
            Array.from(element.querySelectorAll(".b3-card")).sort((a, b) => {
                return parseInt(b.querySelector(".b3-card__info").lastElementChild.textContent) < parseInt(a.querySelector(".b3-card__info").lastElementChild.textContent) ? 1 : -1;
            }).forEach((item) => {
                html += item.outerHTML;
            });
        }
        element.innerHTML = `<div class="b3-cards">${html}</div>`;
        if (reload) {
            appearance.onSetappearance(response.data.appearance);
        }
    }
};
