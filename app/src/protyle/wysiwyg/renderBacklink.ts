import {getIconByType} from "../../editor/getIcon";
import {removeLoading} from "../ui/initUI";

export const renderBacklink = (protyle: IProtyle, backlinkData: {
    blockPaths: IBreadcrumb[],
    dom: string
}[]) => {
    protyle.block.showAll = true
    let html = ""
    backlinkData.forEach(item => {
        html += genBreadcrumb(item.blockPaths) + item.dom
    });
    protyle.wysiwyg.element.innerHTML = html
    removeLoading(protyle);
}

const genBreadcrumb = (blockPaths: IBreadcrumb[]) => {
    let html = ''
    blockPaths.forEach((item, index) => {
        if (index === 0) {
            return;
        }
        html += `<span class="protyle-breadcrumb__item" data-node-id="${item.id}">
    <svg class="popover__block" data-id="${item.id}"><use xlink:href="#${getIconByType(item.type, item.subType)}"></use></svg>
    <span class="protyle-breadcrumb__text" title="${item.name}">${item.name}</span>
</span>`;
        if (index !== blockPaths.length - 1) {
            html += '<svg class="protyle-breadcrumb__arrow"><use xlink:href="#iconRight"></use></svg>';
        }
    })
    return `<div contenteditable="false" class="protyle-breadcrumb__bar protyle-breadcrumb__bar--nowrap">${html}</div>`;
}
