export interface ITrackedTokenRange {
    start: number;
    end: number;
}

const MAX_CONTEXT_TOKEN_COUNT = 24;

const getCommonPrefixLength = (before: string[], after: string[]) => {
    const length = Math.min(before.length, after.length);
    let index = 0;
    while (index < length && before[index] === after[index]) {
        index++;
    }
    return index;
};

const getCommonSuffixLength = (before: string[], after: string[]) => {
    const length = Math.min(before.length, after.length);
    let index = 0;
    while (index < length && before[before.length - index - 1] === after[after.length - index - 1]) {
        index++;
    }
    return index;
};

const getBoundaryCandidates = (beforeLength: number, afterLength: number, prefixLength: number,
                               suffixLength: number, position: number) => {
    const candidates = new Set<number>();
    if (position <= prefixLength) {
        candidates.add(position);
    }
    if (position >= beforeLength - suffixLength) {
        candidates.add(afterLength - (beforeLength - position));
    }
    return Array.from(candidates).sort((first, second) => first - second);
};

export const getTrackedTokenBoundaryCandidates = (before: string[], after: string[], position: number) => {
    if (position < 0 || position > before.length) {
        return [];
    }
    const prefixLength = getCommonPrefixLength(before, after);
    const suffixLength = getCommonSuffixLength(before, after);
    return getBoundaryCandidates(before.length, after.length, prefixLength, suffixLength, position);
};

export const hasTrackedTokenRangeAffinityChoice = (before: string[], after: string[], position: number) => {
    return getTrackedTokenBoundaryCandidates(before, after, position).length > 1;
};

export const hasOverlappingTrackedTokenContext = (before: string[], after: string[]) => {
    return getCommonPrefixLength(before, after) + getCommonSuffixLength(before, after) >
        Math.min(before.length, after.length);
};

const equalTokens = (first: string[], second: string[]) => {
    return first.length === second.length && first.every((token, index) => token === second[index]);
};

const countTokenOccurrences = (tokens: string[], pattern: string[], limit = 2) => {
    if (pattern.length === 0 || pattern.length > tokens.length) {
        return 0;
    }
    const failure = new Array<number>(pattern.length).fill(0);
    for (let index = 1, matched = 0; index < pattern.length; index++) {
        while (matched > 0 && pattern[index] !== pattern[matched]) {
            matched = failure[matched - 1];
        }
        if (pattern[index] === pattern[matched]) {
            matched++;
            failure[index] = matched;
        }
    }
    let count = 0;
    for (let index = 0, matched = 0; index < tokens.length; index++) {
        while (matched > 0 && tokens[index] !== pattern[matched]) {
            matched = failure[matched - 1];
        }
        if (tokens[index] === pattern[matched]) {
            matched++;
        }
        if (matched === pattern.length) {
            count++;
            if (count >= limit) {
                return count;
            }
            matched = failure[matched - 1];
        }
    }
    return count;
};

const isUniqueTokenSequenceAt = (tokens: string[], pattern: string[], start: number) => {
    return start >= 0 && start + pattern.length <= tokens.length &&
        equalTokens(tokens.slice(start, start + pattern.length), pattern) &&
        countTokenOccurrences(tokens, pattern) === 1;
};

const hasUniqueTargetAnchor = (before: string[], after: string[], range: ITrackedTokenRange,
                               mapped: ITrackedTokenRange, prefixLength: number, suffixLength: number) => {
    const target = before.slice(range.start, range.end);
    if (!equalTokens(after.slice(mapped.start, mapped.end), target)) {
        return false;
    }
    if (countTokenOccurrences(before, target) === 1 && countTokenOccurrences(after, target) === 1) {
        return true;
    }
    const failure = new Array<number>(target.length).fill(0);
    for (let index = 1, matched = 0; index < target.length; index++) {
        while (matched > 0 && target[index] !== target[matched]) {
            matched = failure[matched - 1];
        }
        if (target[index] === target[matched]) {
            matched++;
            failure[index] = matched;
        }
    }
    let mappedSourceCount = 0;
    for (let index = 0, matched = 0; index < before.length; index++) {
        while (matched > 0 && before[index] !== target[matched]) {
            matched = failure[matched - 1];
        }
        if (before[index] === target[matched]) {
            matched++;
        }
        if (matched === target.length) {
            const start = index - target.length + 1;
            const end = start + target.length;
            const startCandidates = getBoundaryCandidates(before.length, after.length, prefixLength,
                suffixLength, start);
            const endCandidates = getBoundaryCandidates(before.length, after.length, prefixLength,
                suffixLength, end);
            if (startCandidates.length > 0 && endCandidates.length > 0 &&
                Math.max(...startCandidates) === mapped.start && Math.min(...endCandidates) === mapped.end) {
                mappedSourceCount++;
                if (mappedSourceCount > 1) {
                    return false;
                }
            }
            matched = failure[matched - 1];
        }
    }
    if (mappedSourceCount !== 1) {
        return false;
    }
    const maxLeft = Math.min(MAX_CONTEXT_TOKEN_COUNT, range.start, mapped.start);
    const maxRight = Math.min(MAX_CONTEXT_TOKEN_COUNT, before.length - range.end, after.length - mapped.end);
    for (let contextLength = 1; contextLength <= Math.max(maxLeft, maxRight); contextLength++) {
        const leftLength = Math.min(contextLength, maxLeft);
        const rightLength = Math.min(contextLength, maxRight);
        const contexts = [
            {left: leftLength, right: 0},
            {left: 0, right: rightLength},
            {left: leftLength, right: rightLength},
        ];
        if (contexts.some(context => {
            if (context.left + context.right === 0) {
                return false;
            }
            const pattern = before.slice(range.start - context.left, range.end + context.right);
            return isUniqueTokenSequenceAt(before, pattern, range.start - context.left) &&
                isUniqueTokenSequenceAt(after, pattern, mapped.start - context.left);
        })) {
            return true;
        }
    }
    return false;
};

const hasUniqueCollapsedAnchor = (before: string[], after: string[], position: number,
                                  beforePosition: number, afterPosition: number, requireBothAnchors: boolean) => {
    const maxLeft = Math.min(MAX_CONTEXT_TOKEN_COUNT, position, beforePosition);
    const maxRight = Math.min(MAX_CONTEXT_TOKEN_COUNT, before.length - position, after.length - afterPosition);
    let hasLeftAnchor = position === 0;
    let hasRightAnchor = position === before.length;
    for (let contextLength = 1; contextLength <= Math.max(maxLeft, maxRight); contextLength++) {
        if (!hasLeftAnchor && contextLength <= maxLeft) {
            const pattern = before.slice(position - contextLength, position);
            if (isUniqueTokenSequenceAt(before, pattern, position - contextLength) &&
                isUniqueTokenSequenceAt(after, pattern, beforePosition - contextLength)) {
                hasLeftAnchor = true;
            }
        }
        if (!hasRightAnchor && contextLength <= maxRight) {
            const pattern = before.slice(position, position + contextLength);
            if (isUniqueTokenSequenceAt(before, pattern, position) &&
                isUniqueTokenSequenceAt(after, pattern, afterPosition)) {
                hasRightAnchor = true;
            }
        }
        if (requireBothAnchors ? hasLeftAnchor && hasRightAnchor : hasLeftAnchor || hasRightAnchor) {
            return true;
        }
    }
    return requireBothAnchors ? hasLeftAnchor && hasRightAnchor : hasLeftAnchor || hasRightAnchor;
};

/**
 * 只映射由公共前后缀能够证明身份的范围。重复内容产生多个边界时，折叠范围按亲和性选择，
 * 非折叠范围则向目标内部收紧；目标内容发生变化或身份仍有歧义时返回 undefined。
 */
export const mapTrackedTokenRange = (before: string[], after: string[], range: ITrackedTokenRange,
                                     collapsed: boolean, affinity: "before" | "after",
                                     hasAffinityEvidence = false) => {
    if (range.start < 0 || range.end < range.start || range.end > before.length ||
        collapsed !== (range.start === range.end)) {
        return;
    }
    if (equalTokens(before, after)) {
        return {start: range.start, end: range.end};
    }
    const prefixLength = getCommonPrefixLength(before, after);
    const suffixLength = getCommonSuffixLength(before, after);
    const startCandidates = getBoundaryCandidates(before.length, after.length, prefixLength, suffixLength, range.start);
    const endCandidates = getBoundaryCandidates(before.length, after.length, prefixLength, suffixLength, range.end);
    if (startCandidates.length === 0 || endCandidates.length === 0) {
        return;
    }
    if (collapsed) {
        const candidates = Array.from(new Set([...startCandidates, ...endCandidates]));
        if (candidates.length > 1 && prefixLength + suffixLength > Math.min(before.length, after.length) &&
            !hasAffinityEvidence) {
            return;
        }
        const beforePosition = Math.min(...candidates);
        const afterPosition = Math.max(...candidates);
        if (!hasAffinityEvidence && !hasUniqueCollapsedAnchor(before, after, range.start, beforePosition,
            afterPosition, candidates.length > 1)) {
            return;
        }
        const position = affinity === "before" ? beforePosition : afterPosition;
        return {start: position, end: position};
    }
    const start = Math.max(...startCandidates);
    const end = Math.min(...endCandidates);
    const mapped = {start, end};
    if (start >= end || !equalTokens(before.slice(range.start, range.end), after.slice(start, end)) ||
        !hasUniqueTargetAnchor(before, after, range, mapped, prefixLength, suffixLength)) {
        return;
    }
    return mapped;
};
