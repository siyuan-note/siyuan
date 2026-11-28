import type {JSONValue} from "../types/api";

export interface IFlashcardQueryExpression {
    operator: "matchAll" | "and" | "or" | "not" | "predicate";
    children?: IFlashcardQueryExpression[];
    field?: string;
    comparator?: string;
    // editLater 使用 equal 或 notEqual 与布尔值；待编辑卡片可管理，但不能进入学习会话。
    value?: JSONValue;
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

export const flashcardV2DocumentTreeQuery = (id: string, notebookID: string, path: string): IFlashcardQueryAST => ({
    version: 1,
    root: {operator: "and", children: [
        flashcardV2LocationQuery("notebookID", notebookID).root,
        {operator: "or", children: [
            flashcardV2LocationQuery("rootID", id).root,
            {operator: "predicate", field: "path", comparator: "startsWith", value: path.slice(0, -3) + "/"},
        ]},
    ]},
});
