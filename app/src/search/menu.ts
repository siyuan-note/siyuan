import {Dialog} from "../dialog";
import {isMobile} from "../util/functions";
import {MenuItem} from "../menus/Menu";
import {Constants} from "../constants";
import {showMessage} from "../dialog/message";
import {fetchPost} from "../util/fetch";
import {escapeHtml} from "../util/escape";
import {setStorageVal} from "../protyle/util/compatibility";

export const filterMenu = (config: ISearchOption, cb: () => void) => {
    const filterDialog = new Dialog({
        title: window.siyuan.languages.type,
        content: `<div class="b3-dialog__content">
    <label class="fn__flex b3-label">
        <svg class="ft__on-surface svg fn__flex-center"><use xlink:href="#iconMath"></use></svg>
        <span class="fn__space"></span>
        <div class="fn__flex-1 fn__flex-center">
            ${window.siyuan.languages.math}
        </div>
        <span class="fn__space"></span>
        <input id="removeAssets" class="b3-switch fn__flex-center" data-type="mathBlock" type="checkbox"${config.types.mathBlock ? " checked" : ""}>
    </label>
    <label class="fn__flex b3-label">
        <svg class="ft__on-surface svg fn__flex-center"><use xlink:href="#iconTable"></use></svg>
        <span class="fn__space"></span>
        <div class="fn__flex-1 fn__flex-center">
            ${window.siyuan.languages.table}
        </div>
        <span class="fn__space"></span>
        <input id="removeAssets" class="b3-switch fn__flex-center" data-type="table" type="checkbox"${config.types.table ? " checked" : ""}>
    </label>
    <label class="fn__flex b3-label">
        <svg class="ft__on-surface svg fn__flex-center"><use xlink:href="#iconQuote"></use></svg>
        <span class="fn__space"></span>
        <div class="fn__flex-1 fn__flex-center">
            ${window.siyuan.languages.quote}
        </div>
        <span class="fn__space"></span>
        <input id="removeAssets" class="b3-switch fn__flex-center" data-type="blockquote" type="checkbox"${config.types.blockquote ? " checked" : ""}>
    </label>
    <label class="fn__flex b3-label">
        <svg class="ft__on-surface svg fn__flex-center"><use xlink:href="#iconSuper"></use></svg>
        <span class="fn__space"></span>
        <div class="fn__flex-1 fn__flex-center">
            ${window.siyuan.languages.superBlock}
        </div>
        <span class="fn__space"></span>
        <input id="removeAssets" class="b3-switch fn__flex-center" data-type="superBlock" type="checkbox"${config.types.superBlock ? " checked" : ""}>
    </label>
    <label class="fn__flex b3-label">
        <svg class="ft__on-surface svg fn__flex-center"><use xlink:href="#iconParagraph"></use></svg>
        <span class="fn__space"></span>
        <div class="fn__flex-1 fn__flex-center">
            ${window.siyuan.languages.paragraph}
        </div>
        <span class="fn__space"></span>
        <input id="removeAssets" class="b3-switch fn__flex-center" data-type="paragraph" type="checkbox"${config.types.paragraph ? " checked" : ""}>
    </label>
    <label class="fn__flex b3-label">
        <svg class="ft__on-surface svg fn__flex-center"><use xlink:href="#iconFile"></use></svg>
        <span class="fn__space"></span>
        <div class="fn__flex-1 fn__flex-center">
            ${window.siyuan.languages.doc}
        </div>
        <span class="fn__space"></span>
        <input id="removeAssets" class="b3-switch fn__flex-center" data-type="document" type="checkbox"${config.types.document ? " checked" : ""}>
    </label>
    <label class="fn__flex b3-label">
        <svg class="ft__on-surface svg fn__flex-center"><use xlink:href="#iconHeadings"></use></svg>
        <span class="fn__space"></span>
        <div class="fn__flex-1 fn__flex-center">
            ${window.siyuan.languages.headings}
        </div>
        <span class="fn__space"></span>
        <input id="removeAssets" class="b3-switch fn__flex-center" data-type="heading" type="checkbox"${config.types.heading ? " checked" : ""}>
    </label>
    <label class="fn__flex b3-label">
        <svg class="ft__on-surface svg fn__flex-center"><use xlink:href="#iconList"></use></svg>
        <span class="fn__space"></span>
        <div class="fn__flex-1 fn__flex-center">
            ${window.siyuan.languages.list1}
        </div>
        <span class="fn__space"></span>
        <input id="removeAssets" class="b3-switch fn__flex-center" data-type="list" type="checkbox"${config.types.list ? " checked" : ""}>
    </label>
    <label class="fn__flex b3-label">
        <svg class="ft__on-surface svg fn__flex-center"><use xlink:href="#iconListItem"></use></svg>
        <span class="fn__space"></span>
        <div class="fn__flex-1 fn__flex-center">
            ${window.siyuan.languages.listItem}
        </div>
        <span class="fn__space"></span>
        <input id="removeAssets" class="b3-switch fn__flex-center" data-type="listItem" type="checkbox"${config.types.listItem ? " checked" : ""}>
    </label>
    <label class="fn__flex b3-label">
        <svg class="ft__on-surface svg fn__flex-center"><use xlink:href="#iconCode"></use></svg>
        <span class="fn__space"></span>
        <div class="fn__flex-1 fn__flex-center">
            ${window.siyuan.languages.code}
        </div>
        <span class="fn__space"></span>
        <input id="removeAssets" class="b3-switch fn__flex-center" data-type="codeBlock" type="checkbox"${config.types.codeBlock ? " checked" : ""}>
    </label>
    <label class="fn__flex b3-label">
        <svg class="ft__on-surface svg fn__flex-center"><use xlink:href="#iconHTML5"></use></svg>
        <span class="fn__space"></span>
        <div class="fn__flex-1 fn__flex-center">
            HTML
        </div>
        <span class="fn__space"></span>
        <input id="removeAssets" class="b3-switch fn__flex-center" data-type="htmlBlock" type="checkbox"${config.types.htmlBlock ? " checked" : ""}>
    </label>
    <label class="fn__flex b3-label">
        <svg class="ft__on-surface svg fn__flex-center"><use xlink:href="#iconSQL"></use></svg>
        <span class="fn__space"></span>
        <div class="fn__flex-1 fn__flex-center">
            ${window.siyuan.languages.embedBlock}
        </div>
        <span class="fn__space"></span>
        <input id="removeAssets" class="b3-switch fn__flex-center" data-type="embedBlock" type="checkbox"${config.types.embedBlock ? " checked" : ""}>
    </label>
</div>
<div class="b3-dialog__action">
    <button class="b3-button b3-button--cancel">${window.siyuan.languages.cancel}</button><div class="fn__space"></div>
    <button class="b3-button b3-button--text">${window.siyuan.languages.confirm}</button>
</div>`,
        width: isMobile() ? "92vw" : "520px",
        height: "70vh",
    });
    const btnsElement = filterDialog.element.querySelectorAll(".b3-button");
    btnsElement[0].addEventListener("click", () => {
        filterDialog.destroy();
    });
    btnsElement[1].addEventListener("click", () => {
        filterDialog.element.querySelectorAll(".b3-switch").forEach((item: HTMLInputElement) => {
            config.types[item.getAttribute("data-type") as TSearchFilter] = item.checked;
        });
        cb();
        filterDialog.destroy();
    });
};

export const queryMenu = (config: ISearchOption, cb: () => void) => {
    window.siyuan.menus.menu.remove();
    window.siyuan.menus.menu.append(new MenuItem({
        iconHTML: Constants.ZWSP,
        label: window.siyuan.languages.keyword,
        current: config.method === 0,
        click() {
            config.method = 0;
            cb();
        }
    }).element);
    window.siyuan.menus.menu.append(new MenuItem({
        iconHTML: Constants.ZWSP,
        label: window.siyuan.languages.querySyntax,
        current: config.method === 1,
        click() {
            config.method = 1;
            cb();
        }
    }).element);
    window.siyuan.menus.menu.append(new MenuItem({
        iconHTML: Constants.ZWSP,
        label: "SQL",
        current: config.method === 2,
        click() {
            config.method = 2;
            cb();
        }
    }).element);
    window.siyuan.menus.menu.append(new MenuItem({
        iconHTML: Constants.ZWSP,
        label: window.siyuan.languages.regex,
        current: config.method === 3,
        click() {
            config.method = 3;
            cb();
        }
    }).element);
};

export const saveCriterion = (config: ISearchOption,
                              criteriaData: ISearchOption[],
                              element: Element,) => {
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
    const btnsElement = saveDialog.element.querySelectorAll(".b3-button");
    saveDialog.bindInput(saveDialog.element.querySelector("input"), () => {
        btnsElement[1].dispatchEvent(new CustomEvent("click"));
    });
    btnsElement[0].addEventListener("click", () => {
        saveDialog.destroy();
    });
    btnsElement[1].addEventListener("click", () => {
        const value = saveDialog.element.querySelector("input").value;
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
        config.removed = false;
        const criterion = config;
        criterion.name = value;
        criteriaData.push(Object.assign({}, criterion));
        window.siyuan.storage[Constants.LOCAL_SEARCHDATA] = Object.assign({}, config);
        setStorageVal(Constants.LOCAL_SEARCHDATA, window.siyuan.storage[Constants.LOCAL_SEARCHDATA]);
        fetchPost("/api/storage/setCriterion", {criterion}, () => {
            saveDialog.destroy();
            const criteriaElement = element.querySelector("#criteria");
            criteriaElement.classList.remove("fn__none");
            criteriaElement.firstElementChild.insertAdjacentHTML("beforeend", `<div data-type="set-criteria" class="b3-chip b3-chip--middle b3-chip--pointer b3-chip--${["secondary", "primary", "info", "success", "warning", "error", ""][(criteriaElement.firstElementChild.childElementCount) % 7]}">${criterion.name}<svg class="b3-chip__close" data-type="remove-criteria"><use xlink:href="#iconCloseRound"></use></svg></div>`);
        });
    });
}

export const moreMenu = async (config: ISearchOption,
                               criteriaData: ISearchOption[],
                               element: Element,
                               cb: () => void,
                               removeCriterion: () => void,
                               layoutMenu?: () => void) => {
    window.siyuan.menus.menu.remove();
    const sortMenu = [{
        iconHTML: Constants.ZWSP,
        label: window.siyuan.languages.type,
        current: config.sort === 0,
        click() {
            config.sort = 0;
            cb();
        }
    }, {
        iconHTML: Constants.ZWSP,
        label: window.siyuan.languages.createdASC,
        current: config.sort === 1,
        click() {
            config.sort = 1;
            cb();
        }
    }, {
        iconHTML: Constants.ZWSP,
        label: window.siyuan.languages.createdDESC,
        current: config.sort === 2,
        click() {
            config.sort = 2;
            cb();
        }
    }, {
        iconHTML: Constants.ZWSP,
        label: window.siyuan.languages.modifiedASC,
        current: config.sort === 3,
        click() {
            config.sort = 3;
            cb();
        }
    }, {
        iconHTML: Constants.ZWSP,
        label: window.siyuan.languages.modifiedDESC,
        current: config.sort === 4,
        click() {
            config.sort = 4;
            cb();
        }
    }, {
        iconHTML: Constants.ZWSP,
        label: window.siyuan.languages.sortByRankAsc,
        current: config.sort === 6,
        click() {
            config.sort = 6;
            cb();
        }
    }, {
        iconHTML: Constants.ZWSP,
        label: window.siyuan.languages.sortByRankDesc,
        current: config.sort === 7,
        click() {
            config.sort = 7;
            cb();
        }
    }];
    if (config.group === 1) {
        sortMenu.push({
            iconHTML: Constants.ZWSP,
            label: window.siyuan.languages.sortByContent,
            current: config.sort === 5,
            click() {
                config.sort = 5;
                cb();
            }
        });
    }
    window.siyuan.menus.menu.append(new MenuItem({
        iconHTML: Constants.ZWSP,
        label: window.siyuan.languages.sort,
        type: "submenu",
        submenu: sortMenu,
    }).element);
    window.siyuan.menus.menu.append(new MenuItem({
        iconHTML: Constants.ZWSP,
        label: window.siyuan.languages.group,
        type: "submenu",
        submenu: [{
            iconHTML: Constants.ZWSP,
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
            iconHTML: Constants.ZWSP,
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
        iconHTML: Constants.ZWSP,
        click() {
            saveCriterion(config, criteriaData, element);
        }
    }).element);
    window.siyuan.menus.menu.append(new MenuItem({
        iconHTML: Constants.ZWSP,
        label: window.siyuan.languages.removeCriterion,
        click() {
            removeCriterion();
        }
    }).element);
};

export const initCriteriaMenu = (element: HTMLElement, data: ISearchOption[]) => {
    fetchPost("/api/storage/getCriteria", {}, (response) => {
        let html = "";
        response.data.forEach((item: ISearchOption, index: number) => {
            data.push(item);
            html += `<div data-type="set-criteria" class="b3-chip b3-chip--middle b3-chip--pointer b3-chip--${["secondary", "primary", "info", "success", "warning", "error", ""][index % 7]}">${escapeHtml(item.name)}<svg class="b3-chip__close" data-type="remove-criteria"><use xlink:href="#iconCloseRound"></use></svg></div>`;
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
<button data-type="removeCriterion" aria-label="${window.siyuan.languages.useCriterion}" class="b3-tooltips b3-tooltips__nw b3-button b3-button--small b3-button--outline fn__flex-center">${window.siyuan.languages.removeCriterion}</button>
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
