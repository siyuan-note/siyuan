// Hunspell 生成候选词可能耗时数秒，两端使用同一等待上限。
export const SPELLCHECK_CONTEXT_TIMEOUT = 5000;

export interface ISpellcheckRequest {
    requestId: number;
    x: number;
    y: number;
    requestedAt: number;
}

export interface ISpellcheckContext {
    requestId: number;
    contextId: number;
    x: number;
    y: number;
    misspelledWord: string;
    dictionarySuggestions: string[];
}
