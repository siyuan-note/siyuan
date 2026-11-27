import {escapeHtml} from "../util/escape";

// 将配置字段转换为可阅读的分层列表，稳定标识在当前比较的两个版本之间使用同一编号。
export const renderSourceHistoryConfiguration = (config: Record<string, unknown>, ids: ReadonlyMap<string, string>,
    lang: Record<string, string>, comparison: Record<string, unknown> = config) => {
    const labels: Record<string, string> = {
        groups: lang.group, groupIDs: lang.group, shapes: lang.flashcardImageOcclusion,
        shapeIDs: lang.flashcardImageOcclusion, occlusions: lang.mark, occlusionIDs: lang.mark,
        steps: lang.flashcardOrderedSingle, displayOrder: lang.sort, options: lang.flashcardChoiceQuestion,
        correctOptionIDs: lang.flashcardCorrectAnswer, randomize: lang.flashcardRandomizeOptions,
        frontMode: lang.flashcardImageOcclusion, mode: lang.type, type: lang.type,
        width: lang.width, height: lang.height, x: "X", y: "Y", points: lang.position,
        hint: lang.tooltipText, answers: lang.flashcardMultiLineAll, revealMode: lang.flashcardMultiLineSteps,
        assetID: lang.image, variants: lang.riffCard, dynamicDistractorCount: lang.flashcardDynamicDistractors,
        caseSensitive: lang.searchCaseSensitive, ignoreDiacritics: lang.matchDiacritics,
        fuzzyMaxDistance: lang.flashcardAnswerMaxDistance, fuzzyMaxRatio: lang.flashcardAnswerMaxRatio,
        trimWhitespace: lang.flashcardAnswerTrimWhitespace, collapseWhitespace: lang.flashcardAnswerCollapseWhitespace,
        ignorePunctuation: lang.flashcardAnswerIgnorePunctuation, answerConfig: lang.flashcardTypedAnswer,
        revealBehavior: lang.flashcardMultiLineSteps, distractorQuery: lang.flashcardDynamicFilter,
    };
    const values: Record<string, string> = {
        hideAllAnswerOne: lang.flashcardImageHideAll, hideCurrent: lang.flashcardImageHideCurrent,
        rectangle: lang.flashcardRectangle, ellipse: lang.flashcardEllipse, polygon: lang.flashcardPolygon,
        single: lang.flashcardChoiceSingle, multiple: lang.flashcardChoiceMultiple,
        all: lang.flashcardMultiLineAll, steps: lang.flashcardMultiLineSteps,
        auto: lang.flashcardBlockCard, append: lang.flashcardMultiLineSteps, replace: lang.replace,
    };
    const render = (value: unknown, other?: unknown): string => {
        if (Array.isArray(value)) {
            return `<ol>${value.map((item, index) => `<li>${render(item, Array.isArray(other) ? other[index] : undefined)}</li>`).join("")}</ol>`;
        }
        if (value && typeof value === "object") {
            return `<dl>${Object.entries(value).map(([key, child]) => {
                if (key === "id") {
                    return `<dt>${escapeHtml(ids.get(String(child)) || "")}</dt>`;
                }
                const previous = other && typeof other === "object" ? (other as Record<string, unknown>)[key] : undefined;
                const changed = JSON.stringify(child) !== JSON.stringify(previous);
                const label = Object.prototype.hasOwnProperty.call(labels, key) ? labels[key] : lang.config;
                return `<dt${changed ? " class=\"ft__error\"" : ""}>${escapeHtml(label || lang.config)}</dt><dd>${render(key === "ignoreDiacritics" ? !child : child, previous)}</dd>`;
            }).join("")}</dl>`;
        }
        if (typeof value === "boolean") {
            return escapeHtml(value ? lang.enable : lang.disable);
        }
        const text = String(value ?? "");
        const label = Object.prototype.hasOwnProperty.call(values, text) ? values[text] : text;
        return escapeHtml(ids.get(text) || label || text);
    };
    return render(config, comparison);
};
