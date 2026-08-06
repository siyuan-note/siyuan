import {transaction} from "../../wysiwyg/transaction";
import {Constants} from "../../../constants";
import {fetchSyncPost} from "../../../util/fetch";
import {setPosition} from "../../../util/setPosition";
import {getCardAspectRatioLabel, getCardAspectRatioValue, getCardWidth} from "./gallery/style";
import {getFieldsByData} from "./view";
import {unicode2Emoji} from "../../../emoji";
import {getColIconByType} from "./col";
import {escapeHtml} from "../../../util/escape";
import {CARD_LAYOUT_COMPACT, CARD_LAYOUT_LIST} from "./gallery/cardLayout";
import {Menu} from "../../../plugin/Menu";

const getCardLayoutHTML = (view: IAVGallery | IAVKanban) => {
    return `<button class="b3-menu__item" data-type="set-card-layout">
    <span class="fn__flex-center">${window.siyuan.languages.cardLayout}</span>
    <span class="fn__flex-1"></span>
    <span class="b3-menu__accelerator">${view.cardLayout === CARD_LAYOUT_COMPACT ? window.siyuan.languages.compact : window.siyuan.languages.list1}</span>
    <svg class="b3-menu__icon b3-menu__icon--small"><use xlink:href="#iconRight"></use></svg>
</button>
${view.cardLayout === CARD_LAYOUT_COMPACT ? `<button class="b3-menu__item" data-type="go-card-full-row">
    <span class="fn__flex-center">${window.siyuan.languages.fullRow}</span>
    <span class="fn__flex-1"></span>
    <svg class="b3-menu__icon b3-menu__icon--small"><use xlink:href="#iconRight"></use></svg>
</button>` : ""}`;
};

const getCardFullRowHTML = (view: IAVGallery | IAVKanban) => {
    let fieldsHTML = "";
    view.fields.forEach((field) => {
        if (field.hidden) {
            return;
        }
        const disabled = field.type === "block" || view.displayFieldName;
        const checked = disabled || field.fullRow;
        fieldsHTML += `<label class="b3-menu__item">
    ${field.icon ? unicode2Emoji(field.icon, "b3-menu__icon", true) : `<svg class="b3-menu__icon"><use xlink:href="#${getColIconByType(field.type)}"></use></svg>`}
    <span class="b3-menu__label">${escapeHtml(field.name) || "&nbsp;"}</span>
    <input data-type="toggle-card-full-row" data-id="${field.id}" type="checkbox" class="b3-switch b3-switch--menu" ${checked ? "checked" : ""}${disabled ? " disabled" : ""}>
</label>`;
    });
    return `<div class="b3-menu__items">
    <button class="b3-menu__item" data-type="nobg">
        <span class="block__icon" style="padding: 8px;margin-left: -4px;" data-type="go-layout">
            <svg><use xlink:href="#iconLeft"></use></svg>
        </span>
        <span class="b3-menu__label ft__center">${window.siyuan.languages.fullRow}</span>
    </button>
    <button class="b3-menu__separator"></button>
    ${fieldsHTML}
</div>`;
};

export const getLayoutHTML = (data: IAV) => {
    let html = "";
    const view = data.view as IAVKanban;
    if (["gallery", "kanban"].includes(data.viewType)) {
        let coverFromTitle = "";
        if (view.coverFrom === 0) {
            coverFromTitle = window.siyuan.languages.calcOperatorNone;
        } else if (view.coverFrom === 1) {
            coverFromTitle = window.siyuan.languages.contentImage;
        } else if (view.coverFrom === 3) {
            coverFromTitle = window.siyuan.languages.contentBlock;
        } else {
            view.fields.find(item => {
                if (item.type === "mAsset" && item.id === view.coverFromAssetKeyID) {
                    coverFromTitle = item.name;
                    return true;
                }
            });
        }
        html = `<button class="b3-menu__item" data-type="set-gallery-cover">
    <span class="fn__flex-center">${window.siyuan.languages.cardPreview1}</span>
    <span class="fn__flex-1"></span>
    <span class="b3-menu__accelerator">${coverFromTitle}</span>
    <svg class="b3-menu__icon b3-menu__icon--small"><use xlink:href="#iconRight"></use></svg>
</button>
<button class="b3-menu__item" data-type="set-gallery-ratio"${view.coverFrom === 0 ? " disabled" : ""}>
    <span class="fn__flex-center">${window.siyuan.languages.cardAspectRatio}</span>
    <span class="fn__flex-1"></span>
    <span class="b3-menu__accelerator">${getCardAspectRatioLabel(getCardAspectRatioValue(view))}</span>
    <svg class="b3-menu__icon b3-menu__icon--small"><use xlink:href="#iconRight"></use></svg>
</button>
<button class="b3-menu__item" data-type="set-gallery-size">
    <span class="fn__flex-center">${window.siyuan.languages.cardSize}</span>
    <span class="fn__flex-1"></span>
    <span class="b3-menu__accelerator">${getCardWidth(view)}px</span>
    <svg class="b3-menu__icon b3-menu__icon--small"><use xlink:href="#iconRight"></use></svg>
</button>
<label class="b3-menu__item">
    <span class="fn__flex-center">${window.siyuan.languages.fitImage}</span>
    <span class="fn__space fn__flex-1"></span>
    <input data-type="toggle-gallery-fit" type="checkbox" class="b3-switch b3-switch--menu" ${view.fitImage ? "checked" : ""}>
</label>
<label class="b3-menu__item">
    <span class="fn__flex-center">${window.siyuan.languages.displayFieldName}</span>
    <span class="fn__space fn__flex-1"></span>
    <input data-type="toggle-gallery-name" type="checkbox" class="b3-switch b3-switch--menu" ${view.displayFieldName ? "checked" : ""}>
</label>
<label class="b3-menu__item">
    <span class="fn__flex-center">${window.siyuan.languages.displayEmptyFields}</span>
    <span class="fn__space fn__flex-1"></span>
    <input data-type="toggle-gallery-empty" type="checkbox" class="b3-switch b3-switch--menu" ${view.displayEmptyFields ? "checked" : ""}>
</label>`;
    }
    html = `<div class="b3-menu__items">
    <button class="b3-menu__item" data-type="nobg">
        <span class="block__icon" style="padding: 8px;margin-left: -4px;" data-type="go-config">
            <svg><use xlink:href="#iconLeft"></use></svg>
        </span>
        <span class="b3-menu__label ft__center">${window.siyuan.languages.layout}</span>
    </button>
    <button class="b3-menu__separator"></button>
    <button class="b3-menu__item" data-type="nobg">
        <div class="av__layout">
            <div data-type="set-layout" data-view-type="table" class="av__layout-item${data.viewType === "table" ? " av__layout-item--select" : ""}">
                <svg><use xlink:href="#iconTable"></use></svg>
                <div class="fn__hr"></div>
                <div>${window.siyuan.languages.table}</div>
            </div>
            <div data-type="set-layout" data-view-type="kanban" class="av__layout-item${data.viewType === "kanban" ? " av__layout-item--select" : ""}">
                <svg><use xlink:href="#iconBoard"></use></svg>
                <div class="fn__hr"></div>
                <div>${window.siyuan.languages.kanban}</div>
            </div>
            <div data-type="set-layout" data-view-type="gallery" class="av__layout-item${data.viewType === "gallery" ? " av__layout-item--select" : ""}">
                <svg><use xlink:href="#iconGallery"></use></svg>
                <div class="fn__hr"></div>
                <div>${window.siyuan.languages.gallery}</div>
            </div>
        </div>
    </button>
    <label class="b3-menu__item">
        <span class="fn__flex-center">${window.siyuan.languages.showTitle}</span>
        <span class="fn__space fn__flex-1"></span>
        <input data-type="toggle-view-title" type="checkbox" class="b3-switch b3-switch--menu" ${view.hideAttrViewName ? "" : "checked"}>
    </label>
    ${html}
    <label class="b3-menu__item">
        <span class="fn__flex-center">${window.siyuan.languages.showAllEntriesIcons}</span>
        <span class="fn__space fn__flex-1"></span>
        <input data-type="toggle-entries-icons" type="checkbox" class="b3-switch b3-switch--menu" ${view.showIcon ? "checked" : ""}>
    </label>
    <label class="b3-menu__item">
        <span class="fn__flex-center">${window.siyuan.languages.wrapAllFields}</span>
        <span class="fn__space fn__flex-1"></span>
        <input data-type="toggle-entries-wrap" type="checkbox" class="b3-switch b3-switch--menu" ${view.wrapField ? "checked" : ""}>
    </label>`;
    if (data.viewType === "kanban" && ["select", "mSelect"].includes(data.view.groups?.[0]?.groupValue?.type)) {
        html += `<label class="b3-menu__item">
    <span class="fn__flex-center">${window.siyuan.languages.useBackground}</span>
    <span class="fn__space fn__flex-1"></span>
    <input data-type="toggle-kanban-bg" type="checkbox" class="b3-switch b3-switch--menu" ${view.fillColBackgroundColor ? "checked" : ""}>
</label>`;
    }
    return html + `<button class="b3-menu__item" data-type="set-page-size" data-size="${view.pageSize}">
        <span class="fn__flex-center">${window.siyuan.languages.entryNum}</span>
        <span class="fn__flex-1"></span>
        <span class="b3-menu__accelerator">${view.pageSize === Constants.SIZE_DATABASE_MAZ_SIZE ? window.siyuan.languages.all : view.pageSize}</span>
        <svg class="b3-menu__icon b3-menu__icon--small"><use xlink:href="#iconRight"></use></svg>
    </button>
    ${["gallery", "kanban"].includes(data.viewType) ? getCardLayoutHTML(view) : ""}
</div>`;
};

export const bindLayoutEvent = (options: {
    protyle: IProtyle,
    data: IAV,
    menuElement: HTMLElement
    blockElement: Element
}) => {
    const avID = options.blockElement.getAttribute("data-av-id");
    const blockID = options.blockElement.getAttribute("data-node-id");
    const viewID = options.data.viewID || options.blockElement.getAttribute(Constants.CUSTOM_SY_AV_VIEW);
    const rerender = () => {
        options.menuElement.innerHTML = getLayoutHTML(options.data);
        const tabRect = options.blockElement.querySelector(".av__views").getBoundingClientRect();
        setPosition(options.menuElement, tabRect.right - options.menuElement.clientWidth,
            tabRect.bottom, tabRect.height, 0, true);
        bindLayoutEvent(options);
    };
    const bindCardFullRowEvents = () => {
        options.menuElement.querySelectorAll('input[data-type="toggle-card-full-row"]').forEach((item: HTMLInputElement) => {
            item.addEventListener("change", () => {
                const field = (options.data.view as IAVGallery | IAVKanban).fields.find((fieldItem) => {
                    return fieldItem.id === item.dataset.id;
                });
                if (!field) {
                    return;
                }
                const oldFullRow = !!field.fullRow;
                transaction(options.protyle, [{
                    action: "setAttrViewColFullRow",
                    id: field.id,
                    avID,
                    blockID,
                    data: item.checked,
                    viewID
                }], [{
                    action: "setAttrViewColFullRow",
                    id: field.id,
                    avID,
                    blockID,
                    data: oldFullRow,
                    viewID
                }]);
                field.fullRow = item.checked;
            });
        });
    };
    const toggleTitleElement = options.menuElement.querySelector('.b3-switch[data-type="toggle-view-title"]') as HTMLInputElement;
    toggleTitleElement.addEventListener("change", () => {
        const checked = toggleTitleElement.checked;
        transaction(options.protyle, [{
            action: "hideAttrViewName",
            avID,
            blockID,
            data: !checked,
            viewID
        }], [{
            action: "hideAttrViewName",
            avID,
            blockID,
            data: checked,
            viewID
        }]);
        options.data.view.hideAttrViewName = !checked;
    });
    const toggleIconElement = options.menuElement.querySelector('.b3-switch[data-type="toggle-entries-icons"]') as HTMLInputElement;
    toggleIconElement.addEventListener("change", () => {
        const checked = toggleIconElement.checked;
        transaction(options.protyle, [{
            action: "setAttrViewShowIcon",
            avID,
            blockID,
            data: checked,
            viewID
        }], [{
            action: "setAttrViewShowIcon",
            avID,
            blockID,
            data: !checked,
            viewID
        }]);
        options.data.view.showIcon = checked;
    });
    const toggleWrapElement = options.menuElement.querySelector('.b3-switch[data-type="toggle-entries-wrap"]') as HTMLInputElement;
    toggleWrapElement.addEventListener("change", () => {
        const checked = toggleWrapElement.checked;
        transaction(options.protyle, [{
            action: "setAttrViewWrapField",
            avID,
            blockID,
            data: checked,
            viewID
        }], [{
            action: "setAttrViewWrapField",
            avID,
            blockID,
            data: !checked,
            viewID
        }]);
        getFieldsByData(options.data).forEach(item => {
            item.wrap = checked;
        });
        options.data.view.wrapField = checked;
    });
    if (options.data.viewType === "table") {
        return;
    }
    const cardLayoutElement = options.menuElement.querySelector('[data-type="set-card-layout"]') as HTMLButtonElement;
    cardLayoutElement.addEventListener("click", (event) => {
        const view = options.data.view as IAVGallery | IAVKanban;
        const oldLayout = view.cardLayout;
        const menu = new Menu();
        [{
            layout: CARD_LAYOUT_LIST,
            label: window.siyuan.languages.list1
        }, {
            layout: CARD_LAYOUT_COMPACT,
            label: window.siyuan.languages.compact
        }].forEach((item) => {
            menu.addItem({
                iconHTML: "",
                checked: oldLayout === item.layout,
                label: item.label,
                click() {
                    if (item.layout === oldLayout) {
                        return;
                    }
                    transaction(options.protyle, [{
                        action: "setAttrViewCardLayout",
                        avID,
                        blockID,
                        data: item.layout,
                        viewID
                    }], [{
                        action: "setAttrViewCardLayout",
                        avID,
                        blockID,
                        data: oldLayout,
                        viewID
                    }]);
                    view.cardLayout = item.layout;
                    rerender();
                }
            });
        });
        const rect = cardLayoutElement.getBoundingClientRect();
        menu.open({x: rect.left, y: rect.bottom});
        event.preventDefault();
        event.stopPropagation();
    });
    options.menuElement.querySelector('[data-type="go-card-full-row"]')?.addEventListener("click", (event) => {
        const view = options.data.view as IAVGallery | IAVKanban;
        options.menuElement.innerHTML = getCardFullRowHTML(view);
        const tabRect = options.blockElement.querySelector(".av__views").getBoundingClientRect();
        setPosition(options.menuElement, tabRect.right - options.menuElement.clientWidth,
            tabRect.bottom, tabRect.height, 0, true);
        bindCardFullRowEvents();
        event.preventDefault();
        event.stopPropagation();
    });
    const toggleFitElement = options.menuElement.querySelector('.b3-switch[data-type="toggle-gallery-fit"]') as HTMLInputElement;
    toggleFitElement.addEventListener("change", () => {
        const checked = toggleFitElement.checked;
        transaction(options.protyle, [{
            action: "setAttrViewFitImage",
            avID,
            blockID,
            data: checked,
            viewID
        }], [{
            action: "setAttrViewFitImage",
            avID,
            blockID,
            data: !checked,
            viewID
        }]);
        (options.data.view as IAVGallery).fitImage = checked;
    });
    const toggleNameElement = options.menuElement.querySelector('.b3-switch[data-type="toggle-gallery-name"]') as HTMLInputElement;
    toggleNameElement.addEventListener("change", () => {
        const checked = toggleNameElement.checked;
        transaction(options.protyle, [{
            action: "setAttrViewDisplayFieldName",
            avID,
            blockID,
            data: checked,
            viewID
        }], [{
            action: "setAttrViewDisplayFieldName",
            avID,
            blockID,
            data: !checked,
            viewID
        }]);
        (options.data.view as IAVGallery | IAVKanban).displayFieldName = checked;
        rerender();
    });
    const toggleEmptyElement = options.menuElement.querySelector('.b3-switch[data-type="toggle-gallery-empty"]') as HTMLInputElement;
    toggleEmptyElement.addEventListener("change", () => {
        const checked = toggleEmptyElement.checked;
        transaction(options.protyle, [{
            action: "setAttrViewDisplayEmptyFields",
            avID,
            blockID,
            data: checked,
            viewID
        }], [{
            action: "setAttrViewDisplayEmptyFields",
            avID,
            blockID,
            data: !checked,
            viewID
        }]);
        (options.data.view as IAVGallery | IAVKanban).displayEmptyFields = checked;
    });
    if (options.data.viewType === "gallery") {
        return;
    }
    const toggleBgElement = options.menuElement.querySelector('.b3-switch[data-type="toggle-kanban-bg"]') as HTMLInputElement;
    toggleBgElement?.addEventListener("change", () => {
        const checked = toggleBgElement.checked;
        transaction(options.protyle, [{
            action: "setAttrViewFillColBackgroundColor",
            avID,
            blockID,
            data: checked,
            viewID
        }], [{
            action: "setAttrViewFillColBackgroundColor",
            avID,
            blockID,
            data: !checked,
            viewID
        }]);
        (options.data.view as IAVKanban).fillColBackgroundColor = checked;
    });
};

export const updateLayout = async (options: {
    data: IAV
    nodeElement: Element,
    protyle: IProtyle,
    target: HTMLElement
}) => {
    if (options.target.classList.contains("av__layout-item--select") || options.target.dataset.load === "true") {
        return;
    }
    options.target.dataset.load = "true";
    options.target.parentElement.querySelector(".av__layout-item--select").classList.remove("av__layout-item--select");
    options.target.classList.add("av__layout-item--select");
    const response = await fetchSyncPost("/api/av/changeAttrViewLayout", {
        blockID: options.nodeElement.getAttribute("data-node-id"),
        avID: options.nodeElement.getAttribute("data-av-id"),
        layoutType: options.target.getAttribute("data-view-type")
    });
    const menuElement = document.querySelector(".av__panel").lastElementChild as HTMLElement;
    menuElement.innerHTML = getLayoutHTML(response.data);
    // 切换布局类型后菜单高度变化（如表格→看板），需重新定位避免底部溢出视窗
    const tabRect = options.nodeElement.querySelector(".av__views").getBoundingClientRect();
    setPosition(menuElement, tabRect.right - menuElement.clientWidth, tabRect.bottom, tabRect.height, 0, true);
    bindLayoutEvent({
        protyle: options.protyle,
        data: response.data,
        menuElement,
        blockElement: options.nodeElement
    });
    options.target.removeAttribute("data-load");
    return response.data;
};
