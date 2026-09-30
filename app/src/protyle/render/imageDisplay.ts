import {getAssetExtension, getAssetName, isEncryptedBox} from "../../util/pathName";
import {renameAssetFile, validateName} from "../../editor/rename";

const boundImageNames = new WeakSet<HTMLElement>();

const setImageName = (element: HTMLElement, path: string) => {
    const text = document.createElement("span");
    text.textContent = getAssetName(path) + getAssetExtension(path);
    element.replaceChildren(text);
};

export const renderImageDisplay = (root: Element) => {
    root.querySelectorAll<HTMLImageElement>(".img img").forEach(image => {
        const container = image.parentElement;
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
                if (name.querySelector("input")) {
                    return;
                }
                event.preventDefault();
                const wysiwyg = image.closest(".protyle-wysiwyg");
                const source = image.getAttribute("data-src");
                if (!wysiwyg || wysiwyg.getAttribute("data-readonly") === "true" || window.siyuan.config.readonly ||
                    window.siyuan.isPublish || /[?&]box=/.test(source) ||
                    isEncryptedBox(image.closest("[data-notebook-id]")?.getAttribute("data-notebook-id"))) {
                    return;
                }
                const input = document.createElement("input");
                input.className = "b3-text-field";
                input.value = getAssetName(source);
                input.setAttribute("aria-label", window.siyuan.languages.rename);
                const extension = document.createElement("span");
                extension.className = "img__extension";
                extension.textContent = getAssetExtension(source);
                name.replaceChildren(input, extension);
                const restore = () => setImageName(name, image.getAttribute("data-src"));
                input.addEventListener("blur", () => {
                    if (!input.disabled) {
                        restore();
                    }
                });
                input.addEventListener("keydown", async (keyEvent: KeyboardEvent) => {
                    keyEvent.stopPropagation();
                    if (keyEvent.isComposing) {
                        return;
                    }
                    if (keyEvent.key === "Escape") {
                        keyEvent.preventDefault();
                        restore();
                    } else if (keyEvent.key === "Enter") {
                        keyEvent.preventDefault();
                        const value = input.value.trim();
                        if (!value || value === getAssetName(source)) {
                            restore();
                            return;
                        }
                        if (!validateName(value, input) || input.disabled) {
                            return;
                        }
                        input.disabled = true;
                        try {
                            if (await renameAssetFile(source, value)) {
                                restore();
                            }
                        } finally {
                            input.disabled = false;
                        }
                    }
                });
                input.focus();
                input.select();
            });
        }
        if (!name.querySelector("input")) {
            setImageName(name, path);
        }
    });
};
