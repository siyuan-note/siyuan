/// #if !MOBILE
import {getAllModels} from "../../layout/getAll";
/// #endif
import {setPadding} from "../ui/initUI";

export const fullscreen = (element: Element, btnElement?: Element) => {
    const isFullscreen = element.className.includes("fullscreen");
    if (isFullscreen) {
        element.classList.remove("fullscreen");
        if (document.querySelector("body").classList.contains("body--win32")) {
            document.getElementById("drag").classList.remove("fn__hidden");
        }
    } else {
        element.classList.add("fullscreen");
        if (document.querySelector("body").classList.contains("body--win32")) {
            document.getElementById("drag").classList.add("fn__hidden");
        }
    }

    if (btnElement) {
        if (isFullscreen) {
            btnElement.querySelector("use").setAttribute("xlink:href", "#iconFullscreen");
        } else {
            btnElement.querySelector("use").setAttribute("xlink:href", "#iconContract");
        }
    }
    /// #if !MOBILE
    window.siyuan.editorIsFullscreen = !isFullscreen;
    getAllModels().editor.forEach(item => {
        if (window.siyuan.editorIsFullscreen) {
            if (!element.isSameNode(item.element) && item.element.classList.contains("fullscreen")) {
                item.element.classList.remove("fullscreen");
                setPadding(item.editor.protyle);
            }
        } else if (item.element.classList.contains("fullscreen")) {
            item.element.classList.remove("fullscreen");
            setPadding(item.editor.protyle);
        }
    });
    /// #endif
};
