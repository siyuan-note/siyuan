import {hasClosestBlock, hasClosestByAttribute} from "../protyle/util/hasClosest";
import {getContenteditableElement} from "../protyle/wysiwyg/getBlock";
import {focusByOffset, focusByRange, getSelectionOffset} from "../protyle/util/selection";
import {hideElements} from "../protyle/ui/hideElements";
import {fetchPost, fetchSyncPost} from "./fetch";
import {Constants} from "../constants";
import {Wnd} from "../layout/Wnd";
import {getInstanceById, getWndByLayout} from "../layout/util";
import {Tab} from "../layout/Tab";
import {Editor} from "../editor";
import {onGet} from "../protyle/util/onGet";
import {scrollCenter} from "./highlightById";
import {lockFile} from "../dialog/processSystem";
import {zoomOut} from "../menus/protyle";

let forwardStack: IBackStack[] = [];
let previousIsBack = false;

const focusStack = async (stack: IBackStack) => {
    hideElements(["gutter", "toolbar", "hint", "util", "dialog"], stack.protyle);
    let blockElement: Element;
    if (!stack.protyle.element.parentElement) {
        const response = await fetchSyncPost("/api/block/checkBlockExist", {id: stack.protyle.block.rootID});
        if (!response.data) {
            // 页签删除
            return false;
        }
        let wnd: Wnd;
        // 获取光标所在 tab
        const element = document.querySelector(".layout__wnd--active");
        if (element) {
            wnd = getInstanceById(element.getAttribute("data-id")) as Wnd;
        }
        if (!wnd) {
            // 中心 tab
            wnd = getWndByLayout(window.siyuan.layout.centerLayout);
        }
        if (wnd) {
            const info = await fetchSyncPost("/api/block/getBlockInfo", {id: stack.id});
            if (info.code === 2) {
                // 文件被锁定
                lockFile(info.data);
                return false;
            }
            const tab = new Tab({
                title: info.data.rootTitle,
                docIcon: info.data.rootIcon,
                callback(tab) {
                    const editor = new Editor({
                        tab,
                        blockId: info.data.rootChildID,
                    });
                    tab.addModel(editor);
                }
            });
            wnd.addTab(tab);
            wnd.showHeading();
            // 页签关闭
            setTimeout(() => {
                const protyle = (tab.model as Editor).editor.protyle;
                forwardStack.find(item => {
                    if (!item.protyle.element.parentElement && item.protyle.block.rootID === protyle.block.rootID) {
                        item.protyle = protyle;
                    }
                });
                window.siyuan.backStack.find(item => {
                    if (!item.protyle.element.parentElement && item.protyle.block.rootID === protyle.block.rootID) {
                        item.protyle = protyle;
                    }
                });
                if (protyle.block.rootID === stack.id) {
                    focusByOffset(protyle.title.editElement, stack.position.start, stack.position.end);
                } else {
                    Array.from(protyle.wysiwyg.element.querySelectorAll(`[data-node-id="${stack.id}"]`)).find(item => {
                        if (!hasClosestByAttribute(item, "data-type", "NodeBlockQueryEmbed")) {
                            blockElement = item;
                            return true;
                        }
                    });
                    focusByOffset(blockElement, stack.position.start, stack.position.end);
                    scrollCenter(protyle, blockElement);
                }
            }, 500);
            return true;
        } else {
            return false;
        }
    }

    if (stack.protyle.block.rootID === stack.id) {
        if (stack.protyle.title.editElement.getBoundingClientRect().height === 0) {
            // 切换 tab
            stack.protyle.model.parent.parent.switchTab(stack.protyle.model.parent.headElement);
        }
        focusByOffset(stack.protyle.title.editElement, stack.position.start, stack.position.end);
        return true;
    }
    Array.from(stack.protyle.wysiwyg.element.querySelectorAll(`[data-node-id="${stack.id}"]`)).find(item => {
        if (!hasClosestByAttribute(item, "data-type", "NodeBlockQueryEmbed")) {
            blockElement = item;
            return true;
        }
    });
    if (blockElement) {
        if (blockElement.getBoundingClientRect().height === 0) {
            // 切换 tab
            stack.protyle.model.parent.parent.switchTab(stack.protyle.model.parent.headElement);
        }
        if (stack.isZoom) {
            zoomOut(stack.protyle, stack.id, undefined, false);
            return true;
        }
        if (blockElement && !stack.protyle.block.showAll) {
            focusByOffset(blockElement, stack.position.start, stack.position.end);
            scrollCenter(stack.protyle, blockElement, true);
            return true;
        }
        // 缩放不一致
        fetchPost("/api/filetree/getDoc", {
            id: stack.id,
            mode: stack.isZoom ? 0 : 3,
            size: stack.isZoom ? Constants.SIZE_GET_MAX : Constants.SIZE_GET,
        }, getResponse => {
            onGet(getResponse, stack.protyle);
            Array.from(stack.protyle.wysiwyg.element.querySelectorAll(`[data-node-id="${stack.id}"]`)).find(item => {
                if (!hasClosestByAttribute(item, "data-type", "NodeBlockQueryEmbed")) {
                    blockElement = item;
                    return true;
                }
            });
            focusByOffset(blockElement, stack.position.start, stack.position.end);
            setTimeout(() => {
                // 图片、视频等加载完成后再定位
                scrollCenter(stack.protyle, blockElement, true);
            }, Constants.TIMEOUT_BLOCKLOAD);
        });
        return true;
    }
    if (stack.protyle.element.parentElement) {
        const response = await fetchSyncPost("/api/block/checkBlockExist", {id: stack.id});
        if (!response.data) {
            // 块被删除
            if (getSelection().rangeCount > 0) {
                focusByRange(getSelection().getRangeAt(0));
            }
            return false;
        }
        const info = await fetchSyncPost("/api/block/getBlockInfo", {id: stack.id});
        if (info.code === 2) {
            // 文件被锁定
            lockFile(info.data);
            return false;
        }
        fetchPost("/api/filetree/getDoc", {
            id: info.data.rootChildID,
            mode: stack.isZoom ? 0 : 3,
            size: stack.isZoom ? Constants.SIZE_GET_MAX : Constants.SIZE_GET,
        }, getResponse => {
            onGet(getResponse, stack.protyle);
            Array.from(stack.protyle.wysiwyg.element.querySelectorAll(`[data-node-id="${stack.id}"]`)).find(item => {
                if (!hasClosestByAttribute(item, "data-type", "NodeBlockQueryEmbed")) {
                    blockElement = item;
                    return true;
                }
            });
            focusByOffset(blockElement, stack.position.start, stack.position.end);
            setTimeout(() => {
                scrollCenter(stack.protyle, blockElement);
            }, Constants.TIMEOUT_INPUT);
        });
        return true;
    }
};

export const goBack = async () => {
    if (window.siyuan.backStack.length === 0) {
        if (forwardStack.length > 0) {
            await focusStack(forwardStack[forwardStack.length - 1]);
        }
        return;
    }
    document.querySelector("#barForward").classList.remove("toolbar__item--disabled");

    if (!previousIsBack) {
        forwardStack.push(window.siyuan.backStack.pop());
    }
    let stack = window.siyuan.backStack.pop();
    while (stack) {
        const isFocus = await focusStack(stack);
        if (isFocus) {
            forwardStack.push(stack);
            break;
        } else {
            stack = window.siyuan.backStack.pop();
        }
    }

    if (window.siyuan.backStack.length === 0) {
        document.querySelector("#barBack").classList.add("toolbar__item--disabled");
    }
    previousIsBack = true;
};

export const goForward = async () => {
    if (forwardStack.length === 0) {
        if (window.siyuan.backStack.length > 0) {
            await focusStack(window.siyuan.backStack[window.siyuan.backStack.length - 1]);
        }
        return;
    }
    document.querySelector("#barBack").classList.remove("toolbar__item--disabled");
    if (previousIsBack) {
        window.siyuan.backStack.push(forwardStack.pop());
    }

    let stack = forwardStack.pop();
    while (stack) {
        const isFocus = await focusStack(stack);
        if (isFocus) {
            window.siyuan.backStack.push(stack);
            break;
        } else {
            stack = forwardStack.pop();
        }
    }

    if (forwardStack.length === 0) {
        document.querySelector("#barForward").classList.add("toolbar__item--disabled");
    }
    previousIsBack = false;
};

export const pushBack = (protyle: IProtyle, range?: Range, blockElement?: Element) => {
    if (!protyle.model) {
        return;
    }
    if (!blockElement) {
        blockElement = hasClosestBlock(range.startContainer) as Element;
    }
    if (!blockElement) {
        return;
    }
    let editElement;
    if (blockElement.classList.contains("protyle-title__input")) {
        editElement = blockElement;
    } else {
        editElement = getContenteditableElement(blockElement);
    }
    if (editElement) {
        const position = getSelectionOffset(editElement, undefined, range);
        const id = blockElement.getAttribute("data-node-id") || protyle.block.rootID;
        const lastStack = window.siyuan.backStack[window.siyuan.backStack.length - 1];
        const isZoom = protyle.block.id !== protyle.block.rootID;
        if (lastStack && lastStack.id === id && lastStack.isZoom === isZoom) {
            lastStack.position = position;
        } else {
            if (forwardStack.length > 0) {
                if (previousIsBack) {
                    window.siyuan.backStack.push(forwardStack.pop());
                }
                forwardStack = [];
                document.querySelector("#barForward").classList.add("toolbar__item--disabled");
            }
            window.siyuan.backStack.push({
                position,
                id,
                protyle,
                isZoom
            });
            if (window.siyuan.backStack.length > Constants.SIZE_UNDO) {
                window.siyuan.backStack.shift();
            }
            previousIsBack = false;
        }

        if (window.siyuan.backStack.length > 1) {
            document.querySelector("#barBack").classList.remove("toolbar__item--disabled");
        }
    }
};
