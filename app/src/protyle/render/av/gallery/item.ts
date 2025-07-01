import {showMessage} from "../../../../dialog/message";
import {
    genCellValueByElement,
    getTypeByCellElement,
    renderCell,
    renderCellAttr
} from "../cell";
import {fetchPost} from "../../../../util/fetch";
import {setPage} from "../row";

export const insertGalleryItemAnimation = (options: {
    blockElement: HTMLElement;
    protyle: IProtyle;
    srcIDs: string[];
    previousId: string;
}) => {
    if ((options.blockElement.querySelector('[data-type="av-search"]') as HTMLInputElement).value !== "") {
        showMessage(window.siyuan.languages.insertRowTip);
        return;
    }
    const avId = options.blockElement.getAttribute("data-av-id");
    const sideItemElement = options.previousId ? options.blockElement.querySelector(`.av__gallery-item[data-id="${options.previousId}"]`) : options.blockElement.querySelector(".av__gallery-item");
    let html = "";
    let needUpdate = "";
    if (options.blockElement.querySelector('.av__views [data-type="av-sort"]').classList.contains("block__icon--active") &&
        !options.blockElement.querySelector('[data-type="av-load-more"]').classList.contains("fn__none")) {
        needUpdate = ' data-need-update="true"';
    }
    const coverClass = sideItemElement?.querySelector(".av__gallery-cover")?.className || "fn__none";
    options.srcIDs.forEach((id) => {
        html += `<div class="av__gallery-item"${needUpdate} data-type="ghost" data-id="${id}">
    <div class="${coverClass}"><span style="width: 100%;height: 100%;border-radius: var(--b3-border-radius) var(--b3-border-radius) 0 0;" class="av__pulse"></span></div>
    <div class="av__gallery-fields"><span class="av__pulse"></span></div>
</div>`;
    });
    if (options.previousId && sideItemElement) {
        sideItemElement.insertAdjacentHTML("afterend", html);
    } else {
        options.blockElement.querySelector(".av__gallery").insertAdjacentHTML("afterbegin", html);
    }
    const currentItemElement = options.blockElement.querySelector(`.av__gallery-item[data-id="${options.srcIDs[0]}"]`);
    fetchPost("/api/av/getAttributeViewFilterSort", {
        id: avId,
        blockID: options.blockElement.getAttribute("data-node-id")
    }, (response) => {
        // https://github.com/siyuan-note/siyuan/issues/10517
        let hideTextCell = false;
        response.data.filters.find((item: IAVFilter) => {
            const itemCellElement = options.blockElement.querySelector(`.av__cell[data-field-id="${item.column}"]`);
            if (!itemCellElement) {
                return;
            }
            const filterType = itemCellElement.getAttribute("data-dtype");
            if (item.value && filterType !== item.value.type) {
                return;
            }
            if (["relation", "rollup", "template"].includes(filterType)) {
                hideTextCell = true;
                return true;
            }

            // 根据后台计算出显示与否的结果进行标识，以便于在 refreshAV 中更新 UI
            if (["created", "updated"].includes(filterType)) {
                currentItemElement.setAttribute("data-need-update", "true");
            } else {
                response.data.sorts.find((sortItem: IAVSort) => {
                    if (sortItem.column === item.column) {
                        currentItemElement.setAttribute("data-need-update", "true");
                        return true;
                    }
                });
            }
            // 当空或非空外，需要根据值进行判断
            let isRenderValue = true;
            if (item.operator !== "Is empty" && item.operator !== "Is not empty") {
                switch (item.value.type) {
                    case "select":
                    case "mSelect":
                        if (!item.value.mSelect || item.value.mSelect.length === 0) {
                            isRenderValue = false;
                        }
                        break;
                    case "block":
                        if (!item.value.block || !item.value.block.content) {
                            isRenderValue = false;
                        }
                        break;
                    case "number":
                        if (!item.value.number || !item.value.number.isNotEmpty) {
                            isRenderValue = false;
                        }
                        break;
                    case "date":
                    case "created":
                    case "updated":
                        if (!item.value[item.value.type] || !item.value[item.value.type].isNotEmpty) {
                            isRenderValue = false;
                        }
                        break;
                    case "mAsset":
                        if (!item.value.mAsset || item.value.mAsset.length === 0) {
                            isRenderValue = false;
                        }
                        break;
                    case "checkbox":
                        if (!item.value.checkbox) {
                            isRenderValue = false;
                        }
                        break;
                    case "text":
                    case "url":
                    case "phone":
                    case "email":
                        if (!item.value[item.value.type] || !item.value[item.value.type].content) {
                            isRenderValue = false;
                        }
                        break;
                }
            }
            if (sideItemElement.classList.contains("av__row") && isRenderValue) {
                const sideItemCellElement = sideItemElement.querySelector(`.av__cell[data-field-id="${item.column}"]`) as HTMLElement;
                const cellElement = currentItemElement.querySelector(`.av__cell[data-field-id="${item.column}"]`);
                const cellValue = genCellValueByElement(getTypeByCellElement(sideItemCellElement), sideItemCellElement);
                const iconElement = cellElement.querySelector(".b3-menu__avemoji");
                cellElement.innerHTML = renderCell(cellValue, undefined,
                    iconElement ? !iconElement.classList.contains("fn__none") : false, "gallery");
                renderCellAttr(cellElement, cellValue);
            }
        });
        if (hideTextCell) {
            currentItemElement.remove();
            showMessage(window.siyuan.languages.insertRowTip);
        }
        setPage(options.blockElement);
    });
};
