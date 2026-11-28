import type {App} from "../index";
import {openCard} from "./openCard";
import {
    openFlashcardV2AnkiPreview,
    openFlashcardV2Management,
    openFlashcardV2Presets,
    openFlashcardV2ReviewSets,
    openFlashcardV2Statistics,
} from "./flashcardV2";

export const flashcardMenuActions: {id: string; label: string; icon: string; run: (app: App) => void}[] = [
    {id: "spaceRepetition", label: "spaceRepetition", icon: "iconPlay", run: app => openCard(app)},
    {id: "manage", label: "flashcardManageCards", icon: "iconList", run: () => openFlashcardV2Management()},
    {id: "reviewSets", label: "flashcardManageDecks", icon: "iconDatabase", run: app => openFlashcardV2ReviewSets(app)},
    {id: "presets", label: "flashcardPreset", icon: "iconSettings", run: () => openFlashcardV2Presets()},
    {id: "statistics", label: "flashcardStatistics", icon: "iconGraph", run: () => openFlashcardV2Statistics()},
    {id: "anki", label: "flashcardImportAnki", icon: "iconUpload", run: () => openFlashcardV2AnkiPreview()},
];
