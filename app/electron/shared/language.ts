// 界面语言：语言标签解析与语言包读取，kernel 与 window 直接使用。
import * as nodeFs from "node:fs";
import * as nodePath from "node:path";
import {paths, writeLog} from "./runtime";
import {errorMessage} from "./errors";

type MenuLanguages = {[key: string]: string | undefined};

/**
 * 将 RFC 5646 格式的语言标签解析为应用支持的语言代码
 * https://www.rfc-editor.org/info/rfc5646
 * @param languageTags 语言标签数组（如 ["zh-Hans-CN", "en-US"]）
 * @returns 应用支持的语言代码
 */
const resolveAppLanguage = (languageTags?: string[] | null): string => {
    if (!languageTags || languageTags.length === 0) {
        return "en";
    }

    const tag = languageTags[0].toLowerCase();
    const parts = tag.replace(/_/g, "-").split("-");
    const language = parts[0];

    if (language === "zh") {
        if (tag.includes("hant")) {
            return "zh-TW";
        }
        if (tag.includes("hans") || tag.includes("cn") || tag.includes("sg")) {
            return "zh-CN";
        }
        if (tag.includes("tw") || tag.includes("hk") || tag.includes("mo")) {
            return "zh-TW";
        }
        return "zh-CN";
    }

    const languageMapping: Record<string, string> = {
        "en": "en",
        "ar": "ar",
        "de": "de",
        "es": "es",
        "fr": "fr",
        "he": "he",
        "hi": "hi",
        "id": "id",
        "it": "it",
        "ja": "ja",
        "ko": "ko",
        "nl": "nl",
        "pl": "pl",
        "pt": "pt-BR",
        "ru": "ru",
        "sk": "sk",
        "sr": "sr",
        "th": "th",
        "tr": "tr",
        "uk": "uk",
    };

    return languageMapping[language] || "en";
};

const appMenuLanguages = new Map<string, MenuLanguages>();

// 语言包按语言代码缓存；读取失败时记录日志并回退到英文空集。
const loadAppMenuLanguages = (language: string): MenuLanguages => {
    language = resolveAppLanguage([language]);
    if (appMenuLanguages.has(language)) {
        return appMenuLanguages.get(language) as MenuLanguages;
    }
    try {
        const languages: MenuLanguages = JSON.parse(nodeFs.readFileSync(
            nodePath.join(paths.appDir, "appearance", "langs", `${language}.json`), "utf8"));
        appMenuLanguages.set(language, languages);
        return languages;
    } catch (error) {
        writeLog("load application menu language failed: " + errorMessage(error));
        return language === "en" ? {} : loadAppMenuLanguages("en");
    }
};

export {resolveAppLanguage, loadAppMenuLanguages};
export type {MenuLanguages};
