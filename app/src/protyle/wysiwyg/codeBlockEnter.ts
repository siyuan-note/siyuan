const findCodeBlockFenceStart = (text: string, enableMiddleDot: boolean) => {
    const markers = enableMiddleDot ? ["```", "~~~", "···"] : ["```", "~~~"];
    const trimStartText = text.trimStart();
    const trimStartOffset = text.length - trimStartText.length;
    if (markers.some(marker => trimStartText.startsWith(marker))) {
        return trimStartOffset;
    }

    let fenceStart = -1;
    markers.forEach(marker => {
        const index = text.indexOf("\n" + marker);
        if (index > -1 && (fenceStart === -1 || index + 1 < fenceStart)) {
            fenceStart = index + 1;
        }
    });
    return fenceStart;
};

export const isCodeBlockFenceBeforeCaret = (text: string, caretOffset: number, enableMiddleDot: boolean) => {
    const fenceStart = findCodeBlockFenceStart(text, enableMiddleDot);
    if (fenceStart === -1) {
        return false;
    }

    const markerCharacters = enableMiddleDot ? "`~·" : "`~";
    let fenceEnd = fenceStart + 3;
    while (fenceEnd < text.length && markerCharacters.includes(text[fenceEnd])) {
        fenceEnd++;
    }
    return fenceEnd <= caretOffset;
};

export const hasCodeBlockFence = (html: string, text: string, enableMiddleDot: boolean) =>
    html.startsWith("```") || html.startsWith("~~~") ||
    (html.includes("\n```") && text.includes("\n```")) ||
    (html.includes("\n~~~") && text.includes("\n~~~")) ||
    (enableMiddleDot && (html.startsWith("···") || (html.includes("\n···") && text.includes("\n···"))));

// 表格导航与正文回车共用转换条件，避免不完整围栏和字面标记触发代码块。
export const canEnterCodeBlock = (editable: Element, caretOffset: number, enableMiddleDot: boolean) => {
    const html = editable.innerHTML.trimStart();
    const text = editable.textContent;
    const trimmedText = text.trimStart();
    if (!hasCodeBlockFence(html, trimmedText, enableMiddleDot)) {
        return false;
    }
    // 已保存的字面标记和行内代码不参与块级转换，围栏前的其他行内格式仍可保留。
    const fences = trimmedText.matchAll(enableMiddleDot ? /(?:^|\n)(?:`{3,}|~{3,}|·{3,})/g : /(?:^|\n)(?:`{3,}|~{3,})/g);
    const walker = document.createTreeWalker(editable, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    let offset = 0;
    for (const fence of fences) {
        const start = text.length - trimmedText.length + fence.index + (fence[0].startsWith("\n") ? 1 : 0);
        const tail = text.substring(start);
        const line = tail.split("\n", 1)[0];
        if (!isCodeBlockFenceBeforeCaret(tail, caretOffset - start, enableMiddleDot) ||
            line.replace(enableMiddleDot ? /·|~/g : /~/g, "`").replace(/^`{3,}/, "").includes("`")) {
            continue;
        }
        while (node && offset + node.textContent.length <= start) {
            offset += node.textContent.length;
            node = walker.nextNode();
        }
        if (node && !node.parentElement.closest("span[data-type]")) {
            return true;
        }
    }
    return false;
};
