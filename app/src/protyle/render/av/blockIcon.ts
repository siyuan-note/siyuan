import {getFileTreeIconHTML} from "../../../emoji/fileTreeIcon";
import {escapeAttr} from "../../../util/escape";

export const getAVBlockIconHTML = (value: Pick<IAVCellValue, "block" | "isDetached">) => {
    if (value.isDetached && !value.block?.icon) {
        return '<svg><use xlink:href="#iconLine"></use></svg>';
    }
    return getFileTreeIconHTML(value.block?.icon, "file");
};

export const renderAVBlockIcon = (value: Pick<IAVCellValue, "block" | "isDetached">, showIcon = true) =>
    `<span class="b3-menu__avemoji${showIcon ? "" : " fn__none"}" data-unicode="${escapeAttr(value.block?.icon || "")}">${getAVBlockIconHTML(value)}</span>`;
