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

export const getCodeBlockOutdentRange = (text: string, caret: number, tabSpace: string) => {
    const position = Math.min(Math.max(caret, 0), text.length);
    const lineStart = getCodeBlockLineRange(text, position, position).start;
    const lineEnd = text.indexOf("\n", lineStart);
    const line = text.substring(lineStart, lineEnd < 0 ? text.length : lineEnd);
    const removed = line.length - updateCodeBlockLines(line, tabSpace, true).length;
    return {
        start: lineStart,
        end: lineStart + removed,
        caret: Math.max(lineStart, position - removed),
    };
};
