export const showFullscreenDocumentBar = (protyle: IProtyle, host: HTMLElement) => {
    const bar = protyle.breadcrumb?.element.parentElement;
    if (!bar) {
        return;
    }
    const marker = document.createComment("document-bar");
    bar.before(marker);
    host.before(bar);
    bar.classList.add("protyle-breadcrumb--fullscreen");
    host.classList.add("mindmap-view--document-bar");
    return () => {
        bar.classList.remove("protyle-breadcrumb--fullscreen");
        host.classList.remove("mindmap-view--document-bar");
        marker.replaceWith(bar);
    };
};
