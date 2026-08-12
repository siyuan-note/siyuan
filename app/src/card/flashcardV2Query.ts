export interface IFlashcardQueryExpression {
    operator: "matchAll" | "and" | "or" | "not" | "predicate";
    children?: IFlashcardQueryExpression[];
    field?: string;
    comparator?: string;
    value?: unknown;
}

export interface IFlashcardQueryAST {
    version: number;
    root: IFlashcardQueryExpression;
}

export const flashcardV2LocationQuery = (field: "notebookID" | "rootID", id: string): IFlashcardQueryAST => ({
    version: 1,
    root: {
        operator: "predicate",
        field,
        comparator: "equal",
        value: id,
    },
});
