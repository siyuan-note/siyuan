import {Constants} from "../../constants";
import {closePanel} from "./closePanel";
import {openMobileFileById} from "../editor";
import {validateName} from "../../editor/rename";
import {getEventName} from "../../protyle/util/compatibility";
import {mountHelp} from "../../util/mount";
import {fetchPost} from "../../util/fetch";
import {setInlineStyle} from "../../util/assets";
import {setEmpty} from "./setEmpty";
import {disabledProtyle, enableProtyle} from "../../protyle/util/onGet";
import {getOpenNotebookCount} from "../../util/pathName";
import {popMenu} from "./menu";
import {MobileFiles} from "./MobileFiles";
import {MobileOutline} from "./MobileOutline";
import {hasTopClosestByTag} from "../../protyle/util/hasClosest";
import {MobileBacklinks} from "./MobileBacklinks";

export const initFramework = () => {
    setInlineStyle();
    const scrimElement = document.querySelector(".scrim");
    const sidebarElement = document.getElementById("sidebar");
    let outline: MobileOutline;
    let backlink: MobileBacklinks;
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
    document.getElementById("toolbarFile").addEventListener(getEventName(), () => {
        sidebarElement.style.left = "0";
        document.querySelector(".scrim").classList.remove("fn__none");
        const type = sidebarElement.querySelector(".toolbar--border .toolbar__icon--active").getAttribute("data-type");
        if (type === "sidebar-outline-tab") {
            outline.update();
        } else if (type === "sidebar-backlink-tab") {
            backlink.update();
        }
    });
    document.getElementById("toolbarMore").addEventListener(getEventName(), () => {
        popMenu();
    });
    const editElement = document.getElementById("toolbarEdit");
    if (window.siyuan.config.readonly) {
        editElement.classList.add("fn__none");
    } else {
        const editIconElement = editElement.querySelector("use");
        editElement.addEventListener(getEventName(), () => {
            const inputElement = document.getElementById("toolbarName") as HTMLInputElement;
            if (editIconElement.getAttribute("xlink:href") === "#iconEdit") {
                enableProtyle(window.siyuan.mobileEditor.protyle);
                inputElement.readOnly = false;
                editIconElement.setAttribute("xlink:href", "#iconPreview");
            } else {
                disabledProtyle(window.siyuan.mobileEditor.protyle);
                inputElement.readOnly = true;
                editIconElement.setAttribute("xlink:href", "#iconEdit");
            }
        });
    }
    scrimElement.addEventListener(getEventName(), () => {
        closePanel();
    });
    document.getElementById("modelClose").addEventListener(getEventName(), () => {
        closePanel();
    });
    initEditorName();
    if (getOpenNotebookCount() > 0) {
        const localDoc = JSON.parse(window.localStorage.getItem(Constants.LOCAL_DOCINFO) || '{"id": ""}');
        fetchPost("/api/block/checkBlockExist", {id: localDoc.id}, existResponse => {
            if (existResponse.data) {
                openMobileFileById(localDoc.id, localDoc.hasContext, localDoc.action);
            } else {
                fetchPost("/api/block/getRecentUpdatedBlocks", {}, (response) => {
                    if (response.data.length !== 0) {
                        openMobileFileById(response.data[0].id, true);
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
    inputElement.addEventListener("blur", () => {
        if (window.siyuan.config.readonly || document.querySelector("#toolbarEdit use").getAttribute("xlink:href") === "#iconEdit") {
            return;
        }
        if (!validateName(inputElement.value)) {
            return false;
        }

        fetchPost("/api/filetree/renameDoc", {
            notebook: window.siyuan.mobileEditor.protyle.notebookId,
            path: window.siyuan.mobileEditor.protyle.path,
            title: inputElement.value,
        });
    });
};
