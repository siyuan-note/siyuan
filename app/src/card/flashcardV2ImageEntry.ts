import {isEncryptedBox} from "../util/pathName";

export const canCreateFlashcardFromImage = (image: HTMLImageElement) => {
    const editor = image.closest(".protyle-wysiwyg");
    const src = image.getAttribute("data-src");
    return Boolean(editor?.closest(".protyle") && editor.getAttribute("data-readonly") !== "true" &&
        !window.siyuan.isPublish && !window.siyuan.config.readonly &&
        !isEncryptedBox(image.closest("[data-notebook-id]")?.getAttribute("data-notebook-id")) &&
        src?.startsWith("assets/") && !/[?&]box=/.test(src) && image.closest("[data-node-id]"));
};

export const createFlashcardFromImage = (image: HTMLImageElement) => {
    if (!canCreateFlashcardFromImage(image)) {
        return;
    }
    const blockID = image.closest<HTMLElement>("[data-node-id]").dataset.nodeId;
    const src = image.getAttribute("data-src");
    void import("./flashcardV2").then(({openFlashcardV2ImageSource}) => openFlashcardV2ImageSource(blockID, src));
};
