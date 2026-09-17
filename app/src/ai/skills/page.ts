// 子页面保留父设置的节点和滚动位置，返回交给现有设置导航处理。
export const createSkillManagerPage = (settingRoot: HTMLElement, content: string, onDestroy: () => void) => {
    const view = document.createElement("section");
    view.className = "skill-manager-page config__view config__view--show";
    view.setAttribute("aria-label", window.siyuan.languages.agentSkillManager);
    view.innerHTML = content;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    const scrollTop = settingRoot.scrollTop;
    const model = settingRoot.closest<HTMLElement>("#model");
    const background = [...Array.from(settingRoot.children), model?.querySelector(":scope > .toolbar")]
        .filter((element): element is HTMLElement => element instanceof HTMLElement && !element.hasAttribute("inert"));
    background.forEach(element => element.setAttribute("inert", ""));
    settingRoot.append(view);
    let destroyed = false;
    const viewport = window.visualViewport;
    const resize = () => {
        if (!viewport) {
            return;
        }
        const container = model?.getBoundingClientRect();
        view.style.top = `${Math.max(0, viewport.offsetTop - (container?.top || 0))}px`;
        view.style.height = `${viewport.height}px`;
    };
    viewport?.addEventListener("resize", resize);
    viewport?.addEventListener("scroll", resize);
    resize();
    const destroy = () => {
        if (destroyed) {
            return;
        }
        destroyed = true;
        observer.disconnect();
        viewport?.removeEventListener("resize", resize);
        viewport?.removeEventListener("scroll", resize);
        view.remove();
        background.forEach(element => element.removeAttribute("inert"));
        settingRoot.scrollTop = scrollTop;
        onDestroy();
        if (previousFocus?.isConnected) {
            previousFocus.focus({preventScroll: true});
        }
    };
    // 设置页被其它导航销毁时同步释放页面监听器。
    const observer = new MutationObserver(() => {
        if (!view.isConnected) {
            destroy();
        }
    });
    observer.observe(model || settingRoot.parentElement, {childList: true, subtree: true});
    return {element: view, destroy};
};
