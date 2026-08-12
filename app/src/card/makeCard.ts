import {Dialog} from "../dialog";
import {Constants} from "../constants";
import type {App} from "../index";
import {hideElements} from "../protyle/ui/hideElements";
import {fetchPost} from "../util/fetch";
import {genUUID} from "../util/genID";
import {isMobile} from "../util/functions";
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
            transaction(undefined, [{
                action: "addFlashcards",
                deckID: Constants.QUICK_DECK_ID,
                blockIDs,
            }], undefined, {callback});
            return;
        }
        fetchPost("/api/flashcard/createQuickSources", {
            operationID: genUUID(),
            blockIDs,
            createdAt: Date.now(),
        }, callback);
    });
};

const actionHTML = (type: string, icon: string, label: string) => `<li data-type="${type}" class="b3-list-item b3-list-item--narrow">
<svg class="b3-list-item__graphic"><use xlink:href="#${icon}"></use></svg>
<span class="b3-list-item__text">${label}</span>
</li>`;

export const makeCard = (app: App, ids: string[]) => {
    const existing = window.siyuan.dialogs.find((item) =>
        item.element.getAttribute("data-key") === Constants.DIALOG_MAKECARD);
    if (existing) {
        hideElements(["dialog"]);
        return;
    }
    const sourceActions = ids.length === 0 ? "" : [
        actionHTML("quick", "iconRiffCard", window.siyuan.languages.quickMakeCard),
        ids.length > 1 ? actionHTML("basic", "iconBoth", window.siyuan.languages.flashcardDirectionBidirectional) : "",
        actionHTML("advanced", "iconSettings", window.siyuan.languages.configGroupAdvanced),
    ].join("");
    const dialog = new Dialog({
        positionId: Constants.DIALOG_MAKECARD,
        width: isMobile() ? "92vw" : "480px",
        title: window.siyuan.languages.riffCard,
        content: `<div class="b3-dialog__content">
<ul class="b3-list b3-list--background">
${sourceActions}
${actionHTML("reviewSets", "iconDatabase", window.siyuan.languages.flashcardReviewSet)}
${actionHTML("presets", "iconSettings", window.siyuan.languages.flashcardPreset)}
${actionHTML("management", "iconList", window.siyuan.languages.manage)}
${actionHTML("statistics", "iconGraph", window.siyuan.languages.flashcardStatistics)}
${actionHTML("anki", "iconUpload", "Anki")}
</ul>
</div>`,
    });
    dialog.element.setAttribute("data-key", Constants.DIALOG_MAKECARD);
    dialog.element.addEventListener("click", (event) => {
        const target = (event.target as HTMLElement).closest<HTMLElement>("[data-type]");
        const type = target?.dataset.type;
        if (!type) {
            return;
        }
        if (type === "quick") {
            createQuickSources(ids, () => dialog.destroy());
        } else if (type === "basic") {
            dialog.destroy();
            openFlashcardV2BasicSource(ids);
        } else if (type === "advanced") {
            dialog.destroy();
            openFlashcardV2AdvancedSource(ids);
        } else if (type === "reviewSets") {
            dialog.destroy();
            openFlashcardV2ReviewSets(app);
        } else if (type === "presets") {
            dialog.destroy();
            openFlashcardV2Presets();
        } else if (type === "management") {
            dialog.destroy();
            openFlashcardV2Management();
        } else if (type === "statistics") {
            dialog.destroy();
            openFlashcardV2Statistics();
        } else if (type === "anki") {
            dialog.destroy();
            openFlashcardV2AnkiPreview();
        }
    });
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
