export const nbsp2space = (text: string) => {
    // 非打断空格转换为空格
    return text.replace(/\u00A0/g, " ");
};
