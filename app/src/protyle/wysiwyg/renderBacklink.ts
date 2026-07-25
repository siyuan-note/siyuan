import {getIconByType} from "../../editor/getIcon";
import {removeLoading} from "../ui/initUI";
import {fetchPost} from "../../util/fetch";
import {Constants} from "../../constants";
import {processRender} from "../util/processCode";
import {highlightRender} from "../render/highlightRender";
import {blockRender} from "../render/blockRender";
import {disabledForeverProtyle, disabledProtyle} from "../util/onGet";
import {avRender} from "../render/av/render";
import {hasClosestByAttribute} from "../util/hasClosest";
import {isEncryptedBox} from "../../util/pathName";

interface IBacklinkData {
    id?: string,
    revision?: string,
    blockPaths: IBreadcrumb[],
    dom: string,
    expand: boolean
}

interface IBacklinkDOMRecord {
    revision: string,
    anchor: HTMLElement,
}

const backlinkDOMRecords = new WeakMap<IProtyle, Map<string, IBacklinkDOMRecord>>();

const getBacklinkDOMNodes = (anchor: HTMLElement) => {
    const nodes: Node[] = [anchor];
    let next = anchor.nextSibling;
    while (next) {
        if (next instanceof HTMLElement && next.classList.contains("protyle-breadcrumb__bar") &&
            next.hasAttribute("data-backlink-id")) {
            break;
        }
        nodes.push(next);
        next = next.nextSibling;
    }
    return nodes;
};

const removeBacklinkDOMRecord = (record: IBacklinkDOMRecord) => {
    getBacklinkDOMNodes(record.anchor).forEach(item => item.parentNode?.removeChild(item));
};

const createBacklinkDOMRecord = (item: IBacklinkData, index: number, id: string) => {
    const template = document.createElement("template");
    template.innerHTML = genBreadcrumb(item.blockPaths, false, index, id) + setBacklinkFold(item.dom, item.expand);
    const nodes = Array.from(template.content.childNodes);
    return {
        record: {
            revision: item.revision || "",
            anchor: nodes[0] as HTMLElement,
        },
        nodes,
    };
};

const renderBacklinkDOMNodes = (protyle: IProtyle, nodes: Node[]) => {
    nodes.forEach(item => {
        if (!(item instanceof HTMLElement)) {
            return;
        }
        improveBreadcrumbAppearance(item);
        processRender(item);
        highlightRender(item);
        avRender(item, protyle);
        blockRender(protyle, item);
    });
};

export const renderBacklink = (protyle: IProtyle, backlinkData: IBacklinkData[]) => {
    protyle.block.showAll = true;
    const element = protyle.wysiwyg.element;
    let records = backlinkDOMRecords.get(protyle);
    if (!records) {
        records = new Map<string, IBacklinkDOMRecord>();
        backlinkDOMRecords.set(protyle, records);
        element.replaceChildren();
    }

    const ids = new Set(backlinkData.map((item, index) => item.id || `legacy-${index}`));
    records.forEach((record, id) => {
        if (!ids.has(id)) {
            removeBacklinkDOMRecord(record);
            records.delete(id);
        }
    });

    const changedNodes: Node[][] = [];
    const orderedRecords: IBacklinkDOMRecord[] = [];
    backlinkData.forEach((item, index) => {
        const id = item.id || `legacy-${index}`;
        let record = records.get(id);
        if (record && record.anchor.parentElement !== element) {
            records.delete(id);
            record = undefined;
        }
        if (!record || !item.revision || record.revision !== item.revision) {
            const created = createBacklinkDOMRecord(item, index, id);
            if (record) {
                created.nodes.forEach(node => element.insertBefore(node, record.anchor));
                removeBacklinkDOMRecord(record);
            } else {
                created.nodes.forEach(node => element.appendChild(node));
            }
            record = created.record;
            records.set(id, record);
            changedNodes.push(created.nodes);
        }
        orderedRecords.push(record);
    });

    let cursor = element.firstChild;
    orderedRecords.forEach((record, index) => {
        const nodes = getBacklinkDOMNodes(record.anchor);
        if (nodes[0] !== cursor) {
            const fragment = document.createDocumentFragment();
            nodes.forEach(node => fragment.appendChild(node));
            element.insertBefore(fragment, cursor);
        }
        cursor = nodes[nodes.length - 1].nextSibling;
        if (record.anchor.style.width === "100%") {
            const borderTop = index === 0 ? "0px" : "1px solid var(--b3-border-color)";
            if (record.anchor.style.borderTop !== borderTop) {
                record.anchor.style.borderTop = borderTop;
            }
        }
    });
    changedNodes.forEach(nodes => renderBacklinkDOMNodes(protyle, nodes));
    removeLoading(protyle);
    if (window.siyuan.config.readonly || window.siyuan.config.editor.readOnly) {
        disabledProtyle(protyle);
    }
};

// 传递型折叠处理
export const foldPassiveType = (expand: boolean, element: HTMLElement | DocumentFragment) => {
    if (element.firstElementChild.classList.contains("li")) {
        if (expand) {
            element.querySelectorAll(".li .li").forEach(item => {
                if (item.childElementCount > 3) {
                    item.setAttribute("fold", "1");
                }
            });
        } else {
            element.firstElementChild.setAttribute("fold", "1");
        }
    } else if (element.firstElementChild.getAttribute("data-type") === "NodeHeading") {
        Array.from(element.children).forEach((item, index) => {
            if ((expand && index > 2) || (!expand && index > 1)) {
                if ((expand && index === 3) || (!expand && index === 2)) {
                    item.insertAdjacentHTML("beforebegin", '<div style="max-width: 100%;justify-content: center;" contenteditable="false" class="protyle-breadcrumb__item"><svg style="transform: rotate(90deg);"><use xlink:href="#iconMore"></use></svg></div>');
                }
                item.classList.add("fn__none");
            }
        });
    }
};

const setBacklinkFold = (html: string, expand: boolean) => {
    const tempDom = document.createElement("template");
    tempDom.innerHTML = html;
    foldPassiveType(expand, tempDom.content);
    return tempDom.innerHTML;
};

export const loadBreadcrumb = (protyle: IProtyle, element: HTMLElement) => {
    const getDocParam: IObject = {
        id: element.getAttribute("data-id"),
        size: Constants.SIZE_GET_MAX,
    };
    if (isEncryptedBox(protyle.notebookId)) {
        getDocParam.notebook = protyle.notebookId;
    }
    fetchPost("/api/filetree/getDoc", getDocParam, getResponse => {
        element.parentElement.querySelector(".protyle-breadcrumb__item--active").classList.remove("protyle-breadcrumb__item--active");
        element.classList.add("protyle-breadcrumb__item--active");
        let nextElement = element.parentElement.nextElementSibling;
        while (nextElement && !nextElement.classList.contains("protyle-breadcrumb__bar")) {
            const tempElement = nextElement;
            nextElement = nextElement.nextElementSibling;
            tempElement.remove();
        }
        element.parentElement.insertAdjacentHTML("afterend", setBacklinkFold(getResponse.data.content, true));
        processRender(element.parentElement.parentElement);
        avRender(element.parentElement.parentElement, protyle);
        blockRender(protyle, element.parentElement.parentElement);
        if (getResponse.data.isSyncing) {
            disabledForeverProtyle(protyle);
        } else if (window.siyuan.config.readonly || window.siyuan.config.editor.readOnly) {
            disabledProtyle(protyle);
        }
    });
};

export const getBacklinkHeadingMore = (moreElement: HTMLElement) => {
    let nextElement = moreElement.nextElementSibling;
    while (nextElement && !nextElement.classList.contains("protyle-breadcrumb__bar")) {
        nextElement.classList.remove("fn__none");
        nextElement = nextElement.nextElementSibling;
    }
    moreElement.remove();
};

export const genBreadcrumb = (blockPaths: IBreadcrumb[], renderFirst: boolean, parentIndex?: number, backlinkID?: string) => {
    const backlinkAttr = backlinkID ? ` data-backlink-id="${backlinkID}"` : "";
    if (1 > blockPaths.length) {
        return `<div${backlinkAttr} contenteditable="false" style="border-top: ${parentIndex === 0 ? 0 : 1}px solid var(--b3-border-color);min-height: 0;width: 100%;" class="protyle-breadcrumb__bar"><span></span></div>`;
    }

    let html = "";
    blockPaths.forEach((item, index) => {
        if (index === 0 && !renderFirst) {
            return;
        }
        html += `<span class="protyle-breadcrumb__item${index === blockPaths.length - 1 ? " protyle-breadcrumb__item--active" : ""}" data-id="${item.id}">
    <svg class="popover__block" data-id="${item.id}"><use xlink:href="#${getIconByType(item.type, item.subType)}"></use></svg>
    ${item.name ? `<span class="protyle-breadcrumb__text" title="${item.name}">${item.name}</span>` : ""}
</span>`;
        if (index !== blockPaths.length - 1) {
            html += '<svg class="protyle-breadcrumb__arrow"><use xlink:href="#iconRight"></use></svg>';
        }
    });
    return `<div${backlinkAttr} contenteditable="false" class="protyle-breadcrumb__bar protyle-breadcrumb__bar--nowrap">${html}</div>`;
};

export const improveBreadcrumbAppearance = (element: HTMLElement) => {
    const elements: HTMLElement[] = [];
    if (element.classList.contains("protyle-breadcrumb__bar")) {
        elements.push(element);
    }
    elements.push(...Array.from(element.querySelectorAll(".protyle-breadcrumb__bar")) as HTMLElement[]);
    elements.forEach((item: HTMLElement) => {
        item.classList.remove("protyle-breadcrumb__bar--nowrap");
        const itemElements = Array.from(item.querySelectorAll(".protyle-breadcrumb__text"));
        if (itemElements.length === 0) {
            return;
        }
        let jump = false;
        const isEmbed = hasClosestByAttribute(item, "data-type", "NodeBlockQueryEmbed");
        while (item.scrollHeight > 30 && !jump && itemElements.length > 1) {
            itemElements.find((item, index) => {
                if (index > (isEmbed ? 0 : -1)) {
                    if (!item.classList.contains("protyle-breadcrumb__text--ellipsis")) {
                        item.classList.add("protyle-breadcrumb__text--ellipsis");
                        return true;
                    }
                    if (index === itemElements.length - 1 && item.classList.contains("protyle-breadcrumb__text--ellipsis")) {
                        jump = true;
                    }
                }
            });
        }
        item.classList.add("protyle-breadcrumb__bar--nowrap");
        if (item.lastElementChild) {
            item.scrollLeft = (item.lastElementChild as HTMLElement).offsetLeft - item.clientWidth + 14;
        }
    });
};
