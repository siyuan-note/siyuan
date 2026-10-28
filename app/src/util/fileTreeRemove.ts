import {setNoteBook} from "./pathName";
import {syncFileTreeItemDefaultIcon} from "../emoji/fileTreeIcon";

// 文件树删除 / 关闭笔记本事件的 DOM 收尾。桌面与移动端共用同一段结构操作，
// 各自只需提供生成笔记本条目的回调，两者的笔记本条目外观本来就不同。
interface FileTreeRemoveDeps {
    element: HTMLElement;
    closeElement: HTMLElement;
    genNotebook: (notebook: INotebook) => string;
    updateDocActionElement: (element: HTMLElement) => void;
}

export const removeFileTreeItems = (deps: FileTreeRemoveDeps, data: IWebSocketData) => {
    // "doc2heading" 后删除文件或挂载帮助文档前的 unmount
    if (data.cmd === "closeBox" || data.cmd === "removeBox") {
        setNoteBook((notebooks) => {
            const targetElement = deps.element.querySelector(`ul[data-url="${data.data.box}"] li[data-path="${"/"}"]`);
            if (targetElement) {
                targetElement.parentElement.remove();
                if (data.cmd === "closeBox") {
                    let closeHTML = "";
                    notebooks.find(item => {
                        if (item.closed) {
                            closeHTML += deps.genNotebook(item);
                        }
                    });
                    deps.closeElement.lastElementChild.innerHTML = closeHTML;
                    const counterElement = deps.closeElement.querySelector(".counter");
                    counterElement.textContent = (parseInt(counterElement.textContent) + 1).toString();
                    deps.closeElement.classList.remove("fn__none");
                }
            }
        });
        if (data.cmd === "removeBox") {
            const removeElement = deps.closeElement.querySelector(`li[data-url="${data.data.box}"]`);
            if (removeElement) {
                removeElement.remove();
                const counterElement = deps.closeElement.querySelector(".counter");
                counterElement.textContent = (parseInt(counterElement.textContent) - 1).toString();
                if (counterElement.textContent === "0") {
                    deps.closeElement.classList.add("fn__none");
                }
            }
        }
        return;
    }
    data.data.ids.forEach((item: string) => {
        const targetElement = deps.element.querySelector(`li.b3-list-item[data-node-id="${item}"]`);
        if (targetElement) {
            // 子节点展开则删除
            if (targetElement.nextElementSibling?.tagName === "UL") {
                targetElement.nextElementSibling.remove();
            }
            // 移除当前节点
            const parentElement = targetElement.parentElement.previousElementSibling as HTMLElement;
            if (targetElement.parentElement.childElementCount === 1) {
                if (parentElement) {
                    const iconElement = parentElement.querySelector("svg");
                    iconElement.classList.remove("b3-list-item__arrow--open");
                    if (parentElement.dataset.type !== "navigation-root" || parentElement.dataset.nodeId) {
                        iconElement.parentElement.classList.add("fn__hidden");
                    }
                    parentElement.setAttribute("data-count", "0");
                    deps.updateDocActionElement(parentElement);
                    syncFileTreeItemDefaultIcon(parentElement);
                }
                targetElement.parentElement.remove();
            } else {
                targetElement.remove();
            }
        }
    });
};
