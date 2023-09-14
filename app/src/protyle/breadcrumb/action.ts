/// #if !MOBILE
import {getAllModels} from "../../layout/getAll";
/// #endif
import {addLoading} from "../ui/initUI";
import {fetchPost} from "../../util/fetch";
import {Constants} from "../../constants";
import {hideAllElements, hideElements} from "../ui/hideElements";
import {hasClosestByClassName} from "../util/hasClosest";
import {reloadProtyle} from "../util/reload";
import {resize} from "../util/resize";

export const netImg2LocalAssets = (protyle: IProtyle) => {
    if (protyle.element.querySelector(".wysiwygLoading")) {
        return;
    }
    addLoading(protyle);
    hideElements(["toolbar"], protyle);
    fetchPost("/api/format/netImg2LocalAssets", {
        id: protyle.block.rootID
    }, () => {
        /// #if MOBILE
        reloadProtyle(protyle, false);
        /// #else
        getAllModels().editor.forEach(item => {
            if (item.editor.protyle.block.rootID === protyle.block.rootID) {
                reloadProtyle(item.editor.protyle, item.editor.protyle.element.isSameNode(protyle.element));
            }
        });
        /// #endif
    });
};

export const fullscreen = (element: Element, btnElement?: Element) => {
    setTimeout(() => {
        hideAllElements(["gutter"]);
    }, Constants.TIMEOUT_TRANSITION);   // 等待页面动画结束

    const isFullscreen = element.className.includes("fullscreen");
    if (isFullscreen) {
        element.classList.remove("fullscreen");
        if (document.querySelector("body").classList.contains("body--win32")) {
            document.getElementById("drag")?.classList.remove("fn__hidden");
        }
    } else {
        element.classList.add("fullscreen");
        if (document.querySelector("body").classList.contains("body--win32")) {
            document.getElementById("drag")?.classList.add("fn__hidden");
        }
    }

    if (btnElement) {
        if (isFullscreen) {
            btnElement.querySelector("use").setAttribute("xlink:href", "#iconFullscreen");
        } else {
            btnElement.querySelector("use").setAttribute("xlink:href", "#iconFullscreenExit");
        }
        const dockLayoutElement = hasClosestByClassName(element, "layout--float");
        if (dockLayoutElement) {
            if (isFullscreen) {
                dockLayoutElement.setAttribute("data-temp", dockLayoutElement.style.transform);
                dockLayoutElement.style.transform = "none";
            } else {
                dockLayoutElement.style.transform = dockLayoutElement.getAttribute("data-temp");
                dockLayoutElement.removeAttribute("data-temp");
            }
        }
        return;
    }
    /// #if !MOBILE
    if (element.classList.contains("protyle")) {
        window.siyuan.editorIsFullscreen = !isFullscreen;
    }
    getAllModels().editor.forEach(item => {
        if (!element.isSameNode(item.element)) {
            if (window.siyuan.editorIsFullscreen) {
                if (item.element.classList.contains("fullscreen")) {
                    item.element.classList.remove("fullscreen");
                    resize(item.editor.protyle);
                }
            } else if (item.element.classList.contains("fullscreen")) {
                item.element.classList.remove("fullscreen");
                resize(item.editor.protyle);
            }
        }
    });
    /// #endif
};
