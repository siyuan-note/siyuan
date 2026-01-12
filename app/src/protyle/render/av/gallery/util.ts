import {transaction} from "../../../wysiwyg/transaction";
import {Menu} from "../../../../plugin/Menu";
import {hasClosestByClassName} from "../../../util/hasClosest";
import {unicode2Emoji} from "../../../../emoji";
import {getColIconByType} from "../col";
import {avContextmenu} from "../action";
import {Constants} from "../../../../constants";

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
                }
            });
        }
    });
    const rect = options.target.getBoundingClientRect();
    menu.open({x: rect.left, y: rect.bottom});
};

export const setGallerySize = (options: {
    view: IAVGallery
    nodeElement: Element,
    protyle: IProtyle,
    target: HTMLElement
}) => {
    const menu = new Menu();
    const avID = options.nodeElement.getAttribute("data-av-id");
    const blockID = options.nodeElement.getAttribute("data-node-id");
    const viewID = options.nodeElement.getAttribute(Constants.CUSTOM_SY_AV_VIEW);
    const targetNameElement = options.target.querySelector(".b3-menu__accelerator");
    menu.addItem({
        iconHTML: "",
        checked: options.view.cardSize === 0,
        label: window.siyuan.languages.small,
        click() {
            transaction(options.protyle, [{
                action: "setAttrViewCardSize",
                avID,
                blockID,
                data: 0,
                viewID
            }], [{
                action: "setAttrViewCardSize",
                avID,
                blockID,
                data: options.view.cardSize,
                viewID
            }]);
            options.view.cardSize = 0;
            targetNameElement.textContent = window.siyuan.languages.small;
        }
    });
    menu.addItem({
        iconHTML: "",
        checked: options.view.cardSize === 1,
        label: window.siyuan.languages.medium,
        click() {
            transaction(options.protyle, [{
                action: "setAttrViewCardSize",
                avID,
                blockID,
                data: 1,
                viewID
            }], [{
                action: "setAttrViewCardSize",
                avID,
                blockID,
                data: options.view.cardSize,
                viewID
            }]);
            options.view.cardSize = 1;
            targetNameElement.textContent = window.siyuan.languages.medium;
        }
    });
    menu.addItem({
        iconHTML: "",
        checked: options.view.cardSize === 2,
        label: window.siyuan.languages.large,
        click() {
            transaction(options.protyle, [{
                action: "setAttrViewCardSize",
                avID,
                blockID,
                data: 2,
                viewID
            }], [{
                action: "setAttrViewCardSize",
                avID,
                blockID,
                data: options.view.cardSize,
                viewID
            }]);
            options.view.cardSize = 2;
            targetNameElement.textContent = window.siyuan.languages.large;
        }
    });
    const rect = options.target.getBoundingClientRect();
    menu.open({x: rect.left, y: rect.bottom});
};

export const getCardAspectRatio = (ratio: number) => {
    switch (ratio) {
        case 0:
            return "16:9";
        case 1:
            return "9:16";
        case 2:
            return "4:3";
        case 3:
            return "3:4";
        case 4:
            return "3:2";
        case 5:
            return "2:3";
        case 6:
            return "1:1";
    }
    return "16:9";
};

export const setGalleryRatio = (options: {
    view: IAVGallery
    nodeElement: Element,
    protyle: IProtyle,
    target: HTMLElement
}) => {
    const menu = new Menu();
    const avID = options.nodeElement.getAttribute("data-av-id");
    const blockID = options.nodeElement.getAttribute("data-node-id");
    const viewID = options.nodeElement.getAttribute(Constants.CUSTOM_SY_AV_VIEW);
    const targetNameElement = options.target.querySelector(".b3-menu__accelerator");
    [0, 1, 2, 3, 4, 5, 6].forEach(ratio => {
        menu.addItem({
            iconHTML: "",
            checked: options.view.cardAspectRatio === ratio,
            label: getCardAspectRatio(ratio),
            click() {
                transaction(options.protyle, [{
                    action: "setAttrViewCardAspectRatio",
                    avID,
                    blockID,
                    data: ratio,
                    viewID
                }], [{
                    action: "setAttrViewCardAspectRatio",
                    avID,
                    blockID,
                    data: options.view.cardAspectRatio,
                    viewID
                }]);
                options.view.cardAspectRatio = ratio;
                targetNameElement.textContent = getCardAspectRatio(ratio);
            }
        });
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
