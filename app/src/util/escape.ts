export const escapeHtml = (html: string) => {
    return html.replace(/&/g, "&amp;").replace(/</g, "&lt;");
};

export const escapeAttr = (html: string) => {
    return html.replace(/"/g, "&quot;").replace(/'/g, "&apos;");
};
