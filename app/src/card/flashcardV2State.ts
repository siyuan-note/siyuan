export interface IFlashcardV2ReviewActionState {
    renderPending: boolean;
    requestPending: boolean;
    sessionFinished: boolean;
    index: number;
    queueLength: number;
}

export interface IFlashcardV2TagAssignmentGroup {
    targetIDs: string[];
    tagIDs: string[];
}

export type TFlashcardV2ReviewShortcutAction = "revealOrGood" | "again" | "hard" | "good" | "easy" |
    "skip" | "undo";

const flashcardV2ReviewShortcutActions: Record<string, TFlashcardV2ReviewShortcutAction> = {
    " ": "revealOrGood",
    enter: "revealOrGood",
    "1": "again",
    j: "again",
    a: "again",
    "2": "hard",
    k: "hard",
    s: "hard",
    "3": "good",
    l: "good",
    d: "good",
    "4": "easy",
    ";": "easy",
    f: "easy",
    "0": "skip",
    x: "skip",
    p: "undo",
    q: "undo",
};

export const canUseFlashcardV2ReviewActions = (state: IFlashcardV2ReviewActionState) => {
    return !state.renderPending && !state.requestPending && !state.sessionFinished &&
        state.index >= 0 && state.index < state.queueLength;
};

export const shouldLoadFlashcardV2HeadingChildren = (nodeType: string | null, fold: string | null) => {
    return nodeType === "NodeHeading" && fold === "1";
};

export const getFlashcardV2ReviewShortcutAction = (shortcut: string) => {
    return flashcardV2ReviewShortcutActions[shortcut.toLowerCase()];
};

export const getFlashcardV2TagSelection = (targetIDs: readonly string[],
    assignments: Readonly<Record<string, readonly string[]>>) => {
    const counts = new Map<string, number>();
    targetIDs.forEach((targetID) => {
        new Set(assignments[targetID] || []).forEach((tagID) => {
            counts.set(tagID, (counts.get(tagID) || 0) + 1);
        });
    });
    const selected: string[] = [];
    const mixed: string[] = [];
    counts.forEach((count, tagID) => {
        if (count === targetIDs.length) {
            selected.push(tagID);
        } else {
            mixed.push(tagID);
        }
    });
    return {
        selected: selected.sort(),
        mixed: mixed.sort(),
    };
};

export const buildFlashcardV2TagAssignmentGroups = (targetIDs: readonly string[],
    assignments: Readonly<Record<string, readonly string[]>>, changes: Readonly<Record<string, boolean>>) => {
    const grouped = new Map<string, IFlashcardV2TagAssignmentGroup>();
    targetIDs.forEach((targetID) => {
        const tagIDs = new Set(assignments[targetID] || []);
        Object.entries(changes).forEach(([tagID, selected]) => {
            if (selected) {
                tagIDs.add(tagID);
            } else {
                tagIDs.delete(tagID);
            }
        });
        const sortedTagIDs = [...tagIDs].sort();
        const key = JSON.stringify(sortedTagIDs);
        const group = grouped.get(key);
        if (group) {
            group.targetIDs.push(targetID);
        } else {
            grouped.set(key, {targetIDs: [targetID], tagIDs: sortedTagIDs});
        }
    });
    return [...grouped.values()];
};
