import {hasClosestByTag} from "../protyle/util/hasClosest";
import {setStorageVal} from "../protyle/util/compatibility";
import {Constants} from "../constants";

// 采集已展开的文档路径并写入本地存储，与 restoreFileTreePaths 使用同一个键，供桌面与移动端文件树共用。
// 与 fileTreeRestore 分开是为了让恢复逻辑保持纯函数，便于单独测试。
export const saveOpenFileTreePaths = (element: HTMLElement) => {
    const filesPaths: IFilesPath[] = [];
    element.querySelectorAll(".b3-list[data-url]").forEach((item: HTMLElement) => {
        const notebookPaths: IFilesPath = {
            notebookId: item.getAttribute("data-url"),
            openPaths: []
        };
        item.querySelectorAll(".b3-list-item__arrow--open").forEach((openItem) => {
            const liElement = hasClosestByTag(openItem, "LI");
            if (liElement) {
                notebookPaths.openPaths.push(liElement.getAttribute("data-path"));
            }
        });
        if (notebookPaths.openPaths.length > 0) {
            // 已保存的路径若指向另一个已展开节点的子孙，只保留祖先，避免恢复时重复展开。
            for (let i = 0; i < notebookPaths.openPaths.length; i++) {
                for (let j = i + 1; j < notebookPaths.openPaths.length; j++) {
                    if (notebookPaths.openPaths[j].startsWith(notebookPaths.openPaths[i].replace(".sy", ""))) {
                        notebookPaths.openPaths.splice(i, 1);
                        j--;
                    }
                }
            }
            // 展开节点本身的路径不作为恢复目标，改记其后一个节点，恢复时据此重新展开该层级。
            notebookPaths.openPaths.forEach((openPath, index) => {
                const nextPath = element.querySelector(`[data-url="${notebookPaths.notebookId}"] li[data-path="${openPath}"]`)?.nextElementSibling?.firstElementChild?.getAttribute("data-path");
                if (nextPath) {
                    notebookPaths.openPaths[index] = nextPath;
                }
            });
            filesPaths.push(notebookPaths);
        }
    });
    window.siyuan.storage[Constants.LOCAL_FILESPATHS] = filesPaths;
    setStorageVal(Constants.LOCAL_FILESPATHS, filesPaths);
};
