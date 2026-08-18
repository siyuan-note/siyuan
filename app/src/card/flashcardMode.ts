export type FlashcardCreationConfig = Pick<Config.IFlashCard,
    "blockquote" | "callout" | "heading" | "list" | "mark" | "superBlock">;

export interface IFlashcardRevealState {
    generation: number,
    pendingGeneration?: number,
}

export const createFlashcardRevealState = (): IFlashcardRevealState => ({
    generation: 0,
});

export const beginFlashcardLoad = (state: IFlashcardRevealState) => {
    state.generation++;
    state.pendingGeneration = undefined;
    return state.generation;
};

export const isCurrentFlashcardLoad = (state: IFlashcardRevealState, generation: number) => {
    return state.generation === generation;
};

export const revealFlashcardAfterUnfold = (options: {
    state: IFlashcardRevealState,
    generation: number,
    unfold?: (done: () => void) => void,
    reveal: () => void,
}) => {
    if (!isCurrentFlashcardLoad(options.state, options.generation) ||
        options.state.pendingGeneration === options.generation) {
        return false;
    }
    if (!options.unfold) {
        options.reveal();
        return true;
    }

    options.state.pendingGeneration = options.generation;
    let finished = false;
    options.unfold(() => {
        if (finished) {
            return;
        }
        finished = true;
        if (options.state.pendingGeneration === options.generation) {
            options.state.pendingGeneration = undefined;
        }
        if (isCurrentFlashcardLoad(options.state, options.generation)) {
            options.reveal();
        }
    });
    return true;
};

const FLASHCARD_HIDE_CLASS_ENTRIES: Array<[keyof FlashcardCreationConfig, string]> = [
    ["mark", "card__block--hidemark"],
    ["list", "card__block--hideli"],
    ["superBlock", "card__block--hidesb"],
    ["blockquote", "card__block--hidebq"],
    ["callout", "card__block--hidecallout"],
    ["heading", "card__block--hideh"],
];

const FLASHCARD_HIDE_CLASSES = FLASHCARD_HIDE_CLASS_ENTRIES.map((entry) => entry[1]);

const FLASHCARD_ANSWER_SELECTOR_ENTRIES: Array<[keyof FlashcardCreationConfig, string]> = [
    ["mark", "span[data-type~=\"mark\"]"],
    ["list", ".list[custom-riff-decks] .li > .list, .li[custom-riff-decks] > .list"],
    ["superBlock", ":scope > .sb[custom-riff-decks] > div:nth-of-type(n+2):not(.protyle-attr)"],
    ["blockquote", ":scope > .bq[custom-riff-decks] > [data-node-id] ~ [data-node-id]"],
    ["callout", ":scope > .callout[custom-riff-decks] > .callout-content > [data-node-id]"],
    ["heading", ":scope > div[data-type=\"NodeHeading\"][custom-riff-decks] ~ div"],
];

export const hasFlashcardAnswer = (wysiwygElement: Element, config: FlashcardCreationConfig) => {
    return FLASHCARD_ANSWER_SELECTOR_ENTRIES.some(([key, selector]) => {
        return config[key] && Boolean(wysiwygElement.querySelector(selector));
    });
};

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
