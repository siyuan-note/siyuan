export const getImageResizeWidth = (width: number, height: number, deltaX: number, deltaY: number,
                                    axis: string, multiple: number, maxWidth: number) => {
    const ratio = width > 0 && height > 0 ? width / height : 1;
    let delta = deltaX * multiple;
    if (axis === "height") {
        delta = deltaY * ratio;
    } else if (axis === "both") {
        // 将拖动位置投影到等比缩放方向，横向与纵向移动都能调整右下角。
        delta = (deltaX / multiple + deltaY / ratio) / (1 / (multiple * multiple) + 1 / (ratio * ratio));
    }
    return Math.max(17, Math.min(maxWidth, width + delta));
};

export const bindImageResize = (root: HTMLElement) => {
    const images = new Map<HTMLImageElement, {frame: HTMLElement, container: HTMLElement}>();
    const pending = new Set<HTMLImageElement>();
    let positionFrame = 0;
    const schedulePosition = (image: HTMLImageElement) => {
        pending.add(image);
        if (positionFrame) {
            return;
        }
        positionFrame = requestAnimationFrame(() => {
            positionFrame = 0;
            // 全部图片先读取布局，再统一写入控件，避免逐张图片触发同步重排。
            const positions = Array.from(pending).filter(image => images.has(image) && root.contains(image))
                .map(image => ({image, frame: images.get(image).frame, width: image.clientWidth,
                    height: image.clientHeight, left: image.offsetLeft, top: image.offsetTop}));
            pending.clear();
            positions.forEach(({image, frame, width, height, left, top}) => {
                image.parentElement.classList.toggle("protyle-image-container--compact", width < 96 || height < 48);
                // 说明文字按图片显示宽度缩放，派生样式只写入说明节点，避免影响图片容器的宽度规则。
                image.parentElement.querySelectorAll<HTMLElement>(":scope > .img__name, :scope > .protyle-action__title, :scope > .img__alt")
                    .forEach(caption => caption.style.setProperty("--protyle-image-font-size", Math.max(8, width / 10) + "px"));
                frame.style.left = left + "px";
                frame.style.top = top + "px";
                frame.style.width = width + "px";
                frame.style.height = height + "px";
            });
        });
    };
    const resizeObserver = new ResizeObserver(entries => {
        entries.forEach(entry => {
            const image = entry.target instanceof HTMLImageElement ? entry.target :
                entry.target.querySelector<HTMLImageElement>(":scope > img");
            const state = images.get(image);
            if (state) {
                schedulePosition(image);
            }
        });
    });
    const render = (image: HTMLImageElement) => {
        if (image.closest(".protyle-wysiwyg") !== root ||
            image.closest(".protyle-wysiwyg__embed, .mindmap-view__preview-block")) {
            return;
        }
        const container = image.parentElement;
        if (container.parentElement?.getAttribute("data-type") !== "img") {
            return;
        }
        container.classList.add("protyle-image-container");
        let firstCaption = true;
        container.querySelectorAll<HTMLElement>(":scope > .protyle-action__title, :scope > .img__alt").forEach(caption => {
            const visible = !!caption.textContent;
            caption.classList.toggle("protyle-image-caption", visible && firstCaption);
            if (visible) {
                firstCaption = false;
            }
        });
        let frame = container.querySelector<HTMLElement>(":scope > .protyle-action__drag:not(.protyle-block-resize)");
        if (!frame) {
            frame = image.ownerDocument.createElement("span");
            container.appendChild(frame);
        }
        if (frame.className !== "protyle-action__drag protyle-image-resize") {
            frame.className = "protyle-action__drag protyle-image-resize";
        }
        if (frame.contentEditable !== "false") {
            frame.contentEditable = "false";
        }
        for (const axis of ["width", "height", "both"]) {
            if (frame.querySelector(`[data-resize-axis="${axis}"]`)) {
                continue;
            }
            const handle = image.ownerDocument.createElement("span");
            handle.className = "protyle-action__drag protyle-block-resize";
            handle.dataset.resizeAxis = axis;
            handle.setAttribute("data-prevent-swipe", "true");
            frame.appendChild(handle);
        }
        const previous = images.get(image);
        if (!previous) {
            resizeObserver.observe(image);
        }
        if (previous?.container !== container) {
            if (previous) {
                resizeObserver.unobserve(previous.container);
            }
            resizeObserver.observe(container);
        }
        images.set(image, {frame, container});
        schedulePosition(image);
    };
    const collectImages = (element: Element, collected: Set<HTMLImageElement>) => {
        if (element.matches(".img img")) {
            collected.add(element as HTMLImageElement);
        }
        element.querySelectorAll<HTMLImageElement>(".img img").forEach(image => collected.add(image));
    };
    const observer = new MutationObserver(records => {
        const added = new Set<Element>();
        const removed = new Set<HTMLImageElement>();
        const remove = (image: HTMLImageElement) => {
            const state = images.get(image);
            if (state && !root.contains(image)) {
                resizeObserver.unobserve(image);
                resizeObserver.unobserve(state.container);
                images.delete(image);
            }
        };
        records.forEach(record => {
            // 控件自身追加的节点只参与派生 UI，不触发图片重新初始化。
            if (record.target instanceof Element && record.target.closest(".protyle-image-resize") ||
                record.removedNodes.length === 0 && record.addedNodes.length > 0 &&
                Array.from(record.addedNodes).every(node => node instanceof Element && node.matches(".protyle-image-resize"))) {
                return;
            }
            const parent = record.target instanceof Element ? record.target.closest(".img") : null;
            if (parent) {
                added.add(parent);
            }
            record.addedNodes.forEach(node => {
                if (node instanceof Element) {
                    added.add(node);
                }
            });
            record.removedNodes.forEach(node => {
                if (node instanceof HTMLImageElement) {
                    removed.add(node);
                } else if (node instanceof Element) {
                    node.querySelectorAll<HTMLImageElement>("img").forEach(image => removed.add(image));
                }
            });
        });
        const changed = new Set<HTMLImageElement>();
        added.forEach(element => {
            if (!root.contains(element)) {
                return;
            }
            // 同批次的祖先节点已包含整个子树，图片只需扫描和初始化一次。
            let parent = element.parentElement;
            while (parent) {
                if (added.has(parent)) {
                    return;
                }
                parent = parent.parentElement;
            }
            collectImages(element, changed);
        });
        removed.forEach(remove);
        changed.forEach(render);
    });
    // 在图片插入、替换和撤销后初始化派生控件，不依赖图片的具体插入入口。
    observer.observe(root, {childList: true, subtree: true});
    const initial = new Set<HTMLImageElement>();
    collectImages(root, initial);
    initial.forEach(render);
    return () => {
        observer.disconnect();
        resizeObserver.disconnect();
        cancelAnimationFrame(positionFrame);
        pending.clear();
        images.clear();
    };
};
