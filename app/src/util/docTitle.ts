// 文档标题中的斜杠在层级路径中使用全角斜杠表示。
export const DOC_TITLE_SLASH = "／";

export const sanitizeDocTitleInput = (title: string) => {
    return title.replace(/\r\n|\r|\n|\u2028|\u2029|\t/g, "")
        .substring(0, 512);
};

// 仅对 HPath 的标题片段编码，原始标题按用户输入保存。
export const encodeDocTitle = (title: string) => {
    return title.replace(/\//g, DOC_TITLE_SLASH);
};

// 仅将 HPath 转为显示文本，原始标题无需解码。
export const decodeDocTitle = (title: string) => {
    return title.replaceAll(DOC_TITLE_SLASH, "/");
};

export const getDocTitleText = (title: string) => {
    return title.endsWith(".sy") ? title.slice(0, -3) : title;
};
