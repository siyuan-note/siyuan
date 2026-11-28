import {Constants} from "../constants";
import {isEncryptedBox} from "../util/pathName";

const sourceSelector = `[data-node-id][${Constants.DATA_FLASHCARD_SOURCE}="true"]`;
const badgeSelector = "[data-flashcard-badge]";

export const renderFlashcardV2Badge = (block: Element) => {
    const editor = block.closest(".protyle");
    const attrs = block.querySelector(":scope > .protyle-attr");
    const current = attrs?.querySelector(badgeSelector);
    if (!attrs || !block.matches(sourceSelector) || !editor || editor.getAttribute("data-protyle-lite") === "true" ||
        window.siyuan.isPublish || isEncryptedBox(editor.getAttribute("data-notebook-id")) ||
        block.closest(".protyle-wysiwyg__embed, .card__block")) {
        current?.remove();
        return;
    }
    if (current) {
        return;
    }
    const badge = document.createElement("button");
    badge.type = "button";
    badge.className = "block__icon block__icon--show block__icon--tap ariaLabel";
    badge.setAttribute("contenteditable", "false");
    badge.setAttribute("aria-label", window.siyuan.languages.riffCard);
    badge.setAttribute("aria-haspopup", "menu");
    badge.setAttribute("data-flashcard-badge", "");
    badge.innerHTML = '<svg aria-hidden="true"><use xlink:href="#iconRiffCard"></use></svg>';
    attrs.appendChild(badge);
};

export const renderFlashcardV2Badges = (element: Element) => {
    if (!element.closest(".protyle-wysiwyg") || !element.closest(".protyle") || window.siyuan.isPublish) {
        return;
    }
    if (element.matches(sourceSelector) || element.querySelector(`:scope > .protyle-attr > ${badgeSelector}`)) {
        renderFlashcardV2Badge(element);
    }
    element.querySelectorAll(sourceSelector).forEach(renderFlashcardV2Badge);
};

export const markFlashcardV2SourceBlock = (blockID: string) => {
    const block = `[data-node-id="${CSS.escape(blockID)}"]`;
    document.querySelectorAll(`.protyle-title${block}, .protyle-wysiwyg ${block}`).forEach(element => {
        element.setAttribute(Constants.DATA_FLASHCARD_SOURCE, "true");
        renderFlashcardV2Badge(element);
    });
};

export const handleFlashcardV2Badge = (event: MouseEvent, protyle: IProtyle) => {
    const badge = (event.target as Element).closest<HTMLButtonElement>(badgeSelector);
    const block = badge?.closest<HTMLElement>(sourceSelector);
    if (!badge || !block) {
        return false;
    }
    event.preventDefault();
    event.stopPropagation();
    if (!window.siyuan.isPublish && !protyle.lite && !isEncryptedBox(protyle.notebookId)) {
        const id = block.dataset.nodeId;
        void import("./flashcardV2").then(({openFlashcardV2BadgeMenu}) => {
            if (badge.isConnected && block.dataset.nodeId === id && block.matches(sourceSelector)) {
                openFlashcardV2BadgeMenu(badge, id, !protyle.disabled && !window.siyuan.config.readonly);
            }
        });
    }
    return true;
};
