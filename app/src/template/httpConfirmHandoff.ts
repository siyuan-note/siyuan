interface PreviewConfirmation {
    path: string;
    target: string;
    token: string;
    expires: number;
    timer: ReturnType<typeof setTimeout>;
    revoke: () => void;
}

const previews = new Map<Element, PreviewConfirmation>();
let epoch = 0;

export const templateHTTPConfirmEpoch = () => epoch;

export const clearTemplateHTTPConfirmation = (element: Element) => {
    const preview = previews.get(element);
    if (!preview) return;
    previews.delete(element);
    clearTimeout(preview.timer);
    preview.revoke();
};

export const clearTemplateHTTPConfirmations = () => {
    epoch++;
    [...previews.keys()].forEach(clearTemplateHTTPConfirmation);
};

// 令牌只随当前预览保留，不保存正文，也不把确认扩大到新的地址或凭据。
export const retainTemplateHTTPConfirmation = (element: Element, path: string, target: string,
                                               token: string, previewEpoch: number, revoke: () => void) => {
    if (!token) return;
    if (previewEpoch !== epoch || !element.isConnected || element.closest(".fn__none")) {
        revoke();
        return;
    }
    clearTemplateHTTPConfirmation(element);
    const preview: PreviewConfirmation = {
        path, target, token, expires: Date.now() + 30000, revoke,
        timer: setTimeout(() => {
            if (previews.get(element) === preview) previews.delete(element);
        }, 30000),
    };
    previews.set(element, preview);
};

// 仅明确选择插入时消费；关闭、切换和参数不匹配都撤销授权。
export const takeTemplateHTTPConfirmation = (element: Element, path: string, target: string) => {
    const preview = previews.get(element);
    if (!preview) return undefined;
    if (preview.path !== path || preview.target !== target || !element.isConnected ||
        element.closest(".fn__none") || Date.now() >= preview.expires) {
        clearTemplateHTTPConfirmation(element);
        return undefined;
    }
    previews.delete(element);
    clearTimeout(preview.timer);
    return preview.token;
};
