import {Menu} from "../../../plugin/Menu";
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

export const openFieldVisibility = async (options: {
    protyle: IProtyle;
    blockElement: Element;
    colId: string;
    anchorElement?: Element;
}) => {
    const anchorElement = options.anchorElement || options.blockElement.querySelector(".av__views");
    const rect = anchorElement?.getBoundingClientRect();
    const position = rect ? {
        x: rect.left,
        y: rect.bottom,
        h: rect.height,
    } : undefined;
    if (!position) {
        return;
    }
    document.querySelector(".av__panel")?.remove();
    const avID = options.blockElement.getAttribute("data-av-id");
    const views = await fetchFieldViews(avID, options.colId);
    if (!views) {
        return;
    }

    const menu = new Menu(Constants.MENU_AV_FIELD_VISIBILITY);
    if (menu.isOpen) {
        return;
    }
    const blockID = options.blockElement.getAttribute("data-node-id");
    const currentViewID = options.blockElement.getAttribute(Constants.CUSTOM_SY_AV_VIEW) ||
        options.blockElement.querySelector(".layout-tab-bar .item--focus")?.getAttribute("data-id");
    let opened = false;

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
        render();
    };

    const addViewItem = (view: IAVFieldView) => {
        menu.addItem({
            iconHTML: getViewIconHTML(view),
            label: escapeHtml(view.name) || "&nbsp;",
            checked: !view.hidden,
            current: view.id === currentViewID,
            click() {
                updateVisibility([view.id], !view.hidden);
                return true;
            }
        });
    };

    const render = () => {
        menu.element.lastElementChild.innerHTML = "";
        menu.addItem({
            type: "readonly",
            icon: "iconEye",
            label: window.siyuan.languages.fieldVisibility,
        });

        const visibleViews = views.filter((view) => !view.hidden);
        const hiddenViews = views.filter((view) => view.hidden);
        if (visibleViews.length > 0) {
            menu.addSeparator();
            menu.addItem({
                type: "readonly",
                icon: "",
                label: window.siyuan.languages.showCol,
            });
            menu.addItem({
                icon: "iconEyeoff",
                label: window.siyuan.languages.hideInAllViews,
                click() {
                    updateVisibility(visibleViews.map((view) => view.id), true);
                    return true;
                }
            });
            visibleViews.forEach(addViewItem);
        }
        if (hiddenViews.length > 0) {
            menu.addSeparator();
            menu.addItem({
                type: "readonly",
                icon: "",
                label: window.siyuan.languages.hideCol,
            });
            menu.addItem({
                icon: "iconEye",
                label: window.siyuan.languages.showInAllViews,
                click() {
                    updateVisibility(hiddenViews.map((view) => view.id), false);
                    return true;
                }
            });
            hiddenViews.forEach(addViewItem);
        }

        if (opened) {
            window.siyuan.menus.menu.resetPosition();
        } else {
            menu.open(position);
            opened = true;
        }
    };

    render();
};

const getFieldVisibilityPanelHTML = (views: IAVFieldView[], colId: string, currentViewID: string) => {
    const visibleViews = views.filter((view) => !view.hidden);
    const hiddenViews = views.filter((view) => view.hidden);
    const getViewHTML = (view: IAVFieldView) => {
        return `<button class="b3-menu__item${view.id === currentViewID ? " b3-menu__item--selected" : ""}" data-field-visibility-view-id="${view.id}">
    ${getViewIconHTML(view)}
    <span class="b3-menu__label">${escapeHtml(view.name) || "&nbsp;"}</span>
    ${view.hidden ? "" : '<svg class="b3-menu__checked"><use xlink:href="#iconSelect"></use></svg>'}
</button>`;
    };
    let html = `<button class="b3-menu__item" data-type="nobg">
    <span class="block__icon" style="padding: 8px;margin-left: -4px;" data-type="editCol" data-id="${colId}">
        <svg><use xlink:href="#iconLeft"></use></svg>
    </span>
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
    return `<div class="b3-menu__items">${html}</div>`;
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
    const views = await fetchFieldViews(avID, options.colId);
    if (!views || !options.menuElement.isConnected) {
        return;
    }

    const updatePanelViews = (viewIDs: string[], hidden: boolean) => {
        updateFieldViews(views, viewIDs, hidden);
        if (viewIDs.includes(currentViewID)) {
            options.field.hidden = hidden;
        }
    };

    const render = () => {
        options.menuElement.style.width = `${panelRect.width}px`;
        options.menuElement.innerHTML = getFieldVisibilityPanelHTML(views, options.colId, currentViewID);
        setPosition(options.menuElement, panelRect.left, panelRect.top, 0, 0, true);

        options.menuElement.querySelectorAll("[data-field-visibility-view-id]").forEach((item: HTMLElement) => {
            item.addEventListener("click", (event) => {
                event.preventDefault();
                event.stopPropagation();
                const view = views.find((viewItem) => viewItem.id === item.dataset.fieldVisibilityViewId);
                if (!view) {
                    return;
                }
                setFieldVisibility({
                    protyle: options.protyle,
                    avID,
                    blockID,
                    colId: options.colId,
                    viewIDs: [view.id],
                    hidden: !view.hidden,
                });
                updatePanelViews([view.id], !view.hidden);
                render();
            });
        });
        const bindAll = (action: "hideAll" | "showAll", hidden: boolean) => {
            options.menuElement.querySelector(`[data-field-visibility-action="${action}"]`)?.addEventListener("click", (event) => {
                event.preventDefault();
                event.stopPropagation();
                const viewIDs = views.filter((view) => view.hidden !== hidden).map((view) => view.id);
                if (viewIDs.length < 1) {
                    return;
                }
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
            });
        };
        bindAll("hideAll", true);
        bindAll("showAll", false);
    };

    render();
};
