import type {FlashcardV2EntityRevision, JSONValue} from "../types/api";

export const isFlashcardV2Object = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === "object" && !Array.isArray(value);

export const isFlashcardV2Strings = (value: unknown): value is string[] =>
    Array.isArray(value) && value.every((item) => typeof item === "string");

export const readFlashcardV2Payload = <T>(value: unknown, valid: (value: unknown) => value is T): T => {
    if (!valid(value)) {
        throw new Error("Invalid flashcard response payload");
    }
    return value;
};

// 实体接口返回多种载荷，先检查相应实体的结构，再交给管理和复习界面。
export const readFlashcardV2Revision = <T>(revision: FlashcardV2EntityRevision,
    valid: (value: unknown) => value is T) => ({...revision, payload: readFlashcardV2Payload(revision.payload, valid)});

// 保留 JSON 的实际字段和值，排除无法通过接口传输的值，并沿用对象省略 undefined 的语义。
export const toFlashcardV2JSON = (value: unknown): JSONValue => {
    if (value === null) {
        return null;
    }
    if (typeof value === "string" || typeof value === "boolean" ||
        typeof value === "number" && Number.isFinite(value)) {
        return value;
    }
    if (Array.isArray(value)) {
        return value.map((item) => item === undefined ? null : toFlashcardV2JSON(item));
    }
    if (isFlashcardV2Object(value)) {
        return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)
            .map(([key, item]) => [key, toFlashcardV2JSON(item)]));
    }
    throw new Error("Flashcard payload is not JSON serializable");
};
