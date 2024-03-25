import {Dialog} from "../dialog";
import {isMobile, objEquals} from "../util/functions";
import {MenuItem} from "../menus/Menu";
import {Constants} from "../constants";
import {showMessage} from "../dialog/message";
import {fetchPost} from "../util/fetch";
import {escapeHtml} from "../util/escape";
import {setStorageVal} from "../protyle/util/compatibility";
import {confirmDialog} from "../dialog/confirmDialog";
import {goUnRef, updateSearchResult} from "../mobile/menu/search";

export const filterMenu = (config: Config.IUILayoutTabSearchConfig, cb: () => void) => {
    const filterDialog = new Dialog({
        title: window.siyuan.languages.searchType,
        content: `<div class="b3-dialog__content">
    <label class="fn__flex b3-label">
        <svg class="ft__on-surface svg fn__flex-center"><use xlink:href="#iconMath"></use></svg>
        <span class="fn__space"></span>
        <div class="fn__flex-1 fn__flex-center">
            ${window.siyuan.languages.math}
        </div>
        <span class="fn__space"></span>
        <input class="b3-switch fn__flex-center" data-type="mathBlock" type="checkbox"${config.types.mathBlock ? " checked" : ""}>
    </label>
    <label class="fn__flex b3-label">
        <svg class="ft__on-surface svg fn__flex-center"><use xlink:href="#iconTable"></use></svg>
        <span class="fn__space"></span>
        <div class="fn__flex-1 fn__flex-center">
            ${window.siyuan.languages.table}
        </div>
        <span class="fn__space"></span>
        <input class="b3-switch fn__flex-center" data-type="table" type="checkbox"${config.types.table ? " checked" : ""}>
    </label>
    <label class="fn__flex b3-label">
        <svg class="ft__on-surface svg fn__flex-center"><use xlink:href="#iconQuote"></use></svg>
        <span class="fn__space"></span>
        <div class="fn__flex-1 fn__flex-center">
            ${window.siyuan.languages.quote}
        </div>
        <span class="fn__space"></span>
        <input class="b3-switch fn__flex-center" data-type="blockquote" type="checkbox"${config.types.blockquote ? " checked" : ""}>
    </label>
    <label class="fn__flex b3-label">
        <svg class="ft__on-surface svg fn__flex-center"><use xlink:href="#iconSuper"></use></svg>
        <span class="fn__space"></span>
        <div class="fn__flex-1 fn__flex-center">
            ${window.siyuan.languages.superBlock}
        </div>
        <span class="fn__space"></span>
        <input class="b3-switch fn__flex-center" data-type="superBlock" type="checkbox"${config.types.superBlock ? " checked" : ""}>
    </label>
    <label class="fn__flex b3-label">
        <svg class="ft__on-surface svg fn__flex-center"><use xlink:href="#iconParagraph"></use></svg>
        <span class="fn__space"></span>
        <div class="fn__flex-1 fn__flex-center">
            ${window.siyuan.languages.paragraph}
        </div>
        <span class="fn__space"></span>
        <input class="b3-switch fn__flex-center" data-type="paragraph" type="checkbox"${config.types.paragraph ? " checked" : ""}>
    </label>
    <label class="fn__flex b3-label">
        <svg class="ft__on-surface svg fn__flex-center"><use xlink:href="#iconFile"></use></svg>
        <span class="fn__space"></span>
        <div class="fn__flex-1 fn__flex-center">
            ${window.siyuan.languages.doc}
        </div>
        <span class="fn__space"></span>
        <input class="b3-switch fn__flex-center" data-type="document" type="checkbox"${config.types.document ? " checked" : ""}>
    </label>
    <label class="fn__flex b3-label">
        <svg class="ft__on-surface svg fn__flex-center"><use xlink:href="#iconHeadings"></use></svg>
        <span class="fn__space"></span>
        <div class="fn__flex-1 fn__flex-center">
            ${window.siyuan.languages.headings}
        </div>
        <span class="fn__space"></span>
        <input class="b3-switch fn__flex-center" data-type="heading" type="checkbox"${config.types.heading ? " checked" : ""}>
    </label>
    <label class="fn__flex b3-label">
        <svg class="ft__on-surface svg fn__flex-center"><use xlink:href="#iconList"></use></svg>
        <span class="fn__space"></span>
        <div class="fn__flex-1 fn__flex-center">
            ${window.siyuan.languages.list1}
        </div>
        <span class="fn__space"></span>
        <input class="b3-switch fn__flex-center" data-type="list" type="checkbox"${config.types.list ? " checked" : ""}>
    </label>
    <label class="fn__flex b3-label">
        <svg class="ft__on-surface svg fn__flex-center"><use xlink:href="#iconListItem"></use></svg>
        <span class="fn__space"></span>
        <div class="fn__flex-1 fn__flex-center">
            ${window.siyuan.languages.listItem}
        </div>
        <span class="fn__space"></span>
        <input class="b3-switch fn__flex-center" data-type="listItem" type="checkbox"${config.types.listItem ? " checked" : ""}>
    </label>
    <label class="fn__flex b3-label">
        <svg class="ft__on-surface svg fn__flex-center"><use xlink:href="#iconCode"></use></svg>
        <span class="fn__space"></span>
        <div class="fn__flex-1 fn__flex-center">
            ${window.siyuan.languages.code}
        </div>
        <span class="fn__space"></span>
        <input class="b3-switch fn__flex-center" data-type="codeBlock" type="checkbox"${config.types.codeBlock ? " checked" : ""}>
    </label>
    <label class="fn__flex b3-label">
        <svg class="ft__on-surface svg fn__flex-center"><use xlink:href="#iconHTML5"></use></svg>
        <span class="fn__space"></span>
        <div class="fn__flex-1 fn__flex-center">
            HTML
        </div>
        <span class="fn__space"></span>
        <input class="b3-switch fn__flex-center" data-type="htmlBlock" type="checkbox"${config.types.htmlBlock ? " checked" : ""}>
    </label>
    <label class="fn__flex b3-label">
        <svg class="ft__on-surface svg fn__flex-center"><use xlink:href="#iconSQL"></use></svg>
        <span class="fn__space"></span>
        <div class="fn__flex-1 fn__flex-center">
            ${window.siyuan.languages.embedBlock}
        </div>
        <span class="fn__space"></span>
        <input class="b3-switch fn__flex-center" data-type="embedBlock" type="checkbox"${config.types.embedBlock ? " checked" : ""}>
    </label>
    <label class="fn__flex b3-label">
        <svg class="ft__on-surface svg fn__flex-center"><use xlink:href="#iconDatabase"></use></svg>
        <span class="fn__space"></span>
        <div class="fn__flex-1 fn__flex-center">
            ${window.siyuan.languages.database}
        </div>
        <span class="fn__space"></span>
        <input class="b3-switch fn__flex-center" data-type="databaseBlock" type="checkbox"${config.types.databaseBlock ? " checked" : ""}>
    </label>
    <label class="fn__flex b3-label">
        <svg class="ft__on-surface svg fn__flex-center"><use xlink:href="#iconVideo"></use></svg>
        <span class="fn__space"></span>
        <div class="fn__flex-1 fn__flex-center">
            ${window.siyuan.languages.video}
        </div>
        <span class="fn__space"></span>
        <input class="b3-switch fn__flex-center" data-type="videoBlock" type="checkbox"${config.types.videoBlock ? " checked" : ""}>
    </label>
    <label class="fn__flex b3-label">
        <svg class="ft__on-surface svg fn__flex-center"><use xlink:href="#iconRecord"></use></svg>
        <span class="fn__space"></span>
        <div class="fn__flex-1 fn__flex-center">
            ${window.siyuan.languages.audio}
        </div>
        <span class="fn__space"></span>
        <input class="b3-switch fn__flex-center" data-type="audioBlock" type="checkbox"${config.types.audioBlock ? " checked" : ""}>
    </label>
    <label class="fn__flex b3-label">
        <svg class="ft__on-surface svg fn__flex-center"><use xlink:href="#iconLanguage"></use></svg>
        <span class="fn__space"></span>
        <div class="fn__flex-1 fn__flex-center">
            IFrame
        </div>
        <span class="fn__space"></span>
        <input class="b3-switch fn__flex-center" data-type="iFrameBlock" type="checkbox"${config.types.iFrameBlock ? " checked" : ""}>
    </label>
    <label class="fn__flex b3-label">
        <svg class="ft__on-surface svg fn__flex-center"><use xlink:href="#iconBoth"></use></svg>
        <span class="fn__space"></span>
        <div class="fn__flex-1 fn__flex-center">
            ${window.siyuan.languages.widget}
        </div>
        <span class="fn__space"></span>
        <input class="b3-switch fn__flex-center" data-type="widgetBlock" type="checkbox"${config.types.widgetBlock ? " checked" : ""}>
    </label>
</div>
<div class="b3-dialog__action">
    <button class="b3-button b3-button--cancel">${window.siyuan.languages.cancel}</button><div class="fn__space"></div>
    <button class="b3-button b3-button--text">${window.siyuan.languages.confirm}</button>
</div>`,
        width: isMobile() ? "92vw" : "520px",
        height: "70vh",
    });
    filterDialog.element.setAttribute("data-key", Constants.DIALOG_SEARCHTYPE);
    const btnsElement = filterDialog.element.querySelectorAll(".b3-button");
    btnsElement[0].addEventListener("click", () => {
        filterDialog.destroy();
    });
    btnsElement[1].addEventListener("click", () => {
        filterDialog.element.querySelectorAll(".b3-switch").forEach((item: HTMLInputElement) => {
            config.types[item.getAttribute("data-type") as keyof (typeof config.types)] = item.checked;
        });
        cb();
        filterDialog.destroy();
    });
};

export const replaceFilterMenu = (config: Config.IUILayoutTabSearchConfig) => {
    let html = "";
    Object.keys(Constants.SIYUAN_DEFAULT_REPLACETYPES).forEach((key: keyof Config.IUILayoutTabSearchConfigReplaceTypes) => {
        html += `<label class="fn__flex b3-label">
    <span class="fn__space"></span>
    <div class="fn__flex-1 fn__flex-center">
        ${window.siyuan.languages.replaceTypes[key]}
    </div>
    <span class="fn__space"></span>
    <input class="b3-switch fn__flex-center" data-type="${key}" type="checkbox"${config.replaceTypes[key] ? " checked" : ""}>
</label>`;
    });
    const filterDialog = new Dialog({
        title: window.siyuan.languages.replaceType,
        content: `<div class="b3-dialog__content">${html}</div>
<div class="b3-dialog__action">
    <button class="b3-button b3-button--cancel">${window.siyuan.languages.cancel}</button><div class="fn__space"></div>
    <button class="b3-button b3-button--text">${window.siyuan.languages.confirm}</button>
</div>`,
        width: isMobile() ? "92vw" : "520px",
        height: "70vh",
    });
    filterDialog.element.setAttribute("data-key", Constants.DIALOG_REPLACETYPE);
    const btnsElement = filterDialog.element.querySelectorAll(".b3-button");
    btnsElement[0].addEventListener("click", () => {
        filterDialog.destroy();
    });
    btnsElement[1].addEventListener("click", () => {
        filterDialog.element.querySelectorAll(".b3-switch").forEach((item: HTMLInputElement) => {
            config.replaceTypes[item.getAttribute("data-type") as keyof (typeof config.replaceTypes)] = item.checked;
        });
        filterDialog.destroy();
    });
};

export const queryMenu = (config: Config.IUILayoutTabSearchConfig, cb: () => void) => {
    if (!window.siyuan.menus.menu.element.classList.contains("fn__none") &&
        window.siyuan.menus.menu.element.getAttribute("data-name") === "searchMethod") {
        window.siyuan.menus.menu.remove();
        return;
    }
    window.siyuan.menus.menu.remove();
    window.siyuan.menus.menu.element.setAttribute("data-name", "searchMethod");
    window.siyuan.menus.menu.append(new MenuItem({
        iconHTML: "",
        label: window.siyuan.languages.keyword,
        current: config.method === 0,
        click() {
            config.method = 0;
            cb();
        }
    }).element);
    window.siyuan.menus.menu.append(new MenuItem({
        iconHTML: "",
        label: window.siyuan.languages.querySyntax,
        current: config.method === 1,
        click() {
            config.method = 1;
            cb();
        }
    }).element);
    window.siyuan.menus.menu.append(new MenuItem({
        iconHTML: "",
        label: "SQL",
        current: config.method === 2,
        click() {
            config.method = 2;
            cb();
        }
    }).element);
    window.siyuan.menus.menu.append(new MenuItem({
        iconHTML: "",
        label: window.siyuan.languages.regex,
        current: config.method === 3,
        click() {
            config.method = 3;
            cb();
        }
    }).element);
};

const saveCriterionData = (config: Config.IUILayoutTabSearchConfig,
                           criteriaData: Config.IUILayoutTabSearchConfig[],
                           element: Element,
                           value: string,
                           saveDialog: Dialog) => {
    config.removed = false;
    const criterion = config;
    criterion.name = value;
    criteriaData.push(Object.assign({}, criterion));
    window.siyuan.storage[Constants.LOCAL_SEARCHDATA] = Object.assign({}, config);
    setStorageVal(Constants.LOCAL_SEARCHDATA, window.siyuan.storage[Constants.LOCAL_SEARCHDATA]);
    fetchPost("/api/storage/setCriterion", {criterion}, () => {
        saveDialog.destroy();
        const criteriaElement = element.querySelector("#criteria").firstElementChild;
        criteriaElement.classList.remove("fn__none");
        criteriaElement.querySelector(".b3-chip--current")?.classList.remove("b3-chip--current");
        criteriaElement.insertAdjacentHTML("beforeend", `<div data-type="set-criteria" class="b3-chip b3-chip--current b3-chip--middle b3-chip--pointer b3-chip--${["secondary", "primary", "info", "success", "warning", "error", ""][(criteriaElement.childElementCount) % 7]}">${criterion.name}<svg class="b3-chip__close" data-type="remove-criteria"><use xlink:href="#iconCloseRound"></use></svg></div>`);
    });
};

export const saveCriterion = (config: Config.IUILayoutTabSearchConfig,
                              criteriaData: Config.IUILayoutTabSearchConfig[],
                              element: Element) => {
    const saveDialog = new Dialog({
        title: window.siyuan.languages.saveCriterion,
        content: `<div class="b3-dialog__content">
        <input class="b3-text-field fn__block" placeholder="${window.siyuan.languages.memo}">
</div>
<div class="b3-dialog__action">
    <button class="b3-button b3-button--cancel">${window.siyuan.languages.cancel}</button><div class="fn__space"></div>
    <button class="b3-button b3-button--text">${window.siyuan.languages.confirm}</button>
</div>`,
        width: isMobile() ? "92vw" : "520px",
    });
    saveDialog.element.setAttribute("data-key", Constants.DIALOG_SAVECRITERION);
    const btnsElement = saveDialog.element.querySelectorAll(".b3-button");
    saveDialog.bindInput(saveDialog.element.querySelector("input"), () => {
        btnsElement[1].dispatchEvent(new CustomEvent("click"));
    });
    btnsElement[0].addEventListener("click", () => {
        saveDialog.destroy();
    });
    btnsElement[1].addEventListener("click", () => {
        const value = saveDialog.element.querySelector("input").value.trim();
        if (!value) {
            showMessage(window.siyuan.languages["_kernel"]["142"]);
            return;
        }
        if (isMobile()) {
            config.k = (document.querySelector("#toolbarSearch") as HTMLInputElement).value;
            config.r = (element.querySelector("#toolbarReplace") as HTMLInputElement).value;
        } else {
            config.k = (element.querySelector("#searchInput") as HTMLInputElement).value;
            config.r = (element.querySelector("#replaceInput") as HTMLInputElement).value;
        }
        const criteriaElement = element.querySelector("#criteria").firstElementChild;
        let hasSameName = "";
        let hasSameConfig = "";
        criteriaData.forEach(item => {
            if (item.name === value) {
                hasSameName = item.name;
            }
            if (configIsSame(item, config)) {
                hasSameConfig = item.name;
            }
        });
        if (hasSameName && !hasSameConfig) {
            confirmDialog(window.siyuan.languages.confirm, window.siyuan.languages.searchOverwrite, () => {
                Array.from(criteriaElement.children).forEach(item => {
                    if (item.textContent === value) {
                        item.remove();
                    }
                });
                criteriaData.find((item, index) => {
                    if (item.name === value) {
                        criteriaData.splice(index, 1);
                        return true;
                    }
                });
                saveCriterionData(config, criteriaData, element, value, saveDialog);
            });
        } else if (hasSameName && hasSameConfig) {
            if (hasSameName === hasSameConfig) {
                saveDialog.destroy();
            } else {
                const removeName = hasSameName === value ? hasSameConfig : hasSameName;
                confirmDialog(window.siyuan.languages.confirm, window.siyuan.languages.searchRemoveName.replace("${x}", removeName).replace("${y}", value), () => {
                    Array.from(criteriaElement.children).forEach(item => {
                        if (item.textContent === hasSameConfig || item.textContent === hasSameName) {
                            item.remove();
                        }
                    });
                    criteriaData.find((item, index) => {
                        if (item.name === removeName || item.name === hasSameName) {
                            fetchPost("/api/storage/removeCriterion", {name: removeName});
                            criteriaData.splice(index, 1);
                            return true;
                        }
                    });
                    saveCriterionData(config, criteriaData, element, value, saveDialog);
                });
            }
        } else if (!hasSameName && hasSameConfig) {
            confirmDialog(window.siyuan.languages.confirm, window.siyuan.languages.searchUpdateName.replace("${x}", hasSameConfig).replace("${y}", value), () => {
                Array.from(criteriaElement.children).forEach(item => {
                    if (item.textContent === hasSameConfig) {
                        item.remove();
                    }
                });
                criteriaData.find((item, index) => {
                    if (item.name === hasSameConfig) {
                        fetchPost("/api/storage/removeCriterion", {name: hasSameConfig});
                        criteriaData.splice(index, 1);
                        return true;
                    }
                });
                saveCriterionData(config, criteriaData, element, value, saveDialog);
            });
        } else {
            saveCriterionData(config, criteriaData, element, value, saveDialog);
        }
    });
};

export const moreMenu = async (config: Config.IUILayoutTabSearchConfig,
                               criteriaData: Config.IUILayoutTabSearchConfig[],
                               element: Element,
                               cb: () => void,
                               removeCriterion: () => void,
                               layoutMenu?: () => void) => {
    if (!window.siyuan.menus.menu.element.classList.contains("fn__none") &&
        window.siyuan.menus.menu.element.getAttribute("data-name") === "searchMore") {
        window.siyuan.menus.menu.remove();
        return;
    }
    window.siyuan.menus.menu.remove();
    window.siyuan.menus.menu.element.setAttribute("data-name", "searchMore");
    /// #if MOBILE
    window.siyuan.menus.menu.append(new MenuItem({
        iconHTML: "",
        label: window.siyuan.languages.listInvalidRefBlocks,
        click() {
            goUnRef();
        }
    }).element);
    window.siyuan.menus.menu.append(new MenuItem({type: "separator"}).element);
    window.siyuan.menus.menu.append(new MenuItem({
        iconHTML: "",
        label: window.siyuan.languages.searchType,
        click() {
            filterMenu(config, () => {
                updateSearchResult(config, element, true);
            });
        }
    }).element);
    window.siyuan.menus.menu.append(new MenuItem({
        iconHTML: "",
        label: window.siyuan.languages.replaceType,
        click() {
            replaceFilterMenu(config);
        }
    }).element);
    window.siyuan.menus.menu.append(new MenuItem({
        iconHTML: "",
        label: window.siyuan.languages.searchMethod,
        type: "submenu",
        submenu: [{
            iconHTML: "",
            label: window.siyuan.languages.keyword,
            current: config.method === 0,
            click() {
                config.method = 0;
                config.page = 1;
                updateSearchResult(config, element, true);
            }
        }, {
            iconHTML: "",
            label: window.siyuan.languages.querySyntax,
            current: config.method === 1,
            click() {
                config.method = 1;
                config.page = 1;
                updateSearchResult(config, element, true);
            }
        }, {
            iconHTML: "",
            label: "SQL",
            current: config.method === 2,
            click() {
                config.method = 2;
                config.page = 1;
                updateSearchResult(config, element, true);
            }
        }, {
            iconHTML: "",
            label: window.siyuan.languages.regex,
            current: config.method === 3,
            click() {
                config.method = 3;
                config.page = 1;
                updateSearchResult(config, element, true);
            }
        }]
    }).element);
    /// #endif
    const sortMenu = [{
        iconHTML: "",
        label: window.siyuan.languages.type,
        current: config.sort === 0,
        click() {
            config.sort = 0;
            cb();
        }
    }, {
        iconHTML: "",
        label: window.siyuan.languages.createdASC,
        current: config.sort === 1,
        click() {
            config.sort = 1;
            cb();
        }
    }, {
        iconHTML: "",
        label: window.siyuan.languages.createdDESC,
        current: config.sort === 2,
        click() {
            config.sort = 2;
            cb();
        }
    }, {
        iconHTML: "",
        label: window.siyuan.languages.modifiedASC,
        current: config.sort === 3,
        click() {
            config.sort = 3;
            cb();
        }
    }, {
        iconHTML: "",
        label: window.siyuan.languages.modifiedDESC,
        current: config.sort === 4,
        click() {
            config.sort = 4;
            cb();
        }
    }, {
        iconHTML: "",
        label: window.siyuan.languages.sortByRankAsc,
        current: config.sort === 6,
        click() {
            config.sort = 6;
            cb();
        }
    }, {
        iconHTML: "",
        label: window.siyuan.languages.sortByRankDesc,
        current: config.sort === 7,
        click() {
            config.sort = 7;
            cb();
        }
    }];
    if (config.group === 1) {
        sortMenu.push({
            iconHTML: "",
            label: window.siyuan.languages.sortByContent,
            current: config.sort === 5,
            click() {
                config.sort = 5;
                cb();
            }
        });
    }
    window.siyuan.menus.menu.append(new MenuItem({
        iconHTML: "",
        label: window.siyuan.languages.sort,
        type: "submenu",
        submenu: sortMenu,
    }).element);
    window.siyuan.menus.menu.append(new MenuItem({
        iconHTML: "",
        label: window.siyuan.languages.group,
        type: "submenu",
        submenu: [{
            iconHTML: "",
            label: window.siyuan.languages.noGroupBy,
            current: config.group === 0,
            click() {
                if (isMobile()) {
                    element.querySelector('[data-type="expand"]').classList.add("fn__none");
                    element.querySelector('[data-type="contract"]').classList.add("fn__none");
                } else {
                    element.querySelector("#searchCollapse").parentElement.classList.add("fn__none");
                }
                config.group = 0;
                if (config.sort === 5) {
                    config.sort = 0;
                }
                cb();
            }
        }, {
            iconHTML: "",
            label: window.siyuan.languages.groupByDoc,
            current: config.group === 1,
            click() {
                if (isMobile()) {
                    element.querySelector('[data-type="expand"]').classList.remove("fn__none");
                    element.querySelector('[data-type="contract"]').classList.remove("fn__none");
                } else {
                    element.querySelector("#searchCollapse").parentElement.classList.remove("fn__none");
                }
                config.group = 1;
                cb();
            }
        }]
    }).element);
    if (layoutMenu) {
        layoutMenu();
    }
    window.siyuan.menus.menu.append(new MenuItem({type: "separator"}).element);
    window.siyuan.menus.menu.append(new MenuItem({
        label: window.siyuan.languages.saveCriterion,
        iconHTML: "",
        click() {
            saveCriterion(config, criteriaData, element);
        }
    }).element);
    window.siyuan.menus.menu.append(new MenuItem({
        iconHTML: "",
        label: window.siyuan.languages.removeCriterion,
        click() {
            removeCriterion();
        }
    }).element);
};

const configIsSame = (config: Config.IUILayoutTabSearchConfig, config2: Config.IUILayoutTabSearchConfig) => {
    if (config2.group === config.group && config2.hPath === config.hPath && config2.hasReplace === config.hasReplace &&
        config2.k === config.k && config2.method === config.method && config2.r === config.r &&
        config2.sort === config.sort && objEquals(config2.types, config.types) &&
        objEquals(config2.replaceTypes, config.replaceTypes) && objEquals(config2.idPath, config.idPath)) {
        return true;
    }
    return false;
};

export const initCriteriaMenu = (element: HTMLElement, data: Config.IUILayoutTabSearchConfig[], config: Config.IUILayoutTabSearchConfig) => {
    fetchPost("/api/storage/getCriteria", {}, (response) => {
        let html = "";
        response.data.forEach((item: Config.IUILayoutTabSearchConfig, index: number) => {
            data.push(item);
            let isSame = false;
            if (configIsSame(item, config)) {
                isSame = true;
            }
            html += `<div data-type="set-criteria" class="${isSame ? "b3-chip--current " : ""}b3-chip b3-chip--middle b3-chip--pointer b3-chip--${["secondary", "primary", "info", "success", "warning", "error", ""][index % 7]}">${escapeHtml(item.name)}<svg class="b3-chip__close" data-type="remove-criteria"><use xlink:href="#iconCloseRound"></use></svg></div>`;
        });
        /// #if MOBILE
        element.innerHTML = `<div class="b3-chips">
    ${html}
</div>`;
        if (html === "") {
            element.classList.add("fn__none");
        } else {
            element.classList.remove("fn__none");
        }
        /// #else
        element.innerHTML = `<div class="b3-chips">
    ${html}
</div>
<span class="fn__flex-1"></span>
<button data-type="saveCriterion" class="b3-button b3-button--small b3-button--outline fn__flex-center">${window.siyuan.languages.saveCriterion}</button>
<span class="fn__space"></span>
<button data-type="removeCriterion" aria-label="${window.siyuan.languages.useCriterion}" class="ariaLabel b3-button b3-button--small b3-button--outline fn__flex-center fn__flex-shrink" data-position="9bottom">${window.siyuan.languages.removeCriterion}</button>
<span class="fn__space"></span>`;
        /// #endif
    });
};

export const getKeyByLiElement = (element: HTMLElement) => {
    const keys: string[] = [];
    element.querySelectorAll("mark").forEach(item => {
        keys.push(item.textContent);
    });
    return [...new Set(keys)].join(" ");
};
