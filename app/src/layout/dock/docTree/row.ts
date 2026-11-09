import type {IDocTreeItem} from "./types";
import {setDocTreeRowItem} from "./rowData";
import {escapeHtml, escapeHtmlTextAndAttr, escapeTooltipTextAttr} from "../../../util/escape";
import {getDocDisplayName} from "../../../util/pathName";
import {genFileTreeDocAriaLabel} from "../../../util/fileTreeTooltip";
import {getFileTreeDefaultIconAttr, getFileTreeIconHTML} from "../../../emoji/fileTreeIcon";
import {getPublishAccessOptionByLevel} from "../../../protyle/util/publishAccess";
import {getTreeItemTailHTML} from "../../../util/treeItemTail";

export interface IDocTreeRowOptions {
    mobile?: boolean;
    pinned?: boolean;
    editingPublishAccess?: boolean;
}

// Persisted row attributes are deliberately limited to identity, event routing and the default icon.
// All business data is held by the tree projection, including detached plugin menu rows.
export const renderDocTreeRowHTML = (item: IDocTreeItem, options: IDocTreeRowOptions = {}) => {
    const {mobile = false, pinned = false} = options;
    const config = window.siyuan.config;
    const language = window.siyuan.languages;
    const notebook = item.notebook || window.siyuan.notebooks.find(value => value.id === item.notebookId);
    const root = item.kind === "notebook";
    const closed = root && notebook?.closed;
    const encrypted = notebook?.encrypted;
    const publish = !pinned && options.editingPublishAccess && !encrypted;
    const boxDoc = root && !closed && config.fileTree.boxDocEnabled;
    const hasChildren = item.subFileCount > 0;
    const file = item.file;
    const icon = root ? notebook?.icon : file?.icon;
    // 源版本高于当前客户端支持的文档只能占位显示，不能打开、拖拽或参与保存。
    const specTooNew = !root && !closed && !!file?.specTooNew;
    const defaultIcon = closed && encrypted ? "lock" : root ? "notebook" : hasChildren ? "folder" : "file";
    const iconExpands = !root && !pinned && !mobile && config.fileTree.docIconClickMode === 1;
    const iconChanges = !mobile && (root || !config.fileTree.docIconClickMode);
    const actionClasses = !mobile && !pinned ? `${iconExpands && hasChildren && !publish ? " file-tree__item--icon-expand" : ""}${
        iconExpands && !hasChildren && !publish ? " file-tree__item--icon-open" : ""}${
        hasChildren && config.fileTree.parentDocTitleClickMode !== 0 ? " file-tree__item--title-expand" : ""}` : "";
    const nodeID = root && !boxDoc ? "" : item.id;
    const type = closed ? "navigation-closed" : root ? "navigation-root" : "navigation-file";
    const iconLabel = pinned ? (mobile ? language.docIconClickExpand : config.fileTree.docIconClickMode === 1 ? "" : language.changeIcon) :
        mobile && boxDoc ? (hasChildren ? language.docIconClickExpand : language.openDocument) : language.changeIcon;
    const tooltip = specTooNew ? escapeTooltipTextAttr(window.siyuan.languages._kernel[275]) :
        pinned && (item.unavailable || !file?.hSize) ? escapeTooltipTextAttr(item.name +
        (item.unavailable ? ` (${language.closeNotebook})` : "")) : file ? genFileTreeDocAriaLabel(file, true) : "";
    const iconHTML = `<span class="b3-list-item__icon${iconChanges || pinned && iconLabel ? " ariaLabel" : mobile && root ? " b3-tooltips b3-tooltips__e" : ""}${
        !mobile && !pinned && (!root || boxDoc) ? " popover__block" : ""}${publish ? " fn__none" : ""}" data-position="8east"${
        !mobile && !pinned && (!root || boxDoc) ? ` data-id="${item.id}"` : ""}${iconLabel ? ` aria-label="${iconLabel}"` : ""}>${getFileTreeIconHTML(closed && encrypted ? "" : icon, defaultIcon)}</span>`;
    const switchHTML = pinned ? "" : `<span class="b3-list-item__switch${root ? " b3-tooltips b3-tooltips__e" : mobile ? "" : " b3-tooltips b3-tooltips__n"}${publish ? "" : " fn__none"}" aria-label="${language.publishAccess}">${getPublishAccessOptionByLevel("public").iconHTML}</span>`;
    const more = pinned ? "data-pin-more=\"true\"" : `data-type="${root ? "more-root" : "more-file"}"`;
    const add = pinned ? "data-pin-new=\"true\"" : 'data-type="new"';
    const actionTooltip = pinned || mobile && root ? "" : root ? " b3-tooltips b3-tooltips__w" : " b3-tooltips b3-tooltips__nw";
    const actions = closed ? `<span data-type="open" class="b3-list-item__action${actionTooltip}${config.readonly ? " fn__none" : ""}" aria-label="${language.openBy}"><svg><use xlink:href="#iconOpen"></use></svg></span>` :
        `<span ${more} data-menu="true" class="b3-list-item__action${actionTooltip}${root && config.readonly ? " fn__none" : ""}" aria-label="${language.more}"><svg><use xlink:href="#iconMore"></use></svg></span>${
            pinned && (item.unavailable || config.readonly) ? "" : `<span ${add} class="b3-list-item__action${actionTooltip}${config.readonly ? " fn__none" : ""}" aria-label="${language.newSubDoc}"><svg><use xlink:href="#iconAdd"></use></svg></span>`}`;
    const count = file?.count > 0 && !pinned ? `<span class="${!mobile ? "popover__block b3-tooltips b3-tooltips__nw " : ""}counter"${!mobile ? ` aria-label="${language.ref}"` : ""}>${file.count}</span>` : "";
    const title = root ? escapeHtml(item.name) : getDocDisplayName(item.name, file?.titleEmpty, true);
    return `<li class="b3-list-item file-tree__row${!mobile ? " b3-list-item--hide-action" : ""}${specTooNew ? " file-tree__row--spec-too-new" : ""}${actionClasses}" data-type="${type}" data-node-id="${nodeID}" data-tree-key="${escapeHtmlTextAndAttr(item.occurrenceKey)}"${specTooNew ? ' data-spec-too-new="true" aria-disabled="true"' : ""} draggable="${!mobile && !closed && !item.unavailable && !specTooNew && !config.readonly && (!root || config.fileTree.sort === 6)}" style="--file-tree-depth:${item.depth}"${getFileTreeDefaultIconAttr(closed && encrypted ? "" : icon, defaultIcon)}${item.unavailable ? ' aria-disabled="true"' : ""}>
    <span ${pinned ? 'data-pin-toggle="true" ' : ""}class="b3-list-item__toggle${!mobile ? " b3-list-item__toggle--hl" : ""}${closed || (!root || boxDoc) && !hasChildren ? " fn__hidden" : ""}"><svg class="b3-list-item__arrow"><use xlink:href="#iconRight"></use></svg></span>
    ${iconHTML}${switchHTML}
    <span class="b3-list-item__text${!mobile || pinned ? " ariaLabel" : ""}" data-delay="200" data-position="parentE" data-tooltip-encoding="none"${tooltip ? ` aria-label="${tooltip}"` : ""}>${title}${item.unavailable ? ` (${language.closeNotebook})` : ""}</span>
    ${mobile && !pinned ? getTreeItemTailHTML(count, actions, true) : actions + count}
</li>`;
};

export const renderDocTreeRow = (item: IDocTreeItem, options: IDocTreeRowOptions = {}) => {
    const template = document.createElement("template");
    template.innerHTML = renderDocTreeRowHTML(item, options);
    const row = template.content.firstElementChild as HTMLElement;
    setDocTreeRowItem(row, item);
    return row;
};
