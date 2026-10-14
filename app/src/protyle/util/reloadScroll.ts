import {Constants} from "../../constants";

const pendingReloads = new WeakMap<HTMLElement, () => void>();

export const preserveReloadScroll = (protyle: Pick<IProtyle, "block" | "contentElement" | "wysiwyg" | "scroll">,
                                     scrollTop: number) => {
    const content = protyle.contentElement;
    const wysiwyg = protyle.wysiwyg.element;
    pendingReloads.get(content)?.();
    const overflowAnchor = content.style.getPropertyValue("overflow-anchor");
    const anchorPriority = content.style.getPropertyPriority("overflow-anchor");
    const rootID = protyle.block.rootID;
    let firstChild = wysiwyg.firstElementChild;
    let cancelled = false;
    const inputAbort = new AbortController();
    const release = () => {
        inputAbort.abort();
        if (pendingReloads.get(content) === cancel) {
            if (overflowAnchor) {
                content.style.setProperty("overflow-anchor", overflowAnchor, anchorPriority);
            } else {
                content.style.removeProperty("overflow-anchor");
            }
        }
    };
    const cancel = () => {
        cancelled = true;
        release();
    };
    pendingReloads.set(content, cancel);
    // 重载期间由保存的位置控制滚动，避免数据库布局变化触发浏览器的滚动锚定。
    content.style.setProperty("overflow-anchor", "none");
    // 用户操作只取消位置恢复，文档仍需完成重载。
    ["wheel", "touchstart", "pointerdown", "keydown", "beforeinput"].forEach(type => {
        content.addEventListener(type, cancel, {capture: true, passive: true, signal: inputAbort.signal});
    });
    const isValid = () => {
        const valid = pendingReloads.get(content) === cancel && wysiwyg.isConnected &&
            protyle.contentElement === content && protyle.wysiwyg.element === wysiwyg &&
            protyle.block.rootID === rootID && wysiwyg.firstElementChild === firstChild;
        if (!valid) {
            cancel();
        }
        return valid;
    };

    // 暂存已渲染的容器，让数据库渲染器沿用分页、查询和虚拟滚动状态，再从内核刷新数据。
    const databases = Array.from(wysiwyg.querySelectorAll<HTMLElement>(".av[data-render='true'][data-node-id]"))
        .map(element => {
            const container = element.firstElementChild;
            const clone = container?.cloneNode(true) as HTMLElement;
            const originals = container ? [container, ...container.querySelectorAll("*")] : [];
            const copies = clone ? [clone, ...clone.querySelectorAll("*")] : [];
            const scrolls = originals.map((item, index) => ({element: copies[index],
                top: item.scrollTop, left: item.scrollLeft}));
            return {id: element.dataset.nodeId, avID: element.dataset.avId, type: element.dataset.avType,
                alignSelf: element.style.alignSelf,
                virtualScroll: element.getAttribute(Constants.ATTRIBUTE_V_SCROLL), clone, scrolls};
        });

    return {
        isValid,
        beforeAVRender() {
            wysiwyg.querySelectorAll<HTMLElement>(".av[data-node-id]").forEach(element => {
                const saved = databases.find(item => item.id === element.dataset.nodeId &&
                    item.avID === element.dataset.avId && item.type === element.dataset.avType);
                if (!saved?.clone || !element.firstElementChild) {
                    return;
                }
                element.firstElementChild.replaceWith(saved.clone);
                element.style.alignSelf = saved.alignSelf;
                if (saved.virtualScroll !== null) {
                    element.setAttribute(Constants.ATTRIBUTE_V_SCROLL, saved.virtualScroll);
                }
                saved.scrolls.forEach(item => {
                    item.element.scrollTop = item.top;
                    item.element.scrollLeft = item.left;
                });
            });
            firstChild = wysiwyg.firstElementChild;
        },
        afterAVRender() {
            // 等待数据库布局提交，避免浏览器的滚动锚定再次移动刚恢复的位置。
            return new Promise<void>(resolve => {
                requestAnimationFrame(() => {
                    if (!cancelled && isValid() && content.clientHeight > 0) {
                        if (content.scrollTop !== scrollTop) {
                            content.scrollTop = scrollTop;
                        }
                        protyle.scroll.lastScrollTop = content.scrollTop;
                    }
                    requestAnimationFrame(() => {
                        release();
                        resolve();
                    });
                });
            });
        },
        cancel,
    };
};
