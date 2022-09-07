export const genOptions = (data: string[] | { label: string, name: string }[], key: string) => {
    let html = "";
    data.forEach((item: string | { label: string, name: string }) => {
        if (typeof item === "string") {
            html += `<option value="${item}" ${key === item ? "selected" : ""}>${item}</option>`;
        } else {
            html += `<option value="${item.name}" ${key === item.name ? "selected" : ""}>${item.label}</option>`;
        }
    });
    return html;
};
