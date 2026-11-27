import type {IFlashcardQueryAST} from "./flashcardV2Query";
import type {IFlashcardV2EditLater} from "./flashcardV2EditLater";
import type {IFlashcardV2ReviewSessionOptions} from "./flashcardV2Session";

export interface IFlashcardV2StudyCard {
    card: {id: string};
    reviewState: {due: number, difficulty?: number, lapses: number};
}

export type TFlashcardV2StudyOrder = "selected" | "due" | "difficulty" | "lapses" | "random";

// 临时排序只生成本次会话的卡片顺序，不改写卡包、优先级或排期。
export const orderFlashcardV2StudyCards = (cards: IFlashcardV2StudyCard[], order: TFlashcardV2StudyOrder,
                                         random = Math.random): string[] => {
    const ordered = [...cards];
    if (order === "random") {
        for (let index = ordered.length - 1; index > 0; index--) {
            const other = Math.floor(random() * (index + 1));
            [ordered[index], ordered[other]] = [ordered[other], ordered[index]];
        }
    } else if (order !== "selected") {
        ordered.sort((left, right) => order === "due" ? left.reviewState.due - right.reviewState.due :
            (right.reviewState[order] || 0) - (left.reviewState[order] || 0));
    }
    return [...new Set(ordered.map((item) => item.card.id))];
};

export const flashcardV2SubsetOptions = (reviewSetID: string, query: IFlashcardQueryAST | undefined,
                                       cardIDs: string[] | undefined,
                                       reviewMode: IFlashcardV2ReviewSessionOptions["reviewMode"]): IFlashcardV2ReviewSessionOptions => {
    if (cardIDs?.length === 0) {
        throw new Error("Flashcard selection must not be empty");
    }
    return {
        reviewMode,
        ...(reviewSetID ? {reviewSetIDs: [reviewSetID]} : {}),
        ...(query ? {query} : {}),
        ...(cardIDs ? {cardIDs: [...cardIDs]} : {}),
        ...(reviewMode === "reinforcement" && cardIDs ? {practiceLimit: cardIDs.length} : {}),
    };
};

// 只根据本次会话已成功提交的最后一次评分收集薄弱卡，撤销时恢复前一次结果。
export class FlashcardV2WeakCards {
    private ratings = new Map<string, string>();

    record(cardID: string, rating: string): string | undefined {
        const previous = this.ratings.get(cardID);
        this.ratings.set(cardID, rating);
        return previous;
    }

    restore(cardID: string, rating?: string) {
        if (rating === undefined) {
            this.ratings.delete(cardID);
        } else {
            this.ratings.set(cardID, rating);
        }
    }

    cards(queue: Array<{card: {id: string, generationStatus: string, editLater?: IFlashcardV2EditLater},
        sessionCard: {status: string}}>): string[] {
        return queue.filter((item) => item.card.generationStatus === "active" && !item.card.editLater &&
            item.sessionCard.status === "reviewed" && ["again", "hard"].includes(this.ratings.get(item.card.id)))
            .map((item) => item.card.id);
    }
}
