import {setTabTitleNavigationEditing} from "../render/tabsRender";

export interface IHostVerticalRegion {
    owner: HTMLElement;
    title: HTMLElement | null;
    content: HTMLElement | null;
    database: boolean;
    setTitleEditing?: (editing: boolean) => boolean;
}

const hostRegions = [
    {className: "callout", title: ":scope > .callout-info > .callout-title", content: ":scope > .callout-content"},
    {className: "tab-item", title: ":scope > .tab-item-info > .tab-item-title, " +
        ":scope > .tab-item-info > [tabs-title] > .tab-item-title", content: ":scope > .tab-item-content"},
    {className: "av", title: ".av__title", content: ""},
];

export const getHostVerticalRegion = (element: Element): IHostVerticalRegion | undefined => {
    const descriptor = hostRegions.find(item => element.classList.contains(item.className));
    if (!descriptor) {
        return;
    }
    return {
        owner: element as HTMLElement,
        title: element.querySelector<HTMLElement>(descriptor.title),
        content: descriptor.content ? element.querySelector<HTMLElement>(descriptor.content) : null,
        database: descriptor.className === "av",
        setTitleEditing: descriptor.className === "tab-item" ?
            editing => setTabTitleNavigationEditing(element as HTMLElement, editing) : undefined,
    };
};

export const getHostVerticalTitleRegion = (node: Node): IHostVerticalRegion | undefined => {
    const element = node.nodeType === 3 ? node.parentElement : node as Element;
    let ancestor: Element | null = element;
    while (ancestor && !ancestor.classList.contains("protyle-wysiwyg")) {
        const region = getHostVerticalRegion(ancestor);
        if (region) {
            return region.title?.contains(node) ? region : undefined;
        }
        ancestor = ancestor.parentElement;
    }
};
