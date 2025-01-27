export const cancelDrag = () => {
    const ghostElement = document.getElementById("dragGhost");
    if (ghostElement) {
        if (ghostElement.dataset.ghostType === "dock") {
            ghostElement.parentElement.querySelectorAll(".dock__item").forEach((item: HTMLElement) => {
                item.style.opacity = "";
            });
            document.querySelector("#dockMoveItem")?.remove();
        } else {
            const startElement = ghostElement.parentElement.querySelector(`[data-node-id="${ghostElement.getAttribute("data-node-id")}"]`) as HTMLElement;
            if (startElement) {
                startElement.style.opacity = "";
            }
            ghostElement.parentElement.querySelectorAll(".dragover__top, .dragover__bottom, .dragover, .dragover__current").forEach((item: HTMLElement) => {
                item.classList.remove("dragover__top", "dragover__bottom", "dragover", "dragover__current");
                item.style.opacity = "";
            });
        }
        ghostElement.remove();
        document.onmousemove = null;
    }
};
