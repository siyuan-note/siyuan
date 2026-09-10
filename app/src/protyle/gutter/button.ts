import {escapeAttr} from "../../util/escape";

export interface IGutterBlockButtonOptions {
    ariaLabel: string;
    type: string;
    subtype: string;
    nodeID: string;
    icon: string;
    embedID?: string;
    viewOccurrenceID?: string;
    popoverHTML?: string;
    draggable: boolean;
}

// 动态属性值统一转义后再拼接，避免块属性携带的引号破坏属性边界注入事件处理属性
export const genGutterBlockButtonHTML = (options: IGutterBlockButtonOptions) => {
    const embedHTML = options.embedID ? ` data-embed-id="${escapeAttr(options.embedID)}"` : "";
    const viewOccurrenceHTML = options.viewOccurrenceID ?
        ` data-view-occurrence-id="${escapeAttr(encodeURIComponent(options.viewOccurrenceID))}"` : "";
    return `<button class="ariaLabel" data-delay="500" data-position="parentW" aria-label="${escapeAttr(options.ariaLabel)}"
data-type="${escapeAttr(options.type)}" data-subtype="${escapeAttr(options.subtype)}" data-node-id="${escapeAttr(options.nodeID)}"${embedHTML}${viewOccurrenceHTML}>
    <svg><use xlink:href="#${escapeAttr(options.icon)}"></use></svg>
    <span ${options.popoverHTML || ""} ${options.draggable ? 'draggable="true"' : ""}></span>
</button>`;
};

export const canShowGutterInsert = (embedID?: string) => !embedID;
