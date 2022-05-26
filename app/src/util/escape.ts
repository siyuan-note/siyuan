export const escapeHtml = (html: string) => {
    return html.replace(/&/g, "&amp;").replace(/</g, "&lt;");
};
