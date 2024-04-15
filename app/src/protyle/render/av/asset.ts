import {Menu} from "../../../plugin/Menu";
import {transaction} from "../../wysiwyg/transaction";
import {updateAttrViewCellAnimation} from "./action";
import {isMobile} from "../../../util/functions";
import {Constants} from "../../../constants";
import {uploadFiles} from "../../upload";
import {pathPosix} from "../../../util/pathName";
import {openMenu} from "../../../menus/commonMenuItem";
import {MenuItem} from "../../../menus/Menu";
import {exportAsset} from "../../../menus/util";
import {setPosition} from "../../../util/setPosition";
import {previewImage} from "../../preview/image";
import {genAVValueHTML} from "./blockAttr";
import {hideMessage, showMessage} from "../../../dialog/message";
import {fetchPost} from "../../../util/fetch";
import {hasClosestBlock, hasClosestByClassName} from "../../util/hasClosest";
import {genCellValueByElement, getTypeByCellElement} from "./cell";

export const bindAssetEvent = (options: {
    protyle: IProtyle,
    data: IAV,
    menuElement: HTMLElement,
    cellElements: HTMLElement[],
    blockElement: Element
}) => {
    options.menuElement.querySelector("input").addEventListener("change", (event: InputEvent & {
        target: HTMLInputElement
    }) => {
        if (event.target.files.length === 0) {
            return;
        }
        uploadFiles(options.protyle, event.target.files, event.target, (res) => {
            const resData = JSON.parse(res);
            const value: IAVCellAssetValue[] = [];
            Object.keys(resData.data.succMap).forEach((key) => {
                value.push({
                    name: key,
                    content: resData.data.succMap[key],
                    type: Constants.SIYUAN_ASSETS_IMAGE.includes(pathPosix().extname(resData.data.succMap[key]).toLowerCase()) ? "image" : "file"
                });
            });
            updateAssetCell({
                protyle: options.protyle,
                data: options.data,
                cellElements: options.cellElements,
                addValue: value,
                blockElement: options.blockElement
            });
        });
    });
};

export const getAssetHTML = (cellElements: HTMLElement[]) => {
    let html = "";
    genCellValueByElement("mAsset", cellElements[0]).mAsset.forEach((item, index) => {
        if (!item.content) {
            return;
        }
        let contentHTML;
        if (item.type === "image") {
            contentHTML = `<span data-type="openAssetItem" class="fn__flex-1 ariaLabel" aria-label="${item.content}">
    <img style="max-height: 180px;max-width: 360px;border-radius: var(--b3-border-radius);margin: 4px 0;" src="${item.content}"/>
</span>`;
        } else {
            contentHTML = `<span data-type="openAssetItem" class="fn__ellipsis b3-menu__label ariaLabel" aria-label="${item.content}" style="max-width: 360px">${item.name}</span>`;
        }

        html += `<button class="b3-menu__item" draggable="true" data-index="${index}" data-name="${item.name}" data-type="${item.type}" data-content="${item.content}">
<svg class="b3-menu__icon fn__grab"><use xlink:href="#iconDrag"></use></svg>
${contentHTML}
<svg class="b3-menu__action" data-type="editAssetItem"><use xlink:href="#iconEdit"></use></svg>
</button>`;
    });
    return `<div class="b3-menu__items">
    ${html}
    <button data-type="addAssetExist" class="b3-menu__item">
        <svg class="b3-menu__icon"><use xlink:href="#iconImage"></use></svg>
        <span class="b3-menu__label">${window.siyuan.languages.assets}</span>
    </button>
    <button class="b3-menu__item">
        <svg class="b3-menu__icon"><use xlink:href="#iconDownload"></use></svg>
        <span class="b3-menu__label">${window.siyuan.languages.insertAsset}</span> 
        <input multiple class="b3-form__upload" type="file">
    </button>
    <button data-type="addAssetLink" class="b3-menu__item">
        <svg class="b3-menu__icon"><use xlink:href="#iconLink"></use></svg>
        <span class="b3-menu__label">${window.siyuan.languages.link}</span>
    </button>
</div>`;
};

export const updateAssetCell = (options: {
    protyle: IProtyle,
    data: IAV,
    cellElements: HTMLElement[],
    replaceValue?: IAVCellAssetValue[],
    addValue?: IAVCellAssetValue[],
    updateValue?: { index: number, value: IAVCellAssetValue }
    removeIndex?: number,
    blockElement: Element
}) => {
    const colId = options.cellElements[0].dataset.colId;
    const cellDoOperations: IOperation[] = [];
    const cellUndoOperations: IOperation[] = [];
    let mAssetValue: IAVCellAssetValue[];
    options.cellElements.forEach((item, elementIndex) => {
        if (!options.blockElement.contains(item)) {
            const rowElement = hasClosestByClassName(item, "av__row");
            if (rowElement) {
                item = options.cellElements[elementIndex] = options.blockElement.querySelector(`.av__row[data-id="${rowElement.dataset.id}"] .av__cell[data-col-id="${item.dataset.colId}"]`) as HTMLElement;
            }
        }
        const cellValue = genCellValueByElement(getTypeByCellElement(item) || item.dataset.type as TAVCol, item);
        const rowID = (hasClosestByClassName(item, "av__row") as HTMLElement).dataset.id;
        const oldValue = JSON.parse(JSON.stringify(cellValue));
        if (elementIndex === 0) {
            if (typeof options.removeIndex === "number") {
                cellValue.mAsset.splice(options.removeIndex, 1);
            } else if (options.addValue?.length > 0) {
                cellValue.mAsset = cellValue.mAsset.concat(options.addValue);
            } else if (options.updateValue) {
                cellValue.mAsset.find((assetItem, index) => {
                    if (index === options.updateValue.index) {
                        assetItem.content = options.updateValue.value.content;
                        assetItem.type = options.updateValue.value.type;
                        assetItem.name = options.updateValue.value.name;
                        return true;
                    }
                });
            } else if (options.replaceValue?.length > 0) {
                cellValue.mAsset = options.replaceValue;
            }
            mAssetValue = cellValue.mAsset;
        } else {
            cellValue.mAsset = mAssetValue;
        }
        cellDoOperations.push({
            action: "updateAttrViewCell",
            id: cellValue.id,
            keyID: colId,
            rowID,
            avID: options.data.id,
            data: cellValue
        });
        cellUndoOperations.push({
            action: "updateAttrViewCell",
            id: cellValue.id,
            keyID: colId,
            rowID,
            avID: options.data.id,
            data: oldValue
        });
        options.data.view.rows.find(row => {
            if (row.id === rowID) {
                row.cells.find(cell => {
                    if (cell.id === cellValue.id) {
                        cell.value = cellValue;
                        return true;
                    }
                });
                return true;
            }
        });
        if (item.classList.contains("custom-attr__avvalue")) {
            item.innerHTML = genAVValueHTML(cellValue);
        } else {
            updateAttrViewCellAnimation(item, cellValue);
        }
    });
    transaction(options.protyle, cellDoOperations, cellUndoOperations);
    const menuElement = document.querySelector(".av__panel > .b3-menu") as HTMLElement;
    if (menuElement) {
        menuElement.innerHTML = getAssetHTML(options.cellElements);
        bindAssetEvent({
            protyle: options.protyle,
            data: options.data,
            menuElement,
            cellElements: options.cellElements,
            blockElement: options.blockElement
        });
        const cellRect = (options.cellElements[0].classList.contains("custom-attr__avvalue") ? options.cellElements[0] : options.protyle.wysiwyg.element.querySelector(`.av__cell[data-id="${options.cellElements[0].dataset.id}"]`)).getBoundingClientRect();
        setTimeout(() => {
            setPosition(menuElement, cellRect.left, cellRect.bottom, cellRect.height);
        }, Constants.TIMEOUT_LOAD);  // 等待图片加载
    }
};

export const editAssetItem = (protyle: IProtyle, data: IAV, cellElements: HTMLElement[], target: HTMLElement, blockElement: Element) => {
    const linkAddress = target.dataset.content;
    const type = target.dataset.type as "image" | "file";
    const menu = new Menu("av-asset-edit", () => {
        if (textElements.length < 2 || !textElements[0].value ||
            (textElements[0].value === linkAddress && textElements[1].value === target.dataset.name)) {
            return;
        }
        updateAssetCell({
            protyle,
            data,
            cellElements,
            blockElement,
            updateValue: {
                index: parseInt(target.dataset.index),
                value: {
                    content: textElements[0].value,
                    name: textElements[1].value,
                    type
                }
            }
        });
    });
    if (menu.isOpen) {
        return;
    }
    if (type === "file") {
        menu.addItem({
            iconHTML: "",
            type: "readonly",
            label: `${window.siyuan.languages.link}
<textarea rows="1" style="margin:4px 0;width: ${isMobile() ? "200" : "360"}px;resize: vertical;" class="b3-text-field"></textarea>
<div class="fn__hr"></div>
${window.siyuan.languages.title}
<textarea style="width: ${isMobile() ? "200" : "360"}px;margin: 4px 0;resize: vertical;" rows="1" class="b3-text-field"></textarea>`,
        });
    } else {
        menu.addItem({
            icon: "iconPreview",
            label: window.siyuan.languages.cardPreview,
            click() {
                previewImage(linkAddress);
            }
        });
    }
    menu.addItem({
        icon: "iconTrashcan",
        label: window.siyuan.languages.delete,
        click() {
            updateAssetCell({
                protyle,
                data,
                cellElements,
                blockElement,
                removeIndex: parseInt(target.dataset.index)
            });
        }
    });
    openMenu(protyle ? protyle.app : window.siyuan.ws.app, linkAddress, false, true);
    /// #if !BROWSER
    if (linkAddress?.startsWith("assets/")) {
        window.siyuan.menus.menu.append(new MenuItem(exportAsset(linkAddress)).element);
    }
    /// #endif
    const rect = target.getBoundingClientRect();
    menu.open({
        x: rect.right,
        y: rect.top,
        w: rect.width,
        h: rect.height,
    });
    const textElements = menu.element.querySelectorAll("textarea");
    if (textElements.length > 1) {
        textElements[1].value = target.dataset.name;
        textElements[0].value = linkAddress;
        textElements[0].focus();
    }
};

export const addAssetLink = (protyle: IProtyle, data: IAV, cellElements: HTMLElement[], target: HTMLElement, blockElement: Element) => {
    const menu = new Menu("av-asset-link", () => {
        const textElements = menu.element.querySelectorAll("textarea");
        if (!textElements[0].value) {
            return;
        }
        updateAssetCell({
            protyle,
            data,
            cellElements,
            blockElement,
            addValue: [{
                type: "file",
                name: textElements[1].value,
                content: textElements[0].value,
            }]
        });
    });
    if (menu.isOpen) {
        return;
    }
    menu.addItem({
        iconHTML: "",
        type: "readonly",
        label: `${window.siyuan.languages.link}
<textarea rows="1" style="margin:4px 0;width: ${isMobile() ? "200" : "360"}px;resize: vertical;" class="b3-text-field"></textarea>
<div class="fn__hr"></div>
${window.siyuan.languages.title}
<textarea style="width: ${isMobile() ? "200" : "360"}px;margin: 4px 0;resize: vertical;" rows="1" class="b3-text-field"></textarea>`,
    });
    const rect = target.getBoundingClientRect();
    menu.open({
        x: rect.right,
        y: rect.bottom,
        w: target.parentElement.clientWidth + 8,
        h: rect.height,
    });
    menu.element.querySelector("textarea").focus();
};

export const dragUpload = (files: string[], protyle: IProtyle, cellElement: HTMLElement, avID: string) => {
    const msgId = showMessage(window.siyuan.languages.uploading, 0);
    fetchPost("/api/asset/insertLocalAssets", {
        assetPaths: files,
        isUpload: true,
        id: protyle.block.rootID
    }, (response) => {
        const blockElement = hasClosestBlock(cellElement);
        if (blockElement) {
            hideMessage(msgId);
            const addValue: IAVCellAssetValue[] = [];
            Object.keys(response.data.succMap).forEach(key => {
                const type = pathPosix().extname(key).toLowerCase();
                const name = key.substring(0, key.length - type.length);
                if (Constants.SIYUAN_ASSETS_IMAGE.includes(type)) {
                    addValue.push({
                        type: "image",
                        name,
                        content: response.data.succMap[key],
                    });
                } else {
                    addValue.push({
                        type: "file",
                        name,
                        content: response.data.succMap[key],
                    });
                }
            });
            fetchPost("/api/av/renderAttributeView", {
                id: avID,
                pageSize: parseInt(blockElement.getAttribute("data-page-size")) || undefined,
                viewID: blockElement.getAttribute(Constants.CUSTOM_SY_AV_VIEW)
            }, (response) => {
                updateAssetCell({
                    protyle,
                    blockElement,
                    data: response.data as IAV,
                    cellElements: [cellElement],
                    addValue
                });
            });
        }
    });
};
