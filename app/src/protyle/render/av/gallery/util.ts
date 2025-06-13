import {transaction} from "../../../wysiwyg/transaction";
import {Menu} from "../../../../plugin/Menu";
import * as dayjs from "dayjs";
import {hasClosestByClassName} from "../../../util/hasClosest";
import {genCellValueByElement} from "../cell";

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
    options.view.fields.forEach(item => {
        if (item.type === "mAsset") {
            menu.addItem({
                iconHTML: "",
                checked: options.view.coverFromAssetKeyID === item.id,
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
    const galleryElement = options.nodeElement.querySelector(".av__gallery");
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
                data: 0
            }], [{
                action: "setAttrViewCardSize",
                avID,
                blockID,
                data: options.view.cardSize
            }]);
            options.view.cardSize = 0;
            galleryElement.classList.add("av__gallery--small");
            galleryElement.classList.remove("av__gallery--big");
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
                data: 1
            }], [{
                action: "setAttrViewCardSize",
                avID,
                blockID,
                data: options.view.cardSize
            }]);
            options.view.cardSize = 1;
            galleryElement.classList.remove("av__gallery--big", "av__gallery--small");
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
                data: 2
            }], [{
                action: "setAttrViewCardSize",
                avID,
                blockID,
                data: options.view.cardSize
            }]);
            options.view.cardSize = 2;
            galleryElement.classList.remove("av__gallery--small");
            galleryElement.classList.add("av__gallery--big");
            targetNameElement.textContent = window.siyuan.languages.large;
        }
    });
    const rect = options.target.getBoundingClientRect();
    menu.open({x: rect.left, y: rect.bottom});
};

export const openGalleryItemMenu = (options: {
    target: HTMLElement,
    blockElement: HTMLElement,
    protyle: IProtyle,
}) => {
    const menu = new Menu();
    const avID = options.blockElement.getAttribute("data-av-id");
    menu.addItem({
        icon: "iconCopy",
        label: window.siyuan.languages.duplicate,
        click() {
        }
    });
    menu.addItem({
        icon: "iconTrashcan",
        warning: true,
        label: window.siyuan.languages.delete,
        click() {
            const cardElement = hasClosestByClassName(options.target, "av__gallery-item");
            if (cardElement) {
                const newUpdated = dayjs().format("YYYYMMDDHHmmss");
                const blockValue = genCellValueByElement("block", cardElement.querySelector(".av__cell[data-block-id]"));
                transaction(options.protyle, [{
                    action: "removeAttrViewBlock",
                    srcIDs: [cardElement.dataset.id],
                    avID,
                }, {
                    action: "doUpdateUpdated",
                    id: options.blockElement.dataset.nodeId,
                    data: newUpdated,
                }], [{
                    action: "insertAttrViewBlock",
                    avID,
                    previousID: cardElement.previousElementSibling?.getAttribute("data-id") || "",
                    srcs: [{
                        id: cardElement.getAttribute("data-id"),
                        isDetached: blockValue.isDetached,
                        content: blockValue.block.content
                    }],
                    blockID: options.blockElement.dataset.nodeId
                },{
                    action: "doUpdateUpdated",
                    id: options.blockElement.dataset.nodeId,
                    data: options.blockElement.getAttribute("updated")
                }]);
                cardElement.remove()
                options.blockElement.setAttribute("updated", newUpdated);
            }
        }
    });
    const rect = options.target.getBoundingClientRect();
    menu.open({
        x: rect.left,
        y: rect.bottom
    });
};
