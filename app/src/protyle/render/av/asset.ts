import {Menu} from "../../../plugin/Menu";
import {transaction} from "../../wysiwyg/transaction";
import {updateAttrViewCellAnimation} from "./action";
import {isMobile} from "../../../util/functions";
import {Constants} from "../../../constants";
import {uploadFiles} from "../../upload";
import {pathPosix} from "../../../util/pathName";


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
            const resData = JSON.parse(res)
            const value: IAVCellAssetValue[] = []
            Object.keys(resData.data.succMap).forEach((key) => {
                value.push({
                    name: key,
                    content: resData.data.succMap[key],
                    type: Constants.SIYUAN_ASSETS_IMAGE.includes(pathPosix().extname(resData.data.succMap[key]).toLowerCase()) ? "image" : "file"
                })
            })
            updateAssetCell({
                protyle: options.protyle,
                data: options.data,
                cellElements: options.cellElements,
                value
            })
        });
    });
};

export const getAssetHTML = (data: IAVTable, cellElements: HTMLElement[]) => {
    const cellId = cellElements[0].dataset.id;
    const rowId = cellElements[0].parentElement.dataset.id;
    let cellData: IAVCell
    data.rows.find(row => {
        if (row.id === rowId) {
            row.cells.find(cell => {
                if (cell.id === cellId) {
                    cellData = cell
                    return true
                }
            })
            return true
        }
    })
    let html = ""
    if (cellData?.value?.mAsset) {
        cellData.value.mAsset.forEach(item => {
            if (!item.content) {
                return
            }
            let contentHTML
            if (item.type === "image") {
                contentHTML = `<img style="max-height: 180px;max-width: 360px;border-radius: var(--b3-border-radius);margin: 4px 0;" src="${item.content}"/>`
            } else {
                contentHTML = `<span class="fn__ellipsis b3-menu__label" style="max-width: 360px">${item.name}</span>`
            }

            html += `<button data-type="addColOptionOrCell" class="b3-menu__item" draggable="true">
<svg class="b3-menu__icon"><use xlink:href="#iconDrag"></use></svg>
${contentHTML}
<svg class="b3-menu__action" data-type="setColOption"><use xlink:href="#iconEdit"></use></svg>
</button>`
        })
    }
    return `<div class="b3-menu__items">
    ${html}
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

const updateAssetCell = (options: {
    protyle: IProtyle,
    data: IAV,
    cellElements: HTMLElement[],
    value: IAVCellAssetValue[]
}) => {
    if (!options.value || options.value.length === 0 || !options.value[0].content) {
        return;
    }
    let cellIndex = 0;
    Array.from(options.cellElements[0].parentElement.querySelectorAll(".av__cell")).find((item: HTMLElement, index) => {
        if (item.dataset.id === options.cellElements[0].dataset.id) {
            cellIndex = index;
            return true;
        }
    });

    const colId = options.cellElements[0].dataset.colId;
    const cellDoOperations: IOperation[] = [];
    const cellUndoOperations: IOperation[] = [];
    options.cellElements.forEach(item => {
        let cellData: IAVCell;
        const rowID = item.parentElement.dataset.id;
        options.data.view.rows.find(row => {
            if (row.id === rowID) {
                cellData = row.cells[cellIndex];
                // 为空时 cellId 每次请求都不一致
                cellData.id = item.dataset.id;
                if (!cellData.value || !cellData.value.mAsset) {
                    cellData.value = {mAsset: []} as IAVCellValue;
                }
                return true;
            }
        });
        const oldValue = Object.assign([], cellData.value.mAsset);
        options.value.forEach(item => {
            cellData.value.mAsset.push(item);
        })
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
        updateAttrViewCellAnimation(item);
    });
    transaction(options.protyle, cellDoOperations, cellUndoOperations);
}

export const addAssetLink = (protyle: IProtyle, data: IAV, cellElements: HTMLElement[], target: HTMLElement) => {
    const menu = new Menu("av-asset-link", () => {
        const textElements = menu.element.querySelectorAll("textarea")
        if (!textElements[0].value) {
            return
        }
        updateAssetCell({
            protyle,
            data,
            cellElements,
            value: [{
                type: "file",
                name: textElements[1].value,
                content: textElements[0].value,
            }]
        })
    })

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
        w: rect.width,
        h: rect.height,
    });
}
