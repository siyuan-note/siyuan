export const getAVTemplateHTML = (content: string) => {
    if (window.siyuan.config.editor.allowHTMLBLockScript) {
        return content;
    }
    // 默认过滤危险标签和事件属性，避免数据库模板字段中的代码直接执行
    return window.DOMPurify.sanitize(content);
};
