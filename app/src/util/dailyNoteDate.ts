export type TDailyNoteDateResult = {date: string} | {error: true};

const normalize = (value: string) => value.normalize("NFKC").toLowerCase()
    .replace(/[\u200e\u200f\u061c]/g, "").replace(/[’‘]/g, "'").trim();

const formatDate = (date: Date) => `${date.getFullYear().toString().padStart(4, "0")}-${(date.getMonth() + 1).toString().padStart(2, "0")}-${date.getDate().toString().padStart(2, "0")}`;

const calendarDate = (year: number, month: number, day: number): TDailyNoteDateResult => {
    const date = new Date(0);
    date.setFullYear(year, month - 1, day);
    date.setHours(12, 0, 0, 0);
    if (year < 1 || year > 9999 || date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
        return {error: true};
    }
    return {date: formatDate(date)};
};

type TDateVocabulary = {relative: Map<string, number | null>, months: Map<string, number>};
const vocabularies = new Map<string, TDateVocabulary>();

// 公历月份同时收集独立形式和日期中的形式，兼容俄语等语言的月份变格。
const getVocabulary = (locale: string) => {
    let vocabulary = vocabularies.get(locale);
    if (vocabulary) {
        return vocabulary;
    }
    const relative = new Map<string, number | null>();
    for (const numeric of ["auto", "always"] as const) {
        const relativeFormat = new Intl.RelativeTimeFormat(locale, {numeric});
        [-1, 0, 1].forEach(offset => {
            const word = normalize(relativeFormat.format(offset, "day"));
            relative.set(word, relative.has(word) && relative.get(word) !== offset ? null : offset);
        });
    }
    if (locale === "hi") {
        relative.set("बीता कल", -1);
        relative.set("आने वाला कल", 1);
    }
    const months = new Map<string, number>();
    for (const width of ["long", "short"] as const) {
        for (const withDay of [false, true]) {
            const formatter = new Intl.DateTimeFormat(locale, {
                calendar: "gregory", numberingSystem: "latn", month: width,
                ...(withDay ? {day: "numeric"} : {}),
            });
            for (let month = 0; month < 12; month++) {
                const parts = formatter.formatToParts(new Date(2026, month, 15));
                const monthIndex = parts.findIndex(item => item.type === "month");
                const part = parts[monthIndex];
                if (part && !/^\d+$/.test(part.value)) {
                    const name = normalize(part.value).replace(/\.$/, "");
                    months.set(name, month + 1);
                    const prefix = parts[monthIndex - 1];
                    if (prefix?.type === "literal" && new RegExp("^\\s*\\p{L}+$", "u").test(prefix.value)) {
                        months.set(normalize(prefix.value) + name, month + 1);
                    }
                }
            }
        }
    }
    if (locale === "en") {
        months.set("sept", 9);
    }
    vocabulary = {relative, months};
    vocabularies.set(locale, vocabulary);
    return vocabulary;
};

const latinDigits = (text: string, locale: string) => {
    const formatter = new Intl.NumberFormat(locale, {useGrouping: false});
    for (let digit = 0; digit <= 9; digit++) {
        text = text.split(formatter.format(digit)).join(String(digit));
    }
    return text;
};

// 日期候选仅解析输入，不使用 Date.parse 猜测日期，也不会创建文档。
export const parseDailyNoteDate = (input: string, locale: string, now = new Date()): TDailyNoteDateResult | undefined => {
    let text = normalize(input);
    if (!text || text.length > 80) {
        return undefined;
    }
    const locales = [...new Set([locale, "en"])];
    for (const language of locales) {
        const vocabulary = getVocabulary(language);
        const offset = vocabulary.relative.get(text);
        if (offset === null) {
            return {error: true};
        }
        if (offset !== undefined) {
            const date = new Date(now);
            date.setDate(date.getDate() + offset);
            return {date: formatDate(date)};
        }
        text = latinDigits(text, language);
    }
    const fullDate = text.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
    if (fullDate) {
        return calendarDate(Number(fullDate[1]), Number(fullDate[2]), Number(fullDate[3]));
    }
    const eastAsianDate = text.match(/^(?:(\d{4})[年년]\s*)?(\d{1,2})[月월]\s*(\d{1,2})[日일]?$/);
    if (eastAsianDate) {
        return calendarDate(Number(eastAsianDate[1] || now.getFullYear()), Number(eastAsianDate[2]), Number(eastAsianDate[3]));
    }
    // 数字月日缺少年份或日期顺序不明确时，要求输入明确日期。
    if (/^\d{1,2}\s*[-/.]\s*\d{1,2}(?:\s*[-/.]\s*\d{2,4})?\.?$/.test(text)) {
        return {error: true};
    }
    for (const language of locales) {
        const months = [...getVocabulary(language).months.entries()].sort((a, b) => b[0].length - a[0].length);
        for (const [name, month] of months) {
            const index = text.indexOf(name);
            if (index < 0) {
                continue;
            }
            const before = text.slice(0, index);
            const after = text.slice(index + name.length);
            // 月份必须是完整词，避免将普通文档名中的英文片段解释为日期。
            if (new RegExp("\\p{L}$", "u").test(before) || new RegExp("^\\p{L}", "u").test(after)) {
                continue;
            }
            const remainder = `${before} ${after}`.replace(/\b(\d{1,2})(?:st|nd|rd|th)\b/g, "$1")
                .replace(/\b(?:de|del|of)\b/g, " ").replace(/[年日년일]/g, " ")
                .replace(/[\s.,/-]+/g, " ").trim();
            if (!/^\d{1,4}(?: \d{1,4})?$/.test(remainder)) {
                continue;
            }
            const numbers = remainder.split(" ").map(Number);
            if (numbers.length === 1) {
                return calendarDate(now.getFullYear(), month, numbers[0]);
            }
            const yearIndex = remainder.split(" ").findIndex(number => number.length === 4);
            if (yearIndex < 0) {
                return {error: true};
            }
            return calendarDate(numbers[yearIndex], month, numbers[1 - yearIndex]);
        }
    }
    return undefined;
};
