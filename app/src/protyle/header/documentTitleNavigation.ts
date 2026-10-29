import {showMessage} from "../../dialog/message";
import {removeLoading} from "../ui/initUI";

const generations = new WeakMap<IProtyle, number>();

// onGet 在改变编辑器的文档身份之前等待标题源；连续导航只应用最新的响应。
export const deferDocumentTitleNavigation = (protyle: IProtyle, rootID: string,
                                               resume: (title: IProtyle["title"]) => void, fail?: () => void) => {
    const title = protyle.title;
    const generation = (generations.get(protyle) || 0) + 1;
    generations.set(protyle, generation);
    const pending = title?.prepareForDocumentSwitch(rootID);
    if (!pending) {
        return false;
    }
    void pending.then(() => {
        if (generations.get(protyle) !== generation || protyle.title !== title || title.element.isConnected === false) {
            fail?.();
            return;
        }
        resume(title);
    }).catch(error => {
        if (generations.get(protyle) === generation && title.element.isConnected !== false) {
            removeLoading(protyle);
            showMessage(error instanceof Error ? error.message : window.siyuan.languages.settingsPendingSaveError);
        }
        fail?.();
    });
    return true;
};
