import {Constants} from "../../constants";
import {closeModel, closePanel} from "./closePanel";
import {openMobileFileById} from "../editor";
import {validateName} from "../../editor/rename";
import {getEventName} from "../../protyle/util/compatibility";
import {fetchPost} from "../../util/fetch";
import {setInlineStyle} from "../../util/assets";
import {renderSnippet} from "../../config/util/snippets";
import {setEmpty} from "./setEmpty";
import {getIdZoomInByPath, getOpenNotebookCount} from "../../util/pathName";
import {popMenu} from "../menu";
import {MobileFiles} from "../dock/MobileFiles";
import {MobileOutline} from "../dock/MobileOutline";
import {hasTopClosestByTag} from "../../protyle/util/hasClosest";
import {MobileBacklinks} from "../dock/MobileBacklinks";
import {MobileBookmarks} from "../dock/MobileBookmarks";
import {MobileTags} from "../dock/MobileTags";
import {activeBlur, hideKeyboardToolbar, initKeyboardToolbar} from "./keyboardToolbar";
import {syncGuide} from "../../sync/syncGuide";
import {Inbox} from "../../layout/dock/Inbox";
import {App} from "../../index";

export const initFramework = (app: App) => {
    setInlineStyle();
    renderSnippet();
    initKeyboardToolbar();
    const sidebarElement = document.getElementById("sidebar");
    let outline: MobileOutline;
    let backlink: MobileBacklinks;
    let bookmark: MobileBookmarks;
    let inbox: Inbox;
    let tag: MobileTags;
    // 不能使用 getEventName，否则点击返回会展开右侧栏
    const firstToolbarElement = sidebarElement.querySelector(".toolbar--border");
    firstToolbarElement.addEventListener("click", (event: Event & {
        target: Element
    }) => {
        const svgElement = hasTopClosestByTag(event.target, "svg");
        if (!svgElement || svgElement.classList.contains("toolbar__icon--active")) {
            return;
        }
        const type = svgElement.getAttribute("data-type");
        if (!type) {
            closePanel();
            return;
        }
        firstToolbarElement.querySelectorAll(".toolbar__icon").forEach(item => {
            const itemType = item.getAttribute("data-type");
            if (!itemType) {
                return;
            }
            if (itemType === type) {
                if (type === "sidebar-outline-tab") {
                    if (!outline) {
                        outline = new MobileOutline(app);
                    } else {
                        outline.update();
                    }
                } else if (type === "sidebar-backlink-tab") {
                    if (!backlink) {
                        backlink = new MobileBacklinks(app);
                    } else {
                        backlink.update();
                    }
                } else if (type === "sidebar-bookmark-tab") {
                    if (!bookmark) {
                        bookmark = new MobileBookmarks(app);
                    } else {
                        bookmark.update();
                    }
                } else if (type === "sidebar-tag-tab") {
                    if (!tag) {
                        tag = new MobileTags(app);
                    } else {
                        tag.update();
                    }
                } else if (type === "sidebar-inbox-tab" && !inbox) {
                    inbox = new Inbox(app, document.querySelector('#sidebar [data-type="sidebar-inbox"]'));
                }
                svgElement.classList.add("toolbar__icon--active");
                sidebarElement.lastElementChild.querySelector(`[data-type="${itemType.replace("-tab", "")}"]`).classList.remove("fn__none");
            } else {
                item.classList.remove("toolbar__icon--active");
                sidebarElement.lastElementChild.querySelector(`[data-type="${itemType.replace("-tab", "")}"]`).classList.add("fn__none");
            }
        });
    });
    window.siyuan.mobile.files = new MobileFiles(app);
    document.getElementById("toolbarFile").addEventListener("click", () => {
        hideKeyboardToolbar();
        activeBlur();
        sidebarElement.style.transform = "translateX(0px)";
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
    document.getElementById("toolbarSync").addEventListener(getEventName(), () => {
        syncGuide(app);
    });
    document.getElementById("modelClose").addEventListener("click", () => {
        closeModel();
    });
    initEditorName();
    if (getOpenNotebookCount() > 0) {
        if (window.JSAndroid && window.openFileByURL(window.JSAndroid.getBlockURL())) {
            return;
        }
        const idZoomIn = getIdZoomInByPath();
        if (idZoomIn.id) {
            openMobileFileById(app, idZoomIn.id,
                idZoomIn.isZoomIn ? [Constants.CB_GET_ALL, Constants.CB_GET_FOCUS] : [Constants.CB_GET_FOCUS, Constants.CB_GET_CONTEXT, Constants.CB_GET_ROOTSCROLL]);
            return;
        }
        const localDoc = window.siyuan.storage[Constants.LOCAL_DOCINFO];
        fetchPost("/api/block/checkBlockExist", {id: localDoc.id}, existResponse => {
            if (existResponse.data) {
                openMobileFileById(app, localDoc.id, [Constants.CB_GET_SCROLL]);
            } else {
                fetchPost("/api/block/getRecentUpdatedBlocks", {}, (response) => {
                    if (response.data.length !== 0) {
                        openMobileFileById(app, response.data[0].id, [Constants.CB_GET_HL, Constants.CB_GET_CONTEXT, Constants.CB_GET_ROOTSCROLL]);
                    } else {
                        setEmpty(app);
                    }
                });
            }
        });
        return;
    }
    setEmpty(app);
};

const initEditorName = () => {
    const inputElement = document.getElementById("toolbarName") as HTMLInputElement;
    inputElement.setAttribute("placeholder", window.siyuan.languages._kernel[16]);
    inputElement.addEventListener("blur", () => {
        if (inputElement.getAttribute("readonly") === "readonly") {
            return;
        }
        if (!validateName(inputElement.value)) {
            inputElement.value = inputElement.value.substring(0, Constants.SIZE_TITLE);
            return false;
        }

        fetchPost("/api/filetree/renameDoc", {
            notebook: window.siyuan.mobile.editor.protyle.notebookId,
            path: window.siyuan.mobile.editor.protyle.path,
            title: inputElement.value,
        });
    });
};
