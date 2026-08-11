import {escapeAttr, escapeHtml} from "../util/escape";

export interface IFlashcardV2SourceReference {
    id?: string;
    sourceID?: string;
    fieldID?: string;
    entityType: string;
    entityID: string;
    role: string;
    sort: number;
}

export interface IFlashcardV2RenderSpec {
    type?: string;
    markup?: string;
    fieldID?: string;
    fieldIDs?: string[];
    role?: string;
    roles?: string[];
    answerCheck?: IFlashcardV2AnswerCheckConfig;
    mediaAutoplay?: boolean;
    tts?: {
        enabled?: boolean;
        autoPlay?: boolean;
        lang?: string;
        rate?: number;
        pitch?: number;
        fieldIDs?: string[];
    };
}

export interface IFlashcardV2AnswerCheckConfig {
    acceptedAnswers?: string[];
    caseSensitive?: boolean;
    trimWhitespace?: boolean;
    collapseWhitespace?: boolean;
    ignorePunctuation?: boolean;
    ignoreDiacritics?: boolean;
    fuzzyMaxDistance?: number;
    fuzzyMaxRatio?: number;
}

export interface IFlashcardV2AnswerDiff {
    type: "equal" | "extra" | "missing";
    value: string;
}

export interface IFlashcardV2AnswerCheckResult {
    correct: boolean;
    exact: boolean;
    acceptedAnswer: string;
    normalizedInput: string;
    normalizedAnswer: string;
    distance: number;
    distanceRatio: number;
    suggestedRating: "again" | "good";
    diff: IFlashcardV2AnswerDiff[];
}

interface IClozeGenerationConfig {
    occlusions: Array<{ id: string, groupIDs: string[], displayOrder: number }>;
}

interface IOrderedGenerationConfig {
    steps: Array<{ id: string, displayOrder: number, occlusionIDs: string[] }>;
}

interface IImageOcclusionConfig {
    assetID: string;
    shapes: Array<{
        id: string,
        type: "rectangle" | "ellipse" | "polygon",
        x?: number,
        y?: number,
        width?: number,
        height?: number,
        points?: Array<{ x: number, y: number }>
    }>;
    groups: Array<{ id: string, shapeIDs: string[] }>;
    frontMode: "hideAllAnswerOne" | "hideCurrent";
}

interface IChoiceGenerationConfig {
    mode: "single" | "multiple";
    options: Array<{ id: string, displayOrder: number }>;
    correctOptionIDs: string[];
    randomize: boolean;
    dynamicDistractorCount?: number;
}

interface IMultiLineGenerationConfig {
    answers: Array<{ id: string, displayOrder: number }>;
    revealMode: "all" | "steps";
}

export interface IFlashcardV2RenderModel {
    card: {
        id: string;
        sourceID?: string;
        flag?: number;
        variantKey: string;
        variantData?: Record<string, unknown>;
    };
    source: {
        id?: string;
        primaryRefID?: string;
        sourceType: string;
        generationConfig?: IClozeGenerationConfig | IOrderedGenerationConfig | IImageOcclusionConfig |
            IChoiceGenerationConfig | IMultiLineGenerationConfig;
        pluginNamespace?: string;
        pluginDataVersion?: number;
        pluginData?: {
            textFallback?: string;
            [key: string]: unknown;
        };
    };
    references: IFlashcardV2SourceReference[];
    template: {
        frontSpec?: IFlashcardV2RenderSpec;
        backSpec?: IFlashcardV2RenderSpec;
        style?: string;
        contextPolicy?: {
            breadcrumb?: boolean;
            documentTitle?: boolean;
            ancestorDepth?: number;
            adjacentBefore?: number;
            adjacentAfter?: number;
        };
    };
    schema?: {
        fields: Array<{ id: string, name: string }>;
    };
}

export interface IFlashcardV2OcclusionPlan {
    steps: string[][];
    persistent: string[];
}

export interface IFlashcardV2RevealController {
    revealNext: () => boolean;
}

export interface IFlashcardV2TypedAnswerController {
    check: () => IFlashcardV2AnswerCheckResult[];
}

let flashcardV2StyleScopeSequence = 0;

export const flashcardV2TemplateURI = /^(?:assets\/[a-z0-9._~%/-]+(?:\?box=[a-z0-9._~%-]+)?|data:image\/(?:avif|gif|jpeg|png|webp);base64,[a-z0-9+/=]+|#[a-z0-9_-]+)$/i;

const splitFlashcardV2CSSSelectors = (value: string) => {
    const ret: string[] = [];
    let start = 0;
    let depth = 0;
    let quote = "";
    for (let index = 0; index < value.length; index++) {
        const character = value[index];
        if (quote) {
            if (character === quote && value[index - 1] !== "\\") {
                quote = "";
            }
            continue;
        }
        if (character === "\"" || character === "'") {
            quote = character;
        } else if (character === "(" || character === "[") {
            depth++;
        } else if (character === ")" || character === "]") {
            depth = Math.max(0, depth - 1);
        } else if (character === "," && depth === 0) {
            ret.push(value.substring(start, index));
            start = index + 1;
        }
    }
    ret.push(value.substring(start));
    return ret;
};

const scopeFlashcardV2CSSSelector = (value: string, scope: string) => {
    let selector = value.trim();
    if (!selector) {
        return "";
    }
    const root = selector.match(/^(?::root|html|body)(?=$|[\s.#:[>+~])/i);
    if (root) {
        selector = selector.substring(root[0].length);
    }
    const card = selector.match(/^\.card(?=$|[\s.#:[>+~])/);
    if (card) {
        selector = selector.substring(card[0].length);
    }
    if (root || card) {
        if (!selector) {
            return scope;
        }
        return /^[.#:[>+~]/.test(selector) ? scope + selector : `${scope} ${selector.trimStart()}`;
    }
    return `${scope} ${selector}`;
};

export const isSafeFlashcardV2CSSValue = (value: string) => {
    let unsafe = false;
    const remaining = value.replace(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/gi,
        (_match, doubleQuoted: string, singleQuoted: string, unquoted: string) => {
            const url = (doubleQuoted ?? singleQuoted ?? unquoted ?? "").trim();
            if (url.includes("\\") || [...url].some((character) => {
                const code = character.charCodeAt(0);
                return code < 32 || code === 127;
            }) ||
                !flashcardV2TemplateURI.test(url)) {
                unsafe = true;
            }
            return "";
        });
    return !unsafe && !/url\s*\(/i.test(remaining) && !/\b(?:expression|var)\s*\(/i.test(value);
};

const safeFlashcardV2CSSDeclarations = (style: CSSStyleDeclaration) => {
    const declarations: string[] = [];
    for (let index = 0; index < style.length; index++) {
        const property = style.item(index);
        const value = style.getPropertyValue(property).trim();
        if (!property || !value || property.startsWith("--") || property === "behavior" || property === "-moz-binding" ||
            property === "position" && !/^(?:static|relative)$/i.test(value) || !isSafeFlashcardV2CSSValue(value)) {
            continue;
        }
        declarations.push(`${property}: ${value}${style.getPropertyPriority(property) ? " !important" : ""};`);
    }
    return declarations.join(" ");
};

const serializeFlashcardV2CSSRules = (rules: CSSRuleList, scope: string): string => {
    return [...rules].map((rule) => {
        if (rule.type === CSSRule.STYLE_RULE) {
            const styleRule = rule as CSSStyleRule;
            const selectors = splitFlashcardV2CSSSelectors(styleRule.selectorText)
                .map((selector) => scopeFlashcardV2CSSSelector(selector, scope)).filter(Boolean);
            const declarations = safeFlashcardV2CSSDeclarations(styleRule.style);
            return selectors.length > 0 && declarations ? `${selectors.join(", ")} { ${declarations} }` : "";
        }
        const groupingRule = rule as CSSGroupingRule;
        if (!("cssRules" in groupingRule) || !/^@(media|supports|layer|container)\b/i.test(rule.cssText)) {
            return "";
        }
        const openingBrace = rule.cssText.indexOf("{");
        if (openingBrace < 0) {
            return "";
        }
        const nested = serializeFlashcardV2CSSRules(groupingRule.cssRules, scope);
        return nested ? `${rule.cssText.substring(0, openingBrace).trim()} { ${nested} }` : "";
    }).filter(Boolean).join("\n");
};

export const createFlashcardV2TemplateStyle = (value: string, target: HTMLElement) => {
    target.removeAttribute("data-flashcard-style-scope");
    if (!value?.trim() || value.length > 512 * 1024 || typeof CSSStyleSheet === "undefined") {
        return;
    }
    const sheet = new CSSStyleSheet();
    try {
        sheet.replaceSync(value.replace(/@import\s+[\s\S]*?;/gi, ""));
    } catch (error) {
        console.warn("Parse flashcard template style failed", error);
        return;
    }
    const scopeID = `flashcard-${++flashcardV2StyleScopeSequence}`;
    const scope = `[data-flashcard-style-scope="${scopeID}"]`;
    const scopedStyle = serializeFlashcardV2CSSRules(sheet.cssRules, scope);
    if (!scopedStyle) {
        return;
    }
    target.dataset.flashcardStyleScope = scopeID;
    const style = document.createElement("style");
    style.dataset.flashcardTemplateStyle = scopeID;
    style.textContent = scopedStyle;
    return style;
};

export interface IFlashcardV2ChoiceAnswerResult {
    type: "choice";
    correct: boolean;
    mode: "single" | "multiple";
    selectedOptionIDs: string[];
    correctOptionIDs: string[];
    suggestedRating: "again" | "good";
}

export interface IFlashcardV2ChoiceController {
    check: () => IFlashcardV2ChoiceAnswerResult;
}

interface IAnkiTemplateTextNode {
    type: "text";
    value: string;
}

interface IAnkiTemplateFieldNode {
    type: "field";
    value: string;
}

interface IAnkiTemplateSectionNode {
    type: "section";
    value: string;
    inverse: boolean;
    children: IAnkiTemplateNode[];
}

type IAnkiTemplateNode = IAnkiTemplateTextNode | IAnkiTemplateFieldNode | IAnkiTemplateSectionNode;

const unique = (values: string[]) => [...new Set(values)];

const maximumAnswerLength = 2048;
const maximumDiffLength = 512;

const normalizeFlashcardV2Answer = (value: string, config: IFlashcardV2AnswerCheckConfig) => {
    let normalized = value.normalize("NFKC");
    if (config.trimWhitespace !== false) {
        normalized = normalized.trim();
    }
    if (config.collapseWhitespace !== false) {
        normalized = normalized.replace(/\s+/gu, " ");
    }
    if (config.ignorePunctuation) {
        normalized = normalized.replace(/\p{P}+/gu, "");
    }
    if (config.ignoreDiacritics) {
        normalized = normalized.normalize("NFD").replace(/\p{M}+/gu, "").normalize("NFC");
    }
    if (!config.caseSensitive) {
        normalized = normalized.toLowerCase();
    }
    return normalized;
};

const flashcardV2AnswerDistance = (left: string[], right: string[]): number => {
    if (left.length > maximumAnswerLength || right.length > maximumAnswerLength) {
        return maximumAnswerLength + 1;
    }
    if (left.length > right.length) {
        return flashcardV2AnswerDistance(right, left);
    }
    let previous = Array.from({length: left.length + 1}, (_, index) => index);
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex++) {
        const current = [rightIndex];
        for (let leftIndex = 1; leftIndex <= left.length; leftIndex++) {
            current[leftIndex] = Math.min(
                current[leftIndex - 1] + 1,
                previous[leftIndex] + 1,
                previous[leftIndex - 1] + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1),
            );
        }
        previous = current;
    }
    return previous[left.length];
};

const appendAnswerDiff = (diff: IFlashcardV2AnswerDiff[], type: IFlashcardV2AnswerDiff["type"], value: string) => {
    const previous = diff.at(-1);
    if (previous?.type === type) {
        previous.value += value;
    } else {
        diff.push({type, value});
    }
};

const flashcardV2AnswerDiff = (input: string, answer: string) => {
    const left = Array.from(input);
    const right = Array.from(answer);
    if (left.length > maximumDiffLength || right.length > maximumDiffLength) {
        return [
            {type: "extra", value: input},
            {type: "missing", value: answer},
        ] as IFlashcardV2AnswerDiff[];
    }
    const width = right.length + 1;
    const lengths = new Uint16Array((left.length + 1) * width);
    for (let leftIndex = left.length - 1; leftIndex >= 0; leftIndex--) {
        for (let rightIndex = right.length - 1; rightIndex >= 0; rightIndex--) {
            const offset = leftIndex * width + rightIndex;
            lengths[offset] = left[leftIndex] === right[rightIndex] ? lengths[offset + width + 1] + 1 :
                Math.max(lengths[offset + width], lengths[offset + 1]);
        }
    }
    const diff: IFlashcardV2AnswerDiff[] = [];
    let leftIndex = 0;
    let rightIndex = 0;
    while (leftIndex < left.length || rightIndex < right.length) {
        if (leftIndex < left.length && rightIndex < right.length && left[leftIndex] === right[rightIndex]) {
            appendAnswerDiff(diff, "equal", left[leftIndex]);
            leftIndex++;
            rightIndex++;
        } else if (leftIndex < left.length && (rightIndex >= right.length ||
            lengths[(leftIndex + 1) * width + rightIndex] >= lengths[leftIndex * width + rightIndex + 1])) {
            appendAnswerDiff(diff, "extra", left[leftIndex]);
            leftIndex++;
        } else {
            appendAnswerDiff(diff, "missing", right[rightIndex]);
            rightIndex++;
        }
    }
    return diff;
};

export const checkFlashcardV2Answer = (input: string, acceptedAnswers: string[],
    config: IFlashcardV2AnswerCheckConfig = {}): IFlashcardV2AnswerCheckResult => {
    const candidates = unique(acceptedAnswers.length > 0 ? acceptedAnswers : [""]).slice(0, 100);
    const normalizedInput = normalizeFlashcardV2Answer(input, config);
    const inputCharacters = Array.from(normalizedInput);
    let bestAnswer = candidates[0];
    let bestNormalizedAnswer = normalizeFlashcardV2Answer(bestAnswer, config);
    let bestDistance = flashcardV2AnswerDistance(inputCharacters, Array.from(bestNormalizedAnswer));
    candidates.slice(1).forEach((candidate) => {
        const normalized = normalizeFlashcardV2Answer(candidate, config);
        const distance = flashcardV2AnswerDistance(inputCharacters, Array.from(normalized));
        if (distance < bestDistance) {
            bestAnswer = candidate;
            bestNormalizedAnswer = normalized;
            bestDistance = distance;
        }
    });
    const length = Math.max(inputCharacters.length, Array.from(bestNormalizedAnswer).length, 1);
    const distanceRatio = bestDistance / length;
    const fuzzyDistance = Number.isInteger(config.fuzzyMaxDistance) && config.fuzzyMaxDistance > 0 &&
        bestDistance <= Math.min(config.fuzzyMaxDistance, 64);
    const fuzzyRatio = Number.isFinite(config.fuzzyMaxRatio) && config.fuzzyMaxRatio > 0 &&
        config.fuzzyMaxRatio <= 1 && distanceRatio <= config.fuzzyMaxRatio;
    const withinLimit = inputCharacters.length <= maximumAnswerLength &&
        Array.from(bestNormalizedAnswer).length <= maximumAnswerLength;
    const correct = withinLimit && (bestDistance === 0 || fuzzyDistance || fuzzyRatio);
    return {
        correct,
        exact: input === bestAnswer,
        acceptedAnswer: bestAnswer,
        normalizedInput,
        normalizedAnswer: bestNormalizedAnswer,
        distance: bestDistance,
        distanceRatio,
        suggestedRating: correct ? "good" : "again",
        diff: flashcardV2AnswerDiff(normalizedInput, bestNormalizedAnswer),
    };
};

const parseAnkiTemplate = (markup: string) => {
    const root: IAnkiTemplateNode[] = [];
    const stack: Array<{ name: string, children: IAnkiTemplateNode[] }> = [{name: "", children: root}];
    const pattern = /{{\s*([#^/]?)([^{}]+?)\s*}}/g;
    let offset = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(markup)) !== null) {
        if (match.index > offset) {
            stack.at(-1).children.push({type: "text", value: markup.substring(offset, match.index)});
        }
        const marker = match[1];
        const value = match[2].trim();
        if (marker === "#" || marker === "^") {
            const section: IAnkiTemplateSectionNode = {
                type: "section",
                value,
                inverse: marker === "^",
                children: [],
            };
            stack.at(-1).children.push(section);
            stack.push({name: value, children: section.children});
        } else if (marker === "/") {
            if (stack.length > 1 && stack.at(-1).name === value) {
                stack.pop();
            }
        } else {
            stack.at(-1).children.push({type: "field", value});
        }
        offset = pattern.lastIndex;
    }
    if (offset < markup.length) {
        stack.at(-1).children.push({type: "text", value: markup.substring(offset)});
    }
    return root;
};

const ankiFieldToken = (value: string) => {
    const parts = value.split(":").map((part) => part.trim()).filter(Boolean);
    return {filter: parts.length > 1 ? parts[0] : "", name: parts.at(-1) || ""};
};

const ankiReferenceHasContent = (dom: string) => {
    if (/<(?:img|audio|video)\b/i.test(dom)) {
        return true;
    }
    return dom.replace(/<[^>]*>/g, "").replace(/&nbsp;|\u200b/g, "").trim() !== "";
};

export const flashcardV2ReferenceHTML = (reference: IFlashcardV2SourceReference, doms: Record<string, string>) => {
    const dom = doms[reference.entityID];
    const occlusionID = flashcardV2OcclusionIDForReference(reference);
    const occlusionAttr = occlusionID ? ` data-flashcard-occlusion-id="${escapeAttr(occlusionID)}"` : "";
    if (dom) {
        return `<div data-flashcard-reference="${escapeAttr(reference.entityID)}"${occlusionAttr}>${dom}</div>`;
    }
    return `<div class="ft__secondary" data-flashcard-reference="${escapeAttr(reference.entityID)}"${occlusionAttr}>${escapeHtml(reference.entityID)}</div>`;
};

export const renderFlashcardV2AnkiTemplate = (model: IFlashcardV2RenderModel, side: "front" | "back",
    doms: Record<string, string>, frontHTML = "") => {
    const spec = side === "front" ? model.template.frontSpec : model.template.backSpec;
    if (model.source.sourceType !== "anki" || spec?.type !== "anki" || typeof spec.markup !== "string") {
        return;
    }
    const safeMarkup = window.DOMPurify.sanitize(spec.markup, {
        FORBID_TAGS: ["script", "style", "iframe", "frame", "frameset", "object", "embed"],
        ALLOWED_URI_REGEXP: flashcardV2TemplateURI,
    });
    const fields = new Map((model.schema?.fields || []).map((field) => [field.name, field.id]));
    const references = new Map(model.references.filter((reference) => reference.fieldID)
        .map((reference) => [reference.fieldID, reference]));
    const renderNodes = (nodes: IAnkiTemplateNode[]): string => nodes.map((node) => {
        if (node.type === "text") {
            return node.value;
        }
        const token = ankiFieldToken(node.value);
        if (node.type === "section") {
            const fieldID = fields.get(token.name);
            const reference = fieldID ? references.get(fieldID) : undefined;
            const hasContent = Boolean(reference && ankiReferenceHasContent(doms[reference.entityID] || ""));
            return hasContent !== node.inverse ? renderNodes(node.children) : "";
        }
        if (token.name === "FrontSide") {
            return frontHTML;
        }
        if (token.name.startsWith("!")) {
            return "";
        }
        const fieldID = fields.get(token.name);
        const reference = fieldID ? references.get(fieldID) : undefined;
        if (!reference) {
            return "";
        }
        if (token.filter === "type" && side === "front") {
            return `<input class="b3-text-field fn__block" data-anki-type-answer="${escapeAttr(fieldID)}" autocomplete="off">`;
        }
        return flashcardV2ReferenceHTML(reference, doms);
    }).join("");
    return renderNodes(parseAnkiTemplate(safeMarkup));
};

const flashcardV2ReferenceText = (dom: string) => {
    const template = document.createElement("template");
    template.innerHTML = window.DOMPurify.sanitize(dom, {
        FORBID_TAGS: ["script", "style", "iframe", "frame", "frameset", "object", "embed"],
    });
    return template.content.textContent || "";
};

const renderFlashcardV2AnswerResult = (input: HTMLInputElement, result: IFlashcardV2AnswerCheckResult) => {
    input.disabled = true;
    input.classList.toggle("card__v2-answer-input--correct", result.correct);
    input.classList.toggle("card__v2-answer-input--incorrect", !result.correct);
    const resultElement = document.createElement("div");
    resultElement.className = `card__v2-answer-result card__v2-answer-result--${result.correct ? "correct" : "incorrect"}`;
    resultElement.innerHTML = `<svg><use xlink:href="#icon${result.correct ? "Check" : "CloseRound"}"></use></svg>`;
    const diffElement = document.createElement("span");
    diffElement.className = "card__v2-answer-diff";
    result.diff.forEach((part) => {
        const element = document.createElement("span");
        element.className = `card__v2-answer-diff--${part.type}`;
        element.textContent = part.value;
        diffElement.appendChild(element);
    });
    resultElement.appendChild(diffElement);
    input.insertAdjacentElement("afterend", resultElement);
};

export const prepareFlashcardV2TypedAnswers = (element: Element, model: IFlashcardV2RenderModel,
    doms: Record<string, string>): IFlashcardV2TypedAnswerController | undefined => {
    const inputs = [...element.querySelectorAll<HTMLInputElement>("[data-anki-type-answer]")];
    if (inputs.length === 0) {
        return;
    }
    const references = new Map(model.references.filter((reference) => reference.fieldID)
        .map((reference) => [reference.fieldID, reference]));
    return {
        check: () => inputs.map((input) => {
            const fieldID = input.dataset.ankiTypeAnswer || "";
            const reference = references.get(fieldID);
            const expected = reference ? flashcardV2ReferenceText(doms[reference.entityID] || "") : "";
            const config = model.template.frontSpec?.answerCheck || {};
            const acceptedAnswers = [expected, ...(config.acceptedAnswers || [])];
            const result = checkFlashcardV2Answer(input.value, acceptedAnswers, config);
            renderFlashcardV2AnswerResult(input, result);
            return result;
        }),
    };
};

export const renderFlashcardV2Choice = (model: IFlashcardV2RenderModel, doms: Record<string, string>,
    optionOrder: string[]) => {
    if (model.source.sourceType !== "choice") {
        return;
    }
    const config = model.source.generationConfig as IChoiceGenerationConfig;
    if (!Array.isArray(config?.options) || !Array.isArray(config.correctOptionIDs) ||
        (config.mode !== "single" && config.mode !== "multiple")) {
        return;
    }
    const question = model.references.find((reference) => reference.role === "question");
    const optionReferences = new Map(model.references.filter((reference) => reference.role.startsWith("option:"))
        .map((reference) => [reference.role.substring("option:".length), reference]));
    const configuredOrder = [...config.options].sort((left, right) => left.displayOrder - right.displayOrder)
        .map((option) => option.id);
    const dynamicOrder = [...optionReferences.keys()].filter((optionID) => !configuredOrder.includes(optionID)).sort();
    const fallbackOrder = configuredOrder.concat(dynamicOrder);
    const configuredIDs = new Set(fallbackOrder);
    const orderedIDs = optionOrder.length === fallbackOrder.length && new Set(optionOrder).size === optionOrder.length &&
        optionOrder.every((optionID) => configuredIDs.has(optionID) && optionReferences.has(optionID)) ?
        optionOrder : fallbackOrder;
    const type = config.mode === "single" ? "radio" : "checkbox";
    const questionHTML = question ? flashcardV2ReferenceHTML(question, doms) : "";
    const optionsHTML = orderedIDs.map((optionID) => {
        const reference = optionReferences.get(optionID);
        if (!reference) {
            return "";
        }
        return `<label class="card__v2-choice-option" data-choice-option="${escapeAttr(optionID)}"><input type="${type}" name="choice-${escapeAttr(model.card.id)}" value="${escapeAttr(optionID)}"><span>${flashcardV2ReferenceHTML(reference, doms)}</span></label>`;
    }).join("");
    return `<div class="card__v2-choice-question">${questionHTML}</div><div class="card__v2-choice-options">${optionsHTML}</div>`;
};

export const prepareFlashcardV2Choice = (element: Element,
    model: IFlashcardV2RenderModel): IFlashcardV2ChoiceController | undefined => {
    if (model.source.sourceType !== "choice") {
        return;
    }
    const config = model.source.generationConfig as IChoiceGenerationConfig;
    const inputs = [...element.querySelectorAll<HTMLInputElement>("[data-choice-option] input")];
    if (inputs.length === 0 || !Array.isArray(config?.correctOptionIDs)) {
        return;
    }
    return {
        check: () => {
            const selectedOptionIDs = inputs.filter((input) => input.checked).map((input) => input.value).sort();
            const correctOptionIDs = [...config.correctOptionIDs].sort();
            const correct = selectedOptionIDs.length === correctOptionIDs.length &&
                selectedOptionIDs.every((optionID, index) => optionID === correctOptionIDs[index]);
            const correctSet = new Set(correctOptionIDs);
            inputs.forEach((input) => {
                input.disabled = true;
                const option = input.closest("[data-choice-option]");
                option?.classList.toggle("card__v2-choice-option--correct", correctSet.has(input.value));
                option?.classList.toggle("card__v2-choice-option--incorrect", input.checked &&
                    !correctSet.has(input.value));
            });
            return {
                type: "choice",
                correct,
                mode: config.mode,
                selectedOptionIDs,
                correctOptionIDs,
                suggestedRating: correct ? "good" : "again",
            };
        },
    };
};

export const renderFlashcardV2MultiLine = (model: IFlashcardV2RenderModel, doms: Record<string, string>) => {
    if (model.source.sourceType !== "multi-line") {
        return;
    }
    const config = model.source.generationConfig as IMultiLineGenerationConfig;
    if (!Array.isArray(config?.answers) || (config.revealMode !== "all" && config.revealMode !== "steps")) {
        return;
    }
    const question = model.references.find((reference) => reference.role === "question");
    const answerReferences = new Map(model.references.filter((reference) => reference.role.startsWith("answer:"))
        .map((reference) => [reference.role.substring("answer:".length), reference]));
    const answers = [...config.answers].sort((left, right) => left.displayOrder - right.displayOrder)
        .map((answer) => {
            const reference = answerReferences.get(answer.id);
            if (!reference) {
                return "";
            }
            return `<div class="card__v2-multi-line-answer card__v2-multi-line-answer--hidden" data-multi-line-answer="${escapeAttr(answer.id)}">${flashcardV2ReferenceHTML(reference, doms)}</div>`;
        }).join("");
    const questionHTML = question ? flashcardV2ReferenceHTML(question, doms) : "";
    return `<div class="card__v2-multi-line-question">${questionHTML}</div><div class="card__v2-multi-line-answers">${answers}</div>`;
};

const prepareMultiLineAnswers = (element: Element, model: IFlashcardV2RenderModel) => {
    const config = model.source.generationConfig as IMultiLineGenerationConfig;
    const answers = [...element.querySelectorAll("[data-multi-line-answer]")];
    if (answers.length === 0 || (config?.revealMode !== "all" && config?.revealMode !== "steps")) {
        return;
    }
    let index = 0;
    return {
        revealNext: () => {
            if (config.revealMode === "all") {
                answers.forEach((answer) => answer.classList.remove("card__v2-multi-line-answer--hidden"));
                return true;
            }
            answers[index]?.classList.remove("card__v2-multi-line-answer--hidden");
            index++;
            return index >= answers.length;
        },
    };
};

const textBoundary = (nodes: Text[], offset: number) => {
    let start = 0;
    for (const node of nodes) {
        const end = start + node.data.length;
        if (offset <= end) {
            return {node, offset: Math.max(0, offset - start)};
        }
        start = end;
    }
};

export const applyFlashcardV2AnkiCloze = (element: Element, target: number, revealed: boolean) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    const nodes: Text[] = [];
    let current = walker.nextNode();
    while (current) {
        nodes.push(current as Text);
        current = walker.nextNode();
    }
    const text = nodes.map((node) => node.data).join("");
    const matches = [...text.matchAll(/{{c(\d+)::([\s\S]*?)(?:::(.*?))?}}/gi)];
    for (let index = matches.length - 1; index >= 0; index--) {
        const match = matches[index];
        const start = textBoundary(nodes, match.index);
        const end = textBoundary(nodes, match.index + match[0].length);
        if (!start || !end) {
            continue;
        }
        const cloze = Number(match[1]);
        const span = document.createElement("span");
        span.className = cloze === target ? "card__v2-anki-cloze" : "";
        span.textContent = !revealed && cloze === target ? (match[3] || "...") : match[2];
        const range = document.createRange();
        range.setStart(start.node, start.offset);
        range.setEnd(end.node, end.offset);
        range.deleteContents();
        range.insertNode(span);
    }
};

export const flashcardV2OcclusionIDForReference = (reference: IFlashcardV2SourceReference) => {
    const prefix = "occlusion:";
    if (!reference.role.startsWith(prefix) || reference.role.length === prefix.length) {
        return;
    }
    return reference.role.substring(prefix.length);
};

export const buildFlashcardV2OcclusionPlan = (model: IFlashcardV2RenderModel): IFlashcardV2OcclusionPlan | undefined => {
    const variant = model.card.variantData || {};
    if (model.source.sourceType === "cloze") {
        const config = model.source.generationConfig as IClozeGenerationConfig;
        if (!Array.isArray(config?.occlusions) || !Array.isArray(variant.groupIDs)) {
            return;
        }
        const groupIDs = new Set(variant.groupIDs.filter((value): value is string => typeof value === "string"));
        const hideSelected = variant.mode !== "showGroups";
        const occlusionIDs = config.occlusions.filter((occlusion) => {
            const selected = occlusion.groupIDs.some((groupID) => groupIDs.has(groupID));
            return hideSelected ? selected : !selected;
        }).sort((left, right) => left.displayOrder - right.displayOrder).map((occlusion) => occlusion.id);
        return {steps: occlusionIDs.length === 0 ? [] : [unique(occlusionIDs)], persistent: []};
    }
    if (model.source.sourceType !== "ordered") {
        return;
    }
    const config = model.source.generationConfig as IOrderedGenerationConfig;
    if (!Array.isArray(config?.steps)) {
        return;
    }
    const steps = [...config.steps].sort((left, right) => left.displayOrder - right.displayOrder);
    if (variant.mode === "single") {
        const requested = new Set(Array.isArray(variant.stepIDs) ? variant.stepIDs : []);
        return {
            steps: steps.filter((step) => requested.has(step.id)).map((step) => unique(step.occlusionIDs)),
            persistent: [],
        };
    }
    if (variant.mode === "progressive" && typeof variant.stepID === "string") {
        const currentIndex = steps.findIndex((step) => step.id === variant.stepID);
        if (currentIndex < 0) {
            return;
        }
        const current = unique(steps[currentIndex].occlusionIDs);
        const persistent = unique(steps.slice(currentIndex + 1).flatMap((step) => step.occlusionIDs))
            .filter((occlusionID) => !current.includes(occlusionID));
        return {steps: [current], persistent};
    }
};

const findOcclusionElements = (element: Element, occlusionID: string) => {
    return [...element.querySelectorAll("[data-flashcard-occlusion-id]")]
        .filter((item) => item.getAttribute("data-flashcard-occlusion-id") === occlusionID);
};

const hideTextOcclusion = (element: Element, occlusionID: string) => {
    const elements = findOcclusionElements(element, occlusionID);
    elements.forEach((item, index) => {
        item.classList.add("card__v2-occlusion");
        item.classList.toggle("card__v2-occlusion--placeholder", index === 0);
    });
};

const revealTextOcclusion = (element: Element, occlusionID: string) => {
    findOcclusionElements(element, occlusionID).forEach((item) => {
        item.classList.remove("card__v2-occlusion", "card__v2-occlusion--placeholder");
    });
};

const prepareTextOcclusions = (element: Element, plan: IFlashcardV2OcclusionPlan) => {
    const hidden = unique(plan.steps.flat().concat(plan.persistent));
    if (hidden.length === 0 || !hidden.some((occlusionID) => findOcclusionElements(element, occlusionID).length > 0)) {
        return;
    }
    hidden.forEach((occlusionID) => hideTextOcclusion(element, occlusionID));
    let index = 0;
    return {
        revealNext: () => {
            plan.steps[index]?.forEach((occlusionID) => revealTextOcclusion(element, occlusionID));
            index++;
            return index >= plan.steps.length;
        },
    };
};

const normalized = (value: number) => Number.isFinite(value) && value >= 0 && value <= 1;

const shapeStyle = (shape: IImageOcclusionConfig["shapes"][number]) => {
    if (shape.type === "polygon") {
        if (!Array.isArray(shape.points) || shape.points.length < 3 || !shape.points.every((point) => normalized(point.x) && normalized(point.y))) {
            return;
        }
        return `inset:0;clip-path:polygon(${shape.points.map((point) => `${point.x * 100}% ${point.y * 100}%`).join(",")})`;
    }
    if (!normalized(shape.x) || !normalized(shape.y) || !normalized(shape.width) || !normalized(shape.height)) {
        return;
    }
    return `left:${shape.x * 100}%;top:${shape.y * 100}%;width:${shape.width * 100}%;height:${shape.height * 100}%${shape.type === "ellipse" ? ";border-radius:50%" : ""}`;
};

const prepareImageOcclusions = (element: Element, model: IFlashcardV2RenderModel) => {
    const config = model.source.generationConfig as IImageOcclusionConfig;
    const variant = model.card.variantData || {};
    if (!Array.isArray(config?.shapes) || !Array.isArray(config.groups) || typeof variant.groupID !== "string") {
        return;
    }
    const group = config.groups.find((item) => item.id === variant.groupID);
    if (!group) {
        return;
    }
    const images = [...element.querySelectorAll("img")];
    const image = images.find((item) => item.getAttribute("src")?.includes(config.assetID)) || images[0];
    if (!image || image.closest(".card__v2-image-occlusion")) {
        return;
    }
    const targetShapeIDs = new Set(group.shapeIDs);
    const visibleShapes = config.frontMode === "hideAllAnswerOne" ? config.shapes :
        config.shapes.filter((shape) => targetShapeIDs.has(shape.id));
    if (visibleShapes.length === 0) {
        return;
    }
    const wrapper = document.createElement("span");
    wrapper.className = "card__v2-image-occlusion";
    image.parentElement.insertBefore(wrapper, image);
    wrapper.appendChild(image);
    visibleShapes.forEach((shape) => {
        const style = shapeStyle(shape);
        if (!style) {
            return;
        }
        const overlay = document.createElement("span");
        overlay.className = "card__v2-image-shape";
        overlay.dataset.shapeId = shape.id;
        overlay.setAttribute("style", style);
        wrapper.appendChild(overlay);
    });
    return {
        revealNext: () => {
            wrapper.querySelectorAll("[data-shape-id]").forEach((overlay) => {
                if (targetShapeIDs.has((overlay as HTMLElement).dataset.shapeId)) {
                    overlay.remove();
                }
            });
            return true;
        },
    };
};

export const prepareFlashcardV2Reveal = (element: Element, model: IFlashcardV2RenderModel): IFlashcardV2RevealController | undefined => {
    if (model.source.sourceType === "image-occlusion") {
        return prepareImageOcclusions(element, model);
    }
    if (model.source.sourceType === "multi-line") {
        return prepareMultiLineAnswers(element, model);
    }
    const plan = buildFlashcardV2OcclusionPlan(model);
    return plan ? prepareTextOcclusions(element, plan) : undefined;
};
