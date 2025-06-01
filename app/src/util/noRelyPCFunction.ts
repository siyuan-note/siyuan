import {Dialog} from "../dialog";
import {fetchPost} from "./fetch";
import {isMobile} from "./functions";
import {Constants} from "../constants";
import {pathPosix} from "./pathName";
/// #if !MOBILE
import {getDockByType} from "../layout/tabUtil";
import {Files} from "../layout/dock/Files";
import {Tag} from "../layout/dock/Tag";
/// #endif
import {upDownHint} from "./upDownHint";
import {escapeHtml} from "./escape";
import {hasClosestByClassName} from "../protyle/util/hasClosest";
import {isNotCtrl} from "../protyle/util/compatibility";

// 需独立出来，否则移动端引用的时候会引入 pc 端大量无用代码
export const renameTag = (labelName: string) => {
    const dialog = new Dialog({
        title: window.siyuan.languages.rename,
        content: `<div class="b3-dialog__content">
    <input class="b3-text-field fn__block">
    <div class="b3-list fn__flex-1 b3-list--background fn__none protyle-hint" style="    position: absolute;
    width: calc(100% - 48px);">
        <img style="margin: 0 auto;display: block;width: 64px;height: 64px" src="/stage/loading-pure.svg">
    </div>
</div>
<div class="b3-dialog__action">
    <button class="b3-button b3-button--cancel">${window.siyuan.languages.cancel}</button><div class="fn__space"></div>
    <button class="b3-button b3-button--text">${window.siyuan.languages.confirm}</button>
</div>`,
        width: isMobile() ? "92vw" : "520px",
    });
    dialog.element.setAttribute("data-key", Constants.DIALOG_RENAMETAG);
    const btnsElement = dialog.element.querySelectorAll(".b3-button");
    btnsElement[0].addEventListener("click", () => {
        dialog.destroy();
    });
    btnsElement[1].addEventListener("click", () => {
        fetchPost("/api/tag/renameTag", {oldLabel: labelName, newLabel: inputElement.value}, () => {
            dialog.destroy();
            /// #if MOBILE
            window.siyuan.mobile.docks.tag.update();
            /// #else
            const dockTag = getDockByType("tag");
            (dockTag.data.tag as Tag).update();
            /// #endif
        });
    });
    const inputElement = dialog.element.querySelector("input");
    inputElement.value = labelName;
    inputElement.focus();
    inputElement.select();
    const listElement = dialog.element.querySelector(".b3-list--background");
    inputElement.addEventListener("keydown", (event: KeyboardEvent) => {
        event.stopPropagation();
        if (event.isComposing) {
            return;
        }
        upDownHint(listElement, event);
        if (event.key === "Escape") {
            if (listElement.classList.contains("fn__none")) {
                dialog.destroy();
            } else {
                listElement.classList.add("fn__none");
            }
            event.preventDefault();
        } else if (!event.shiftKey && isNotCtrl(event) && event.key === "Enter") {
            if (listElement.classList.contains("fn__none")) {
                (btnsElement[1] as HTMLButtonElement).click();
            } else {
                const currentElement = listElement.querySelector(".b3-list-item--focus") as HTMLElement;
                inputElement.value = currentElement.dataset.type === "new" ? currentElement.querySelector("mark").textContent.trim() : currentElement.textContent.trim();
                listElement.classList.add("fn__none");
            }
            event.preventDefault();
        }
    });
    inputElement.addEventListener("input", (event) => {
        event.stopPropagation();
        listElement.classList.remove("fn__none");
        fetchPost("/api/search/searchTag", {
            k: inputElement.value.trim(),
        }, (response) => {
            let searchHTML = "";
            let hasKey = false;
            response.data.tags.forEach((item: string, index: number) => {
                searchHTML += `<div class="b3-list-item${index === 0 ? " b3-list-item--focus" : ""}">
    <div class="fn__flex-1">${item}</div>
</div>`;
                if (item === `<mark>${response.data.k}</mark>`) {
                    hasKey = true;
                }
            });
            if (!hasKey && response.data.k) {
                searchHTML = `<div data-type="new" class="b3-list-item${searchHTML ? "" : " b3-list-item--focus"}"><div class="fn__flex-1">${window.siyuan.languages.new} <mark>${escapeHtml(response.data.k)}</mark></div></div>` + searchHTML;
            }
            listElement.innerHTML = searchHTML;
        });
    });
    listElement.addEventListener("click", (event) => {
        const target = event.target as HTMLElement;
        const listItemElement = hasClosestByClassName(target, "b3-list-item");
        if (!listItemElement) {
            return;
        }
        inputElement.value = listItemElement.dataset.type === "new" ? listItemElement.querySelector("mark").textContent.trim() : listItemElement.textContent.trim();
        listElement.classList.add("fn__none");
    });
};

export const getWorkspaceName = () => {
    return pathPosix().basename(window.siyuan.config.system.workspaceDir.replace(/\\/g, "/"));
};

export const checkFold = (id: string, cb: (zoomIn: boolean, action: TProtyleAction[], isRoot: boolean) => void) => {
    if (!id) {
        return;
    }
    fetchPost("/api/block/checkBlockFold", {id}, (foldResponse) => {
        cb(foldResponse.data.isFolded,
            foldResponse.data.isFolded ? [Constants.CB_GET_FOCUS, Constants.CB_GET_ALL] : [Constants.CB_GET_FOCUS, Constants.CB_GET_CONTEXT, Constants.CB_GET_ROOTSCROLL],
            foldResponse.data.isRoot);
    });
};

export const setLocalShorthandCount = () => {
    let fileElement;
    /// #if MOBILE
    fileElement = window.siyuan.mobile.docks.file.element;
    /// #else
    const dockFile = getDockByType("file");
    if (!dockFile) {
        return false;
    }
    fileElement = (dockFile.data.file as Files).element;
    /// #endif
    const helpIDs: string[] = [];
    Object.keys(Constants.HELP_PATH).forEach((key) => {
        helpIDs.push(Constants.HELP_PATH[key]);
    });
    fileElement.childNodes.forEach((item: Element) => {
        if (item.querySelector('[data-type="addLocal"]') || helpIDs.includes(item.getAttribute("data-url"))) {
            return;
        }
        item.querySelector('[data-type="more-root"]').insertAdjacentHTML("beforebegin", `<span data-type="addLocal" class="b3-list-item__action">
    <svg><use xlink:href="#iconRiffCard"></use></svg>
</span>`);
    });
};
