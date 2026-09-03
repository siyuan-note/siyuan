import {getTitleEnterAction} from "./titleEnterCore";
import {isDocumentBoundaryLoaded} from "../util/documentRange";
import {getContenteditableElement} from "../wysiwyg/getBlock";
import {focusBlock, focusByWbr, getEditorRange} from "../util/selection";
import {genEmptyElement} from "../../block/util";
import {transaction} from "../wysiwyg/transaction";
import {fetchPost} from "../../util/fetch";
import {isEncryptedBox} from "../../util/pathName";
import {onGet} from "../util/onGet";
/// #if MOBILE
import {pauseMobileBarsScroll} from "../../mobile/util/mobileBars";
/// #endif

const enterLoadedDocumentStart = (protyle: IProtyle) => {
    const firstElement = protyle.wysiwyg.element.firstElementChild;
    if (!firstElement) {
        return;
    }
    const editElement = getContenteditableElement(firstElement);
    const action = getTitleEnterAction({
        documentStartLoaded: true,
        hasFirstBlock: true,
        firstBlockIsList: firstElement.classList.contains("li"),
        firstEditableIsEmpty: editElement?.textContent === "",
        firstEditableHasPlaceholder: Boolean(editElement?.getAttribute("placeholder")),
    });
    /// #if MOBILE
    pauseMobileBarsScroll();
    /// #endif
    protyle.contentElement.scrollTop = 0;
    protyle.scroll.lastScrollTop = 1;
    if (action === "focus") {
        // 配合提示文本使用，避免提示文本挤压到第二个块中
        focusBlock(firstElement, protyle.wysiwyg.element);
        return;
    }

    const newId = Lute.NewNodeID();
    const newElement = genEmptyElement(false, true, newId);
    protyle.wysiwyg.element.insertAdjacentElement("afterbegin", newElement);
    focusByWbr(newElement, protyle.toolbar.range || getEditorRange(newElement));
    transaction(protyle, [{
        action: "insert",
        data: newElement.outerHTML,
        id: newId,
        parentID: protyle.block.parentID,
    }], [{
        action: "delete",
        id: newId,
    }]);
};

export const enterDocumentFromTitle = (protyle: IProtyle, options?: {
    beforeLoad?: Promise<unknown>,
    isValid?: () => boolean,
}) => {
    const isValid = options?.isValid || (() => true);
    if (!isValid()) {
        return;
    }
    const firstElement = protyle.wysiwyg.element.firstElementChild;
    const editElement = firstElement ? getContenteditableElement(firstElement) : undefined;
    const action = getTitleEnterAction({
        documentStartLoaded: isDocumentBoundaryLoaded(protyle.wysiwyg.element, "before"),
        hasFirstBlock: Boolean(firstElement),
        firstBlockIsList: firstElement?.classList.contains("li") || false,
        firstEditableIsEmpty: editElement?.textContent === "",
        firstEditableHasPlaceholder: Boolean(editElement?.getAttribute("placeholder")),
    });
    if (action !== "load") {
        enterLoadedDocumentStart(protyle);
        return;
    }

    const rootID = protyle.block.rootID;
    const loadDocumentStart = () => {
        if (!isValid() || protyle.block.rootID !== rootID) {
            return;
        }
        const getDocParam: IObject = {
            id: rootID,
            mode: 0,
            size: window.siyuan.config.editor.dynamicLoadBlocks,
        };
        if (isEncryptedBox(protyle.notebookId)) {
            getDocParam.notebook = protyle.notebookId;
        }
        fetchPost("/api/filetree/getDoc", getDocParam, (response) => {
            if (!isValid() || protyle.block.rootID !== rootID) {
                return;
            }
            onGet({
                data: response,
                protyle,
                action: [],
                isValid: () => isValid() && protyle.block.rootID === rootID,
                afterCB() {
                    if (isValid() && protyle.block.rootID === rootID) {
                        enterLoadedDocumentStart(protyle);
                    }
                },
            });
        });
    };
    if (options?.beforeLoad) {
        void options.beforeLoad.then(loadDocumentStart, loadDocumentStart);
    } else {
        loadDocumentStart();
    }
};
