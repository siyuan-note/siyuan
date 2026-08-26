import {escapeAriaLabel, escapeHtml} from "../util/escape";

export interface IAssetSearchResultItem {
    content: string;
    ext: string;
    id: string;
    path: string;
    name: string;
    hSize: string;
}

// 生成资源搜索结果行 HTML，文件名与扩展名等不可信字段需转义，避免注入可执行脚本
export const genAssetSearchResultItemHTML = (item: IAssetSearchResultItem, index: number) => {
    return `<div data-type="search-item" class="b3-list-item${index === 0 ? " b3-list-item--focus" : ""}" data-id="${item.id}">
<span class="ft__on-surface">${escapeHtml(item.ext)}</span>
<span class="fn__space"></span>
<span class="b3-list-item__text">${item.content}</span>
<span class="b3-list-item__meta">${item.hSize}</span>
<span class="b3-list-item__meta b3-list-item__meta--ellipsis ariaLabel" aria-label="${escapeAriaLabel(item.path)}">${escapeHtml(item.name)}</span>
</div>`;
};
