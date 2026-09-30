import {Constants} from "../../constants";
import {copyImageOCRText, openImageOCR} from "../../asset/imageOCR";
import {isEncryptedBox} from "../../util/pathName";

export const renderImageActions = (root: Element) => {
    root.querySelectorAll<HTMLImageElement>(".img img").forEach(image => {
        const actions = image.parentElement.querySelector(".protyle-icons");
        if (!actions || actions.querySelector(".protyle-action__ocr") || window.siyuan.isPublish ||
            !image.closest(".protyle-wysiwyg") || !image.getAttribute("data-src")?.startsWith("assets/") ||
            isEncryptedBox(image.closest("[data-notebook-id]")?.getAttribute("data-notebook-id"))) {
            return;
        }
        const action = document.createElement("span");
        action.className = "protyle-icon protyle-icon--first protyle-action__ocr ariaLabel";
        action.tabIndex = 0;
        action.setAttribute("role", "button");
        action.setAttribute("aria-label", `${window.siyuan.languages.copy} OCR / ${window.siyuan.languages.doubleClick} ${window.siyuan.languages.ocrResult}`);
        action.setAttribute("data-position", "north");
        action.innerHTML = '<svg><use xlink:href="#iconCopy"></use></svg>';
        let timer: number;
        action.addEventListener("click", event => {
            event.stopPropagation();
            event.preventDefault();
            clearTimeout(timer);
            timer = window.setTimeout(() => {
                if (image.isConnected) {
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
