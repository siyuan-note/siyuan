import {Constants} from "../../constants";
import {hideElements} from "../ui/hideElements";
import {fetchPost} from "../../util/fetch";
import {onGet} from "../util/onGet";
import {showMessage} from "../../dialog/message";
import {updateHotkeyTip} from "../util/compatibility";

export const scrollEvent = (protyle: IProtyle, element: HTMLElement) => {
    let elementRect = element.getBoundingClientRect();
    element.addEventListener("scroll", (event) => {
        if (!protyle.toolbar.element.classList.contains("fn__none")) {
            const initY = protyle.toolbar.element.getAttribute("data-inity").split(Constants.ZWSP);
            const top = parseInt(initY[0]) + (parseInt(initY[1]) - element.scrollTop)
            if (elementRect.width === 0) {
                elementRect = element.getBoundingClientRect();
            }
            const toolbarHeight = 29;
            if (top < elementRect.top - toolbarHeight || top > elementRect.bottom - toolbarHeight) {
                protyle.toolbar.element.style.display = "none";
            } else {
                protyle.toolbar.element.style.top = top + "px";
                protyle.toolbar.element.style.display = "";
            }
            return;
        }
        if (!window.siyuan.dragElement) { // https://ld246.com/article/1649638389841
            hideElements(["gutter"], protyle);
        }
        if (!protyle.selectElement.classList.contains("fn__none")) {
            showMessage(window.siyuan.languages.crossPageUse.replace("${}", updateHotkeyTip("⇧Click")), 9000);
        }

        const panelContextElement = protyle.breadcrumb.element.parentElement.querySelector('[data-type="context"]');
        if (panelContextElement && !panelContextElement.classList.contains("ft__primary")) {
            // 悬浮窗需展开上下文后才能进行滚动 https://github.com/siyuan-note/siyuan/issues/2311
            return;
        }
        if (protyle.wysiwyg.element.getAttribute("data-top") || protyle.block.showAll || protyle.scroll.lastScrollTop === element.scrollTop || protyle.scroll.lastScrollTop === -1) {
            return;
        }
        if (protyle.scroll.lastScrollTop - element.scrollTop > 0) {
            // up
            if (element.scrollTop < element.clientHeight / 2 &&
                protyle.wysiwyg.element.firstElementChild.getAttribute("data-eof") !== "true") {
                protyle.wysiwyg.element.setAttribute("data-top", element.scrollTop.toString());
                fetchPost("/api/filetree/getDoc", {
                    id: protyle.wysiwyg.element.firstElementChild.getAttribute("data-node-id"),
                    mode: 1,
                    k: protyle.options.key || "",
                    size: Constants.SIZE_GET,
                }, getResponse => {
                    onGet(getResponse, protyle, [Constants.CB_GET_BEFORE, Constants.CB_GET_UNCHANGEID]);
                });
            }
        } else if ((element.scrollTop > element.scrollHeight - element.clientHeight * 1.8) &&
            protyle.wysiwyg.element.lastElementChild &&
            protyle.wysiwyg.element.lastElementChild.getAttribute("data-eof") !== "true") {
            protyle.wysiwyg.element.setAttribute("data-top", element.scrollTop.toString());
            fetchPost("/api/filetree/getDoc", {
                id: protyle.wysiwyg.element.lastElementChild.getAttribute("data-node-id"),
                mode: 2,
                k: protyle.options.key || "",
                size: Constants.SIZE_GET,
            }, getResponse => {
                onGet(getResponse, protyle, [Constants.CB_GET_APPEND, Constants.CB_GET_UNCHANGEID]);
            });
        }
        protyle.scroll.lastScrollTop = Math.max(element.scrollTop, 0);
    }, {
        capture: false,
        passive: true,
        once: false
    });
};
