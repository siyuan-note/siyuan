import {getAgentLute} from "../setLute";
import {applyLuteMarkdownSyntax} from "../luteMarkdownSyntax";
import {configureAVRichTextLute} from "./richTextValue";

export const configureAVRichTextEditorLute = (lute: Lute, inlineOnly = false) => {
    configureAVRichTextLute(lute);
    applyLuteMarkdownSyntax(lute, window.siyuan.config.editor.markdown);
    // 主键使用单段行级解析，载体沿用正文样式，避免输入时附加文档标题的字号和字重。
    return inlineOnly ? new Proxy(lute, {
        get(target, property) {
            return property === "SpinBlockDOM" ?
                (blockDOM: string) => target.SpinInlineBlockDOM(blockDOM) : Reflect.get(target, property);
        },
    }) : lute;
};

// 输入语法独立于存储解析器，关闭语法时仍可读取已有富文本。
export const createAVRichTextEditorLute = (inlineOnly = false) => configureAVRichTextEditorLute(getAgentLute({
    emojiSite: "/emojis",
    emojis: {},
    headingAnchor: false,
    listStyle: false,
    paragraphBeginningSpace: true,
    sanitize: true,
}), inlineOnly);
