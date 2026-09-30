import {Constants} from "../../constants";
import {copyImageOCRText, openImageOCR} from "../../asset/imageOCR";
import {isEncryptedBox} from "../../util/pathName";

const boundImageActions = new WeakSet<HTMLElement>();

export const renderImageActions = (root: Element) => {
    root.querySelectorAll<HTMLImageElement>(".img img").forEach(image => {
        const actions = image.parentElement.querySelector(".protyle-icons");
        const existing = actions?.querySelector<HTMLElement>(".protyle-action__ocr");
        if (!actions || window.siyuan.isPublish ||
            !image.closest(".protyle-wysiwyg") || !image.getAttribute("data-src")?.startsWith("assets/") ||
            /[?&]box=/.test(image.getAttribute("data-src")) ||
            isEncryptedBox(image.closest("[data-notebook-id]")?.getAttribute("data-notebook-id"))) {
            existing?.remove();
            if (actions?.childElementCount === 1) {
                actions.querySelector(".protyle-icon--last")?.classList.replace("protyle-icon--last", "protyle-icon--only");
            }
            return;
        }
        if (existing && boundImageActions.has(existing)) {
            return;
        }
        existing?.remove();
        const action = document.createElement("span");
        boundImageActions.add(action);
        action.className = "protyle-icon protyle-icon--first protyle-action__ocr ariaLabel";
        action.tabIndex = 0;
        action.setAttribute("role", "button");
        action.setAttribute("aria-label", window.siyuan.languages.imageOCRActionTip);
        action.setAttribute("data-position", "north");
        action.innerHTML = '<svg><use xlink:href="#iconCopy"></use></svg>';
        let timer: number;
        action.addEventListener("click", event => {
            event.stopPropagation();
            event.preventDefault();
            clearTimeout(timer);
            timer = window.setTimeout(() => {
                if (image.isConnected && action.isConnected) {
                    copyImageOCRText(image.getAttribute("data-src"));
                }
            }, Constants.TIMEOUT_DBLCLICK);
        });
        action.addEventListener("dblclick", event => {
            event.stopPropagation();
            event.preventDefault();
            clearTimeout(timer);
            if (image.closest(".protyle-wysiwyg")?.getAttribute("data-readonly") !== "true") {
                openImageOCR(image.getAttribute("data-src"));
            }
        });
        action.addEventListener("keydown", (event: KeyboardEvent) => {
            if ((event.key === "Enter" || event.key === " ") && !event.isComposing) {
                copyImageOCRText(image.getAttribute("data-src"));
                event.preventDefault();
                event.stopPropagation();
            }
        });
        const more = actions.querySelector(".protyle-icon--only");
        more?.classList.replace("protyle-icon--only", "protyle-icon--last");
        actions.prepend(action);
    });
};
