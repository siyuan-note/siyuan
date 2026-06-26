import type {RowPart} from "../render/parts";

/** 检索文案：去 HTML、trim、toLowerCase */
export const normalizeSearchText = (text: string): string => {
    let plain = text || "";
    if (plain.includes("<")) {
        const el = document.createElement("div");
        el.innerHTML = plain;
        plain = el.textContent || "";
    }
    return plain.trim().toLowerCase();
};

/** 获取设置对话框搜索框关键词 */
export const getSearchKeywordsLower = (dialogElement: HTMLElement): string | undefined => {
    const searchInput = dialogElement.querySelector(".config__tab-head .b3-text-field") as HTMLInputElement | null;
    const keywords = normalizeSearchText(searchInput?.value ?? "");
    return keywords || undefined;
};

/** 注册时构建检索索引（normalize、去重） */
export const buildSearchIndex = (rawStrings: readonly string[]): readonly string[] => {
    const strings: string[] = [];
    for (const text of rawStrings) {
        const normalized = normalizeSearchText(text);
        if (normalized.length > 0) {
            strings.push(normalized);
        }
    }
    return [...new Set(strings)];
};

/** 注册时构建条目检索索引（normalize、去重） */
export const buildItemSearchIndex = (item: {
    kind: string;
    rowParts?: RowPart[];
    searchTexts?: () => string[];
}): readonly string[] => {
    const strings: string[] = [];
    if (item.kind === "full" && item.rowParts) {
        for (const part of item.rowParts) {
            for (const s of collectPartSearchStrings(part)) {
                if (s.length > 0) {
                    strings.push(s);
                }
            }
        }
    }
    if (item.searchTexts) {
        for (const text of item.searchTexts()) {
            const normalized = normalizeSearchText(text);
            if (normalized.length > 0) {
                strings.push(normalized);
            }
        }
    }
    return [...new Set(strings)];
};

const collectPartSearchStrings = (part: RowPart): string[] => {
    switch (part.kind) {
        case "title":
        case "desc":
            return [normalizeSearchText(part.text)];
        case "select":
            return (part.options ?? []).map((o) => normalizeSearchText(o.label ?? String(o.value)));
        case "number":
            return part.unit ? [normalizeSearchText(part.unit)] : [];
        default:
            return [];
    }
};
