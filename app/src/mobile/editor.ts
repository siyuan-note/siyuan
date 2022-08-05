import Protyle from "../protyle";
import {setEditor} from "./util/setEmpty";
import {closePanel} from "./util/closePanel";
import {Constants} from "../constants";
import {fetchPost} from "../util/fetch";
import {disabledProtyle, enableProtyle, onGet} from "../protyle/util/onGet";
import {addLoading} from "../protyle/ui/initUI";
import {focusBlock} from "../protyle/util/selection";
import {scrollCenter} from "../util/highlightById";
import {lockFile} from "../dialog/processSystem";
import {hasClosestByAttribute} from "../protyle/util/hasClosest";
import {setEditMode} from "../protyle/util/setEditMode";
import {hideElements} from "../protyle/ui/hideElements";

export const openMobileFileById = (id: string, action = [Constants.CB_GET_HL], pushStack = true) => {
    window.localStorage.setItem(Constants.LOCAL_DOCINFO, JSON.stringify({id, action}));
    if (window.siyuan.mobileEditor) {
        hideElements(["toolbar", "hint", "util"], window.siyuan.mobileEditor.protyle);
        if (window.siyuan.mobileEditor.protyle.contentElement.classList.contains("fn__none")) {
            setEditMode(window.siyuan.mobileEditor.protyle, "wysiwyg");
        }
        let blockElement;
        Array.from(window.siyuan.mobileEditor.protyle.wysiwyg.element.querySelectorAll(`[data-node-id="${id}"]`)).find(item => {
            if (!hasClosestByAttribute(item.parentElement, "data-type", "NodeBlockQueryEmbed")) {
                blockElement = item;
                return true;
            }
        });
        if (blockElement) {
            // https://github.com/siyuan-note/siyuan/issues/4327
            if (pushStack) {
                window.siyuan.backStack.push({
                    id,
                    scrollTop: window.siyuan.mobileEditor.protyle.contentElement.scrollTop,
                    callback: action,
                });
            }
            focusBlock(blockElement);
            scrollCenter(window.siyuan.mobileEditor.protyle, blockElement, true);
            closePanel();
            return;
        }
    }

    fetchPost("/api/block/getBlockInfo", {id}, (data) => {
        if (data.code === 2) {
            // 文件被锁定
            lockFile(data.data);
            return;
        }
        if (window.siyuan.mobileEditor) {
            addLoading(window.siyuan.mobileEditor.protyle);
            fetchPost("/api/filetree/getDoc", {
                id,
                size: action.includes(Constants.CB_GET_ALL) ? Constants.SIZE_GET_MAX : Constants.SIZE_GET,
                mode: !action.includes(Constants.CB_GET_ALL) ? 3 : 0,
            }, getResponse => {
                onGet(getResponse, window.siyuan.mobileEditor.protyle, action);
                window.siyuan.mobileEditor.protyle.breadcrumb.render(window.siyuan.mobileEditor.protyle);
            });
            window.siyuan.mobileEditor.protyle.undo.clear();
        } else {
            window.siyuan.mobileEditor = new Protyle(document.getElementById("editor"), {
                blockId: id,
                action,
                render: {
                    background: true,
                    gutter: true,
                },
                typewriterMode: true,
                preview: {
                    actions: ["mp-wechat", "zhihu"]
                },
                after: (editor) => {
                    // protyle 仅初始化一次，后续更新时会对 url 等再次复制
                    if (window.siyuan.config.readonly || document.querySelector("#toolbarEdit use").getAttribute("xlink:href") === "#iconEdit") {
                        disabledProtyle(editor.protyle);
                    } else {
                        enableProtyle(editor.protyle);
                    }
                }
            });
        }
        (document.getElementById("toolbarName") as HTMLInputElement).value = data.data.rootTitle === "Untitled" ? "" : data.data.rootTitle;
        setEditor();
        closePanel();
        if (pushStack) {
            window.siyuan.backStack.push({
                id,
                scrollTop: window.siyuan.mobileEditor.protyle.contentElement.scrollTop,
                callback: action,
            });
        }
    });
};
