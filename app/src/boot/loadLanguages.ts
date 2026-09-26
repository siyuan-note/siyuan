export const loadLanguages = async (lang: string, version: string, onLoaded: (languages: IObject) => void): Promise<void> => {
    const url = `/appearance/langs/${lang}.json?v=${version}`;
    let languages: IObject;
    try {
        const response = await fetch(url, {cache: "no-store"});
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        const data: unknown = await response.json();
        if (!data || typeof data !== "object" || Array.isArray(data) ||
            typeof (data as Record<string, unknown>).siyuanNote !== "string") {
            throw new SyntaxError("JSON");
        }
        languages = data as IObject;
    } catch (error) {
        console.error(url, error);
        const element = document.createElement("pre");
        element.className = "language-load-error";
        element.setAttribute("role", "alert");
        element.textContent = `${url}\n${String(error)}`;
        document.body.appendChild(element);
        return;
    }
    onLoaded(languages);
};
