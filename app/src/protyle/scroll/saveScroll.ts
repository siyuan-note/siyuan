import {hasClosestBlock} from "../util/hasClosest";
import {getSelectionOffset} from "../util/selection";
import {fetchPost} from "../../util/fetch";
import {onGet} from "../util/onGet";
import {Constants} from "../../constants";
import {setStorageVal} from "../util/compatibility";
import {isSupportCSSHL} from "../render/searchMarkRender";
import {isEncryptedBox} from "../../util/pathName";
import {getContenteditableElement} from "../wysiwyg/getBlock";

export const saveScroll = (protyle: IProtyle, getObject = false) => {
    if (!protyle.wysiwyg.element.firstElementChild || window.siyuan.config.readonly ||
        (protyle.element.dataset.databaseRowId && !getObject)) {
        // 报错或者空白页面
        return undefined;
    }
    const attr: IScrollAttr = {
        rootId: protyle.block.rootID,
        startId: protyle.wysiwyg.element.firstElementChild.getAttribute("data-node-id"),
        endId: protyle.wysiwyg.element.lastElementChild.getAttribute("data-node-id"),
        scrollTop: protyle.contentElement.scrollTop || parseInt(protyle.contentElement.getAttribute("data-scrolltop")) || 0,
    };
    let range: Range;
    if (getSelection().rangeCount > 0) {
        range = getSelection().getRangeAt(0);
    }
    // 光标位于文档标题时用文档 id 作为焦点标识 https://github.com/siyuan-note/siyuan/issues/17456
    if (range && protyle.title?.editElement?.contains(range.startContainer)) {
        const position = getSelectionOffset(protyle.title.editElement, undefined, range);
        attr.focusId = protyle.block.rootID;
        attr.focusStart = position.start;
        attr.focusEnd = position.end;
    } else {
        if (!range || !protyle.wysiwyg.element.contains(range.startContainer)) {
            range = protyle.toolbar.range;
        }
        if (range && protyle.wysiwyg.element.contains(range.startContainer)) {
            const blockElement = hasClosestBlock(range.startContainer);
            if (blockElement) {
                const position = getSelectionOffset(getContenteditableElement(blockElement) || blockElement, undefined, range);
                attr.focusId = blockElement.getAttribute("data-node-id");
                attr.focusStart = position.start;
                attr.focusEnd = position.end;
            }
        }
    }

    if (protyle.block.showAll) {
        attr.zoomInId = protyle.block.id;
    }
    if (getObject) {
        return attr;
    }

    if (isEncryptedBox(protyle.notebookId)) {
        delete window.siyuan.storage[Constants.LOCAL_FILEPOSITION][protyle.block.rootID];
        return Promise.resolve(true);
    }
    window.siyuan.storage[Constants.LOCAL_FILEPOSITION][protyle.block.rootID] = attr;
    return new Promise(resolve => {
        setStorageVal(Constants.LOCAL_FILEPOSITION, window.siyuan.storage[Constants.LOCAL_FILEPOSITION], () => {
            resolve(true);
        });
    });
};

export const getDocByScroll = (options: {
    protyle: IProtyle,
    scrollAttr?: IScrollAttr,
    mergedOptions?: IProtyleOptions,
    cb?: (keys: string[]) => void,
    focus?: boolean,
    updateReadonly?: boolean,
    signal?: AbortSignal,
    fail?: (invalid?: boolean) => void,
    isValid?: () => boolean,
}) => {
    const fetchDoc = (params: Record<string, any>, callback: (response: IWebSocketData) => void) => {
        let handled = false;
        void fetchPost("/api/filetree/getDoc", params, (response) => {
            handled = true;
            callback(response);
        }, undefined, undefined, options.signal).then(() => {
            if (!handled) {
                options.fail?.();
            }
        });
    };
    let actions: TProtyleAction[] = [];
    if (options.mergedOptions) {
        actions = options.mergedOptions.action;
    } else {
        if (options.focus) {
            actions = [Constants.CB_GET_UNUNDO, Constants.CB_GET_FOCUS];
        } else {
            actions = [Constants.CB_GET_UNUNDO];
        }
    }
    const renderDoc = (response: IWebSocketData) => {
        try {
            onGet({
                scrollPosition: options.mergedOptions?.scrollPosition,
                data: response,
                protyle: options.protyle,
                action: actions,
                scrollAttr: options.scrollAttr,
                afterCB: options.cb ? () => {
                    options.cb(response.data.keywords);
                } : undefined,
                updateReadonly: options.updateReadonly,
                isValid: options.isValid,
            });
        } catch (error) {
            console.error(error);
            options.fail?.();
            return;
        }
    };
    if (options.scrollAttr?.zoomInId && options.scrollAttr?.rootId && options.scrollAttr.zoomInId !== options.scrollAttr.rootId) {
        const getDocParam: Record<string, any> = {
            id: options.scrollAttr.zoomInId,
            size: Constants.SIZE_GET_MAX,
            query: options.protyle.query?.key,
            queryMethod: options.protyle.query?.method,
            queryTypes: options.protyle.query?.types,
            querySubTypes: options.protyle.query?.subTypes,
            highlight: !isSupportCSSHL(),
        };
        if (isEncryptedBox(options.protyle.notebookId)) {
            getDocParam.notebook = options.protyle.notebookId;
        }
        fetchDoc(getDocParam, response => {
            if (response.code === 1) {
                const getDocParam: Record<string, any> = {
                    id: options.scrollAttr.rootId || options.mergedOptions?.blockId || options.protyle.block?.rootID || options.scrollAttr.startId,
                    query: options.protyle.query?.key,
                    queryMethod: options.protyle.query?.method,
                    queryTypes: options.protyle.query?.types,
                    querySubTypes: options.protyle.query?.subTypes,
                    highlight: !isSupportCSSHL(),
                };
                if (isEncryptedBox(options.protyle.notebookId)) {
                    getDocParam.notebook = options.protyle.notebookId;
                }
                fetchDoc(getDocParam, response => {
                    if (response.code !== 0 && options.fail) {
                        options.fail(true);
                        return;
                    }
                    renderDoc(response);
                });
            } else {
                if (response.code !== 0 && options.fail) {
                    options.fail(true);
                    return;
                }
                actions.push(Constants.CB_GET_ALL);
                renderDoc(response);
            }
        });
        return;
    }
    const getDocParam: Record<string, any> = {
        id: options.scrollAttr?.rootId || options.mergedOptions?.blockId || options.protyle.block?.rootID || options.scrollAttr?.startId,
        startID: options.scrollAttr?.startId,
        endID: options.scrollAttr?.endId,
        query: options.protyle.query?.key,
        queryMethod: options.protyle.query?.method,
        queryTypes: options.protyle.query?.types,
        querySubTypes: options.protyle.query?.subTypes,
        highlight: !isSupportCSSHL(),
    };
    if (isEncryptedBox(options.protyle.notebookId)) {
        getDocParam.notebook = options.protyle.notebookId;
    }
    fetchDoc(getDocParam, response => {
        if (response.code !== 0 && options.fail) {
            options.fail(true);
            return;
        }
        renderDoc(response);
    });
};
