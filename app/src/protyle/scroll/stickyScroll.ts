export interface IStickyPositionY {
    top: number;
    bottom: number;
}

export interface IStickyElementY {
    element: HTMLElement;
    offset?: number;
}

export interface IStickyContextY extends IStickyElementY {
    rect: DOMRect;
    base: number;
    origin: IStickyPositionY;
    current: IStickyPositionY;
    target: IStickyPositionY;
    style: IStickyPositionY;
}

export const stickyScrollY = (
    view: HTMLElement, // 视口元素
    container: HTMLElement, // 容器元素
    topElements: IStickyElementY[] = [], // 顶部粘性元素
    bottomElements: IStickyElementY[] = [], // 底部粘性元素
) => {
    if (topElements.length === 0 && bottomElements.length === 0) {
        return;
    }

    const viewRect = view.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();

    /**
     * ┏---------------┓
     * |      view     |
     * ┗---------------┛ → viewRect.bottom
     *   ┌-----------┐ --→ containerRect.top
     *   | container |
     *   └-----------┘
     * ====== OR ======
     *   ┌-----------┐
     *   | container |
     *   └-----------┘ --→ containerRect.bottom
     * ┏---------------┓ → viewRect.top
     * |      view     |
     * ┗---------------┛
     */
    if (viewRect.bottom <= containerRect.top || containerRect.bottom <= viewRect.top) {
        return;
    }

    const topContext: IStickyContextY[] = topElements.map(item => {
        const rect = item.element.getBoundingClientRect();
        const base = Number.parseFloat(item.element.style.top) || 0;
        item.offset ??= 0;

        return {
            ...item,
            rect,
            base,
            origin: {
                top: rect.top - base,
                bottom: rect.bottom - base,
            },
            current: {
                top: rect.top,
                bottom: rect.bottom,
            },
            target: {
                top: null,
                bottom: null,
            },
            style: {
                top: null,
                bottom: null,
            }
        };
    });
    const bottomContext: IStickyContextY[] = bottomElements.map(item => {
        const rect = item.element.getBoundingClientRect();
        const base = Number.parseFloat(item.element.style.bottom) || 0;
        item.offset ??= 0;

        return {
            ...item,
            rect,
            base,
            origin: {
                top: rect.top + base,
                bottom: rect.bottom + base,
            },
            current: {
                top: rect.top,
                bottom: rect.bottom,
            },
            target: {
                top: null,
                bottom: null,
            },
            style: {
                top: null,
                bottom: null,
            }
        };
    });

    let handleTop = false;
    let handleBottom = false;

    switch (true) {
        /**
         * ┏---------------┓ → viewRect.top
         * |               |
         * |      view     |
         * | ┌-----------┐ | → containerRect.top
         * ┗-╊-----------╊-┛ → viewRect.bottom
         *   | container |
         *   └-----------┘ --→ containerRect.bottom
         */
        case viewRect.top <= containerRect.top
            && containerRect.top <= viewRect.bottom
            && viewRect.top <= viewRect.bottom:
            handleBottom = true;
            break;

        /**
         * ┏---------------┓ → viewRect.top
         * |      view     |
         * | ┌-----------┐ | → containerRect.top
         * | | container | |
         * | └-----------┘ | → containerRect.bottom
         * ┗---------------┛ → viewRect.bottom
         */
        case viewRect.top <= containerRect.top
            && containerRect.bottom <= viewRect.bottom:
            break;


        /**
         *   ┌-----------┐ --→ containerRect.top
         * ┏-╊-----------╊-┓ → viewRect.top
         * | |           | |}→ view
         * ┗-╊-----------╊-┛ → viewRect.bottom
         *   | container |
         *   └-----------┘ --→ containerRect.bottom
         */
        case containerRect.top <= viewRect.top
            && viewRect.bottom <= containerRect.bottom:
            handleTop = true;
            handleBottom = true;
            break;

        /**
         *   ┌-----------┐ --→ containerRect.top
         *   | container |
         * ┏-╊-----------╊-┓ → viewRect.top
         * | └-----------┘ | → containerRect.bottom
         * |      view     |
         * ┗-|-----------|-┛ → viewRect.bottom
         */
        case containerRect.top <= viewRect.top
            && viewRect.top <= containerRect.bottom
            && containerRect.bottom <= viewRect.bottom:
            handleTop = true;
            break;

        default:
            break;
    }

    if (handleTop) {
        if (topContext.length > 0) {
            topContext.reduceRight((next, current) => {
                switch (true) {
                    /**
                     *   ┌-----------┐ --→ containerRect.top
                     * ┏-╊-----------╊-┓ → viewRect.top
                     * | | ┌┄┄┄┄┄┄┄┐ | | → current.target.top - current.offset
                     * | | ├╌╌╌╌╌╌╌┤ | | → current.origin.top
                     * | | └╌╌╌╌╌╌╌┘ | | → current.origin.bottom
                     * | | ┌╌╌╌╌╌╌╌┐ | | → next.origin.top
                     * | | └╌╌╌╌╌╌╌┘ | | → next.origin.bottom
                     * ┗-╊-----------╊-┛ → viewRect.bottom
                     *   └-----------┘ --→ containerRect.bottom
                     */
                    case viewRect.top <= (current.origin.top - current.offset):
                        current.target.top = current.origin.top;
                        current.target.bottom = current.origin.bottom;
                        current.style.top = null;
                        break;

                    /**
                     *   ┌-----------┐ --→ containerRect.top
                     *   | ┌╌╌╌╌╌╌╌┐ | --→ current.origin.top
                     *   | └╌╌╌╌╌╌╌┘ | --→ current.origin.bottom
                     * ┏-╊-----------╊-┓ → viewRect.top
                     * | | ┌-------┐ | | → current.target.top
                     * | | └-------┘ | | → current.target.bottom
                     * ┗-╊-----------╊-┛ → viewRect.bottom
                     *   | container |
                     *   └-----------┘ --→ containerRect.bottom
                     */
                    default:
                        current.target.top = viewRect.top + current.offset;
                        current.target.bottom = current.target.top + current.rect.height;
                        const nextTop = next
                            ? Math.min(next.target.top, next.origin.top, containerRect.bottom)
                            : containerRect.bottom;
                        if (nextTop < current.target.bottom) {
                            const diff = nextTop - current.target.bottom;
                            current.target.top += diff;
                            current.target.bottom += diff;
                        }
                        current.style.top = current.base + (current.target.top - current.current.top);
                        break;
                }
                return current;
            }, null);
        }
    }
    if (handleBottom) {
        if (bottomContext.length > 0) {
            bottomContext.reduce((last, current) => {
                switch (true) {
                    /**
                     *   ┌-----------┐ --→ containerRect.top
                     * ┏-╊-----------╊-┓ → viewRect.top
                     * | | ┌╌╌╌╌╌╌╌┐ | | → last.origin.top
                     * | | └╌╌╌╌╌╌╌┘ | | → last.origin.bottom
                     * | | ┌╌╌╌╌╌╌╌┐ | | → current.origin.top
                     * | | ├╌╌╌╌╌╌╌┤ | | → current.origin.bottom
                     * | | └┄┄┄┄┄┄┄┘ | | → current.target.bottom + current.offset
                     * ┗-╊-----------╊-┛ → viewRect.bottom
                     *   └-----------┘ --→ containerRect.bottom
                     */
                    case (current.origin.bottom + current.offset) <= viewRect.bottom:
                        current.target.top = current.origin.top;
                        current.target.bottom = current.origin.bottom;
                        current.style.bottom = null;
                        break;

                    /**
                     *   ┌-----------┐ --→ containerRect.top
                     * ┏-╊-----------╊-┓ → viewRect.top
                     * | | ┌-------┐ | | → current.target.top
                     * | | └-------┘ | | → current.target.bottom
                     * ┗-╊-----------╊-┛ → viewRect.bottom
                     *   | ┌╌╌╌╌╌╌╌┐ | --→ current.origin.top
                     *   | └╌╌╌╌╌╌╌┘ | --→ current.origin.bottom
                     *   | container |
                     *   └-----------┘ --→ containerRect.bottom
                     */
                    default:
                        current.target.bottom = viewRect.bottom - current.offset;
                        current.target.top = current.target.bottom - current.rect.height;
                        const lastBottom = last
                            ? Math.max(last.target.bottom, last.origin.bottom, containerRect.top)
                            : containerRect.top;
                        if (current.target.top < lastBottom) {
                            const diff = lastBottom - current.target.top;
                            current.target.top += diff;
                            current.target.bottom += diff;
                        }
                        current.style.bottom = current.base - (current.target.bottom - current.current.bottom);
                        break;
                }
                return current;
            }, null);
        }
    }

    [...topContext, ...bottomContext].forEach(item => {
        item.element.style.top = item.style.top ? `${item.style.top}px` : null;
        item.element.style.bottom = item.style.bottom ? `${item.style.bottom}px` : null;
    });
}
