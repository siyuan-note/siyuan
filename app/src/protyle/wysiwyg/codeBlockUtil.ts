export const CODE_TAB_SPACE_VALUES = [0, 2, 4, 6, 8];

export const resolveCodeTabSpaces = (attributeValue: string | null, globalValue: number) => {
    if (attributeValue !== null && CODE_TAB_SPACE_VALUES.some((value) => value.toString() === attributeValue)) {
        return parseInt(attributeValue);
    }
    return globalValue;
};

export const getCodeTabSpace = (spaces: number) => spaces === 0 ? "\t" : "".padStart(spaces, " ");

export const getCodeBlockLineRange = (text: string, start: number, end: number) => {
    const rangeStart = Math.min(Math.max(start, 0), text.length);
    const rangeEnd = Math.min(Math.max(end, rangeStart), text.length);
    const lineStart = rangeStart === 0 ? 0 : text.lastIndexOf("\n", rangeStart - 1) + 1;
    const lineEnd = rangeEnd > rangeStart && text[rangeEnd - 1] === "\n" ? rangeEnd - 1 : rangeEnd;
    return {
        start: lineStart,
        end: Math.max(lineStart, lineEnd),
    };
};

export const updateCodeBlockLines = (text: string, tabSpace: string, outdent = false) => text.split("\n").map((line) => {
    if (!outdent) {
        return tabSpace + line;
    }
    if (line.startsWith("\t")) {
        return line.substring(1);
    }
    if (tabSpace === "\t") {
        return line;
    }
    let spaceCount = 0;
    while (spaceCount < tabSpace.length && line[spaceCount] === " ") {
        spaceCount++;
    }
    return line.substring(spaceCount);
}).join("\n");

export const getCodeBlockDeleteStart = (text: string, caret: number, tabSpace: string) => {
    const rangeEnd = Math.min(Math.max(caret, 0), text.length);
    const lineStart = rangeEnd === 0 ? 0 : text.lastIndexOf("\n", rangeEnd - 1) + 1;
    if (rangeEnd <= lineStart) {
        return rangeEnd;
    }
    if (text[rangeEnd - 1] === "\t") {
        return rangeEnd - 1;
    }
    if (tabSpace === "\t") {
        return rangeEnd;
    }
    let rangeStart = rangeEnd;
    while (rangeStart > lineStart && rangeEnd - rangeStart < tabSpace.length && text[rangeStart - 1] === " ") {
        rangeStart--;
    }
    return rangeStart;
};
