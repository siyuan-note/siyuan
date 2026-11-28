import {showMessage} from "../dialog/message";
import {Constants} from "../constants";
import type {App} from "../index";
import {fetchPost} from "../util/fetch";
import {genUUID} from "../util/genID";
import {transaction} from "../protyle/wysiwyg/transaction";
import {
    openFlashcardV2AdvancedSource,
    openFlashcardV2AnkiPreview,
    openFlashcardV2BasicSource,
    openFlashcardV2Management,
    openFlashcardV2Presets,
    openFlashcardV2ReviewSets,
    openFlashcardV2Statistics
} from "./flashcardV2";

export const createQuickSources = (blockIDs: string[], callback?: () => void) => {
    if (blockIDs.length === 0) {
        return;
    }
    fetchPost("/api/flashcard/getMigrationStatus", {}, (statusResponse) => {
        if (statusResponse.data.state === "Legacy") {
            fetchPost("/api/riff/getRiffCardsByBlockIDs", {blockIDs}, (response) => {
                const remove = (response.data.blocks as IBlock[]).every((block) => block.riffCard);
                transaction(undefined, [{
                    action: remove ? "removeFlashcards" : "addFlashcards",
                    deckID: Constants.QUICK_DECK_ID,
                    blockIDs,
                }], undefined, {callback: () => {
                    showMessage(remove ? window.siyuan.languages.quickMakeCardCanceled :
                        window.siyuan.languages.quickMakeCardCompleted);
                    callback?.();
                }});
            });
            return;
        }
        fetchPost("/api/flashcard/createQuickSources", {
            operationID: genUUID(),
            blockIDs,
            createdAt: Date.now(),
            toggle: true,
        }, (response) => {
            if (response.data.markedBlockIDs) {
                const marked = new Set(response.data.markedBlockIDs);
                for (const id of blockIDs) {
                    const block = `[data-node-id="${CSS.escape(id)}"]`;
                    document.querySelectorAll(`.protyle-title${block}, .protyle-wysiwyg ${block}`).forEach(element => {
                        if (marked.has(id)) {
                            element.setAttribute(Constants.DATA_FLASHCARD_SOURCE, "true");
                        } else if (element.hasAttribute(Constants.CUSTOM_RIFF_DECKS)) {
                            element.setAttribute(Constants.DATA_FLASHCARD_SOURCE, "false");
                        } else {
                            element.removeAttribute(Constants.DATA_FLASHCARD_SOURCE);
                        }
                    });
                }
            }
            showMessage(response.data.cardIDs.length === 0 ? window.siyuan.languages.quickMakeCardEmpty :
                response.data.action === "removed" ? window.siyuan.languages.quickMakeCardCanceled :
                window.siyuan.languages.quickMakeCardCompleted);
            callback?.();
        });
    });
};

export const flashcardSourceMenuItems = (app: App, blockIDs: string[]): IMenu[] => {
    const lang = window.siyuan.languages;
    return [{
        id: "basic",
        icon: "iconBoth",
        label: lang.flashcardQA,
        ignore: blockIDs.length < 2,
        click: () => openFlashcardV2BasicSource(blockIDs),
    }, {
        id: "advanced",
        icon: "iconSettings",
        label: lang.configGroupAdvanced,
        ignore: blockIDs.length === 0,
        click: () => openFlashcardV2AdvancedSource(blockIDs),
    }, {
        id: "reviewSets",
        icon: "iconDatabase",
        label: lang.flashcardReviewSet,
        click: () => openFlashcardV2ReviewSets(app),
    }, {
        id: "presets",
        icon: "iconSettings",
        label: lang.flashcardPreset,
        click: () => openFlashcardV2Presets(),
    }, {
        id: "management",
        icon: "iconList",
        label: lang.manage,
        click: () => openFlashcardV2Management(),
    }, {
        id: "statistics",
        icon: "iconGraph",
        label: lang.flashcardStatistics,
        click: () => openFlashcardV2Statistics(),
    }, {
        id: "anki",
        icon: "iconUpload",
        label: "Anki",
        click: () => openFlashcardV2AnkiPreview(),
    }];
};

export const quickMakeCard = (_protyle: IProtyle, nodeElements: Element[]) => {
    const blockIDs: string[] = [];
    nodeElements.forEach((item) => {
        item.classList.remove("protyle-wysiwyg--select");
        if (item.getAttribute("data-type") !== "NodeThematicBreak") {
            blockIDs.push(item.getAttribute("data-node-id"));
        }
    });
    createQuickSources(blockIDs);
};
