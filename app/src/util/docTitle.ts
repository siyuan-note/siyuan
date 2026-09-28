// 文档标题中的斜杠在层级路径中使用私用区字符保存。
export const DOC_TITLE_SLASH = "\u{F0000}";

export const sanitizeDocTitleInput = (title: string) => {
    return title.replaceAll(DOC_TITLE_SLASH, "")
        .replace(/\r\n|\r|\n|\u2028|\u2029|\t/g, "")
        .substring(0, 512);
};

export const encodeDocTitle = (title: string) => {
    return title.replace(/\//g, DOC_TITLE_SLASH);
};

export const decodeDocTitle = (title: string) => {
    return title.replaceAll(DOC_TITLE_SLASH, "/");
};

export const getDocTitleText = (title: string) => {
    return decodeDocTitle(title.endsWith(".sy") ? title.slice(0, -3) : title);
};
