import {openSearchAV} from "./relation";
import {transaction} from "../../wysiwyg/transaction";
import {focusByRange} from "../../util/selection";
import {hasClosestBlock} from "../../util/hasClosest";
import * as dayjs from "dayjs";

export const addFilesToDatabase = (fileLiElements: Element[]) => {
    const srcs: IOperationSrcs[] = [];
    fileLiElements.forEach(item => {
        const id = item.getAttribute("data-node-id");
        if (id) {
            srcs.push({
                id,
                isDetached: false
            });
        }
    });
    if (srcs.length > 0) {
        openSearchAV("", fileLiElements[0] as HTMLElement, (listItemElement) => {
            const avID = listItemElement.dataset.avId;
            transaction(undefined, [{
                action: "insertAttrViewBlock",
                avID,
                ignoreFillFilter: true,
                srcs,
                blockID: listItemElement.dataset.blockId
            }, {
                action: "doUpdateUpdated",
                id: listItemElement.dataset.blockId,
                data: dayjs().format("YYYYMMDDHHmmss"),
            }]);
        });
    }
};

export const addEditorToDatabase = (protyle: IProtyle, range: Range, type?: string) => {
    if (protyle.title?.editElement?.contains(range.startContainer) || type === "title") {
        openSearchAV("", protyle.breadcrumb.element, (listItemElement) => {
            const avID = listItemElement.dataset.avId;
            transaction(protyle, [{
                action: "insertAttrViewBlock",
                avID,
                ignoreFillFilter: true,
                srcs: [{
                    id: protyle.block.rootID,
                    isDetached: false
                }],
                blockID: listItemElement.dataset.blockId
            }, {
                action: "doUpdateUpdated",
                id: listItemElement.dataset.blockId,
                data: dayjs().format("YYYYMMDDHHmmss"),
            }], [{
                action: "removeAttrViewBlock",
                srcIDs: [protyle.block.rootID],
                avID,
            }]);
            focusByRange(range);
        });
    } else {
        let targetElement: HTMLElement;
        const ids: string[] = [];
        protyle.wysiwyg.element.querySelectorAll(".protyle-wysiwyg--select").forEach((item: HTMLElement) => {
            if (!targetElement) {
                targetElement = item;
            }
            ids.push(item.getAttribute("data-node-id"));
        });
        if (!targetElement) {
            const nodeElement = hasClosestBlock(range.startContainer);
            if (nodeElement) {
                targetElement = nodeElement;
                ids.push(nodeElement.getAttribute("data-node-id"));
            }
        }
        if (!targetElement) {
            targetElement = protyle.wysiwyg.element;
            ids.push(protyle.block.rootID);
        }
        openSearchAV("", targetElement, (listItemElement) => {
            const srcIDs: string[] = [];
            const srcs: IOperationSrcs[] = [];
            ids.forEach(item => {
                srcIDs.push(item);
                srcs.push({
                    id: item,
                    isDetached: false
                });
            });
            const avID = listItemElement.dataset.avId;
            transaction(protyle, [{
                action: "insertAttrViewBlock",
                avID,
                ignoreFillFilter: true,
                srcs,
                blockID: listItemElement.dataset.blockId
            }, {
                action: "doUpdateUpdated",
                id: listItemElement.dataset.blockId,
                data: dayjs().format("YYYYMMDDHHmmss"),
            }], [{
                action: "removeAttrViewBlock",
                srcIDs,
                avID,
            }]);
            focusByRange(range);
        });
    }
};
