import {Constants} from "../../constants";
import {closePanel} from "./closePanel";
import {openMobileFileById} from "../editor";
import {validateName} from "../../editor/rename";
import {getEventName} from "../../protyle/util/compatibility";
import {mountHelp} from "../../util/mount";
import {fetchPost} from "../../util/fetch";
import {setInlineStyle} from "../../util/assets";
import {renderSnippet} from "../../config/util/snippets";
import {setEmpty} from "./setEmpty";
import {disabledProtyle, enableProtyle} from "../../protyle/util/onGet";
import {getOpenNotebookCount} from "../../util/pathName";
import {popMenu} from "./menu";
import {MobileFiles} from "./MobileFiles";
import {MobileOutline} from "./MobileOutline";
import {hasTopClosestByTag} from "../../protyle/util/hasClosest";
import {MobileBacklinks} from "./MobileBacklinks";
import {MobileBookmarks} from "./MobileBookmarks";
import {MobileTags} from "./MobileTags";
import {hideKeyboardToolbar, initKeyboardToolbar} from "./showKeyboardToolbar";

export const initFramework = () => {
    setInlineStyle();
    renderSnippet();
    initKeyboardToolbar();
    const scrimElement = document.querySelector(".scrim");
    const sidebarElement = document.getElementById("sidebar");
    let outline: MobileOutline;
    let backlink: MobileBacklinks;
    let bookmark: MobileBookmarks;
    let tag: MobileTags;
    sidebarElement.querySelector(".toolbar--border").addEventListener(getEventName(), (event: Event & { target: Element }) => {
        const svgElement = hasTopClosestByTag(event.target, "svg");
        if (!svgElement || svgElement.classList.contains("toolbar__icon--active")) {
            return;
        }
        const type = svgElement.getAttribute("data-type");
        sidebarElement.querySelectorAll(".toolbar--border svg").forEach(item => {
            const itemType = item.getAttribute("data-type");
            if (itemType === type) {
                if (type === "sidebar-outline-tab") {
                    if (!outline) {
                        outline = new MobileOutline();
                    } else {
                        outline.update();
                    }
                } else if (type === "sidebar-backlink-tab") {
                    if (!backlink) {
                        backlink = new MobileBacklinks();
                    } else {
                        backlink.update();
                    }
                } else if (type === "sidebar-bookmark-tab") {
                    if (!backlink) {
                        bookmark = new MobileBookmarks();
                    } else {
                        backlink.update();
                    }
                } else if (type === "sidebar-tag-tab") {
                    if (!backlink) {
                        tag = new MobileTags();
                    } else {
                        tag.update();
                    }
                }
                svgElement.classList.add("toolbar__icon--active");
                sidebarElement.lastElementChild.querySelector(`[data-type="${itemType.replace("-tab", "")}"]`).classList.remove("fn__none");
            } else {
                item.classList.remove("toolbar__icon--active");
                sidebarElement.lastElementChild.querySelector(`[data-type="${itemType.replace("-tab", "")}"]`).classList.add("fn__none");
            }
        });
    });
    new MobileFiles();
    document.getElementById("toolbarFile").addEventListener("click", () => {
        sidebarElement.style.left = "0";
        document.querySelector(".scrim").classList.remove("fn__none");
        const type = sidebarElement.querySelector(".toolbar--border .toolbar__icon--active").getAttribute("data-type");
        if (type === "sidebar-outline-tab") {
            outline.update();
        } else if (type === "sidebar-backlink-tab") {
            backlink.update();
        } else if (type === "sidebar-bookmark-tab") {
            bookmark.update();
        } else if (type === "sidebar-tag-tab") {
            tag.update();
        }
    });
    // 用 touchstart 会导致键盘不收起
    document.getElementById("toolbarMore").addEventListener("click", () => {
        popMenu();
    });
    const editElement = document.getElementById("toolbarEdit");
    if (window.siyuan.config.readonly) {
        editElement.classList.add("fn__none");
    }
    const inputElement = document.getElementById("toolbarName") as HTMLInputElement;
    const editIconElement = editElement.querySelector("use");
    if (window.siyuan.config.readonly || window.siyuan.config.editor.readOnly) {
        inputElement.readOnly = true;
        editIconElement.setAttribute("xlink:href", "#iconEdit");
    } else {
        inputElement.readOnly = false;
        editIconElement.setAttribute("xlink:href", "#iconPreview");
    }
    editElement.addEventListener(getEventName(), () => {
        const isReadonly = editIconElement.getAttribute("xlink:href") === "#iconPreview";
        window.siyuan.config.editor.readOnly = isReadonly;
        fetchPost("/api/setting/setEditor", window.siyuan.config.editor, () => {
            if (!isReadonly) {
                enableProtyle(window.siyuan.mobileEditor.protyle);
                inputElement.readOnly = false;
                editIconElement.setAttribute("xlink:href", "#iconPreview");
            } else {
                disabledProtyle(window.siyuan.mobileEditor.protyle);
                inputElement.readOnly = true;
                editIconElement.setAttribute("xlink:href", "#iconEdit");
            }
        });
    });

    scrimElement.addEventListener(getEventName(), () => {
        closePanel();
    });
    document.getElementById("modelClose").addEventListener(getEventName(), () => {
        closePanel();
    });
    initEditorName();
    if (getOpenNotebookCount() > 0) {
        const localDoc = JSON.parse(localStorage.getItem(Constants.LOCAL_DOCINFO) || '{"id": ""}');
        fetchPost("/api/block/checkBlockExist", {id: localDoc.id}, existResponse => {
            if (existResponse.data) {
                openMobileFileById(localDoc.id, localDoc.action);
            } else {
                fetchPost("/api/block/getRecentUpdatedBlocks", {}, (response) => {
                    if (response.data.length !== 0) {
                        openMobileFileById(response.data[0].id, [Constants.CB_GET_HL, Constants.CB_GET_CONTEXT]);
                    } else {
                        setEmpty();
                    }
                });
            }
        });
    } else {
        setEmpty();
    }
    if (window.siyuan.config.newbie) {
        mountHelp();
    }
};

const initEditorName = () => {
    const inputElement = document.getElementById("toolbarName") as HTMLInputElement;
    inputElement.setAttribute("placeholder", window.siyuan.languages._kernel[16]);
    inputElement.addEventListener("focus", () => {
        hideKeyboardToolbar();
    });
    inputElement.addEventListener("blur", () => {
        if (window.siyuan.config.readonly || window.siyuan.config.editor.readOnly || window.siyuan.mobileEditor.protyle.disabled) {
            return;
        }
        if (!validateName(inputElement.value)) {
            inputElement.value = inputElement.value.substring(0, Constants.SIZE_TITLE);
            return false;
        }

        fetchPost("/api/filetree/renameDoc", {
            notebook: window.siyuan.mobileEditor.protyle.notebookId,
            path: window.siyuan.mobileEditor.protyle.path,
            title: inputElement.value,
        });
    });
};
