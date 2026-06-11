// https://github.com/siyuan-note/siyuan/issues/9382
export const nbsp2space = (text: string) => {
    // 非打断空格转换为空格
    return text.replace(/\u00A0/g, " ");
};

// https://github.com/siyuan-note/siyuan/issues/14800
export const removeZWJ = (text: string) => {
    return text.replace(/\u200D```/g, "```");
};
