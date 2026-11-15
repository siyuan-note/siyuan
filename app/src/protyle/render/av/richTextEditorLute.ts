import {getAgentLute} from "../setLute";
import {applyLuteMarkdownSyntax} from "../luteMarkdownSyntax";
import {configureAVRichTextLute} from "./richTextValue";

export const configureAVRichTextEditorLute = (lute: Lute) => {
    configureAVRichTextLute(lute);
    applyLuteMarkdownSyntax(lute, window.siyuan.config.editor.markdown);
    return lute;
};

// 输入语法独立于存储解析器，关闭语法时仍可读取已有富文本。
export const createAVRichTextEditorLute = () => configureAVRichTextEditorLute(getAgentLute({
    emojiSite: "/emojis",
    emojis: {},
    headingAnchor: false,
    listStyle: false,
    paragraphBeginningSpace: true,
    sanitize: true,
}));
