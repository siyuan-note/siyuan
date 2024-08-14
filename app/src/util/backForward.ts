import {hasClosestBlock, isInEmbedBlock} from "../protyle/util/hasClosest";
import {getContenteditableElement} from "../protyle/wysiwyg/getBlock";
import {focusByOffset, focusByRange, getSelectionOffset} from "../protyle/util/selection";
import {hideElements} from "../protyle/ui/hideElements";
import {fetchPost, fetchSyncPost} from "./fetch";
import {Constants} from "../constants";
import {Wnd} from "../layout/Wnd";
import {getInstanceById, getWndByLayout} from "../layout/util";
import {Tab} from "../layout/Tab";
import {Editor} from "../editor";
import {scrollCenter} from "./highlightById";
import {zoomOut} from "../menus/protyle";
import {showMessage} from "../dialog/message";
import {saveScroll} from "../protyle/scroll/saveScroll";
import {getAllModels} from "../layout/getAll";
import {App} from "../index";
import {onGet} from "../protyle/util/onGet";

let forwardStack: IBackStack[] = [];
let previousIsBack = false;

const focusStack = async (app: App, stack: IBackStack) => {
    hideElements(["gutter", "toolbar", "hint", "util", "dialog"], stack.protyle);
    let blockElement: HTMLElement;
    if (!document.contains(stack.protyle.element)) {
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
            if (info.code === 3) {
                showMessage(info.msg);
                return;
            }
            const tab = new Tab({
                title: info.data.rootTitle,
                docIcon: info.data.rootIcon,
                callback(tab) {
                    const scrollAttr = saveScroll(stack.protyle, true);
                    scrollAttr.rootId = stack.protyle.block.rootID;
                    scrollAttr.focusId = stack.id;
                    scrollAttr.focusStart = stack.position.start;
                    scrollAttr.focusEnd = stack.position.end;
                    window.siyuan.storage[Constants.LOCAL_FILEPOSITION][stack.protyle.block.rootID] = scrollAttr;
                    const editor = new Editor({
                        app: app,
                        tab,
                        blockId: stack.zoomId || stack.protyle.block.rootID,
                        rootId: stack.protyle.block.rootID,
                        action: stack.zoomId ? [Constants.CB_GET_FOCUS, Constants.CB_GET_ALL] : [Constants.CB_GET_FOCUS]
                    });
                    tab.addModel(editor);
                }
            });
            if (window.siyuan.config.fileTree.openFilesUseCurrentTab) {
                let unUpdateTab: Tab;
                // 不能 reverse, 找到也不能提前退出循环，否则 https://github.com/siyuan-note/siyuan/issues/3271
                wnd.children.forEach((item) => {
                    if (item.headElement && item.headElement.classList.contains("item--unupdate") && !item.headElement.classList.contains("item--pin")) {
                        unUpdateTab = item;
                    }
                });
                wnd.addTab(tab);
                if (unUpdateTab) {
                    wnd.removeTab(unUpdateTab.id);
                }
            } else {
                wnd.addTab(tab);
            }
            wnd.showHeading();
            // 替换被关闭的 protyle
            const protyle = (tab.model as Editor).editor.protyle;
            stack.protyle = protyle;
            forwardStack.forEach(item => {
                if (!document.contains(item.protyle.element) && item.protyle.block.rootID === info.data.rootID) {
                    item.protyle = protyle;
                }
            });
            window.siyuan.backStack.forEach(item => {
                if (!document.contains(item.protyle.element) && item.protyle.block.rootID === info.data.rootID) {
                    item.protyle = protyle;
                }
            });
            if (info.data.rootID === stack.id) {
                focusByOffset(protyle.title.editElement, stack.position.start, stack.position.end);
            } else {
                Array.from(protyle.wysiwyg.element.querySelectorAll(`[data-node-id="${stack.id}"]`)).find((item: HTMLElement) => {
                    if (!isInEmbedBlock(item)) {
                        blockElement = item;
                        return true;
                    }
                });
                focusByOffset(getContenteditableElement(blockElement), stack.position.start, stack.position.end);
                scrollCenter(protyle, blockElement);
            }
            return true;
        } else {
            return false;
        }
    }

    if (stack.protyle.block.rootID === stack.id) {
        if (stack.protyle.title.editElement.getBoundingClientRect().height === 0) {
            // 切换 tab
            stack.protyle.model.parent.parent.switchTab(stack.protyle.model.parent.headElement);
            // 需要更新 range，否则 resize 中 `保持光标位置不变` 会导致光标跳动
            stack.protyle.toolbar.range = undefined;
        }
        focusByOffset(stack.protyle.title.editElement, stack.position.start, stack.position.end);
        return true;
    }
    Array.from(stack.protyle.wysiwyg.element.querySelectorAll(`[data-node-id="${stack.id}"]`)).find((item: HTMLElement) => {
        if (!isInEmbedBlock(item)) {
            blockElement = item;
            return true;
        }
    });
    if (blockElement &&
        // 即使块存在，折叠的情况需要也需要 zoomOut，否则折叠块内的光标无法定位
        (!stack.zoomId || (stack.zoomId && stack.zoomId === stack.protyle.block.id))
    ) {
        if (blockElement.getBoundingClientRect().height === 0) {
            // 切换 tab
            stack.protyle.model.parent.parent.switchTab(stack.protyle.model.parent.headElement);
        }
        focusByOffset(getContenteditableElement(blockElement), stack.position.start, stack.position.end);
        scrollCenter(stack.protyle, blockElement);
        getAllModels().outline.forEach(item => {
            if (item.blockId === stack.protyle.block.rootID) {
                item.setCurrent(blockElement);
            }
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
        // 动态加载导致内容移除 https://github.com/siyuan-note/siyuan/issues/10692
        if (!blockElement && !stack.zoomId && !stack.protyle.scroll.element.classList.contains("fn__none")) {
            fetchPost("/api/filetree/getDoc", {
                id: stack.id,
                mode: 3,
                size: window.siyuan.config.editor.dynamicLoadBlocks,
            }, getResponse => {
                onGet({
                    data: getResponse,
                    protyle: stack.protyle,
                    afterCB() {
                        Array.from(stack.protyle.wysiwyg.element.querySelectorAll(`[data-node-id="${stack.id}"]`)).find((item: HTMLElement) => {
                            if (!isInEmbedBlock(item)) {
                                blockElement = item;
                                return true;
                            }
                        });
                        if (!blockElement) {
                            return;
                        }
                        getAllModels().outline.forEach(item => {
                            if (item.blockId === stack.protyle.block.rootID) {
                                item.setCurrent(blockElement);
                            }
                        });
                        focusByOffset(getContenteditableElement(blockElement), stack.position.start, stack.position.end);
                        scrollCenter(stack.protyle, blockElement, true);
                    }
                });
            });
            return true;
        }

        // 缩放
        zoomOut({
            protyle: stack.protyle,
            id: stack.zoomId || stack.protyle.block.rootID,
            isPushBack: false,
            callback: () => {
                Array.from(stack.protyle.wysiwyg.element.querySelectorAll(`[data-node-id="${stack.id}"]`)).find((item: HTMLElement) => {
                    if (!isInEmbedBlock(item)) {
                        blockElement = item;
                        return true;
                    }
                });
                if (!blockElement) {
                    return;
                }
                getAllModels().outline.forEach(item => {
                    if (item.blockId === stack.protyle.block.rootID) {
                        item.setCurrent(blockElement);
                    }
                });
                focusByOffset(getContenteditableElement(blockElement), stack.position.start, stack.position.end);
                scrollCenter(stack.protyle, blockElement, true);
            }
        });
        return true;
    }
};

export const goBack = async (app: App) => {
    if (window.siyuan.backStack.length === 0) {
        if (forwardStack.length > 0) {
            await focusStack(app, forwardStack[forwardStack.length - 1]);
        }
        return;
    }
    document.querySelector("#barForward")?.classList.remove("toolbar__item--disabled");
    if (!previousIsBack &&
        // 页签被关闭时应优先打开该页签，页签存在时即可返回上一步，不用再重置光标到该页签上
        document.contains(window.siyuan.backStack[window.siyuan.backStack.length - 1].protyle.element)) {
        forwardStack.push(window.siyuan.backStack.pop());
    }
    let stack = window.siyuan.backStack.pop();
    while (stack) {
        const isFocus = await focusStack(app, stack);
        if (isFocus) {
            forwardStack.push(stack);
            break;
        } else {
            stack = window.siyuan.backStack.pop();
        }
    }
    previousIsBack = true;
    if (window.siyuan.backStack.length === 0) {
        document.querySelector("#barBack")?.classList.add("toolbar__item--disabled");
    }
};

export const goForward = async (app: App) => {
    if (forwardStack.length === 0) {
        if (window.siyuan.backStack.length > 0) {
            await focusStack(app, window.siyuan.backStack[window.siyuan.backStack.length - 1]);
        }
        return;
    }
    document.querySelector("#barBack")?.classList.remove("toolbar__item--disabled");
    if (previousIsBack) {
        window.siyuan.backStack.push(forwardStack.pop());
    }

    let stack = forwardStack.pop();
    while (stack) {
        const isFocus = await focusStack(app, stack);
        if (isFocus) {
            window.siyuan.backStack.push(stack);
            break;
        } else {
            stack = forwardStack.pop();
        }
    }
    previousIsBack = false;
    if (forwardStack.length === 0) {
        document.querySelector("#barForward")?.classList.add("toolbar__item--disabled");
    }
};

export const pushBack = (protyle: IProtyle, range?: Range, blockElement?: Element) => {
    if (!protyle.model) {
        return;
    }
    if (!blockElement && range) {
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
        if (lastStack && lastStack.id === id && (
            (protyle.block.showAll && lastStack.zoomId === protyle.block.id) || (!lastStack.zoomId && !protyle.block.showAll)
        )) {
            lastStack.position = position;
        } else {
            if (forwardStack.length > 0) {
                if (previousIsBack) {
                    window.siyuan.backStack.push(forwardStack.pop());
                }
                forwardStack = [];
                document.querySelector("#barForward")?.classList.add("toolbar__item--disabled");
            }
            window.siyuan.backStack.push({
                position,
                id,
                protyle,
                zoomId: protyle.block.showAll ? protyle.block.id : undefined,
            });
            if (window.siyuan.backStack.length > Constants.SIZE_UNDO) {
                window.siyuan.backStack.shift();
            }
            previousIsBack = false;
        }
        if (window.siyuan.backStack.length > 1) {
            document.querySelector("#barBack")?.classList.remove("toolbar__item--disabled");
        }
    }
};
