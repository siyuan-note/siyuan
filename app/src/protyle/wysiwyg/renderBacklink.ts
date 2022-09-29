import {getIconByType} from "../../editor/getIcon";
import {removeLoading} from "../ui/initUI";
import {fetchPost} from "../../util/fetch";
import {Constants} from "../../constants";

export const renderBacklink = (protyle: IProtyle, backlinkData: {
    blockPaths: IBreadcrumb[],
    dom: string
}[]) => {
    protyle.block.showAll = true;
    let html = "";
    backlinkData.forEach(item => {
        html += genBreadcrumb(item.blockPaths) + item.dom;
    });
    protyle.wysiwyg.element.innerHTML = html;
    removeLoading(protyle);
};

export const loadBreadcrumb = (element: HTMLElement) => {
    if (element.classList.contains("protyle-breadcrumb__item--active")) {
        return;
    }
    element.parentElement.querySelector(".protyle-breadcrumb__item--active").classList.remove("protyle-breadcrumb__item--active");
    element.classList.add("protyle-breadcrumb__item--active");
    let nextElement = element.parentElement.nextElementSibling;
    while (nextElement && !nextElement.classList.contains("protyle-breadcrumb__bar")) {
        const tempElement = nextElement;
        nextElement = nextElement.nextElementSibling;
        tempElement.remove();
    }
    fetchPost("/api/filetree/getDoc", {
        id: element.getAttribute("data-id"),
        size: Constants.SIZE_GET_MAX,
    }, getResponse => {
        element.parentElement.insertAdjacentHTML("afterend", getResponse.data.content);
    });
};

const genBreadcrumb = (blockPaths: IBreadcrumb[]) => {
    let html = "";
    blockPaths.forEach((item, index) => {
        if (index === 0) {
            return;
        }
        html += `<span class="protyle-breadcrumb__item${index === blockPaths.length - 1 ? " protyle-breadcrumb__item--active" : ""}" data-id="${item.id}">
    <svg class="popover__block" data-id="${item.id}"><use xlink:href="#${getIconByType(item.type, item.subType)}"></use></svg>
    <span class="protyle-breadcrumb__text" title="${item.name}">${item.name}</span>
</span>`;
        if (index !== blockPaths.length - 1) {
            html += '<svg class="protyle-breadcrumb__arrow"><use xlink:href="#iconRight"></use></svg>';
        }
    });
    return `<div contenteditable="false" class="protyle-breadcrumb__bar protyle-breadcrumb__bar--nowrap">${html}</div>`;
};
