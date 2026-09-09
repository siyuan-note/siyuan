import {isMixedFontSize} from "./fontSizeCore";

interface IFontSizeSample {
    fontSize: string;
    computedSize: string;
    baseFontSize: number;
}

export const getSelectedFontSize = (ranges: {editableElement: Element; range: Range}[]) => {
    const samples: IFontSizeSample[] = [];
    // 仅统计选中的可编辑正文，排除块属性和不可编辑的辅助文字。
    ranges.forEach(({editableElement, range}) => {
        const walker = document.createTreeWalker(editableElement, NodeFilter.SHOW_TEXT);
        let text = walker.nextNode() as Text;
        while (text) {
            const start = text === range.startContainer ? range.startOffset : 0;
            const end = text === range.endContainer ? range.endOffset : text.length;
            const decoration = text.parentElement?.closest('[contenteditable="false"]');
            if (range.intersectsNode(text) && text.data.slice(start, end).replace(/\u200b/g, "") &&
                !(decoration && editableElement.contains(decoration))) {
                const computedSize = getComputedStyle(text.parentElement).fontSize;
                let styled = text.parentElement;
                while (styled && editableElement.contains(styled) && !styled.style.fontSize) {
                    styled = styled.parentElement;
                }
                const declaredSize = styled && editableElement.contains(styled) ? styled.style.fontSize : "";
                const inlineSize = /^(?:\d*\.)?\d+(?:px|em)$/.test(declaredSize) ? declaredSize : "";
                samples.push({
                    fontSize: inlineSize || computedSize,
                    computedSize,
                    baseFontSize: parseFloat(inlineSize && styled.parentElement ?
                        getComputedStyle(styled.parentElement).fontSize : computedSize),
                });
            }
            text = walker.nextNode() as Text;
        }
    });
    if (samples.length === 0) {
        return;
    }
    const first = samples[0];
    return {
        fontSize: isMixedFontSize(samples.map(sample => sample.fontSize)) ? first.computedSize : first.fontSize,
        baseFontSize: first.baseFontSize,
        mixed: isMixedFontSize(samples.map(sample => sample.computedSize)),
    };
};
