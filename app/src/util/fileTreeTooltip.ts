import {getDocDisplayName} from "./pathName";

export type IFileTreeDocTooltip = Pick<IFile, "name" | "titleEmpty" | "hSize" | "bookmark" | "name1" | "alias" |
    "memo" | "subFileCount" | "hMtime" | "hCtime">;

export const genFileTreeDocAriaLabel = (item: IFileTreeDocTooltip, escapeMethod: (text: string) => string) => {
    return `${escapeMethod(getDocDisplayName(item.name, item.titleEmpty))} <small class='ft__on-surface'>${item.hSize}</small>${item.bookmark ? "<br>" + window.siyuan.languages.bookmark + " " + escapeMethod(item.bookmark) : ""}${item.name1 ? "<br>" + window.siyuan.languages.name + " " + escapeMethod(item.name1) : ""}${item.alias ? "<br>" + window.siyuan.languages.alias + " " + escapeMethod(item.alias) : ""}${item.memo ? "<br>" + window.siyuan.languages.memo + " " + escapeMethod(item.memo) : ""}${item.subFileCount !== 0 ? window.siyuan.languages.includeSubFile.replace("x", item.subFileCount) : ""}<br>${window.siyuan.languages.modifiedAt} ${item.hMtime}<br>${window.siyuan.languages.createdAt} ${item.hCtime}`;
};
