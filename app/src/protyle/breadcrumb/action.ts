/// #if !MOBILE
import {getAllModels, getAllWnds} from "../../layout/getAll";
/// #endif
import {addLoading} from "../ui/initUI";
import {fetchPost} from "../../util/fetch";
import {Constants} from "../../constants";
import {hideAllElements, hideElements} from "../ui/hideElements";
import {hasClosestByClassName} from "../util/hasClosest";
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
    });
};

export const setFullscreen = (element: Element, enter: boolean, btnElement?: Element) => {
    if (element.classList.contains("fullscreen") === enter) {
        return false;
    }
    setTimeout(() => {
        hideAllElements(["gutter"]);
    }, Constants.TIMEOUT_TRANSITION);   // 等待页面动画结束

    if (enter) {
        element.classList.add("fullscreen");
        document.getElementById("drag")?.classList.add("fn__hidden");
    } else {
        element.classList.remove("fullscreen");
        document.getElementById("drag")?.classList.remove("fn__hidden");
    }
    /// #if !MOBILE
    const isWindowMode = isWindow();
    const wndsTemp: Wnd[] = [];
    if (isWindowMode) {
        getAllWnds(window.siyuan.layout.layout, wndsTemp);
    } else if (window.siyuan.config.appearance.hideToolbar) {
        getAllWnds(window.siyuan.layout.centerLayout, wndsTemp);
    }
    wndsTemp.find(item => {
        const headerElement = item.headersElement.parentElement;
        if (headerElement.getBoundingClientRect().top <= 0) {
            ((headerElement.querySelector(".item--readonly .fn__flex-1") as HTMLElement).style as CSSStyleDeclarationElectron).WebkitAppRegion =
                enter ? "" : "drag";
            return true;
        }
    });
    /// #endif

    /// #if !MOBILE
    if ("darwin" !== window.siyuan.config.system.os && !isWindow()) {
        const windowControlsElement = document.getElementById("windowControls");
        if (enter) {
            window.siyuan.zIndex++;
            windowControlsElement.style.zIndex = window.siyuan.zIndex.toString();
        } else {
            windowControlsElement.style.zIndex = "";
        }
    }
    /// #endif
    if (btnElement) {
        if (enter) {
            btnElement.querySelector("use").setAttribute("xlink:href", "#iconFullscreenExit");
        } else {
            btnElement.querySelector("use").setAttribute("xlink:href", "#iconFullscreen");
        }
        const dockLayoutElement = hasClosestByClassName(element, "layout--float");
        if (dockLayoutElement) {
            if (enter) {
                dockLayoutElement.setAttribute("data-temp", dockLayoutElement.style.transform);
                dockLayoutElement.style.transform = "none";
            } else {
                dockLayoutElement.style.transform = dockLayoutElement.getAttribute("data-temp");
                dockLayoutElement.removeAttribute("data-temp");
            }
        }
        return true;
    }
    /// #if !MOBILE
    if (element.classList.contains("protyle")) {
        window.siyuan.editorIsFullscreen = enter;
    }
    getAllModels().editor.forEach(item => {
        if (element !== item.element && item.element.classList.contains("fullscreen")) {
            item.element.classList.remove("fullscreen");
            resize(item.editor.protyle);
        }
    });
    /// #endif
    return true;
};

export const fullscreen = (element: Element, btnElement?: Element) => {
    setFullscreen(element, !element.classList.contains("fullscreen"), btnElement);
};

export const updateReadonly = (target: Element, protyle: IProtyle) => {
    if (!window.siyuan.config.readonly && protyle.element.getAttribute("disabled-forever") !== "true") {
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
