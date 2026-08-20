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

export const genGutterBlockButtonHTML = (options: IGutterBlockButtonOptions) => {
    const embedHTML = options.embedID ? ` data-embed-id="${options.embedID}"` : "";
    const viewOccurrenceHTML = options.viewOccurrenceID ?
        ` data-view-occurrence-id="${encodeURIComponent(options.viewOccurrenceID)}"` : "";
    return `<button class="ariaLabel" data-delay="500" data-position="parentW" aria-label="${options.ariaLabel}"
data-type="${options.type}" data-subtype="${options.subtype}" data-node-id="${options.nodeID}"${embedHTML}${viewOccurrenceHTML}>
    <svg><use xlink:href="#${options.icon}"></use></svg>
    <span ${options.popoverHTML || ""} ${options.draggable ? 'draggable="true"' : ""}></span>
</button>`;
};

export const canShowGutterInsert = (embedID?: string) => !embedID;
