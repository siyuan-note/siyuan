import {removeZWJ} from "./normalizeText";
import {cleanListMindmapHTML} from "../render/listMindmap/model";

interface IBlockDOMClipboardHTMLLute {
    BlockDOM2HTML(blockDOM: string): string;
}

interface IBlockDOMClipboardLute extends IBlockDOMClipboardHTMLLute {
    BlockDOM2StdMd(blockDOM: string): string;
}

export const buildBlockDOMClipboardRichData = (lute: IBlockDOMClipboardHTMLLute, blockDOM: string) => {
    const source = cleanListMindmapHTML(blockDOM);
    return {
        textHTML: removeZWJ(lute.BlockDOM2HTML(source).trimEnd()),
        textSiyuan: source + "\u200b",
    };
};

export const buildBlockDOMClipboardData = (lute: IBlockDOMClipboardLute, blockDOM: string) => ({
    textPlain: lute.BlockDOM2StdMd(cleanListMindmapHTML(blockDOM)).trimEnd(),
    ...buildBlockDOMClipboardRichData(lute, blockDOM),
});
