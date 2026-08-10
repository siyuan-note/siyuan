import {removeZWJ} from "./normalizeText";

interface IBlockDOMClipboardLute {
    BlockDOM2HTML(blockDOM: string): string;
    BlockDOM2StdMd(blockDOM: string): string;
}

export const buildBlockDOMClipboardData = (lute: IBlockDOMClipboardLute, blockDOM: string) => ({
    textPlain: lute.BlockDOM2StdMd(blockDOM).trimEnd(),
    textHTML: removeZWJ(lute.BlockDOM2HTML(blockDOM).trimEnd()),
    textSiyuan: blockDOM + "\u200b",
});
