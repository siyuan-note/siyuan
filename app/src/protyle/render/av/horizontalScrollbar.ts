type ScrollbarEditor = Pick<IProtyle, "element" | "contentElement"> & {
    wysiwyg?: {element: HTMLElement};
};

const scrollbars = new WeakMap<ScrollbarEditor, AVHorizontalScrollbar>();
const sourceSelector = ":scope > .av__container > .av__scroll";
const epsilon = 1;

class AVHorizontalScrollbar {
    private readonly track = document.createElement("div");
    private readonly spacer = document.createElement("div");
    private readonly sources = new Map<HTMLElement, {block: HTMLElement; bodies: HTMLElement[]}>();
    private readonly visible = new Set<HTMLElement>();
    private readonly intersection: IntersectionObserver;
    private readonly resize = new ResizeObserver(() => this.schedule());
    private readonly removals: MutationObserver;
    private source?: HTMLElement;
    private projected = 0;
    private frame = 0;

    constructor(private readonly protyle: ScrollbarEditor, wysiwyg: HTMLElement) {
        this.track.className = "av__horizontal-scrollbar fn__none";
        this.track.tabIndex = 0;
        this.track.setAttribute("role", "region");
        this.track.setAttribute("aria-label", window.siyuan.languages.scrollHorizontal);
        this.track.append(this.spacer);
        this.track.addEventListener("pointerdown", event => {
            if (event.pointerType === "mouse" && event.button === 0) {
                // 鼠标拖动原生滑块时，编辑器保有当前焦点和光标。
                event.preventDefault();
            }
        });
        // 源表保有真实滚动位置，代理仅回写尚未投影的用户滚动。
        this.track.addEventListener("scroll", () => {
            const left = this.track.scrollLeft;
            if (this.source?.isConnected && Math.abs(left - this.projected) > .01) {
                this.source.scrollLeft = left;
                this.project();
            }
        }, {passive: true});
        this.track.addEventListener("keydown", event => {
            const offsets: Record<string, number> = {ArrowLeft: -40, ArrowRight: 40, Home: -Infinity, End: Infinity};
            if (!Object.hasOwn(offsets, event.key) || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
                return;
            }
            event.preventDefault();
            event.stopPropagation();
            const limit = this.track.scrollWidth - this.track.clientWidth;
            this.track.scrollLeft = Math.max(0, Math.min(limit, this.track.scrollLeft + offsets[event.key]));
        });
        protyle.element.append(this.track);
        this.intersection = new IntersectionObserver(entries => {
            entries.forEach(({target, isIntersecting}) => {
                if (target instanceof HTMLElement && this.sources.has(target)) {
                    if (isIntersecting) {
                        this.visible.add(target);
                    } else {
                        this.visible.delete(target);
                    }
                }
            });
            this.schedule();
        }, {root: protyle.contentElement});
        this.resize.observe(protyle.contentElement);
        this.removals = new MutationObserver(records => {
            if (records.some(record => record.removedNodes.length &&
                !(record.target instanceof Element && record.target.closest(".av__body")))) {
                this.sources.forEach(({block}, source) => {
                    if (!wysiwyg.contains(block) || !block.contains(source)) {
                        this.remove(source);
                    }
                });
                this.schedule();
            }
        });
        this.removals.observe(wysiwyg, {childList: true, subtree: true});
    }

    public register(block: HTMLElement, source: HTMLElement) {
        const previous = this.sources.get(source);
        previous?.bodies.forEach(body => this.resize.unobserve(body));
        const bodies = Array.from(source.querySelectorAll<HTMLElement>(":scope > .av__body"));
        this.sources.set(source, {block, bodies});
        bodies.forEach(body => this.resize.observe(body));
        if (!previous) {
            this.intersection.observe(source);
            this.resize.observe(source);
        }
        this.schedule();
    }

    public schedule() {
        if (!this.frame) {
            this.frame = requestAnimationFrame(() => {
                this.frame = 0;
                this.update();
            });
        }
    }

    public destroy() {
        cancelAnimationFrame(this.frame);
        this.resize.disconnect();
        this.intersection.disconnect();
        this.removals.disconnect();
        this.bind(undefined);
        this.track.remove();
    }

    private remove(source: HTMLElement) {
        this.sources.get(source).bodies.forEach(body => this.resize.unobserve(body));
        this.resize.unobserve(source);
        this.intersection.unobserve(source);
        this.sources.delete(source);
        this.visible.delete(source);
    }

    private project = () => {
        if (this.source) {
            const left = this.source.scrollLeft;
            if (Math.abs(this.track.scrollLeft - left) > .01) {
                this.track.scrollLeft = left;
            }
            this.projected = this.track.scrollLeft;
        }
    };

    private bind(source: HTMLElement | undefined) {
        if (source !== this.source) {
            this.source?.removeEventListener("scroll", this.project);
            this.source = source;
            source?.addEventListener("scroll", this.project, {passive: true});
        }
        if (!source && this.track === document.activeElement) {
            this.protyle.element.focus({preventScroll: true});
        }
        this.track.classList.toggle("fn__none", !source);
    }

    private update() {
        const {element, contentElement} = this.protyle;
        if (!element.offsetWidth || !element.offsetHeight || !contentElement.clientHeight) {
            this.bind(undefined);
            return;
        }
        const shell = element.getBoundingClientRect();
        const scaleX = shell.width / element.offsetWidth;
        const scaleY = shell.height / element.offsetHeight;
        const trackHeight = parseFloat(getComputedStyle(this.track).height) * scaleY;
        const viewport = contentElement.getBoundingClientRect();
        const clientLeft = viewport.left + contentElement.clientLeft * scaleX;
        const clientTop = viewport.top + contentElement.clientTop * scaleY;
        const viewportLeft = Math.max(clientLeft, shell.left);
        const viewportRight = Math.min(clientLeft + contentElement.clientWidth * scaleX, shell.right);
        const viewportTop = Math.max(clientTop, shell.top);
        const viewportBottom = Math.min(clientTop + contentElement.clientHeight * scaleY, shell.bottom);
        let candidate: {source: HTMLElement; left: number; right: number; bottom: number; range: number; end: number};
        for (const source of this.visible) {
            const {block, bodies} = this.sources.get(source);
            if (!source.isConnected || block.dataset.avType !== "table") {
                continue;
            }
            const range = source.scrollWidth - source.clientWidth;
            const rect = source.getBoundingClientRect();
            const originalTrackTop = rect.top + (source.clientTop + source.clientHeight) * scaleY;
            const sourceLeft = rect.left + source.clientLeft * scaleX;
            const left = Math.max(viewportLeft, sourceLeft);
            const right = Math.min(viewportRight, sourceLeft + source.clientWidth * scaleX);
            if (range <= epsilon || originalTrackTop <= viewportBottom + epsilon || right - left < 24 * scaleX) {
                continue;
            }
            for (const body of bodies) {
                const bodyRect = body.getBoundingClientRect();
                if (bodyRect.top >= viewportBottom - epsilon || bodyRect.bottom <= viewportBottom + epsilon) {
                    continue;
                }
                const footer = body.querySelector<HTMLElement>(":scope > .av__row--footer--fixed");
                const bottom = footer ? Math.min(viewportBottom, footer.getBoundingClientRect().top) : viewportBottom;
                const header = body.querySelector<HTMLElement>(":scope > .av__row--header");
                const top = Math.max(viewportTop, bodyRect.top, header?.getBoundingClientRect().bottom ?? viewportTop);
                if (bottom - top < trackHeight || (candidate &&
                    (candidate.source === this.source || (source !== this.source && candidate.end <= bodyRect.bottom)))) {
                    continue;
                }
                candidate = {source, left, right, bottom, range, end: bodyRect.bottom};
            }
        }
        this.bind(candidate?.source);
        if (candidate) {
            this.track.style.left = (candidate.left - shell.left) / scaleX - element.clientLeft + "px";
            this.track.style.top = (candidate.bottom - shell.top) / scaleY - element.clientTop + "px";
            this.track.style.width = (candidate.right - candidate.left) / scaleX + "px";
            this.spacer.style.width = this.track.clientWidth + candidate.range + "px";
            this.project();
        }
    }
}

export const registerAVHorizontalScrollbar = (protyle: ScrollbarEditor, block: HTMLElement) => {
    const wysiwyg = protyle.wysiwyg?.element;
    if (!wysiwyg || block.dataset.avType !== "table" ||
        block.closest(".av--backlink, .mindmap-view__preview-block, [data-type=\"NodeBlockQueryEmbed\"]") ||
        block.closest(".protyle-wysiwyg") !== wysiwyg) {
        return;
    }
    const source = block.querySelector<HTMLElement>(sourceSelector);
    if (source) {
        let scrollbar = scrollbars.get(protyle);
        if (!scrollbar) {
            scrollbar = new AVHorizontalScrollbar(protyle, wysiwyg);
            scrollbars.set(protyle, scrollbar);
        }
        scrollbar.register(block, source);
    }
};

export const scheduleAVHorizontalScrollbar = (protyle: ScrollbarEditor) => scrollbars.get(protyle)?.schedule();
export const destroyAVHorizontalScrollbar = (protyle: ScrollbarEditor) => {
    scrollbars.get(protyle)?.destroy();
    scrollbars.delete(protyle);
};
