import {removeZWJ} from "./normalizeText";

interface IBlockDOMClipboardHTMLLute {
    BlockDOM2HTML(blockDOM: string): string;
}

interface IBlockDOMClipboardLute extends IBlockDOMClipboardHTMLLute {
    BlockDOM2StdMd(blockDOM: string): string;
}

export const buildBlockDOMClipboardRichData = (lute: IBlockDOMClipboardHTMLLute, blockDOM: string) => ({
    textHTML: removeZWJ(lute.BlockDOM2HTML(blockDOM).trimEnd()),
    textSiyuan: blockDOM + "\u200b",
});

export const buildBlockDOMClipboardData = (lute: IBlockDOMClipboardLute, blockDOM: string) => ({
    textPlain: lute.BlockDOM2StdMd(blockDOM).trimEnd(),
    ...buildBlockDOMClipboardRichData(lute, blockDOM),
});
