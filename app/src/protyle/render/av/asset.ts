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

export const bindAssetEvent = (options: {
    protyle: IProtyle,
    data: IAV,
    menuElement: HTMLElement,
    cellElements: HTMLElement[]
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
                type: "addUpdate",
                addUpdateValue: value
            });
        });
    });
};

export const getAssetHTML = (data: IAVTable, cellElements: HTMLElement[]) => {
    const cellId = cellElements[0].dataset.id;
    const rowId = cellElements[0].parentElement.dataset.id;
    let cellData: IAVCell;
    data.rows.find(row => {
        if (row.id === rowId) {
            row.cells.find(cell => {
                if (cell.id === cellId) {
                    cellData = cell;
                    return true;
                }
            });
            return true;
        }
    });
    let html = "";
    if (cellData?.value?.mAsset) {
        cellData.value.mAsset.forEach(item => {
            if (!item.content) {
                return;
            }
            let contentHTML;
            if (item.type === "image") {
                contentHTML = `<span class="fn__flex-1">
    <img style="max-height: 180px;max-width: 360px;border-radius: var(--b3-border-radius);margin: 4px 0;" src="${item.content}"/>
</span>`;
            } else {
                contentHTML = `<span class="fn__ellipsis b3-menu__label" style="max-width: 360px">${item.name}</span>`;
            }

            html += `<button class="b3-menu__item" draggable="true" data-name="${item.name}" data-type="${item.type}" data-content="${item.content}">
<svg class="b3-menu__icon"><use xlink:href="#iconDrag"></use></svg>
${contentHTML}
<svg class="b3-menu__action" data-type="editAssetItem"><use xlink:href="#iconEdit"></use></svg>
</button>`;
        });
    }
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
    type: "replace" | "addUpdate" | "remove",
    replaceValue?: IAVCellAssetValue[],
    addUpdateValue?: IAVCellAssetValue[],
    removeContent?: string
}) => {
    let cellIndex: number;
    Array.from(options.cellElements[0].parentElement.querySelectorAll(".av__cell")).find((item: HTMLElement, index) => {
        if (item.dataset.id === options.cellElements[0].dataset.id) {
            cellIndex = index;
            return true;
        }
    });
    const colId = options.cellElements[0].dataset.colId;
    const cellDoOperations: IOperation[] = [];
    const cellUndoOperations: IOperation[] = [];
    let newValue: IAVCellAssetValue[] = [];
    options.cellElements.forEach((item, elementIndex) => {
        let cellData: IAVCell;
        const rowID = item.parentElement.dataset.id;
        options.data.view.rows.find(row => {
            if (row.id === rowID) {
                if (typeof cellIndex === "number") {
                    cellData = row.cells[cellIndex];
                    // 为空时 cellId 每次请求都不一致
                    cellData.id = item.dataset.id;
                    if (!cellData.value || !cellData.value.mAsset) {
                        cellData.value = {mAsset: []} as IAVCellValue;
                    }
                } else {
                    cellData = row.cells.find(cellItem => {
                        if (cellItem.id === item.dataset.id) {
                            return true;
                        }
                    });
                }
                return true;
            }
        });
        const oldValue = Object.assign([], cellData.value.mAsset);
        if (options.type === "remove") {
            if (elementIndex === 0) {
                cellData.value.mAsset.find((oldItem, index) => {
                    if (oldItem.content === options.removeContent) {
                        cellData.value.mAsset.splice(index, 1);
                        return true;
                    }
                });
                newValue = cellData.value.mAsset;
            } else {
                cellData.value.mAsset = newValue;
            }
        } else if (options.type === "addUpdate") {
            if (elementIndex === 0) {
                options.addUpdateValue.forEach(newitem => {
                    if (!newitem.content) {
                        return;
                    }
                    const hasMatch = cellData.value.mAsset.find(oldItem => {
                        if (oldItem.content === newitem.content) {
                            oldItem.name = newitem.name;
                            oldItem.type = newitem.type;
                            return true;
                        }
                    });
                    if (!hasMatch) {
                        if (newitem.type === "file" && !newitem.name) {
                            newitem.name = newitem.content;
                        }
                        cellData.value.mAsset.push(newitem);
                    }
                });
                newValue = cellData.value.mAsset;
            } else {
                cellData.value.mAsset = newValue;
            }
        } else {
            cellData.value.mAsset = options.replaceValue;
        }
        cellDoOperations.push({
            action: "updateAttrViewCell",
            id: cellData.id,
            keyID: colId,
            rowID,
            avID: options.data.id,
            data: cellData.value
        });
        cellUndoOperations.push({
            action: "updateAttrViewCell",
            id: cellData.id,
            keyID: colId,
            rowID,
            avID: options.data.id,
            data: {
                mAsset: oldValue
            }
        });
        if (item.classList.contains("custom-attr__avvalue")) {
            item.innerHTML = genAVValueHTML(cellData.value);
        } else {
            updateAttrViewCellAnimation(item);
        }
    });
    transaction(options.protyle, cellDoOperations, cellUndoOperations);
    const menuElement = document.querySelector(".av__panel > .b3-menu") as HTMLElement;
    if (menuElement) {
        menuElement.innerHTML = getAssetHTML(options.data.view, options.cellElements);
        bindAssetEvent({protyle: options.protyle, data: options.data, menuElement, cellElements: options.cellElements});
        const cellRect = (options.cellElements[0].classList.contains("custom-attr__avvalue") ? options.cellElements[0] : options.protyle.wysiwyg.element.querySelector(`.av__cell[data-id="${options.cellElements[0].dataset.id}"]`)).getBoundingClientRect();
        setTimeout(() => {
            setPosition(menuElement, cellRect.left, cellRect.bottom, cellRect.height);
        }, Constants.TIMEOUT_LOAD);  // 等待图片加载
    }
};

export const editAssetItem = (protyle: IProtyle, data: IAV, cellElements: HTMLElement[], target: HTMLElement) => {
    const linkAddress = target.dataset.content;
    const type = target.dataset.type as "image" | "file";
    const menu = new Menu("av-asset-edit", () => {
        if (!textElement || !textElement.value || textElement.value === target.dataset.name) {
            return;
        }
        updateAssetCell({
            protyle,
            data,
            cellElements,
            type: "addUpdate",
            addUpdateValue: [{
                content: linkAddress,
                name: textElement.value,
                type
            }]
        });
    });
    if (menu.isOpen) {
        return;
    }
    if (type === "file") {
        menu.addItem({
            iconHTML: "",
            label: `<textarea rows="1" style="margin:4px 0;width: ${isMobile() ? "200" : "360"}px" class="b3-text-field"></textarea>`,
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
                type: "remove",
                removeContent: linkAddress
            });
        }
    });
    openMenu(protyle ? protyle.app : window.siyuan.ws.app, linkAddress, false, true);
    /// #if !BROWSER
    if (linkAddress?.startsWith("assets/")) {
        window.siyuan.menus.menu.append(new MenuItem(exportAsset(linkAddress)).element);
    }
    /// #endif
    const textElement = menu.element.querySelector("textarea");
    if (textElement) {
        textElement.value = target.dataset.name;
    }
    const rect = target.getBoundingClientRect();
    menu.open({
        x: rect.right,
        y: rect.top,
        w: rect.width,
        h: rect.height,
    });
};

export const addAssetLink = (protyle: IProtyle, data: IAV, cellElements: HTMLElement[], target: HTMLElement) => {
    const menu = new Menu("av-asset-link", () => {
        const textElements = menu.element.querySelectorAll("textarea");
        if (!textElements[0].value) {
            return;
        }
        updateAssetCell({
            protyle,
            data,
            cellElements,
            type: "addUpdate",
            addUpdateValue: [{
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
        label: `<textarea rows="1" style="margin:4px 0;width: ${isMobile() ? "200" : "360"}px" class="b3-text-field" placeholder="${window.siyuan.languages.link}"></textarea>`,
    });
    menu.addItem({
        iconHTML: "",
        label: `<textarea rows="1" style="margin:4px 0;width: ${isMobile() ? "200" : "360"}px" class="b3-text-field" placeholder="${window.siyuan.languages.title}"></textarea>`,
    });
    const rect = target.getBoundingClientRect();
    menu.open({
        x: rect.right,
        y: rect.bottom,
        w: target.parentElement.clientWidth + 8,
        h: rect.height,
    });
};
