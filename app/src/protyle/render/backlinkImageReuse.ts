interface IBacklinkImageSource {
    element: HTMLElement;
    source: string;
}

export const captureBacklinkImageSources = (nodes: Node[]) => {
    const sources = new Map<string, IBacklinkImageSource>();
    const counts = new Map<string, number>();
    nodes.forEach(node => {
        if (!(node instanceof HTMLElement)) {
            return;
        }
        node.querySelectorAll<HTMLElement>('.img[data-type="img"]').forEach(element => {
            if (element.closest('.av, [data-type="NodeBlockQueryEmbed"], .protyle-wysiwyg__embed')) {
                return;
            }
            const blockID = element.closest("[data-node-id]")?.getAttribute("data-node-id");
            if (!blockID) {
                return;
            }
            const index = counts.get(blockID) || 0;
            counts.set(blockID, index + 1);
            sources.set(`${blockID}:${index}`, {element, source: element.outerHTML});
        });
    });
    return sources;
};

// 同一出现位置内只复用源码完全相同的图片，尺寸、标题和资源地址变化均使用新节点。
export const reuseBacklinkImageSources = (sources: Map<string, IBacklinkImageSource>,
                                         previous: Map<string, IBacklinkImageSource>) => {
    sources.forEach((source, id) => {
        const old = previous.get(id);
        if (!old || old.source !== source.source || !old.element.isConnected) {
            return;
        }
        source.element.replaceWith(old.element);
        source.element = old.element;
    });
};
