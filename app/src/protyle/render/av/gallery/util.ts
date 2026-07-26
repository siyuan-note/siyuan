import {transaction} from "../../../wysiwyg/transaction";
import {Menu} from "../../../../plugin/Menu";
import {hasClosestByClassName} from "../../../util/hasClosest";
import {unicode2Emoji} from "../../../../emoji";
import {getColIconByType} from "../col";
import {avContextmenu} from "../action";
import {Constants} from "../../../../constants";
import {
    CARD_ASPECT_RATIO_MAX,
    CARD_ASPECT_RATIO_MIN,
    CARD_ASPECT_RATIO_PRESETS,
    CARD_WIDTH_MAX,
    CARD_WIDTH_MIN,
    CARD_WIDTH_PRESETS,
    getCardAspectRatio,
    getCardAspectRatioLabel,
    getCardAspectRatioValue,
    getCardWidth
} from "./style";

const updateCardPreview = (nodeElement: Element, property: string, value: string) => {
    const selector = nodeElement.getAttribute("data-av-type") === "kanban" ? ".av__kanban" : ".av__gallery";
    nodeElement.querySelectorAll<HTMLElement>(selector).forEach(item => {
        item.style.setProperty(property, value);
    });
};

export const setGalleryCover = (options: {
    view: IAVGallery
    nodeElement: Element,
    protyle: IProtyle,
    target: HTMLElement
}) => {
    const avID = options.nodeElement.getAttribute("data-av-id");
    const blockID = options.nodeElement.getAttribute("data-node-id");
    const targetNameElement = options.target.querySelector(".b3-menu__accelerator");
    const menu = new Menu();
    const updateRatioDisabled = (disabled: boolean) => {
        (options.target.parentElement.querySelector('[data-type="set-gallery-ratio"]') as HTMLButtonElement).disabled = disabled;
    };
    menu.addItem({
        iconHTML: "",
        checked: options.view.coverFrom === 0,
        label: window.siyuan.languages.calcOperatorNone,
        click() {
            transaction(options.protyle, [{
                action: "setAttrViewCoverFrom",
                avID,
                blockID,
                data: 0
            }], [{
                action: "setAttrViewCoverFrom",
                avID,
                blockID,
                data: options.view.coverFrom
            }]);
            options.view.coverFrom = 0;
            targetNameElement.textContent = window.siyuan.languages.calcOperatorNone;
            updateRatioDisabled(true);
        }
    });
    menu.addItem({
        iconHTML: "",
        checked: options.view.coverFrom === 3,
        label: window.siyuan.languages.contentBlock,
        click() {
            transaction(options.protyle, [{
                action: "setAttrViewCoverFrom",
                avID,
                blockID,
                data: 3
            }], [{
                action: "setAttrViewCoverFrom",
                avID,
                blockID,
                data: options.view.coverFrom
            }]);
            options.view.coverFrom = 3;
            targetNameElement.textContent = window.siyuan.languages.contentBlock;
            updateRatioDisabled(false);
        }
    });
    menu.addItem({
        iconHTML: "",
        checked: options.view.coverFrom === 1,
        label: window.siyuan.languages.contentImage,
        click() {
            transaction(options.protyle, [{
                action: "setAttrViewCoverFrom",
                avID,
                blockID,
                data: 1
            }], [{
                action: "setAttrViewCoverFrom",
                avID,
                blockID,
                data: options.view.coverFrom
            }]);
            options.view.coverFrom = 1;
            targetNameElement.textContent = window.siyuan.languages.contentImage;
            updateRatioDisabled(false);
        }
    });
    let addedSeparator = false;
    options.view.fields.forEach(item => {
        if (item.type === "mAsset") {
            if (!addedSeparator) {
                menu.addSeparator();
                addedSeparator = true;
            }
            menu.addItem({
                iconHTML: item.icon ? unicode2Emoji(item.icon, "b3-menu__icon", true) : `<svg class="b3-menu__icon"><use xlink:href="#${getColIconByType(item.type)}"></use></svg>`,
                checked: options.view.coverFrom === 2 && options.view.coverFromAssetKeyID === item.id,
                label: item.name,
                click() {
                    transaction(options.protyle, [{
                        action: "setAttrViewCoverFrom",
                        avID,
                        blockID,
                        data: 2
                    }, {
                        action: "setAttrViewCoverFromAssetKeyID",
                        avID,
                        blockID,
                        keyID: item.id
                    }], [{
                        action: "setAttrViewCoverFrom",
                        avID,
                        blockID,
                        data: options.view.coverFrom
                    }, {
                        action: "setAttrViewCoverFromAssetKeyID",
                        avID,
                        blockID,
                        keyID: options.view.coverFromAssetKeyID
                    }]);
                    options.view.coverFrom = 2;
                    options.view.coverFromAssetKeyID = item.id;
                    targetNameElement.textContent = item.name;
                    updateRatioDisabled(false);
                }
            });
        }
    });
    const rect = options.target.getBoundingClientRect();
    menu.open({x: rect.left, y: rect.bottom});
};

export const setGallerySize = (options: {
    view: IAVGallery | IAVKanban
    nodeElement: Element,
    protyle: IProtyle,
    target: HTMLElement
}) => {
    const menu = new Menu();
    const avID = options.nodeElement.getAttribute("data-av-id");
    const blockID = options.nodeElement.getAttribute("data-node-id");
    const viewID = options.nodeElement.getAttribute(Constants.CUSTOM_SY_AV_VIEW);
    const targetNameElement = options.target.querySelector(".b3-menu__accelerator");
    const previousWidth = getCardWidth(options.view);
    [window.siyuan.languages.small, window.siyuan.languages.medium, window.siyuan.languages.large].forEach((label, index) => {
        const width = CARD_WIDTH_PRESETS[index];
        menu.addItem({
            iconHTML: "",
            checked: previousWidth === width,
            label,
            click() {
                transaction(options.protyle, [{
                    action: "setAttrViewCardWidth",
                    avID,
                    blockID,
                    data: width,
                    viewID
                }], [{
                    action: "setAttrViewCardWidth",
                    avID,
                    blockID,
                    data: previousWidth,
                    viewID
                }]);
                options.view.cardWidth = width;
                targetNameElement.textContent = `${width}px`;
            }
        });
    });
    menu.addSeparator();
    menu.addItem({
        iconHTML: "",
        type: "readonly",
        label: `<div class="b3-tooltips b3-tooltips__n" aria-label="${previousWidth}px" style="margin: 4px 0;">
    <input class="b3-slider fn__block" max="${CARD_WIDTH_MAX}" min="${CARD_WIDTH_MIN}" step="10" type="range" value="${previousWidth}">
</div>`,
        bind(element) {
            const rangeElement = element.querySelector("input") as HTMLInputElement;
            rangeElement.addEventListener("input", () => {
                updateCardPreview(options.nodeElement, "--b3-av-card-width", `${rangeElement.value}px`);
                rangeElement.parentElement.setAttribute("aria-label", `${rangeElement.value}px`);
            });
            rangeElement.addEventListener("change", () => {
                const width = parseInt(rangeElement.value);
                if (width !== previousWidth) {
                    transaction(options.protyle, [{
                        action: "setAttrViewCardWidth",
                        avID,
                        blockID,
                        data: width,
                        viewID
                    }], [{
                        action: "setAttrViewCardWidth",
                        avID,
                        blockID,
                        data: previousWidth,
                        viewID
                    }]);
                    options.view.cardWidth = width;
                    targetNameElement.textContent = `${width}px`;
                }
                menu.close();
            });
        }
    });
    const rect = options.target.getBoundingClientRect();
    menu.open({x: rect.left, y: rect.bottom});
};

export const setGalleryRatio = (options: {
    view: IAVGallery | IAVKanban
    nodeElement: Element,
    protyle: IProtyle,
    target: HTMLElement
}) => {
    const menu = new Menu();
    const avID = options.nodeElement.getAttribute("data-av-id");
    const blockID = options.nodeElement.getAttribute("data-node-id");
    const viewID = options.nodeElement.getAttribute(Constants.CUSTOM_SY_AV_VIEW);
    const targetNameElement = options.target.querySelector(".b3-menu__accelerator");
    const previousRatio = getCardAspectRatioValue(options.view);
    [0, 1, 2, 3, 4, 5, 6].forEach(ratio => {
        const ratioValue = CARD_ASPECT_RATIO_PRESETS[ratio];
        menu.addItem({
            iconHTML: "",
            checked: Math.abs(previousRatio - ratioValue) < 0.0001,
            label: getCardAspectRatio(ratio),
            click() {
                transaction(options.protyle, [{
                    action: "setAttrViewCardAspectRatioValue",
                    avID,
                    blockID,
                    data: ratioValue,
                    viewID
                }], [{
                    action: "setAttrViewCardAspectRatioValue",
                    avID,
                    blockID,
                    data: previousRatio,
                    viewID
                }]);
                options.view.cardAspectRatioValue = ratioValue;
                targetNameElement.textContent = getCardAspectRatioLabel(ratioValue);
            }
        });
    });
    menu.addSeparator();
    menu.addItem({
        iconHTML: "",
        type: "readonly",
        label: `<div class="b3-tooltips b3-tooltips__n" aria-label="${getCardAspectRatioLabel(previousRatio)}" style="margin: 4px 0;">
    <input class="b3-slider fn__block" max="${CARD_ASPECT_RATIO_MAX}" min="${CARD_ASPECT_RATIO_MIN}" step="0.05" type="range" value="${previousRatio}">
</div>`,
        bind(element) {
            const rangeElement = element.querySelector("input") as HTMLInputElement;
            rangeElement.addEventListener("input", () => {
                const ratio = parseFloat(rangeElement.value);
                updateCardPreview(options.nodeElement, "--b3-av-card-aspect-ratio", rangeElement.value);
                rangeElement.parentElement.setAttribute("aria-label", getCardAspectRatioLabel(ratio));
            });
            rangeElement.addEventListener("change", () => {
                const ratio = parseFloat(rangeElement.value);
                if (ratio !== previousRatio) {
                    transaction(options.protyle, [{
                        action: "setAttrViewCardAspectRatioValue",
                        avID,
                        blockID,
                        data: ratio,
                        viewID
                    }], [{
                        action: "setAttrViewCardAspectRatioValue",
                        avID,
                        blockID,
                        data: previousRatio,
                        viewID
                    }]);
                    options.view.cardAspectRatioValue = ratio;
                    targetNameElement.textContent = getCardAspectRatioLabel(ratio);
                }
                menu.close();
            });
        }
    });
    const rect = options.target.getBoundingClientRect();
    menu.open({x: rect.left, y: rect.bottom});
};

export const openGalleryItemMenu = (options: {
    target: HTMLElement,
    protyle: IProtyle,
    position: {
        x:number,
        y:number
    }
}) => {
    const cardElement = hasClosestByClassName(options.target, "av__gallery-item");
    if (!cardElement) {
        return;
    }
    avContextmenu(options.protyle, cardElement, options.position);
};

export const editGalleryItem = (target: Element) => {
    const itemElement = hasClosestByClassName(target, "av__gallery-item");
    if (itemElement) {
        const fieldsElement = itemElement.querySelector(".av__gallery-fields");
        if (fieldsElement) {
            target.setAttribute("aria-label", window.siyuan.languages[fieldsElement.classList.contains("av__gallery-fields--edit") ? "displayEmptyFields" : "hideEmptyFields"]);
            fieldsElement.classList.toggle("av__gallery-fields--edit");
        }
    }
};
