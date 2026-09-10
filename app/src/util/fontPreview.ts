export const observeFontPreview = (listElement: HTMLElement,
                                   applyFont: (label: HTMLElement, item: HTMLElement) => void) => {
    let closed = false;
    let observer: IntersectionObserver;
    let timer: ReturnType<typeof setTimeout>;
    let frame: number;
    let loading = false;
    const pending = new Set<HTMLElement>();
    const schedule = () => {
        clearTimeout(timer);
        cancelAnimationFrame(frame);
        if (!closed) {
            timer = setTimeout(() => {
                timer = undefined;
                void next();
            }, 150);
        }
    };
    const next = async () => {
        if (closed || loading) {
            return;
        }
        const item = pending.values().next().value;
        if (!item) {
            return;
        }
        pending.delete(item);
        loading = true;
        await prepare(item);
        loading = false;
        // 后续字体逐帧加载，仅滚动或可见范围变化时重新等待防抖。
        if (!closed && pending.size && timer === undefined) {
            frame = requestAnimationFrame(() => void next());
        }
    };
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
    // 名称立即显示，滚动停止后逐项加载可见字体，避免快速滚动时集中加载。
    listElement.addEventListener("scroll", schedule, {passive: true});
    if ("IntersectionObserver" in window) {
        observer = new IntersectionObserver(entries => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    if (!prepared.has(entry.target as HTMLElement)) {
                        pending.add(entry.target as HTMLElement);
                    }
                } else {
                    pending.delete(entry.target as HTMLElement);
                }
            });
            schedule();
        }, {root: listElement});
        items.forEach(item => observer.observe(item));
    } else {
        items.forEach(item => pending.add(item));
        schedule();
    }
    return () => {
        closed = true;
        clearTimeout(timer);
        cancelAnimationFrame(frame);
        pending.clear();
        listElement.removeEventListener("scroll", schedule);
        observer?.disconnect();
    };
};
