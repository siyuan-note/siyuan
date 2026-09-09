import type {IFlashcardTabData} from "./flashcardTab";
import type {IFlashcardV2ReviewSessionOptions} from "./flashcardV2Session";

export const resolveFlashcardOpenMode = (mode: number | undefined, mobile: boolean, browser: boolean) => {
    if (mobile || ![0, 1, 2, 3].includes(mode)) {
        return 0;
    }
    return browser && mode === 3 ? 1 : mode;
};

export const createFlashcardReviewTabData = (reviewSetID: string, title: string,
                                           options: IFlashcardV2ReviewSessionOptions): IFlashcardTabData => ({
    cardType: "all",
    id: "",
    title,
    // 单个复习集标识还用于会话策略和插件事件，随页签完整保留。
    ...(reviewSetID ? {reviewSetID} : {}),
    review: {...options},
});
