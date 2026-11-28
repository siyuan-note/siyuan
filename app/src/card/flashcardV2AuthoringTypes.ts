export const FLASHCARD_SLASH_TYPES = [
    {id: "flashcardQA", mode: "qa", label: "flashcardQA"},
    {id: "flashcardMultiLine", mode: "multiLineAll", label: "flashcardMultiLine"},
    {id: "flashcardTypedAnswer", mode: "typedAnswer", label: "flashcardTypedAnswer"},
    {id: "flashcardChoiceSingle", mode: "choiceSingle", label: "flashcardChoiceSingle"},
    {id: "flashcardChoiceMultiple", mode: "choiceMultiple", label: "flashcardChoiceMultiple"},
    {id: "flashcardImageOcclusion", mode: "imageOcclusion", label: "flashcardImageOcclusion"},
] as const;

export type TFlashcardAuthoringMode = Exclude<typeof FLASHCARD_SLASH_TYPES[number]["mode"], "imageOcclusion"> | "cloze";

export interface IFlashcardV2ClozeDraft {
    blockID: string;
    dom: string;
    save: (dom: string) => Promise<boolean>;
}
