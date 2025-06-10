import {transaction} from "../../wysiwyg/transaction";

export const getLayoutHTML = (data: IAV) => {
    let html = "";
    if (data.viewType === "gallery") {
        html = `<label class="b3-menu__item">
    <span class="fn__flex-center">${window.siyuan.languages.showTitle}</span>
    <span class="fn__space fn__flex-1"></span>
    <input data-type="toggle-view-title" type="checkbox" class="b3-switch b3-switch--menu" ${data.view.hideAttrViewName ? "" : "checked"}>
</label>`
        // calcOperatorNone
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
            <div class="av__layout-item${data.viewType === "table" ? " av__layout-item--select" : ""}">
                <svg><use xlink:href="#iconTable"></use></svg>
                <div class="fn__hr"></div>
                <div>${window.siyuan.languages.table}</div>
            </div>
            <div class="av__layout-item${data.viewType === "gallery" ? " av__layout-item--select" : ""}">
                <svg><use xlink:href="#iconGallery"></use></svg>
                <div class="fn__hr"></div>
                <div>${window.siyuan.languages.gallery}</div>
            </div>
        </div>
    </button>
    <label class="b3-menu__item">
        <span class="fn__flex-center">${window.siyuan.languages.showTitle}</span>
        <span class="fn__space fn__flex-1"></span>
        <input data-type="toggle-view-title" type="checkbox" class="b3-switch b3-switch--menu" ${data.view.hideAttrViewName ? "" : "checked"}>
    </label>
    ${html}
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
        if (!toggleTitleElement.checked) {
            // hide
            transaction(options.protyle, [{
                action: "hideAttrViewName",
                avID,
                blockID,
                data: true
            }], [{
                action: "hideAttrViewName",
                avID,
                blockID,
                data: false
            }]);
            options.blockElement.querySelector(".av__title").classList.add("fn__none");
        } else {
            transaction(options.protyle, [{
                action: "hideAttrViewName",
                avID,
                blockID,
                data: false
            }], [{
                action: "hideAttrViewName",
                avID,
                blockID,
                data: true
            }]);
            options.blockElement.querySelector(".av__title").classList.remove("fn__none");
        }
    });
};
