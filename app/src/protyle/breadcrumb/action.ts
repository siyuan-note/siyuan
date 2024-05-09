/// #if !MOBILE
import {getAllEditor, getAllModels, getAllWnds} from "../../layout/getAll";
/// #endif
import {addLoading} from "../ui/initUI";
import {fetchPost} from "../../util/fetch";
import {Constants} from "../../constants";
import {hideAllElements, hideElements} from "../ui/hideElements";
import {hasClosestByClassName} from "../util/hasClosest";
import {reloadProtyle} from "../util/reload";
import {resize} from "../util/resize";
import {disabledProtyle, enableProtyle} from "../util/onGet";
import {isWindow} from "../../util/functions";
import {Wnd} from "../../layout/Wnd";

export const net2LocalAssets = (protyle: IProtyle, type: "Assets" | "Img") => {
    if (protyle.element.querySelector(".wysiwygLoading")) {
        return;
    }
    addLoading(protyle);
    hideElements(["toolbar"], protyle);
    fetchPost(`/api/format/net${type}2LocalAssets`, {
        id: protyle.block.rootID
    }, () => {
        /// #if MOBILE
        reloadProtyle(protyle, false);
        /// #else
        getAllEditor().forEach(item => {
            if (item.protyle.block.rootID === protyle.block.rootID) {
                reloadProtyle(item.protyle, item.protyle.element.isSameNode(protyle.element));
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
        document.getElementById("drag")?.classList.remove("fn__hidden");
    } else {
        element.classList.add("fullscreen");
        document.getElementById("drag")?.classList.add("fn__hidden");
    }
    if (isWindow()) {
        // 编辑器全屏
        /// #if !MOBILE
        const wndsTemp: Wnd[] = [];
        getAllWnds(window.siyuan.layout.layout, wndsTemp);
        wndsTemp.find(async item => {
            const headerElement = item.headersElement.parentElement;
            if (headerElement.getBoundingClientRect().top <= 0) {
                // @ts-ignore
                (headerElement.querySelector(".item--readonly .fn__flex-1") as HTMLElement).style.WebkitAppRegion = isFullscreen ? "drag" : "";
                return true;
            }
        });
        /// #endif
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

export const updateReadonly = (target: Element, protyle: IProtyle) => {
    if (!window.siyuan.config.readonly) {
        const isReadonly = target.querySelector("use").getAttribute("xlink:href") !== "#iconUnlock";
        if (window.siyuan.config.editor.readOnly) {
            if (isReadonly) {
                enableProtyle(protyle);
            } else {
                disabledProtyle(protyle);
            }
        } else {
            fetchPost("/api/attr/setBlockAttrs", {
                id: protyle.block.rootID,
                attrs: {
                    [Constants.CUSTOM_SY_READONLY]: isReadonly ? "false" : "true"
                }
            });
        }
    }
};
