import type {IFlashcardQueryAST} from "./flashcardV2Query";
import {flashcardV2LocationQuery} from "./flashcardV2Query";
import type {IFlashcardV2ReviewSessionOptions} from "./flashcardV2Session";

export interface IFlashcardTabData {
    cardType: "doc" | "notebook" | "all";
    id: string;
    title?: string;
    review?: IFlashcardV2ReviewSessionOptions;
}

// 布局只保存复习范围，旧队列和游标由新会话重新计算。
export const normalizeFlashcardTabData = (data: IFlashcardTabData, reviewSetID?: string): IFlashcardTabData => {
    if (!data.review && data.cardType === "all" && data.id && !reviewSetID) {
        throw new Error("Legacy flashcard deck must be resolved before opening");
    }
    return {
        cardType: data.cardType,
        id: data.id,
        title: data.title,
        review: data.review || {
            reviewMode: "normal",
            ...(reviewSetID ? {reviewSetIDs: [reviewSetID]} : {}),
            query: flashcardTabQuery({type: data.cardType, id: data.id}),
        },
    };
};

export interface IFlashcardTabOptions {
    type: "doc" | "notebook" | "all";
    id?: string;
    title?: string;
    reviewSetIDs?: string[];
    query?: IFlashcardQueryAST;
    reviewMode?: "normal" | "reinforcement";
}

export const flashcardTabQuery = (options: IFlashcardTabOptions): IFlashcardQueryAST | undefined => {
    if (!["all", "doc", "notebook"].includes(options.type)) {
        throw new Error("Unsupported flashcard scope type");
    }
    if (options.reviewSetIDs !== undefined && options.reviewSetIDs.length === 0) {
        throw new Error("Flashcard reviewSetIDs must not be empty");
    }
    if (options.reviewSetIDs?.some((id) => !id.trim())) {
        throw new Error("Flashcard review set ID is required");
    }
    if (options.type === "all") {
        return options.query;
    }
    if (!options.id?.trim()) {
        throw new Error("Flashcard document or notebook ID is required");
    }
    const scope = flashcardV2LocationQuery(options.type === "doc" ? "rootID" : "notebookID", options.id);
    if (!options.query) {
        return scope;
    }
    return {version: options.query.version, root: {operator: "and", children: [scope.root, options.query.root]}};
};
