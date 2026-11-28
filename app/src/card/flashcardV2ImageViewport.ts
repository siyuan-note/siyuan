import {AdaptiveDialog} from "../dialog/adaptiveDialog";
import {escapeAttr} from "../util/escape";
import {isFlashcardV2ImageRegion, type IFlashcardV2ImageRegion} from "./flashcardV2ImageRegion";

const focusedReviews = new WeakSet<Element>();

export const bindFlashcardV2Pinch = (element: HTMLElement, cancelSingle: () => void,
    update: (scale: number, x: number, y: number, dx: number, dy: number) => void) => {
    const points = new Map<number, {x: number, y: number}>();
    const measure = () => {
        const [first, second] = points.values();
        return second && {x: (first.x + second.x) / 2, y: (first.y + second.y) / 2,
            distance: Math.hypot(first.x - second.x, first.y - second.y)};
    };
    let pinching = false;
    let previous: ReturnType<typeof measure>;
    const stop = (event: PointerEvent) => {
        event.preventDefault();
        event.stopImmediatePropagation();
    };
    element.addEventListener("pointerdown", event => {
        if (event.pointerType !== "touch") {
            return;
        }
        points.set(event.pointerId, {x: event.clientX, y: event.clientY});
        element.setPointerCapture(event.pointerId);
        if (points.size >= 2) {
            if (!pinching) {
                cancelSingle();
                pinching = true;
            }
            previous = measure();
            stop(event);
        }
    }, true);
    element.addEventListener("pointermove", event => {
        if (!points.has(event.pointerId)) {
            return;
        }
        points.set(event.pointerId, {x: event.clientX, y: event.clientY});
        if (pinching) {
            const current = measure();
            if (current?.distance > 0 && previous?.distance > 0) {
                update(current.distance / previous.distance, previous.x, previous.y,
                    current.x - previous.x, current.y - previous.y);
            }
            previous = current;
            stop(event);
        }
    }, true);
    const release = (event: PointerEvent) => {
        if (points.delete(event.pointerId) && pinching) {
            if (points.size === 0) {
                pinching = false;
            }
            previous = measure();
            stop(event);
        }
    };
    (["pointerup", "pointercancel", "lostpointercapture"] as const).forEach(type => element.addEventListener(type, release, true));
};

const mountImageRegion = (layer: HTMLElement, image: HTMLImageElement, region: IFlashcardV2ImageRegion) => {
    const frame = document.createElement("span");
    frame.className = "card__v2-image-review-region";
    layer.before(frame);
    frame.appendChild(layer);
    return {
        frame,
        fitWidth: (maxWidth: number, maxHeight: number) => Math.min(image.naturalWidth * region.width, maxWidth,
            maxHeight * image.naturalWidth / image.naturalHeight * region.width / region.height),
        layout: (width: number) => {
            const imageWidth = width / region.width;
            const imageHeight = imageWidth * image.naturalHeight / image.naturalWidth;
            frame.style.width = `${width}px`;
            frame.style.height = `${imageHeight * region.height}px`;
            layer.style.left = `${-region.x * imageWidth}px`;
            layer.style.top = `${-region.y * imageHeight}px`;
            image.style.width = `${imageWidth}px`;
            image.style.height = "auto";
        },
    };
};

export const bindFlashcardV2ImageViewport = (wrapper: HTMLElement, image: HTMLImageElement,
    target: {left: number, top: number, right: number, bottom: number} | undefined,
    visibleRegion?: IFlashcardV2ImageRegion) => {
    const lang = window.siyuan.languages;
    const region = isFlashcardV2ImageRegion(visibleRegion) ? visibleRegion : undefined;
    const session = wrapper.closest(".card__v2-session");
    const card = wrapper.closest(".card__block");
    const inlineViewport = document.createElement("span");
    inlineViewport.className = "card__v2-image-review-scroll";
    wrapper.insertAdjacentElement("beforebegin", inlineViewport);
    inlineViewport.appendChild(wrapper);
    const inlineRegion = region && mountImageRegion(wrapper, image, region);
    const controls = document.createElement("div");
    controls.className = "card__v2-image-review-controls";
    controls.innerHTML = `<button type="button" data-zoom="open" class="b3-button b3-button--outline" aria-label="${escapeAttr(lang.zoomIn)}"><svg aria-hidden="true"><use xlink:href="#iconZoomIn"></use></svg></button>
${target && session && !region ? `<button type="button" data-zoom="auto" class="b3-button b3-button--outline" aria-pressed="false">${lang.flashcardFocusImageMask}</button>` : ""}`;
    inlineViewport.insertAdjacentElement("afterend", controls);
    const focusButton = controls.querySelector<HTMLButtonElement>('[data-zoom="auto"]');
    const originalWidth = image.style.width;
    const originalHeight = image.style.height;
    const fitInline = () => {
        const height = (card?.clientHeight || 0) - controls.offsetHeight - 30;
        if (height > 0) {
            inlineViewport.style.setProperty("--card-image-height", `${height}px`);
        }
        if (inlineRegion) {
            if (image.naturalWidth && image.naturalHeight) {
                inlineRegion.layout(inlineRegion.fitWidth(inlineViewport.clientWidth,
                    height > 0 ? height : window.innerHeight * .48));
            }
            return;
        }
        const focus = !!target && !!session && focusedReviews.has(session);
        const aspect = image.naturalWidth / image.naturalHeight;
        const zoomed = focus && height > 0 && aspect > 0 && inlineViewport.clientWidth > 0;
        inlineViewport.toggleAttribute("data-image-focused", !!zoomed);
        if (focusButton) {
            focusButton.setAttribute("aria-pressed", String(focus));
        }
        if (!zoomed) {
            image.style.width = originalWidth;
            image.style.height = originalHeight;
            return;
        }
        const width = inlineViewport.clientWidth;
        const fit = Math.min(width, height * aspect);
        const desired = Math.min(width * .8 / Math.max(.08, target.right - target.left),
            height * aspect * .8 / Math.max(.08, target.bottom - target.top));
        image.style.width = `${Math.max(fit, Math.min(image.naturalWidth, desired))}px`;
        image.style.height = "auto";
        inlineViewport.scrollLeft = wrapper.offsetLeft + (target.left + target.right) / 2 * wrapper.offsetWidth - width / 2;
        inlineViewport.scrollTop = wrapper.offsetTop + (target.top + target.bottom) / 2 * wrapper.offsetHeight - height / 2;
    };
    const inlineSize = new ResizeObserver(fitInline);
    inlineSize.observe(card || inlineViewport);
    image.addEventListener("load", fitInline);
    focusButton?.addEventListener("click", () => {
        if (focusedReviews.has(session)) {
            focusedReviews.delete(session);
        } else {
            focusedReviews.add(session);
        }
        fitInline();
    });
    fitInline();

    let preview: AdaptiveDialog | undefined;
    const open = () => {
        if (!wrapper.isConnected || preview) {
            return;
        }
        const size = new ResizeObserver(() => layout());
        const dialog = new AdaptiveDialog({
            title: lang.flashcardImageOcclusion,
            width: "100vw",
            height: "100dvh",
            mobileSheet: {initiallyExpanded: true},
            content: `<div class="b3-dialog__content card__v2-image-preview">
<div class="card__v2-image-review-controls">
    <button type="button" data-zoom="out" class="b3-button b3-button--outline" aria-label="${escapeAttr(lang.zoomOut)}"><svg aria-hidden="true"><use xlink:href="#iconZoomOut"></use></svg></button>
    <button type="button" data-zoom="fit" class="b3-button b3-button--outline">${lang.fitImage}</button>
    <button type="button" data-zoom="in" class="b3-button b3-button--outline" aria-label="${escapeAttr(lang.zoomIn)}"><svg aria-hidden="true"><use xlink:href="#iconZoomIn"></use></svg></button>
</div>
<div class="card__v2-image-preview-scroll" tabindex="0"></div>
</div>`,
            destroyCallback: () => {
                size.disconnect();
                preview = undefined;
            },
        });
        preview = dialog;
        const viewport = dialog.element.querySelector<HTMLElement>(".card__v2-image-preview-scroll");
        const clone = wrapper.cloneNode(true) as HTMLElement;
        const previewImage = clone.querySelector("img");
        previewImage.removeAttribute("id");
        previewImage.removeAttribute("style");
        previewImage.draggable = false;
        viewport.appendChild(clone);
        const previewRegion = region && mountImageRegion(clone, previewImage, region);
        const previewContent = previewRegion?.frame || clone;
        const zoomIn = dialog.element.querySelector<HTMLButtonElement>('[data-zoom="in"]');
        const zoomOut = dialog.element.querySelector<HTMLButtonElement>('[data-zoom="out"]');
        let zoom = 1;
        let drag: {pointer: number, x: number, y: number, left: number, top: number} | undefined;
        const layout = () => {
            const aspect = previewImage.naturalWidth / previewImage.naturalHeight;
            if (Number.isFinite(aspect) && aspect > 0) {
                if (previewRegion) {
                    previewRegion.layout(previewRegion.fitWidth(viewport.clientWidth, viewport.clientHeight) * zoom);
                } else {
                    const width = Math.min(previewImage.naturalWidth, viewport.clientWidth, viewport.clientHeight * aspect);
                    previewImage.style.width = `${Math.floor(width * zoom)}px`;
                }
            }
            zoomIn.disabled = zoom >= 8;
            zoomOut.disabled = zoom <= 1;
        };
        const zoomTo = (value: number, x = viewport.clientWidth / 2, y = viewport.clientHeight / 2) => {
            const oldWidth = previewContent.offsetWidth;
            const oldHeight = previewContent.offsetHeight;
            const pointX = (viewport.scrollLeft + x - previewContent.offsetLeft) / Math.max(1, oldWidth);
            const pointY = (viewport.scrollTop + y - previewContent.offsetTop) / Math.max(1, oldHeight);
            zoom = Math.max(1, Math.min(8, value));
            layout();
            viewport.scrollLeft = previewContent.offsetLeft + pointX * previewContent.offsetWidth - x;
            viewport.scrollTop = previewContent.offsetTop + pointY * previewContent.offsetHeight - y;
        };
        previewImage.addEventListener("load", layout, {once: true});
        size.observe(viewport);
        dialog.element.querySelector('[data-zoom="fit"]').addEventListener("click", () => zoomTo(1));
        zoomIn.addEventListener("click", () => zoomTo(zoom * 1.5));
        zoomOut.addEventListener("click", () => zoomTo(zoom / 1.5));
        viewport.addEventListener("wheel", (event) => {
            if (event.ctrlKey || event.metaKey) {
                event.preventDefault();
                const rect = viewport.getBoundingClientRect();
                zoomTo(zoom * (event.deltaY < 0 ? 1.25 : .8), event.clientX - rect.left, event.clientY - rect.top);
            }
            if (event.shiftKey && !event.ctrlKey && !event.metaKey && event.deltaX === 0) {
                event.preventDefault();
                viewport.scrollLeft += event.deltaY;
            }
        }, {passive: false});
        bindFlashcardV2Pinch(viewport, () => { drag = undefined; }, (scale, x, y, dx, dy) => {
            const rect = viewport.getBoundingClientRect();
            zoomTo(zoom * scale, x - rect.left, y - rect.top);
            viewport.scrollLeft -= dx;
            viewport.scrollTop -= dy;
        });
        viewport.addEventListener("pointerdown", (event) => {
            if (event.button === 0 && zoom > 1) {
                drag = {pointer: event.pointerId, x: event.clientX, y: event.clientY,
                    left: viewport.scrollLeft, top: viewport.scrollTop};
                viewport.setPointerCapture(event.pointerId);
            }
        });
        viewport.addEventListener("pointermove", (event) => {
            if (drag?.pointer === event.pointerId) {
                viewport.scrollLeft = drag.left + drag.x - event.clientX;
                viewport.scrollTop = drag.top + drag.y - event.clientY;
            }
        });
        viewport.addEventListener("lostpointercapture", () => { drag = undefined; });
        layout();
    };
    controls.querySelector('[data-zoom="open"]').addEventListener("click", open);
    image.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopImmediatePropagation();
        open();
    }, true);
    return {
        controls,
        setTarget: (next: typeof target) => {
            target = next;
            fitInline();
        },
        destroy: () => {
            inlineSize.disconnect();
            image.removeEventListener("load", fitInline);
            preview?.destroy();
        },
    };
};
