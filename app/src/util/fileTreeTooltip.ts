import {escapeHtmlTextAndAttr} from "./escape";

export type IFileTreeDocTooltip = Pick<IFile, "name" | "titleEmpty" | "hSize" | "bookmark" | "name1" | "alias" |
    "memo" | "subFileCount" | "hMtime" | "hCtime">;

// 返回提示 HTML；用于 HTML 模板的属性时，额外转义整个属性，动态 setAttribute 则直接使用。
export const genFileTreeDocAriaLabel = (item: IFileTreeDocTooltip, htmlAttribute = false) => {
    const escapeMethod = escapeHtmlTextAndAttr;
    const name = item.titleEmpty ? window.siyuan.languages._kernel[16] : item.name;
    const label = `${escapeMethod(name)} <small class='ft__on-surface'>${item.hSize}</small>${item.bookmark ? "<br>" + window.siyuan.languages.bookmark + " " + escapeMethod(item.bookmark) : ""}${item.name1 ? "<br>" + window.siyuan.languages.name + " " + escapeMethod(item.name1) : ""}${item.alias ? "<br>" + window.siyuan.languages.alias + " " + escapeMethod(item.alias) : ""}${item.memo ? "<br>" + window.siyuan.languages.memo + " " + escapeMethod(item.memo) : ""}${item.subFileCount !== 0 ? window.siyuan.languages.includeSubFile.replace("x", item.subFileCount) : ""}<br>${window.siyuan.languages.modifiedAt} ${item.hMtime}<br>${window.siyuan.languages.createdAt} ${item.hCtime}`;
    return htmlAttribute ? escapeHtmlTextAndAttr(label) : label;
};
