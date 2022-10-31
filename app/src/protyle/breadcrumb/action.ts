/// #if !MOBILE
import {getAllModels} from "../../layout/getAll";
/// #endif
import {addLoading, setPadding} from "../ui/initUI";
import {fetchPost} from "../../util/fetch";
import {Constants} from "../../constants";
import {onGet} from "../util/onGet";
import {saveScroll} from "../scroll/saveScroll";
import {hideElements} from "../ui/hideElements";

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
        fetchPost("/api/filetree/getDoc", {
            id: protyle.block.id,
            mode: 0,
            size: window.siyuan.config.editor.dynamicLoadBlocks,
        }, getResponse => {
            onGet(getResponse, protyle, [Constants.CB_GET_FOCUS], saveScroll(protyle, true));
        });
        /// #else
        getAllModels().editor.forEach(item => {
            if (item.editor.protyle.block.rootID === protyle.block.rootID) {
                fetchPost("/api/filetree/getDoc", {
                    id: item.editor.protyle.block.rootID,
                    mode: 0,
                    size: window.siyuan.config.editor.dynamicLoadBlocks,
                }, getResponse => {
                    onGet(getResponse, item.editor.protyle, [Constants.CB_GET_FOCUS], saveScroll(protyle, true));
                });
            }
        });
        /// #endif
    });
};

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
    if (element.classList.contains("protyle")) {
        window.siyuan.editorIsFullscreen = !isFullscreen;
    }
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
