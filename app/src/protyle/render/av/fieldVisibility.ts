import {fetchSyncPost} from "../../../util/fetch";
import {transaction} from "../../wysiwyg/transaction";
import {Constants} from "../../../constants";
import {unicode2Emoji} from "../../../emoji";
import {escapeHtml} from "../../../util/escape";
import {setPosition} from "../../../util/setPosition";

const getViewIcon = (type: TAVView) => {
    switch (type) {
        case "gallery":
            return "iconGallery";
        case "kanban":
            return "iconBoard";
        default:
            return "iconTable";
    }
};

const getViewIconHTML = (view: IAVFieldView) => {
    return view.icon
        ? unicode2Emoji(view.icon, "b3-menu__icon", true)
        : `<svg class="b3-menu__icon"><use xlink:href="#${getViewIcon(view.type)}"></use></svg>`;
};

const fetchFieldViews = async (avID: string, colId: string) => {
    const response = await fetchSyncPost("/api/av/getAttributeViewFieldViews", {
        avID,
        keyID: colId,
    });
    if (response.code !== 0) {
        return;
    }
    return response.data.views as IAVFieldView[];
};

const getSupportedFieldViews = (views: IAVFieldView[] | undefined, fieldType?: TAVCol) => {
    if (!views) {
        return;
    }
    return fieldType === "block" ? views.filter(view => view.type === "gallery") : views;
};

const setFieldVisibility = (options: {
    protyle: IProtyle;
    avID: string;
    blockID: string;
    colId: string;
    viewIDs: string[];
    hidden: boolean;
}) => {
    transaction(options.protyle, [{
        action: "setAttrViewColHidden",
        id: options.colId,
        avID: options.avID,
        viewIDs: options.viewIDs,
        data: options.hidden,
        blockID: options.blockID,
    }], [{
        action: "setAttrViewColHidden",
        id: options.colId,
        avID: options.avID,
        viewIDs: options.viewIDs,
        data: !options.hidden,
        blockID: options.blockID,
    }]);
};

const updateFieldViews = (views: IAVFieldView[], viewIDs: string[], hidden: boolean) => {
    const changedViewIDs = new Set(viewIDs);
    views.forEach((view) => {
        if (changedViewIDs.has(view.id)) {
            view.hidden = hidden;
        }
    });
};

const getFieldVisibilityItemsHTML = (views: IAVFieldView[], backColId: string) => {
    const visibleViews = views.filter((view) => !view.hidden);
    const hiddenViews = views.filter((view) => view.hidden);
    const getViewHTML = (view: IAVFieldView) => {
        return `<button class="b3-menu__item" data-field-visibility-view-id="${view.id}">
    ${getViewIconHTML(view)}
    <span class="b3-menu__label">${escapeHtml(view.name) || "&nbsp;"}</span>
    ${view.hidden ? "" : '<svg class="b3-menu__checked"><use xlink:href="#iconSelect"></use></svg>'}
</button>`;
    };
    const titleIconHTML = `<span class="block__icon" style="padding: 8px;margin-left: -4px;" data-type="editCol" data-id="${backColId}">
        <svg><use xlink:href="#iconLeft"></use></svg>
    </span>`;
    let html = `<button class="b3-menu__item av__field-visibility-title" data-type="nobg">
    ${titleIconHTML}
    <span class="b3-menu__label ft__center">${window.siyuan.languages.fieldVisibility}</span>
</button>`;
    if (visibleViews.length > 0) {
        html += `<button class="b3-menu__separator"></button>
<button class="b3-menu__item" data-type="nobg">
    <span class="b3-menu__label">${window.siyuan.languages.showCol}</span>
    <span class="block__icon" data-field-visibility-action="hideAll">
        ${window.siyuan.languages.hideInAllViews}
        <span class="fn__space"></span>
        <svg><use xlink:href="#iconEyeoff"></use></svg>
    </span>
</button>
${visibleViews.map(getViewHTML).join("")}`;
    }
    if (hiddenViews.length > 0) {
        html += `<button class="b3-menu__separator"></button>
<button class="b3-menu__item" data-type="nobg">
    <span class="b3-menu__label">${window.siyuan.languages.hideCol}</span>
    <span class="block__icon" data-field-visibility-action="showAll">
        ${window.siyuan.languages.showInAllViews}
        <span class="fn__space"></span>
        <svg><use xlink:href="#iconEye"></use></svg>
    </span>
</button>
${hiddenViews.map(getViewHTML).join("")}`;
    }
    return html;
};

const bindFieldVisibilityEvents = (
    element: Element,
    views: IAVFieldView[],
    updateVisibility: (viewIDs: string[], hidden: boolean) => void,
    back?: () => void
) => {
    if (back) {
        element.querySelector('[data-type="editCol"]')?.addEventListener("click", (event) => {
            event.preventDefault();
            event.stopPropagation();
            back();
        });
    }
    element.querySelectorAll("[data-field-visibility-view-id]").forEach((item: HTMLElement) => {
        item.addEventListener("click", (event) => {
            event.preventDefault();
            event.stopPropagation();
            const view = views.find((viewItem) => viewItem.id === item.dataset.fieldVisibilityViewId);
            if (view) {
                updateVisibility([view.id], !view.hidden);
            }
        });
    });
    const bindAll = (action: "hideAll" | "showAll", hidden: boolean) => {
        element.querySelector(`[data-field-visibility-action="${action}"]`)?.addEventListener("click", (event) => {
            event.preventDefault();
            event.stopPropagation();
            const viewIDs = views.filter((view) => view.hidden !== hidden).map((view) => view.id);
            if (viewIDs.length > 0) {
                updateVisibility(viewIDs, hidden);
            }
        });
    };
    bindAll("hideAll", true);
    bindAll("showAll", false);
};

export const openFieldVisibility = async (options: {
    protyle: IProtyle;
    blockElement: Element;
    colId: string;
    fieldType?: TAVCol;
}) => {
    document.querySelector(".av__panel")?.remove();
    const menu = window.siyuan.menus.menu;
    const menuElement = menu.element;
    const previousItemsElement = menuElement.lastElementChild as HTMLElement;
    const menuRect = menuElement.getBoundingClientRect();
    const previousWidth = menuElement.style.width;
    const previousRemoveCB = menu.removeCB;
    const avID = options.blockElement.getAttribute("data-av-id");
    const views = getSupportedFieldViews(await fetchFieldViews(avID, options.colId), options.fieldType);
    if (!views || menuElement.classList.contains("fn__none") || menuElement.lastElementChild !== previousItemsElement) {
        return;
    }

    const blockID = options.blockElement.getAttribute("data-node-id");
    const currentViewID = options.blockElement.getAttribute(Constants.CUSTOM_SY_AV_VIEW) ||
        options.blockElement.querySelector(".layout-tab-bar .item--focus")?.getAttribute("data-id");
    const itemsElement = document.createElement("div");
    itemsElement.classList.add("b3-menu__items", "av__field-visibility");
    previousItemsElement.classList.add("fn__none");
    menuElement.append(itemsElement);
    menuElement.style.width = `${menuRect.width}px`;

    const restoreMenu = () => {
        itemsElement.remove();
        previousItemsElement.classList.remove("fn__none");
        menuElement.style.width = previousWidth;
        menu.removeCB = previousRemoveCB;
        menu.resetPosition();
    };
    menu.removeCB = () => {
        itemsElement.remove();
        previousItemsElement.classList.remove("fn__none");
        menuElement.style.width = previousWidth;
        previousRemoveCB?.();
    };

    const updatePreviousVisibilityItem = (hidden: boolean) => {
        const previousVisibilityElement =
            previousItemsElement.querySelector('[data-id="hide"]') as HTMLElement;
        if (!previousVisibilityElement) {
            return;
        }
        const visibilityElement = document.createElement("button");
        visibilityElement.className = previousVisibilityElement.className;
        visibilityElement.dataset.id = "hide";
        visibilityElement.innerHTML = `<svg class="b3-menu__icon"><use xlink:href="#${hidden ? "iconEye" : "iconEyeoff"}"></use></svg>
<span class="b3-menu__label">${hidden ? window.siyuan.languages.showCol : window.siyuan.languages.hide}</span>
<svg class="b3-menu__action ariaLabel" data-position="4west" aria-label="${window.siyuan.languages.fieldVisibility}"><use xlink:href="#iconEdit"></use></svg>`;
        visibilityElement.addEventListener("click", (event) => {
            event.preventDefault();
            event.stopPropagation();
            setFieldVisibility({
                protyle: options.protyle,
                avID,
                blockID,
                colId: options.colId,
                viewIDs: [currentViewID],
                hidden: !hidden,
            });
            menu.remove();
        });
        visibilityElement.querySelector(".b3-menu__action").addEventListener("click", (event) => {
            event.preventDefault();
            event.stopImmediatePropagation();
            openFieldVisibility(options);
        });
        previousVisibilityElement.replaceWith(visibilityElement);
    };

    const updateVisibility = (viewIDs: string[], hidden: boolean) => {
        setFieldVisibility({
            protyle: options.protyle,
            avID,
            viewIDs,
            blockID,
            colId: options.colId,
            hidden,
        });
        updateFieldViews(views, viewIDs, hidden);
        if (viewIDs.includes(currentViewID)) {
            updatePreviousVisibilityItem(hidden);
        }
        render();
    };

    const render = () => {
        itemsElement.innerHTML = getFieldVisibilityItemsHTML(views, options.colId);
        bindFieldVisibilityEvents(itemsElement, views, updateVisibility, restoreMenu);
        menu.resetPosition();
    };

    render();
};

export const openFieldVisibilityPanel = async (options: {
    protyle: IProtyle;
    blockElement: Element;
    colId: string;
    menuElement: HTMLElement;
    field: IAVColumn;
}) => {
    const avID = options.blockElement.getAttribute("data-av-id");
    const blockID = options.blockElement.getAttribute("data-node-id");
    const currentViewID = options.blockElement.getAttribute(Constants.CUSTOM_SY_AV_VIEW) ||
        options.blockElement.querySelector(".layout-tab-bar .item--focus")?.getAttribute("data-id");
    const panelRect = options.menuElement.getBoundingClientRect();
    const previousItemsElement = options.menuElement.firstElementChild;
    const views = getSupportedFieldViews(await fetchFieldViews(avID, options.colId), options.field.type);
    if (!views || !options.menuElement.isConnected ||
        options.menuElement.firstElementChild !== previousItemsElement) {
        return;
    }

    const updatePanelViews = (viewIDs: string[], hidden: boolean) => {
        updateFieldViews(views, viewIDs, hidden);
        if (viewIDs.includes(currentViewID)) {
            options.field.hidden = hidden;
        }
    };

    const updateVisibility = (viewIDs: string[], hidden: boolean) => {
        setFieldVisibility({
            protyle: options.protyle,
            avID,
            blockID,
            colId: options.colId,
            viewIDs,
            hidden,
        });
        updatePanelViews(viewIDs, hidden);
        render();
    };

    const render = () => {
        options.menuElement.style.width = `${panelRect.width}px`;
        options.menuElement.innerHTML =
            `<div class="b3-menu__items av__field-visibility">${getFieldVisibilityItemsHTML(views, options.colId)}</div>`;
        setPosition(options.menuElement, panelRect.left, panelRect.top, 0, 0, true);
        bindFieldVisibilityEvents(options.menuElement, views, updateVisibility);
    };

    render();
};
