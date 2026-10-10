import {getAssetExtension, getAssetName, isEncryptedBox} from "../../util/pathName";
import {renameAsset} from "../../editor/rename";
import {getImageTitle, setImageTitle} from "./imageTitle";

const boundImageNames = new WeakSet<HTMLElement>();

const setImageName = (element: HTMLElement, path: string) => {
    const text = document.createElement("span");
    text.textContent = getAssetName(path) + getAssetExtension(path);
    element.replaceChildren(text);
};

export const renderImageDisplay = (root: Element) => {
    root.querySelectorAll<HTMLImageElement>(".img img").forEach(image => {
        setImageTitle(image, getImageTitle(image));
        const container = image.parentElement;
        const title = container.querySelector<HTMLElement>(".protyle-action__title");
        if (title) {
            const wysiwyg = image.closest(".protyle-wysiwyg");
            if (getImageTitle(image) && wysiwyg && wysiwyg.getAttribute("data-readonly") !== "true" &&
                !window.siyuan.config.readonly && !window.siyuan.isPublish &&
                !image.closest(".protyle-wysiwyg__embed, .mindmap-view__preview-block")) {
                title.tabIndex = 0;
                title.setAttribute("role", "button");
                title.setAttribute("aria-label", window.siyuan.languages.title);
            } else {
                title.removeAttribute("tabindex");
                title.removeAttribute("role");
                title.removeAttribute("aria-label");
            }
        }
        let alt = container.querySelector<HTMLElement>(".img__alt");
        if (window.siyuan.config.editor.displayImgAlt && image.alt) {
            if (!alt) {
                alt = document.createElement("span");
                alt.className = "img__alt";
                alt.contentEditable = "false";
            }
            const text = document.createElement("span");
            text.textContent = image.alt;
            alt.replaceChildren(text);
            container.append(alt);
        } else {
            alt?.remove();
        }
        let name = container.querySelector<HTMLElement>(".img__name");
        const path = image.getAttribute("data-src") || "";
        if (!window.siyuan.config.editor.displayImgName || !path.startsWith("assets/")) {
            name?.remove();
            return;
        }
        if (!name) {
            name = document.createElement("span");
            name.className = "img__name";
            name.contentEditable = "false";
            name.tabIndex = 0;
            name.setAttribute("role", "button");
            name.setAttribute("aria-label", window.siyuan.languages.rename);
            container.insertBefore(name, image);
        }
        if (!boundImageNames.has(name)) {
            boundImageNames.add(name);
            setImageName(name, path);
            name.addEventListener("mousedown", event => event.stopPropagation());
            name.addEventListener("keydown", (event: KeyboardEvent) => {
                if (event.target === name && (event.key === "Enter" || event.key === " ") && !event.isComposing) {
                    event.preventDefault();
                    event.stopPropagation();
                    name.click();
                }
            });
            name.addEventListener("click", event => {
                event.stopPropagation();
                event.preventDefault();
                const wysiwyg = image.closest(".protyle-wysiwyg");
                const source = image.getAttribute("data-src");
                if (!wysiwyg || wysiwyg.getAttribute("data-readonly") === "true" || window.siyuan.config.readonly ||
                    window.siyuan.isPublish || /[?&]box=/.test(source) ||
                    isEncryptedBox(image.closest("[data-notebook-id]")?.getAttribute("data-notebook-id"))) {
                    return;
                }
                renameAsset(source);
            });
        }
        setImageName(name, path);
    });
};
