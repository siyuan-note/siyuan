export const observeFontPreview = (listElement: HTMLElement,
                                   applyFont: (label: HTMLElement, item: HTMLElement) => void) => {
    let closed = false;
    let observer: IntersectionObserver;
    const prepared = new WeakSet<HTMLElement>();
    const prepare = async (item: HTMLElement) => {
        const label = item.querySelector<HTMLElement>(".b3-menu__label");
        if (closed || !label?.dataset.family || prepared.has(item)) {
            return;
        }
        prepared.add(item);
        observer?.unobserve(item);
        try {
            applyFont(label, item);
            const style = getComputedStyle(label);
            await document.fonts?.load(`${style.fontWeight} ${style.fontSize} ${style.fontFamily}`, label.textContent);
        } catch (error) {
            // 字体加载失败时使用界面字体，确保名称仍可阅读和选择。
            label.style.removeProperty("font-family");
            label.style.removeProperty("font-weight");
        } finally {
            if (!closed) {
                label.style.removeProperty("visibility");
            }
        }
    };
    const items = listElement.querySelectorAll<HTMLElement>(".b3-list-item");
    // 字体就绪后再显示名称，避免菜单选项从界面字体切换到预览字体。
    items.forEach(item => {
        const label = item.querySelector<HTMLElement>(".b3-menu__label");
        if (label?.dataset.family) {
            label.style.visibility = "hidden";
        }
    });
    if ("IntersectionObserver" in window) {
        observer = new IntersectionObserver(entries => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    void prepare(entry.target as HTMLElement);
                }
            });
        }, {root: listElement, rootMargin: "100px 0px"});
        items.forEach(item => observer.observe(item));
    } else {
        items.forEach(item => void prepare(item));
    }
    return () => {
        closed = true;
        observer?.disconnect();
    };
};
