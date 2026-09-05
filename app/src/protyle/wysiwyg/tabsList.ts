import {getTabTitle, getTabTitleBlock} from "../render/tabsRender";

export type TTabsListConversion = "List2Tabs" | "Tabs2UL" | "Tabs2OL" | "Tabs2TL";

export const isTabsListConversion = (type: string): type is TTabsListConversion =>
    ["List2Tabs", "Tabs2UL", "Tabs2OL", "Tabs2TL"].includes(type);

const blockChildren = (element: Element): Element[] => Array.from(
    (element.getAttribute("data-type") === "NodeTabItem" ?
        element.querySelector(":scope > .tab-item-content") : element)?.children || [],
).filter(child => child.hasAttribute("data-node-id"));

// 补齐折叠隐藏的块，同时保留编辑器中已有的正文、属性和光标。
export const completeTabsListSource = (visible: Element, full: Element): Element => {
    const result = visible.cloneNode(true) as Element;
    const complete = (target: Element, source: Element) => {
        const container = target.getAttribute("data-type") === "NodeTabItem" ?
            target.querySelector(":scope > .tab-item-content") : target;
        const children = blockChildren(target);
        const byID = new Map(children.map(child => [child.getAttribute("data-node-id"), child]));
        let next = container.querySelector(":scope > .protyle-attr");
        blockChildren(source).reverse().forEach(child => {
            const existing = byID.get(child.getAttribute("data-node-id"));
            if (existing) {
                complete(existing, child);
                next = existing;
            } else {
                const added = child.cloneNode(true) as Element;
                container.insertBefore(added, next);
                next = added;
            }
        });
    };
    complete(result, full);
    return result;
};

const skeleton = (lute: Lute, markdown: string): HTMLElement => {
    const template = document.createElement("template");
    template.innerHTML = lute.Md2BlockDOM(markdown);
    return template.content.firstElementChild as HTMLElement;
};

const newParagraph = (lute: Lute): HTMLElement => {
    const paragraph = skeleton(lute, "x\n");
    paragraph.querySelector("[contenteditable]").replaceChildren();
    return paragraph;
};

// 只移除转换时补出的空白落点；用户已有段落及后来填写的正文继续保留。
export const isEmptyTabPlaceholder = (paragraph: Element): boolean => {
    if (paragraph.getAttribute("tabs-placeholder") !== "true" ||
        Array.from(paragraph.attributes).some(attr => attr.name.startsWith("custom-") ||
            ["name", "alias", "memo", "bookmark", "style", "refcount"].includes(attr.name))) {
        return false;
    }
    const content = paragraph.querySelector(":scope > [contenteditable]");
    return !!content && !(content.textContent || "").replace(/[\u200b\ufeff\s]/g, "") &&
        !content.querySelector("span, img, audio, video, iframe");
};

const convertContainer = (source: Element, target: HTMLElement): HTMLElement => {
    const result = source.cloneNode(false) as HTMLElement;
    ["data-subtype", "data-marker", "data-task", "data-tight", "fold", "data-tabs-hidden", "data-tabs-editing",
        "tabs-active-id", "tabs-position", "data-sb-layout", "data-list-index", "aria-hidden", "hidden"].forEach(name =>
        result.removeAttribute(name));
    Array.from(target.attributes).forEach(attr => {
        if (!["data-node-id", "updated"].includes(attr.name)) {
            result.setAttribute(attr.name, attr.value);
        }
    });
    result.replaceChildren(...Array.from(target.childNodes));
    const oldIAL = source.querySelector(":scope > .protyle-attr");
    if (oldIAL) {
        result.querySelector(":scope > .protyle-attr")?.replaceWith(oldIAL.cloneNode(true));
    }
    return result;
};

// 仅改当前容器及直属项的类型，正文和嵌套容器保持原有块身份。
export const convertTabsList = (source: Element, type: TTabsListConversion, lute: Lute): HTMLElement => {
    const toTabs = type === "List2Tabs";
    if (source.getAttribute("data-type") !== (toTabs ? "NodeList" : "NodeTabs")) {
        return;
    }
    const items = blockChildren(source);
    if (items.length === 0) {
        return;
    }
    const listMarker = type === "Tabs2OL" ? "1." : type === "Tabs2TL" ? "* [ ]" : "*";
    const target = skeleton(lute, toTabs ? "::: tabs\n@tab\n\n:::\n" : `${listMarker} \n`);
    const itemTemplate = target.querySelector(toTabs ? ":scope > .tab-item" : ":scope > .li") as HTMLElement;
    const result = convertContainer(source, target);
    result.querySelector(toTabs ? ":scope > .tab-item" : ":scope > .li").remove();
    items.forEach((item, index) => {
        const converted = convertContainer(item, itemTemplate.cloneNode(true) as HTMLElement);
        const blocks = blockChildren(item).map(child => child.cloneNode(true) as Element);
        if (toTabs) {
            if (blocks[0]?.getAttribute("data-type") === "NodeParagraph") {
                const titleBlock = blocks.shift();
                titleBlock.setAttribute("tabs-title", "true");
                titleBlock.querySelector(":scope > [contenteditable]").classList.add("tab-item-title", "callout-title");
                converted.querySelector(".tab-item-info").replaceChildren(titleBlock);
            }
            const body = converted.querySelector(".tab-item-content");
            if (blocks.length === 0) {
                const placeholder = newParagraph(lute);
                placeholder.setAttribute("tabs-placeholder", "true");
                blocks.push(placeholder);
            }
            body.replaceChildren(...blocks);
        } else {
            for (let i = blocks.length - 1; i >= 0; i--) {
                if (isEmptyTabPlaceholder(blocks[i])) {
                    blocks.splice(i, 1);
                } else {
                    blocks[i].removeAttribute("tabs-placeholder");
                }
            }
            const originalTitle = getTabTitleBlock(item);
            const title = getTabTitle(item);
            if (originalTitle) {
                const titleBlock = originalTitle.cloneNode(true) as Element;
                titleBlock.removeAttribute("tabs-title");
                titleBlock.querySelector(".tab-item-title").classList.remove("tab-item-title", "callout-title");
                blocks.unshift(titleBlock);
            } else if (title?.innerHTML) {
                const titleBlock = newParagraph(lute);
                titleBlock.querySelector("[contenteditable]").innerHTML = title.innerHTML;
                titleBlock.querySelectorAll("wbr").forEach(caret => caret.remove());
                blocks.unshift(titleBlock);
            }
            converted.querySelectorAll(":scope > [data-node-id]").forEach(child => child.remove());
            if (blocks.length === 0) {
                blocks.push(newParagraph(lute));
            }
            const ial = converted.querySelector(":scope > .protyle-attr");
            blocks.forEach(block => converted.insertBefore(block, ial));
            if (type === "Tabs2OL") {
                converted.dataset.marker = `${index + 1}.`;
                converted.querySelector(":scope > .protyle-action").textContent = `${index + 1}.`;
            }
        }
        result.insertBefore(converted, result.querySelector(":scope > .protyle-attr"));
    });
    if (toTabs) {
        result.setAttribute("tabs-active-id", result.querySelector(":scope > .tab-item").getAttribute("data-node-id"));
    }
    if (source.querySelector("wbr")) {
        if (toTabs) {
            result.querySelectorAll("wbr").forEach(caret => caret.remove());
        }
        if (!result.querySelector("wbr")) {
            result.querySelector(toTabs ? ".tab-item-content [contenteditable=\"true\"]" : "[contenteditable=\"true\"]")
                ?.insertAdjacentHTML("afterbegin", "<wbr>");
        }
    }
    return result;
};
