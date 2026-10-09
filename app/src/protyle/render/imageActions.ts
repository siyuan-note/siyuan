import {Constants} from "../../constants";
import {copyImageOCRText, openImageOCR} from "../../asset/imageOCR";
import {isEncryptedBox} from "../../util/pathName";
import {getImageOCRStatus} from "../../asset/imageOCRStatus";
import {isEntryVisible} from "../../config/entryVisibility/runtime";

const boundImageActions = new WeakSet<HTMLElement>();
const boundImages = new WeakSet<HTMLImageElement>();
const requests = new WeakMap<HTMLImageElement, AbortController>();

const removeImageAction = (image: HTMLImageElement) => {
    const actions = image.parentElement?.querySelector(".protyle-icons");
    actions?.querySelector(".protyle-action__ocr")?.remove();
    if (actions?.childElementCount === 1) {
        actions.querySelector(".protyle-icon--last")?.classList.replace("protyle-icon--last", "protyle-icon--only");
    }
};

const canShowImageAction = (image: HTMLImageElement) => !window.siyuan.isPublish && image.closest(".protyle-wysiwyg") &&
    image.getAttribute("data-src")?.startsWith("assets/") && !/[?&]box=/.test(image.getAttribute("data-src")) &&
    !isEncryptedBox(image.closest("[data-notebook-id]")?.getAttribute("data-notebook-id")) && isEntryVisible("editor.image.ocrText");

export const renderImageActions = (root: Element) => {
    root.querySelectorAll<HTMLImageElement>(".img img").forEach(image => {
        requests.get(image)?.abort();
        requests.delete(image);
        removeImageAction(image);
        if (!canShowImageAction(image)) {
            return;
        }
        if (!boundImages.has(image)) {
            boundImages.add(image);
            const update = () => updateImageAction(image);
            image.parentElement.addEventListener("mouseenter", update);
            image.parentElement.addEventListener("focusin", update);
            image.parentElement.addEventListener("pointerdown", update);
        }
        if (image.parentElement.matches(":hover") || image.parentElement.contains(document.activeElement)) {
            updateImageAction(image);
        }
    });
};

const updateImageAction = (image: HTMLImageElement) => {
    if (!canShowImageAction(image)) {
        removeImageAction(image);
        return;
    }
    if (requests.has(image)) {
        return;
    }
    const source = image.getAttribute("data-src");
    const controller = new AbortController();
    requests.set(image, controller);
    getImageOCRStatus(source).then(hasText => {
        if (controller.signal.aborted || !image.isConnected || image.getAttribute("data-src") !== source) {
            return;
        }
        if (canShowImageAction(image) && hasText) {
            addImageAction(image);
        } else {
            removeImageAction(image);
        }
    }).finally(() => {
        if (requests.get(image) === controller) {
            requests.delete(image);
        }
    });
};

const addImageAction = (image: HTMLImageElement) => {
    const actions = image.parentElement.querySelector(".protyle-icons");
    const existing = actions?.querySelector<HTMLElement>(".protyle-action__ocr");
    if (!actions) {
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
};

window.addEventListener("siyuan-entry-visibility", () => renderImageActions(document.documentElement));
window.addEventListener("siyuan-image-ocr", () => renderImageActions(document.documentElement));
