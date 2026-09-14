export interface IAVLocateRequest {
    itemID: string;
    keyID?: string;
    defIDs?: string[];
    scroll?: boolean;
    groupID?: string;
    viewID?: string;
    select?: boolean;
    highlight?: boolean;
    persistView?: boolean;
    previousViewID?: string;
    messageShown?: boolean;
    located?: boolean;
}

export const locateRequests = new WeakMap<HTMLElement, IAVLocateRequest>();
const locateEditors = new WeakSet<HTMLElement>();

export const retainAVLocate = (editor: HTMLElement, request: IAVLocateRequest,
                               viewID: string, groupID: string) => {
    Object.assign(request, {
        located: true, viewID, groupID, scroll: false, highlight: false, select: false,
        persistView: false, keyID: undefined, defIDs: undefined, previousViewID: viewID,
    });
    if (locateEditors.has(editor)) {
        return;
    }
    locateEditors.add(editor);
    const clearOutside = (event: Event) => {
        editor.querySelectorAll<HTMLElement>(".av").forEach(block => {
            if (locateRequests.get(block)?.located && !block.contains(event.target as Node)) {
                locateRequests.delete(block);
            }
        });
    };
    editor.addEventListener("pointerdown", clearOutside);
    editor.addEventListener("focusin", clearOutside);
};

export const cancelAVLocateGroup = (blockElement: HTMLElement, states: Record<string, boolean>) => {
    const request = locateRequests.get(blockElement);
    if (request?.groupID && Object.prototype.hasOwnProperty.call(states, request.groupID)) {
        locateRequests.delete(blockElement);
    }
};
