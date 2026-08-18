import {Constants} from "../constants";
import {MenuItem} from "./Menu";
import {escapeHtml} from "../util/escape";
import {showMessage} from "../dialog/message";
/// #if !BROWSER
import {ipcRenderer} from "electron";
/// #endif

export interface ISpellcheckContext {
    contextId: number;
    x: number;
    y: number;
    misspelledWord: string;
    dictionarySuggestions: string[];
}

interface IPendingSpellcheckRequest {
    key: string;
    resolve: (context: ISpellcheckContext | null | undefined) => void;
    timeout: number;
}

let pendingSpellcheckRequest: IPendingSpellcheckRequest;

const getPositionKey = (x: number, y: number) => `${Math.round(x)}:${Math.round(y)}`;

/// #if !BROWSER
ipcRenderer.on(Constants.SIYUAN_SPELLCHECK_CONTEXT, (event, context: ISpellcheckContext) => {
    if (!pendingSpellcheckRequest || pendingSpellcheckRequest.key !== getPositionKey(context.x, context.y)) {
        return;
    }
    window.clearTimeout(pendingSpellcheckRequest.timeout);
    const resolve = pendingSpellcheckRequest.resolve;
    pendingSpellcheckRequest = undefined;
    resolve(context);
});
/// #endif

export const requestSpellcheckContext = (x: number, y: number) => {
    /// #if BROWSER
    return Promise.resolve(undefined as ISpellcheckContext | null | undefined);
    /// #else
    if (pendingSpellcheckRequest) {
        window.clearTimeout(pendingSpellcheckRequest.timeout);
        pendingSpellcheckRequest.resolve(null);
    }
    return new Promise<ISpellcheckContext | null | undefined>((resolve) => {
        const key = getPositionKey(x, y);
        const timeout = window.setTimeout(() => {
            if (pendingSpellcheckRequest?.key !== key) {
                return;
            }
            pendingSpellcheckRequest = undefined;
            resolve(undefined);
        }, 100);
        pendingSpellcheckRequest = {
            key,
            resolve,
            timeout,
        };
        ipcRenderer.send(Constants.SIYUAN_SPELLCHECK_CONTEXT, {
            x,
            y,
            requestedAt: Date.now(),
        });
    });
    /// #endif
};

const preserveEditorFocus = (element: HTMLElement) => {
    element.addEventListener("mousedown", (event) => {
        event.preventDefault();
    });
};

const runSpellcheckAction = async (contextId: number, action: "replace" | "addToDictionary", suggestion?: string) => {
    /// #if BROWSER
    return false;
    /// #else
    return ipcRenderer.invoke(Constants.SIYUAN_SPELLCHECK_ACTION, {
        contextId,
        action,
        suggestion,
    });
    /// #endif
};

export const addSpellcheckMenuItems = (context?: ISpellcheckContext) => {
    if (!context?.misspelledWord) {
        return;
    }
    const fragment = document.createDocumentFragment();
    context.dictionarySuggestions.forEach((suggestion) => {
        fragment.append(new MenuItem({
            label: escapeHtml(suggestion),
            bind: preserveEditorFocus,
            click: () => {
                runSpellcheckAction(context.contextId, "replace", suggestion);
            },
        }).element);
    });
    fragment.append(new MenuItem({
        label: window.siyuan.languages.addToDictionary,
        bind: preserveEditorFocus,
        click: async () => {
            if (!await runSpellcheckAction(context.contextId, "addToDictionary")) {
                showMessage(window.siyuan.languages.addToDictionaryFailed, 0, "error");
            }
        },
    }).element);
    fragment.append(new MenuItem({
        type: "separator",
    }).element);
    window.siyuan.menus.menu.element.lastElementChild.prepend(fragment);
};
