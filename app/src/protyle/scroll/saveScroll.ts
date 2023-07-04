import {hasClosestBlock} from "../util/hasClosest";
import {getSelectionOffset} from "../util/selection";
import {fetchPost} from "../../util/fetch";
import {onGet} from "../util/onGet";
import {Constants} from "../../constants";

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
    const jsonAttr = JSON.stringify(attr);
    fetchPost("/api/attr/setBlockAttrs", {id: protyle.block.rootID, attrs: {scroll: jsonAttr}}, () => {
        protyle.wysiwyg.element.setAttribute("scroll", jsonAttr);
    });
};

export const getDocByScroll = (options: {
    protyle: IProtyle,
    scrollAttr: IScrollAttr,
    mergedOptions?: IOptions,
    cb?: () => void
    focus?: boolean
}) => {
    let actions: string[] = [];
    if (options.mergedOptions) {
        actions = options.mergedOptions.action;
    } else {
        if (options.focus) {
            actions = [Constants.CB_GET_UNUNDO, Constants.CB_GET_FOCUS];
        } else {
            actions = [Constants.CB_GET_UNUNDO];
        }
    }
    if (options.scrollAttr.zoomInId) {
        fetchPost("/api/filetree/getDoc", {
            id: options.scrollAttr.zoomInId,
            size: Constants.SIZE_GET_MAX,
        }, response => {
            actions.push(Constants.CB_GET_ALL);
            onGet({
                data: response,
                protyle: options.protyle,
                action: actions,
                scrollAttr: options.scrollAttr,
            });
            if (options.cb) {
                options.cb();
            }
        });
        return;
    }
    fetchPost("/api/filetree/getDoc", {
        id: options.scrollAttr.rootId || options.mergedOptions?.blockId || options.protyle.block?.rootID || options.scrollAttr.startId,
        startID: options.scrollAttr.startId,
        endID: options.scrollAttr.endId,
    }, response => {
        onGet({
            data: response,
            protyle: options.protyle,
            action: actions,
            scrollAttr: options.scrollAttr,
        });
        if (options.cb) {
            options.cb();
        }
    });
};
