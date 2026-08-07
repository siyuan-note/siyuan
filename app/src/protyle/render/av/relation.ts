import {Menu} from "../../../plugin/Menu";
import {hasClosestByAttribute, hasClosestByClassName, hasTopClosestByClassName} from "../../util/hasClosest";
import {UDLRHint, upDownHint} from "../../../util/upDownHint";
import {fetchPost} from "../../../util/fetch";
import {escapeAttr, escapeHtml, escapeLessThans} from "../../../util/escape";
import {transaction} from "../../wysiwyg/transaction";
import {getCellValueText, renderCell, updateCellsValue} from "./cell";
import {updateAttrViewCellAnimation} from "./action";
import {focusBlock} from "../../util/selection";
import {setPosition} from "../../../util/setPosition";
import * as dayjs from "dayjs";
import {getFieldsByData, getViewName} from "./view";
import {getColIconByType, getColId} from "./col";
import {getFieldIdByCellElement} from "./row";
import {isMobile} from "../../../util/functions";
import {showMessage} from "../../../dialog/message";
import {writeText} from "../../util/compatibility";
import {Constants} from "../../../constants";
import {openDatabaseRowByData} from "./openDatabaseRow";
import {getAVColumnTextMeasurer, getAVTableFitWidths} from "./columnWidth";

interface IAVItem {
    avID: string;
    avName: string;
    blockID: string;
    hPath: string;
    matched?: boolean;
    viewName: string;
    viewID: string;
    viewLayout: string;
}

type TSearchAVPurpose = "addToDatabase" | "selectRelation";

interface IOpenSearchAVOptions {
    avID: string;
    target: HTMLElement;
    callback?: (element: HTMLElement) => void;
    purpose: TSearchAVPurpose;
    blockID?: string;
}

const RELATION_PAGE_SIZE = 16;

const SEARCH_AV_LOADING_HTML = '<img style="margin: 0 auto;display: block;width: 64px;height: 64px" src="/stage/loading-pure.svg">';

const genSearchList = (element: Element, keyword: string, options: IOpenSearchAVOptions, signal: AbortSignal,
                       cb?: () => void) => {
    const showViews = options.purpose === "addToDatabase";
    fetchPost("/api/av/searchAttributeView", {
        keyword,
        avID: options.avID,
        blockID: options.blockID,
        excludes: (showViews && options.avID) ? [options.avID] : undefined,
        includeViewMatches: showViews,
    }, (response) => {
        let html = "";
        const results = response.data.results as Array<IAVItem & { children: IAVItem[] }>;
        const hasMatchedView = showViews && results.some((item) => item.children?.some((subItem) => subItem.matched));
        let focusAssigned = false;
        results.forEach((item, index) => {
            const hasChildren = item.children && item.children.length > 0 && showViews;
            const expandChildren = hasChildren && item.children.some((subItem) => subItem.matched);
            const focusParent = !hasMatchedView && index === 0;
            if (focusParent) {
                focusAssigned = true;
            }
            html += `<div class="b3-list-item b3-list-item--narrow${focusParent ? " b3-list-item--focus" : ""}" data-av-id="${item.avID}" data-block-id="${item.blockID}">
    <span class="b3-list-item__toggle b3-list-item__toggle--hl${showViews ? "" : " fn__none"}" style="height:auto;align-self: stretch;margin: 4px 0;">
        <svg class="b3-list-item__arrow${expandChildren ? " b3-list-item__arrow--open" : ""}">${hasChildren ? '<use xlink:href="#iconRight"></use>' : ""}</svg>
    </span>
    <span class="fn__space--small"></span>
    <div class="b3-list-item--two fn__flex-1">
        <div class="b3-list-item__first">
            <span class="b3-list-item__text">${escapeHtml(item.avName || window.siyuan.languages._kernel[267])}</span>
        </div>
        <div class="b3-list-item__meta b3-list-item__showall">${escapeLessThans(item.hPath)}</div>
    </div>
    <svg aria-label="${window.siyuan.languages.thisDatabase}" style="margin: 0 0 0 4px" class="b3-list-item__hinticon ariaLabel${item.avID === options.avID ? "" : " fn__none"}"><use xlink:href="#iconInfo"></use></svg>
</div>`;
            if (hasChildren) {
                html += `<div class="${expandChildren ? "" : "fn__none"}">`;
                item.children.forEach((subItem) => {
                    const viewDefaultName = getViewName(subItem.viewLayout);
                    const focusView = !focusAssigned && Boolean(subItem.matched);
                    if (focusView) {
                        focusAssigned = true;
                    }
                    html += `<div style="padding-left: 48px;" class="b3-list-item b3-list-item--narrow${focusView ? " b3-list-item--focus" : ""}" data-av-id="${subItem.avID}" data-view-id="${subItem.viewID}" data-block-id="${subItem.blockID}">
<span class="b3-list-item__text">${escapeHtml(subItem.viewName)}</span> 
<span class="b3-list-item__meta">${viewDefaultName}</span>
</div>`;
                });
                html += "</div>";
            }
        });
        if (results.length === 0) {
            const emptyText = showViews && keyword.trim() === "" ?
                window.siyuan.languages.noAvailableDatabase : window.siyuan.languages.emptyContent;
            html = `<div class="b3-list--empty">${emptyText}</div>`;
        }
        element.innerHTML = html;
        if (cb) {
            cb();
        }
    }, undefined, undefined, signal);
};

const setDatabase = (avId: string, element: HTMLElement, item: HTMLElement) => {
    element.dataset.avId = item.dataset.avId;
    element.dataset.blockId = item.dataset.blockId;
    element.querySelector(".b3-menu__accelerator").textContent = item.querySelector(".b3-list-item__hinticon").classList.contains("fn__none") ? item.querySelector(".b3-list-item__text").textContent : window.siyuan.languages.thisDatabase;
    const menuElement = hasClosestByClassName(element, "b3-menu__items");
    if (menuElement) {
        toggleUpdateRelationBtn(menuElement, avId, true);
    }
};

export const openSearchAV = (options: IOpenSearchAVOptions) => {
    window.siyuan.menus.menu.remove();
    const menu = new Menu();
    menu.addItem({
        iconHTML: "",
        type: "empty",
        label: `<div class="fn__flex-column b3-menu__filter"${isMobile() ? "" : ' style="width: 50vw"'} >
    <input class="b3-text-field fn__flex-shrink"/>
    <div class="fn__hr"></div>
    <div class="b3-list fn__flex-1 b3-list--background">
        ${SEARCH_AV_LOADING_HTML}
    </div>
</div>`,
        bind(element) {
            const listElement = element.querySelector(".b3-list") as HTMLElement;
            const inputElement = element.querySelector("input") as HTMLInputElement;
            let searchTimer = 0;
            let requestSequence = 0;
            let controller: AbortController;
            const loadList = (keyword: string, cb?: () => void) => {
                controller?.abort();
                controller = new AbortController();
                const currentSequence = ++requestSequence;
                genSearchList(listElement, keyword, options, controller.signal, () => {
                    if (currentSequence !== requestSequence) {
                        return;
                    }
                    cb?.();
                });
            };
            const search = () => {
                controller?.abort();
                requestSequence++;
                clearTimeout(searchTimer);
                listElement.innerHTML = SEARCH_AV_LOADING_HTML;
                searchTimer = window.setTimeout(() => {
                    loadList(inputElement.value);
                }, Constants.TIMEOUT_INPUT);
            };
            const selectItem = (listItemElement?: HTMLElement) => {
                if (!listItemElement) {
                    return;
                }
                clearTimeout(searchTimer);
                controller?.abort();
                if (options.callback) {
                    options.callback(listItemElement);
                } else {
                    setDatabase(options.avID, options.target, listItemElement);
                }
                window.siyuan.menus.menu.remove();
            };
            inputElement.addEventListener("keydown", (event: KeyboardEvent) => {
                if (event.isComposing) {
                    return;
                }
                UDLRHint(listElement, event);
                if (event.key === "Enter") {
                    event.preventDefault();
                    event.stopPropagation();
                    const listItemElement = listElement.querySelector(".b3-list-item--focus") as HTMLElement;
                    selectItem(listItemElement);
                }
            });
            inputElement.addEventListener("input", (event: InputEvent) => {
                event.stopPropagation();
                if (event.isComposing) {
                    return;
                }
                search();
            });
            inputElement.addEventListener("compositionend", () => {
                search();
            });
            element.lastElementChild.addEventListener("click", (event) => {
                let clickTarget = event.target as HTMLElement;
                while (clickTarget && !clickTarget.classList.contains("b3-list")) {
                    if (clickTarget.classList.contains("b3-list-item__toggle")) {
                        if (clickTarget.firstElementChild.classList.contains("b3-list-item__arrow--open")) {
                            clickTarget.firstElementChild.classList.remove("b3-list-item__arrow--open");
                            clickTarget.parentElement.nextElementSibling.classList.add("fn__none");
                        } else {
                            clickTarget.firstElementChild.classList.add("b3-list-item__arrow--open");
                            clickTarget.parentElement.nextElementSibling.classList.remove("fn__none");
                        }
                        event.preventDefault();
                        event.stopPropagation();
                        break;
                    } else if (clickTarget.classList.contains("b3-list-item")) {
                        event.preventDefault();
                        event.stopPropagation();
                        selectItem(clickTarget);
                        break;
                    }
                    clickTarget = clickTarget.parentElement;
                }
            });
            loadList("", () => {
                const rect = options.target.getBoundingClientRect();
                menu.open({
                    x: rect.left,
                    y: rect.bottom,
                    h: rect.height,
                });
                element.querySelector("input").focus();
            });
        }
    });
    menu.element.querySelector(".b3-menu__items").setAttribute("style", "overflow: initial");
    const popoverElement = hasTopClosestByClassName(options.target, "block__popover", true);
    menu.element.setAttribute("data-from", popoverElement ? popoverElement.dataset.level + "popover" : "app");
};

export const updateRelation = (options: {
    protyle: IProtyle,
    avID: string,
    avElement: Element,
    colsData: IAVColumn[],
    blockElement: Element,
    callback?: () => void,
}) => {
    const inputElement = options.avElement.querySelector('input[data-type="colName"]') as HTMLInputElement;
    const goSearchAVElement = options.avElement.querySelector('.b3-menu__item[data-type="goSearchAV"]') as HTMLElement;
    const newAVId = goSearchAVElement.getAttribute("data-av-id");
    const colId = options.avElement.querySelector(".b3-menu__item").getAttribute("data-col-id");
    let colData: IAVColumn;
    options.colsData.find(item => {
        if (item.id === colId) {
            if (!item.relation) {
                item.relation = {};
            }
            colData = item;
            return true;
        }
    });
    const colNewName = (options.avElement.querySelector('[data-type="name"]') as HTMLInputElement).value;
    const blockID = options.blockElement.getAttribute("data-node-id");
    const targetAVID = newAVId || colData.relation.avID;
    const oldCandidateFilters = JSON.parse(JSON.stringify(colData.relation.candidateFilters || []));
    const newCandidateFilters = targetAVID === colData.relation.avID ? oldCandidateFilters : [];
    const targetChanged = targetAVID !== colData.relation.avID;
    const dependentRollups = options.colsData.filter((item) => {
        return item.type === "rollup" && item.rollup?.relationKeyID === colId;
    });
    const doOperations: IOperation[] = [{
        action: "updateAttrViewColRelation",
        avID: options.avID,
        keyID: colId,
        id: targetAVID,
        backRelationKeyID: colData.relation.avID === newAVId ? (colData.relation.backKeyID || Lute.NewNodeID()) : Lute.NewNodeID(),
        isTwoWay: (options.avElement.querySelector(".b3-switch") as HTMLInputElement).checked,
        name: inputElement.value,
        format: colNewName
    }, {
        action: "setAttrViewColRelationFilters",
        avID: options.avID,
        keyID: colId,
        blockID,
        data: newCandidateFilters,
    }];
    if (targetChanged) {
        dependentRollups.forEach((item) => {
            doOperations.push({
                action: "setAttrViewColRollupFilters",
                avID: options.avID,
                keyID: item.id,
                blockID,
                data: [],
            });
        });
    }
    doOperations.push({
        action: "doUpdateUpdated",
        id: blockID,
        data: dayjs().format("YYYYMMDDHHmmss"),
    });
    const undoOperations: IOperation[] = [{
        action: "updateAttrViewColRelation",
        avID: options.avID,
        keyID: colId,
        id: colData.relation.avID || newAVId,
        backRelationKeyID: colData.relation.backKeyID,
        isTwoWay: colData.relation.isTwoWay,
        name: inputElement.dataset.oldValue,
        format: colData.name
    }];
    if (colData.relation.avID) {
        undoOperations.push({
            action: "setAttrViewColRelationFilters",
            avID: options.avID,
            keyID: colId,
            blockID,
            data: oldCandidateFilters,
        });
        if (targetChanged) {
            dependentRollups.forEach((item) => {
                undoOperations.push({
                    action: "setAttrViewColRollupFilters",
                    avID: options.avID,
                    keyID: item.id,
                    blockID,
                    data: JSON.parse(JSON.stringify(item.rollup?.filters || [])),
                });
            });
        }
    }
    transaction(options.protyle, doOperations, undoOperations, {callback: options.callback});
    options.avElement.remove();
    updateAttrViewCellAnimation(options.blockElement.querySelector(`.av__row--header .av__cell[data-col-id="${colId}"]`), undefined, {name: colNewName});
    focusBlock(options.blockElement);
};

export const toggleUpdateRelationBtn = (menuItemsElement: HTMLElement, avId: string, resetData = false) => {
    const searchElement = menuItemsElement.querySelector('.b3-menu__item[data-type="goSearchAV"]') as HTMLElement;
    const filterElement = menuItemsElement.querySelector(
        '[data-type="goAttrViewColFilters"][data-filter-type="relation"]') as HTMLElement;
    filterElement?.classList.toggle("b3-menu__item--disabled", !searchElement?.dataset.avId);
    const switchElement = menuItemsElement.querySelector('input[data-type="backRelation"]') as HTMLInputElement;
    const inputElement = menuItemsElement.querySelector('input[data-type="colName"]') as HTMLInputElement;
    const inputItemElement = inputElement?.closest(".b3-menu__item") as HTMLElement;
    const updateButtonElement = menuItemsElement.querySelector('[data-type="updateRelation"]') as HTMLElement;
    const btnElement = updateButtonElement?.closest(".b3-menu__item") as HTMLElement;
    if (!searchElement || !switchElement || !inputElement || !inputItemElement || !btnElement) {
        return;
    }
    const oldValue = JSON.parse(searchElement.dataset.oldValue) as IAVColumnRelation;
    if (oldValue.avID) {
        if (resetData) {
            if (searchElement.dataset.avId !== oldValue.avID) {
                inputElement.value = "";
                switchElement.checked = false;
            } else {
                inputElement.value = inputElement.dataset.oldValue;
                switchElement.checked = oldValue.isTwoWay;
            }
        }
        if (switchElement.checked) {
            inputItemElement.classList.remove("fn__none");
        } else {
            inputItemElement.classList.add("fn__none");
        }
        if ((searchElement.dataset.avId && oldValue.avID !== searchElement.dataset.avId) || oldValue.isTwoWay !== switchElement.checked || inputElement.dataset.oldValue !== inputElement.value) {
            btnElement.classList.remove("fn__none");
        } else {
            btnElement.classList.add("fn__none");
        }
    } else if (searchElement.dataset.avId) {
        if (switchElement.checked) {
            inputItemElement.classList.remove("fn__none");
        } else {
            inputItemElement.classList.add("fn__none");
        }
        btnElement.classList.remove("fn__none");
    }
};

const updateCopyRelatedItems = (menuElement: Element) => {
    const inputElement = menuElement.querySelector(".b3-form__icona .b3-text-field") as HTMLInputElement;
    if (menuElement.querySelector('[data-relation-type="selected"]')) {
        inputElement.nextElementSibling.classList.remove("fn__none");
        inputElement.style.paddingRight = "26px";
    } else {
        inputElement.nextElementSibling.classList.add("fn__none");
        inputElement.style.paddingRight = "";
    }
};

const getRelationGridTemplate = (columns: IAVColumn[], rows: IAVRow[],
                                 measureText: (value: string) => number) => {
    const widths = getAVTableFitWidths({
        columns,
        rows,
        groups: [],
        rowCount: rows.length,
    } as IAVTable, getCellValueText, measureText);
    return `32px ${columns.map((column, index) => {
        const width = widths[column.id] || "64px";
        return index === 0 ? `${Math.max(240, parseFloat(width))}px` : width;
    }).join(" ")}`;
};

const getRelationPrimaryCell = (row: IAVRow) => {
    return row.cells.find((cell) => cell.value?.type === "block");
};

const genRelationHeaderHTML = (columns: IAVColumn[], gridTemplate: string) => {
    let html = `<div class="av__relation-table-header" data-relation-type="header" style="grid-template-columns:${gridTemplate}">
<span class="av__relation-table-check"></span>`;
    columns.forEach((column, index) => {
        html += `<span class="av__relation-table-cell${index === 0 ? " av__relation-table-primary" : ""}">
    <svg><use xlink:href="#${getColIconByType(column.type)}"></use></svg>
    <span class="fn__ellipsis">${escapeHtml(column.name)}</span>
</span>`;
    });
    return html + "</div>";
};

const genRelationRowHTML = (row: IAVRow, columns: IAVColumn[], type: "selected" | "candidate", gridTemplate: string) => {
    const primaryCell = getRelationPrimaryCell(row);
    if (!primaryCell?.value) {
        return "";
    }
    const primaryValue = primaryCell.value;
    const selected = type === "selected";
    let html = `<div data-row-id="${escapeAttr(row.id)}" data-position="west" data-type="setRelationCell"
data-relation-type="${type}" class="b3-menu__item av__relation-table-row" ${selected ? 'draggable="true"' : ""}
style="grid-template-columns:${gridTemplate}">
<span class="av__relation-table-check"><svg><use xlink:href="#icon${selected ? "Check" : "Uncheck"}"></use></svg></span>`;
    columns.forEach((column, index) => {
        const cell = row.cells.find((item) => item.value?.keyID === column.id) || row.cells[index];
        if (index === 0) {
            const isDetached = primaryValue.isDetached;
            html += `<span class="av__relation-table-cell av__relation-table-primary" data-row-id="${escapeAttr(row.id)}"
data-value-id="${escapeAttr(primaryCell.id || "")}"
style="${primaryCell.bgColor ? `background-color:${primaryCell.bgColor};` : ""}${primaryCell.color ? `color:${primaryCell.color};` : ""}">
    ${selected ? '<svg class="b3-menu__icon fn__grab"><use xlink:href="#iconDrag"></use></svg>' : ""}
    <span class="b3-menu__label fn__ellipsis${isDetached ? "" : " popover__block"}"
        ${isDetached ? "" : 'style="color:var(--b3-protyle-inline-blockref-color)"'}
        data-id="${escapeAttr(primaryValue.block?.id || "")}">${Lute.EscapeHTMLStr(primaryValue.block?.content || window.siyuan.languages.untitled)}</span>
    ${primaryCell.id ? `<button type="button" class="av__relation-row-open ariaLabel" data-type="openRelationRow" draggable="false"
        data-position="north" aria-label="${window.siyuan.languages.openBy}"><svg><use xlink:href="#iconOpen"></use></svg></button>` : ""}
</span>`;
        } else {
            html += `<span class="av__relation-table-cell"
style="${cell?.bgColor ? `background-color:${cell.bgColor};` : ""}${cell?.color ? `color:${cell.color};` : ""}">${cell?.value ?
                renderCell(cell.value, 0, false, "table", column.options, column.dateFormat) : ""}</span>`;
        }
    });
    return html + "</div>";
};

const genRelationRowsHTML = (rows: IAVRow[], columns: IAVColumn[], type: "selected" | "candidate",
                             gridTemplate: string, excludedIDs = new Set<string>()) => {
    let html = "";
    rows.forEach((row) => {
        if (!excludedIDs.has(row.id)) {
            html += genRelationRowHTML(row, columns, type, gridTemplate);
            excludedIDs.add(row.id);
        }
    });
    return html;
};

const genRelationFooterHTML = (menuElement: HTMLElement, keyword: string, hasCandidates: boolean, hasMore: boolean) => {
    if (keyword) {
        const refElement = menuElement.querySelector(".popover__block");
        const databaseName = `<span style="color: var(--b3-protyle-inline-blockref-color);" class="popover__block"
data-id="${escapeAttr(refElement?.getAttribute("data-id") || "")}">${escapeHtml(refElement?.textContent || "")}</span>`;
        return `<button class="b3-menu__item av__relation-table-footer" data-type="setRelationCell" data-relation-type="create">
    <span class="b3-menu__label fn__ellipsis">${window.siyuan.languages.newRowInRelation.replace("${x}", databaseName).
            replace("${y}", Lute.EscapeHTMLStr(keyword))}</span>
</button>`;
    }
    if (!hasCandidates && !hasMore) {
        return `<div class="b3-list--empty av__relation-table-footer" data-relation-type="empty">${window.siyuan.languages.noMoreItems}</div>`;
    }
    return "";
};

const genRelationLoaderHTML = (loading: boolean, visible = loading) => {
    return `<img data-relation-type="loader" class="${loading ? "" : "fn__none"}" style="${visible ? "" : "visibility: hidden;"}margin: 0 auto;display: block;width: 64px;height: 64px" src="/stage/loading-pure.svg">`;
};

export const bindRelationEvent = (options: {
    menuElement: HTMLElement,
    protyle: IProtyle,
    blockElement: Element,
    cellElements: HTMLElement[]
}) => {
    const inputElement = options.menuElement.querySelector("input");
    const listElement = options.menuElement.querySelector(".b3-menu__items") as HTMLElement;
    const measureText = getAVColumnTextMeasurer(options.blockElement as HTMLElement);
    const state = {
        page: 0,
        total: 0,
        keyword: "",
        loading: false,
        loaderVisible: false,
        columns: [] as IAVColumn[],
        gridTemplate: "",
        controller: undefined as AbortController | undefined,
    };
    let searchTimer: number;
    let loaderTimer: number | undefined;
    let initialLoad = true;
    let listNaturalMaxHeight = 0;
    let positionInitialized = false;

    const resetPosition = () => {
        options.menuElement.removeAttribute("data-position-top");
        options.menuElement.removeAttribute("data-position-bottom");
        options.menuElement.removeAttribute("data-position-x");
    };
    const updateListMaxHeight = () => {
        if (listNaturalMaxHeight < 1) {
            return false;
        }
        const menuStyle = getComputedStyle(options.menuElement);
        const maxMenuHeight = parseFloat(menuStyle.maxHeight) || window.innerHeight - 32;
        const headerHeight = listElement.previousElementSibling?.getBoundingClientRect().height || 0;
        const chromeHeight = headerHeight + parseFloat(menuStyle.paddingTop) + parseFloat(menuStyle.paddingBottom) +
            parseFloat(menuStyle.borderTopWidth) + parseFloat(menuStyle.borderBottomWidth);
        const maxHeight = Math.max(30, Math.min(listNaturalMaxHeight, maxMenuHeight - chromeHeight));
        const maxHeightValue = maxHeight + "px";
        if (listElement.style.maxHeight === maxHeightValue) {
            return false;
        }
        listElement.style.maxHeight = maxHeightValue;
        return true;
    };
    const updateListNaturalMaxHeight = (allowInitialize = true) => {
        const naturalHeight = listElement.scrollHeight;
        if (naturalHeight <= listNaturalMaxHeight || (listNaturalMaxHeight < 1 && !allowInitialize)) {
            return false;
        }
        listNaturalMaxHeight = naturalHeight;
        return updateListMaxHeight();
    };
    const positionMenu = (reset = false) => {
        if (reset) {
            resetPosition();
        }
        const cellRect = options.cellElements[options.cellElements.length - 1].getBoundingClientRect();
        setPosition(options.menuElement, cellRect.left, cellRect.bottom, cellRect.height, 0, true);
        positionInitialized = true;
    };
    const resize = () => {
        updateListMaxHeight();
        positionMenu(true);
    };
    const resizeList = () => {
        const listHeightChanged = updateListNaturalMaxHeight();
        if (listHeightChanged) {
            resetPosition();
        }
        positionMenu();
    };

    const clearLoaderTimer = () => {
        if (typeof loaderTimer !== "undefined") {
            clearTimeout(loaderTimer);
            loaderTimer = undefined;
        }
    };
    const setLoading = (loading: boolean, delayed = false, controller?: AbortController) => {
        clearLoaderTimer();
        state.loaderVisible = loading && !delayed;
        const loaderElement = listElement.querySelector('[data-relation-type="loader"]') as HTMLElement;
        loaderElement?.classList.toggle("fn__none", !loading);
        if (loaderElement) {
            loaderElement.style.visibility = state.loaderVisible ? "" : "hidden";
        }
        if (loading && delayed) {
            loaderTimer = window.setTimeout(() => {
                if (!state.loading || state.controller !== controller) {
                    return;
                }
                state.loaderVisible = true;
                const currentLoaderElement = listElement.querySelector('[data-relation-type="loader"]') as HTMLElement;
                currentLoaderElement?.style.removeProperty("visibility");
            }, Constants.TIMEOUT_LOAD);
        }
    };
    const hasMore = () => state.page * RELATION_PAGE_SIZE < state.total;
    const ensureListFilled = () => {
        requestAnimationFrame(() => {
            if (!listElement.isConnected || state.loading || !hasMore()) {
                return;
            }
            if (listElement.scrollHeight <= listElement.clientHeight + 30) {
                loadPage(false);
            }
        });
    };
    const getSelectedItems = () => {
        const selectedRows = listElement.querySelectorAll('[data-relation-type="selected"]');
        if (selectedRows.length > 0 || listElement.querySelector('[data-relation-type="header"]')) {
            return Array.from(selectedRows).map((item: HTMLElement) => {
                const blockElement = item.querySelector(".b3-menu__label") as HTMLElement;
                return {
                    id: item.dataset.rowId,
                    blockID: blockElement.dataset.id,
                    content: blockElement.textContent,
                    isDetached: !blockElement.classList.contains("popover__block"),
                };
            });
        }
        return Array.from(options.cellElements[0].querySelectorAll(".av__cell--relation")).
            map((item: HTMLElement) => {
                const blockElement = item.querySelector(".av__celltext") as HTMLElement;
                return {
                    id: item.dataset.rowId,
                    blockID: blockElement.dataset.id,
                    content: blockElement.textContent,
                    isDetached: !blockElement.classList.contains("av__celltext--ref"),
                };
            });
    };
    const renderFooter = (hasCandidates: boolean) => {
        listElement.querySelector('[data-relation-type="create"], [data-relation-type="empty"]')?.remove();
        const more = hasMore();
        listElement.dataset.hasMore = more.toString();
        const footerHTML = genRelationFooterHTML(options.menuElement, state.keyword, hasCandidates, more);
        if (footerHTML) {
            listElement.querySelector('[data-relation-type="loader"]').insertAdjacentHTML("beforebegin", footerHTML);
        }
    };
    const renderPage = (data: {
        columns: IAVColumn[],
        selectedRows: IAVRow[],
        rows: IAVRow[]
    }, reset: boolean) => {
        state.columns = data.columns || state.columns;
        if (reset || !state.gridTemplate) {
            state.gridTemplate = getRelationGridTemplate(state.columns,
                [...(data.selectedRows || []), ...(data.rows || [])], measureText);
        }
        const gridTemplate = state.gridTemplate;
        const excludedIDs = new Set(Array.from(listElement.querySelectorAll(
            '[data-relation-type="selected"], [data-relation-type="candidate"]'
        )).map((item: HTMLElement) => item.dataset.rowId));
        let candidateHTML = "";
        if (reset) {
            excludedIDs.clear();
            const selectedHTML = genRelationRowsHTML(data.selectedRows || [], state.columns, "selected",
                gridTemplate, excludedIDs);
            candidateHTML = genRelationRowsHTML(data.rows || [], state.columns, "candidate", gridTemplate, excludedIDs);
            listElement.innerHTML = `${genRelationHeaderHTML(state.columns, gridTemplate)}
<div class="av__relation-table-selected" data-relation-type="selectedRows">${selectedHTML}</div>
<div class="b3-menu__separator" data-relation-type="separator"></div>
<div class="av__relation-table-candidates" data-relation-type="candidateRows">${candidateHTML}</div>
${genRelationLoaderHTML(state.loading, state.loaderVisible)}`;
        } else {
            candidateHTML = genRelationRowsHTML(data.rows || [], state.columns, "candidate", gridTemplate, excludedIDs);
            if (candidateHTML) {
                listElement.querySelector('[data-relation-type="candidateRows"]').insertAdjacentHTML("beforeend", candidateHTML);
            }
        }
        renderFooter(!!listElement.querySelector('[data-relation-type="candidate"]'));
        if (!listElement.querySelector(".b3-menu__item--current")) {
            listElement.querySelector('[data-type="setRelationCell"]')?.classList.add("b3-menu__item--current");
        }
        updateCopyRelatedItems(options.menuElement);
    };
    const loadPage = (reset: boolean) => {
        if (state.loading && !reset) {
            return;
        }
        if (reset) {
            state.controller?.abort();
            state.page = 0;
            state.total = 0;
        } else if (!hasMore()) {
            return;
        }
        const page = reset ? 1 : state.page + 1;
        const keyword = state.keyword;
        const controller = new AbortController();
        const selectedItems = getSelectedItems();
        state.controller = controller;
        state.loading = true;
        setLoading(true, initialLoad && reset, controller);
        let succeeded = false;
        fetchPost("/api/av/getAttributeViewRelationCandidates", {
            avID: options.menuElement.firstElementChild.getAttribute("data-source-av-id"),
            keyID: options.menuElement.firstElementChild.getAttribute("data-key-id"),
            keyword,
            page,
            pageSize: RELATION_PAGE_SIZE,
            selectedBlockIDs: selectedItems.map((item) => item.id),
        }, response => {
            if (controller.signal.aborted || keyword !== state.keyword) {
                return;
            }
            const rows = response.data.rows as IAVRow[] || [];
            state.page = page;
            state.total = typeof response.data.total === "number" ? response.data.total :
                (page - 1) * RELATION_PAGE_SIZE + rows.length + (rows.length === RELATION_PAGE_SIZE ? 1 : 0);
            const databaseName = inputElement.parentElement.parentElement.querySelector(".popover__block");
            databaseName.textContent = response.data.name;
            databaseName.setAttribute("data-id", response.data.blockIDs?.[0] || "");
            const relationElement = options.menuElement.firstElementChild as HTMLElement;
            relationElement.dataset.databaseBlockId = response.data.blockIDs?.[0] || "";
            relationElement.dataset.notebookId = response.data.notebookID || "";
            const columns = response.data.columns as IAVColumn[] || [];
            const selectedRowsByID = new Map<string, IAVRow>((response.data.selectedRows as IAVRow[] || []).
                map((row) => [row.id, row]));
            const selectedRows: IAVRow[] = selectedItems.map((item) => {
                return selectedRowsByID.get(item.id) || {
                    id: item.id,
                    cells: [{
                        id: "",
                        color: "",
                        bgColor: "",
                        valueType: "block",
                        value: {
                            keyID: columns[0]?.id,
                            blockID: item.id,
                            type: "block",
                            isDetached: item.isDetached,
                            block: {
                                id: item.blockID,
                                content: item.content,
                            }
                        }
                    }]
                } as IAVRow;
            });
            initialLoad = false;
            renderPage({
                columns,
                selectedRows,
                rows,
            }, reset);
            setLoading(false);
            const listHeightChanged = updateListNaturalMaxHeight(keyword === "" || rows.length === RELATION_PAGE_SIZE);
            if (!positionInitialized || listHeightChanged) {
                resetPosition();
            }
            positionMenu();
            succeeded = true;
        }, undefined, undefined, controller.signal).finally(() => {
            if (state.controller !== controller) {
                return;
            }
            state.loading = false;
            setLoading(false);
            if (succeeded) {
                ensureListFilled();
            }
        });
    };
    const search = () => {
        state.keyword = inputElement.value;
        state.controller?.abort();
        state.controller = undefined;
        state.loading = false;
        setLoading(false);
        if (searchTimer) {
            clearTimeout(searchTimer);
        }
        searchTimer = window.setTimeout(() => {
            loadPage(true);
        }, Constants.TIMEOUT_INPUT);
    };

    inputElement.addEventListener("keydown", (event) => {
        if (event.isComposing) {
            return;
        }
        upDownHint(listElement, event, "b3-menu__item--current");
        const currentElement = options.menuElement.querySelector(".b3-menu__item--current") as HTMLElement;
        if (event.key === "Enter" && currentElement && currentElement.getAttribute("data-type") === "setRelationCell") {
            setRelationCell(options.protyle, options.blockElement as HTMLElement, currentElement, options.cellElements);
            event.preventDefault();
            event.stopPropagation();
        }
    });
    inputElement.addEventListener("input", (event: InputEvent) => {
        if (event.isComposing) {
            return;
        }
        search();
        event.stopPropagation();
    });
    inputElement.addEventListener("compositionend", (event) => {
        event.stopPropagation();
        search();
    });
    listElement.addEventListener("click", (event) => {
        const openElement = hasClosestByAttribute(event.target as HTMLElement, "data-type", "openRelationRow");
        if (!openElement || !listElement.contains(openElement)) {
            return;
        }
        const rowElement = hasClosestByClassName(openElement, "av__relation-table-row") as HTMLElement;
        const primaryElement = rowElement?.querySelector(".av__relation-table-primary") as HTMLElement;
        const blockElement = primaryElement?.querySelector(".b3-menu__label") as HTMLElement;
        const relationElement = options.menuElement.firstElementChild as HTMLElement;
        if (!rowElement || !primaryElement || !blockElement || !relationElement.dataset.databaseBlockId) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        openDatabaseRowByData(options.protyle, {
            avID: relationElement.dataset.avId,
            databaseBlockID: relationElement.dataset.databaseBlockId,
            notebookID: relationElement.dataset.notebookId,
            itemID: rowElement.dataset.rowId,
            valueID: primaryElement.dataset.valueId,
            title: blockElement.textContent,
            boundBlockID: blockElement.dataset.id,
            isDetached: !blockElement.classList.contains("popover__block"),
        }, {
            keepAVPanel: true,
        });
    });
    listElement.addEventListener("scroll", () => {
        if (!state.loading && hasMore() && listElement.scrollHeight - listElement.scrollTop - listElement.clientHeight <= 30) {
            loadPage(false);
        }
    });
    const refresh = () => {
        loadPage(true);
    };
    options.menuElement.addEventListener("relationrefresh", refresh);
    options.menuElement.addEventListener("relationresize", resizeList);
    options.menuElement.querySelector('[data-type="copyRelatedItems"]').addEventListener("click", () => {
        let copyText = "";
        const selectedElements = options.menuElement.querySelectorAll('.b3-menu__item[draggable="true"]');
        selectedElements.forEach((item: HTMLElement) => {
            if (selectedElements.length > 1) {
                copyText += "- ";
            }
            const textElement = item.querySelector(".b3-menu__label") as HTMLElement;
            if (!textElement.dataset.id || textElement.dataset.id === "undefined") {
                copyText += textElement.textContent + "\n";
            } else {
                copyText += `((${textElement.dataset.id} "${textElement.textContent}"))\n`;
            }
        });
        if (copyText) {
            writeText(copyText.trimEnd());
            showMessage(window.siyuan.languages.copied);
        }
    });
    window.addEventListener("resize", resize);
    loadPage(true);
    return () => {
        state.controller?.abort();
        window.removeEventListener("resize", resize);
        options.menuElement.removeEventListener("relationrefresh", refresh);
        options.menuElement.removeEventListener("relationresize", resizeList);
        clearLoaderTimer();
        if (searchTimer) {
            clearTimeout(searchTimer);
        }
    };
};

export const getRelationHTML = (data: IAV, cellElements?: HTMLElement[]) => {
    let colRelationData: IAVColumnRelation;
    let colId = "";
    getFieldsByData(data).find(item => {
        if (item.id === getColId(cellElements[0], data.viewType)) {
            colRelationData = item.relation;
            colId = item.id;
            return true;
        }
    });
    if (colRelationData && colRelationData.avID) {
        return `<div data-av-id="${colRelationData.avID}" data-source-av-id="${data.id}" data-key-id="${colId}" class="fn__flex-column av__relation">
<div class="b3-menu__item" data-type="nobg">
    <div class="b3-form__icona fn__flex-1" style="overflow: visible">
        <input class="b3-text-field fn__block" style="min-width: 190px"/>
        <svg class="b3-form__icona-icon ariaLabel fn__none" data-position="north" data-type="copyRelatedItems" aria-label="${window.siyuan.languages.copy} ${window.siyuan.languages.relatedItems}"><use xlink:href="#iconCopy"></use></svg>
    </div>
    <span class="fn__space"></span>
    <span style="color: var(--b3-protyle-inline-blockref-color);max-width: 200px" data-id="" class="popover__block fn__pointer fn__ellipsis"></span>
</div>
<div class="b3-menu__items av__relation-table">
    ${genRelationLoaderHTML(true, false)}
</div>`;
    } else {
        return "";
    }
};

const getRelationValue = (menuElement: HTMLElement) => {
    const value: IAVCellRelationValue = {blockIDs: [], contents: []};
    menuElement.querySelectorAll('[data-relation-type="selected"]').forEach((item: HTMLElement) => {
        const blockElement = item.querySelector(".b3-menu__label") as HTMLElement;
        value.blockIDs.push(item.dataset.rowId);
        value.contents.push({
            type: "block",
            block: {
                id: blockElement.dataset.id,
                content: blockElement.textContent
            },
            isDetached: !blockElement.classList.contains("popover__block")
        });
    });
    return value;
};

const genCreatedRelationRowHTML = (menuElement: HTMLElement, rowID: string, content: string) => {
    const headerElement = menuElement.querySelector('[data-relation-type="header"]') as HTMLElement;
    const columnCount = headerElement?.querySelectorAll(".av__relation-table-cell").length || 1;
    let cellsHTML = `<span class="av__relation-table-cell av__relation-table-primary" data-row-id="${rowID}">
    <svg class="b3-menu__icon fn__grab"><use xlink:href="#iconDrag"></use></svg>
    <span class="b3-menu__label fn__ellipsis" data-id="">${Lute.EscapeHTMLStr(content)}</span>
</span>`;
    for (let i = 1; i < columnCount; i++) {
        cellsHTML += '<span class="av__relation-table-cell"></span>';
    }
    return `<div data-row-id="${rowID}" data-position="west" data-type="setRelationCell"
data-relation-type="selected" class="b3-menu__item av__relation-table-row" draggable="true"
style="grid-template-columns:${headerElement?.style.gridTemplateColumns || "32px 240px"}">
<span class="av__relation-table-check"><svg><use xlink:href="#iconCheck"></use></svg></span>${cellsHTML}</div>`;
};

export const setRelationCell = async (protyle: IProtyle, nodeElement: HTMLElement, target: HTMLElement, cellElements: HTMLElement[]) => {
    const menuElement = hasClosestByClassName(target, "b3-menu");
    if (!menuElement) {
        return;
    }
    if (menuElement.querySelector(".dragover__bottom, .dragover__top")) {
        return;
    }

    if (!nodeElement.contains(cellElements[0])) {
        const viewType = nodeElement.getAttribute("data-av-type") as TAVView;
        const rowID = getFieldIdByCellElement(cellElements[0], viewType);
        if (viewType === "table") {
            cellElements[0] = (nodeElement.querySelector(`.av__row[data-id="${rowID}"] .av__cell[data-col-id="${cellElements[0].dataset.colId}"]`) ||
                nodeElement.querySelector(`.fn__flex-1[data-col-id="${cellElements[0].dataset.colId}"]`)) as HTMLElement;
        } else {
            cellElements[0] = (nodeElement.querySelector(`.av__gallery-item[data-id="${rowID}"] .av__cell[data-field-id="${cellElements[0].dataset.fieldId}"]`)) as HTMLElement;
        }
    }

    if (target.classList.contains("b3-menu__item")) {
        const rowId = target.getAttribute("data-row-id");
        if (target.dataset.relationType === "selected") {
            target.remove();
            updateCellsValue(protyle, nodeElement, getRelationValue(menuElement), cellElements);
            menuElement.dispatchEvent(new CustomEvent("relationrefresh"));
        } else if (rowId) {
            target.dataset.relationType = "selected";
            target.setAttribute("draggable", "true");
            target.querySelector(".av__relation-table-check use").setAttribute("xlink:href", "#iconCheck");
            const primaryElement = target.querySelector(".av__relation-table-primary");
            primaryElement.insertAdjacentHTML("afterbegin",
                '<svg class="b3-menu__icon fn__grab"><use xlink:href="#iconDrag"></use></svg>');
            menuElement.querySelector('[data-relation-type="selectedRows"]').append(target);
            updateCellsValue(protyle, nodeElement, getRelationValue(menuElement), cellElements);
            menuElement.dispatchEvent(new CustomEvent("relationrefresh"));
        } else {
            const blockID = target.querySelector(".popover__block").getAttribute("data-id");
            const content = target.querySelector("b").textContent;
            const rowId = Lute.NewNodeID();
            const bodyElement = hasClosestByClassName(cellElements[0], "av__body");
            menuElement.querySelector('[data-relation-type="selectedRows"]').insertAdjacentHTML(
                "beforeend", genCreatedRelationRowHTML(menuElement, rowId, content));
            const newValue = getRelationValue(menuElement);
            const updateOptions = await updateCellsValue(protyle, nodeElement, newValue, cellElements, null, null, true);
            const doOperations: IOperation[] = [{
                action: "insertAttrViewBlock",
                ignoreDefaultFill: true,
                avID: menuElement.firstElementChild.getAttribute("data-av-id"),
                srcs: [{
                    itemID: rowId,
                    id: Lute.NewNodeID(),
                    isDetached: true,
                    content
                }],
                blockID,
                groupID: bodyElement ? bodyElement.getAttribute("data-group-id") : "",
            }, {
                action: "doUpdateUpdated",
                id: blockID,
                data: dayjs().format("YYYYMMDDHHmmss"),
            }];
            transaction(protyle, doOperations.concat(updateOptions.doOperations));
        }
    }
    updateCopyRelatedItems(menuElement);
    menuElement.dispatchEvent(new CustomEvent("relationresize"));
};
