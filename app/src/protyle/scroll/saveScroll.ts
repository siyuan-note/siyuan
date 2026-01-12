import {hasClosestBlock} from "../util/hasClosest";
import {getSelectionOffset} from "../util/selection";
import {fetchPost} from "../../util/fetch";
import {onGet} from "../util/onGet";
import {Constants} from "../../constants";
import {setStorageVal} from "../util/compatibility";
import {isSupportCSSHL} from "../render/searchMarkRender";

export const saveScroll = (protyle: IProtyle, getObject = false) => {
    if (!protyle.wysiwyg.element.firstElementChild || window.siyuan.config.readonly) {
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
    if (!range || !protyle.wysiwyg.element.contains(range.startContainer)) {
        range = protyle.toolbar.range;
    }
    if (range && protyle.wysiwyg.element.contains(range.startContainer)) {
        const blockElement = hasClosestBlock(range.startContainer);
        if (blockElement) {
            const position = getSelectionOffset(blockElement, undefined, range);
            attr.focusId = blockElement.getAttribute("data-node-id");
            attr.focusStart = position.start;
            attr.focusEnd = position.end;
        }
    }

    if (protyle.block.showAll) {
        attr.zoomInId = protyle.block.id;
    }
    if (getObject) {
        return attr;
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
    cb?: (keys: string[]) => void
    focus?: boolean,
    updateReadonly?: boolean
}) => {
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
    if (options.scrollAttr?.zoomInId && options.scrollAttr?.rootId && options.scrollAttr.zoomInId !== options.scrollAttr.rootId) {
        fetchPost("/api/filetree/getDoc", {
            id: options.scrollAttr.zoomInId,
            size: Constants.SIZE_GET_MAX,
            query: options.protyle.query?.key,
            queryMethod: options.protyle.query?.method,
            queryTypes: options.protyle.query?.types,
            highlight: !isSupportCSSHL(),
        }, response => {
            if (response.code === 1) {
                fetchPost("/api/filetree/getDoc", {
                    id: options.scrollAttr.rootId || options.mergedOptions?.blockId || options.protyle.block?.rootID || options.scrollAttr.startId,
                    query: options.protyle.query?.key,
                    queryMethod: options.protyle.query?.method,
                    queryTypes: options.protyle.query?.types,
                    highlight: !isSupportCSSHL(),
                }, response => {
                    onGet({
                        scrollPosition: options.mergedOptions?.scrollPosition,
                        data: response,
                        protyle: options.protyle,
                        action: actions,
                        scrollAttr: options.scrollAttr,
                        afterCB: options.cb ? () => {
                            options.cb(response.data.keywords);
                        } : undefined,
                        updateReadonly: options.updateReadonly
                    });
                });
            } else {
                actions.push(Constants.CB_GET_ALL);
                onGet({
                    scrollPosition: options.mergedOptions?.scrollPosition,
                    data: response,
                    protyle: options.protyle,
                    action: actions,
                    scrollAttr: options.scrollAttr,
                    afterCB: options.cb ? () => {
                        options.cb(response.data.keywords);
                    } : undefined,
                    updateReadonly: options.updateReadonly
                });
            }
        });
        return;
    }
    fetchPost("/api/filetree/getDoc", {
        id: options.scrollAttr?.rootId || options.mergedOptions?.blockId || options.protyle.block?.rootID || options.scrollAttr?.startId,
        startID: options.scrollAttr?.startId,
        endID: options.scrollAttr?.endId,
        query: options.protyle.query?.key,
        queryMethod: options.protyle.query?.method,
        queryTypes: options.protyle.query?.types,
        highlight: !isSupportCSSHL(),
    }, response => {
        onGet({
            scrollPosition: options.mergedOptions?.scrollPosition,
            data: response,
            protyle: options.protyle,
            action: actions,
            scrollAttr: options.scrollAttr,
            afterCB: options.cb ? () => {
                options.cb(response.data.keywords);
            } : undefined,
            updateReadonly: options.updateReadonly
        });
    });
};
