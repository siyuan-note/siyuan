type FlashcardCreationConfig = Pick<Config.IFlashCard,
    "blockquote" | "callout" | "heading" | "list" | "mark" | "superBlock">;

const FLASHCARD_HIDE_CLASS_ENTRIES: Array<[keyof FlashcardCreationConfig, string]> = [
    ["mark", "card__block--hidemark"],
    ["list", "card__block--hideli"],
    ["superBlock", "card__block--hidesb"],
    ["blockquote", "card__block--hidebq"],
    ["callout", "card__block--hidecallout"],
    ["heading", "card__block--hideh"],
];

const FLASHCARD_HIDE_CLASSES = FLASHCARD_HIDE_CLASS_ENTRIES.map((entry) => entry[1]);

export const showFlashcardAnswer = (element: Element) => {
    element.classList.remove(...FLASHCARD_HIDE_CLASSES);
};

export const hideFlashcardAnswer = (element: Element, config: FlashcardCreationConfig) => {
    showFlashcardAnswer(element);
    FLASHCARD_HIDE_CLASS_ENTRIES.forEach(([key, className]) => {
        if (config[key]) {
            element.classList.add(className);
        }
    });
};

export const prepareCalloutFlashcard = (wysiwygElement: Element, enabled: boolean) => {
    if (!enabled) {
        return false;
    }
    const calloutElement = wysiwygElement.querySelector(":scope > .callout[custom-riff-decks]");
    if (!calloutElement?.querySelector(":scope > .callout-content > [data-node-id]")) {
        return false;
    }
    calloutElement.removeAttribute("fold");
    return true;
};
