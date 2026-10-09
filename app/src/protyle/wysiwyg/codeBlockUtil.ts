export const CODE_TAB_SPACE_VALUES = [0, 2, 4, 6, 8];

export const resolveCodeTabSpaces = (attributeValue: string | null, globalValue: number) => {
    if (attributeValue !== null && CODE_TAB_SPACE_VALUES.some((value) => value.toString() === attributeValue)) {
        return parseInt(attributeValue);
    }
    return globalValue;
};

export const getCodeTabSpace = (spaces: number) => spaces === 0 ? "\t" : "".padStart(spaces, " ");

export const detectCodeTabSpaces = (text: string): number | null => {
    const spaceIndents: number[] = [];
    let hasTabs = false;
    let lineCount = 0;
    for (const line of text.split("\n")) {
        if (!line.trim()) {
            continue;
        }
        lineCount++;
        const indent = line.match(/^[ \t]+/)?.[0];
        if (!indent) {
            continue;
        }
        if (indent.includes("\t")) {
            if (indent.includes(" ") || spaceIndents.length > 0) {
                return null;
            }
            hasTabs = true;
        } else {
            if (hasTabs) {
                return null;
            }
            spaceIndents.push(indent.length);
        }
    }
    if (lineCount < 2) {
        return null;
    }
    if (hasTabs) {
        return 0;
    }
    // 仅采用受支持的最小空格缩进，且其他缩进必须是它的整数倍。
    const spaces = spaceIndents.reduce((minimum, value) => Math.min(minimum, value), Infinity);
    return CODE_TAB_SPACE_VALUES.includes(spaces) && spaceIndents.every(value => value % spaces === 0) ? spaces : null;
};

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
    // 制表符模式按代码块默认显示宽度处理行首空格。
    const spaceLimit = tabSpace === "\t" ? 4 : tabSpace.length;
    let spaceCount = 0;
    while (spaceCount < spaceLimit && line[spaceCount] === " ") {
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
