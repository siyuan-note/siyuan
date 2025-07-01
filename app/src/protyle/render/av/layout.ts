import {transaction} from "../../wysiwyg/transaction";
import {Constants} from "../../../constants";
import {fetchSyncPost} from "../../../util/fetch";
import {getCardAspectRatio} from "./gallery/util";
import {getFieldsByData} from "./view";

export const getLayoutHTML = (data: IAV) => {
    let html = "";
    const view = data.view as IAVGallery;
    if (data.viewType === "gallery") {
        let coverFromTitle = "";
        if (view.coverFrom === 0) {
            coverFromTitle = window.siyuan.languages.calcOperatorNone;
        } else if (view.coverFrom === 1) {
            coverFromTitle = window.siyuan.languages.contentImage;
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
<button class="b3-menu__item" data-type="set-gallery-ratio">
    <span class="fn__flex-center">${window.siyuan.languages.cardAspectRatio}</span>
    <span class="fn__flex-1"></span>
    <span class="b3-menu__accelerator">${getCardAspectRatio(view.cardAspectRatio)}</span>
    <svg class="b3-menu__icon b3-menu__icon--small"><use xlink:href="#iconRight"></use></svg>
</button>
<button class="b3-menu__item" data-type="set-gallery-size">
    <span class="fn__flex-center">${window.siyuan.languages.cardSize}</span>
    <span class="fn__flex-1"></span>
    <span class="b3-menu__accelerator">${view.cardSize === 0 ? window.siyuan.languages.small : (view.cardSize === 1 ? window.siyuan.languages.medium : window.siyuan.languages.large)}</span>
    <svg class="b3-menu__icon b3-menu__icon--small"><use xlink:href="#iconRight"></use></svg>
</button>
<label class="b3-menu__item">
    <span class="fn__flex-center">${window.siyuan.languages.fitImage}</span>
    <span class="fn__space fn__flex-1"></span>
    <input data-type="toggle-gallery-fit" type="checkbox" class="b3-switch b3-switch--menu" ${view.fitImage ? "checked" : ""}>
</label>`;
    }
    return `<div class="b3-menu__items">
    <div class="b3-menu__items">
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
        <span class="fn__flex-center">${window.siyuan.languages.showAllFieldsIcon}</span>
        <span class="fn__space fn__flex-1"></span>
        <input data-type="toggle-gallery-icon" type="checkbox" class="b3-switch b3-switch--menu" ${view.showIcon ? "checked" : ""}>
    </label>
    <label class="b3-menu__item">
        <span class="fn__flex-center">${window.siyuan.languages.wrapAllFields}</span>
        <span class="fn__space fn__flex-1"></span>
        <input data-type="toggle-gallery-wrap" type="checkbox" class="b3-switch b3-switch--menu" ${view.wrapField ? "checked" : ""}>
    </label>
    <button class="b3-menu__item" data-type="set-page-size" data-size="${view.pageSize}">
        <span class="fn__flex-center">${window.siyuan.languages.entryNum}</span>
        <span class="fn__flex-1"></span>
        <span class="b3-menu__accelerator">${view.pageSize === Constants.SIZE_DATABASE_MAZ_SIZE ? window.siyuan.languages.all : view.pageSize}</span>
        <svg class="b3-menu__icon b3-menu__icon--small"><use xlink:href="#iconRight"></use></svg>
    </button>
</div>`;
};

export const bindLayoutEvent = (options: {
    protyle: IProtyle,
    data: IAV,
    menuElement: HTMLElement
    blockElement: Element
}) => {
    const toggleTitleElement = options.menuElement.querySelector('.b3-switch[data-type="toggle-view-title"]') as HTMLInputElement;
    toggleTitleElement.addEventListener("change", () => {
        const avID = options.blockElement.getAttribute("data-av-id");
        const blockID = options.blockElement.getAttribute("data-node-id");
        const checked = toggleTitleElement.checked;
        transaction(options.protyle, [{
            action: "hideAttrViewName",
            avID,
            blockID,
            data: !checked
        }], [{
            action: "hideAttrViewName",
            avID,
            blockID,
            data: checked
        }]);
    });
    const toggleIconElement = options.menuElement.querySelector('.b3-switch[data-type="toggle-gallery-icon"]') as HTMLInputElement;
    toggleIconElement.addEventListener("change", () => {
        const avID = options.blockElement.getAttribute("data-av-id");
        const blockID = options.blockElement.getAttribute("data-node-id");
        const checked = toggleIconElement.checked;
        transaction(options.protyle, [{
            action: "setAttrViewShowIcon",
            avID,
            blockID,
            data: checked
        }], [{
            action: "setAttrViewShowIcon",
            avID,
            blockID,
            data: !checked
        }]);
    });
    const toggleWrapElement = options.menuElement.querySelector('.b3-switch[data-type="toggle-gallery-wrap"]') as HTMLInputElement;
    toggleWrapElement.addEventListener("change", () => {
        const avID = options.blockElement.getAttribute("data-av-id");
        const blockID = options.blockElement.getAttribute("data-node-id");
        const checked = toggleWrapElement.checked;
        transaction(options.protyle, [{
            action: "setAttrViewWrapField",
            avID,
            blockID,
            data: checked
        }], [{
            action: "setAttrViewWrapField",
            avID,
            blockID,
            data: !checked
        }]);
        getFieldsByData(options.data).forEach(item => {
            item.wrap = checked;
        });
        options.data.view.wrapField = checked;
    });
    if (options.data.viewType !== "gallery") {
        return;
    }
    const toggleFitElement = options.menuElement.querySelector('.b3-switch[data-type="toggle-gallery-fit"]') as HTMLInputElement;
    toggleFitElement.addEventListener("change", () => {
        const avID = options.blockElement.getAttribute("data-av-id");
        const blockID = options.blockElement.getAttribute("data-node-id");
        const checked = toggleFitElement.checked;
        transaction(options.protyle, [{
            action: "setAttrViewFitImage",
            avID,
            blockID,
            data: checked
        }], [{
            action: "setAttrViewFitImage",
            avID,
            blockID,
            data: !checked
        }]);
        options.blockElement.querySelectorAll(".av__gallery-img").forEach(item => {
            if (checked) {
                item.classList.add("av__gallery-img--fit");
            } else {
                item.classList.remove("av__gallery-img--fit");
            }
        });
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
    bindLayoutEvent({
        protyle: options.protyle,
        data: response.data,
        menuElement,
        blockElement: options.nodeElement
    });
    options.target.removeAttribute("data-load");
    return response.data;
};
