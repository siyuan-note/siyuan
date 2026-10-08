import {Constants} from "../../constants";
import {canReferenceDailyNoteNotebook, getLastDailyNoteNotebookId} from "../../util/dailyNote";
import {parseDailyNoteDate} from "../../util/dailyNoteDate";
import {escapeHtml} from "../../util/escape";
import {isEncryptedBox} from "../../util/pathName";
import {selectDailyNoteNotebook} from "../../util/mount";
import {fetchPost} from "../../util/fetch";

const getNotebooks = (sourceID: string) => window.siyuan.notebooks.filter(notebook => !notebook.closed &&
    canReferenceDailyNoteNotebook(sourceID, notebook.id, isEncryptedBox(sourceID), isEncryptedBox(notebook.id)));

export const getDailyNoteHint = (key: string, protyle: IProtyle): IHintData | undefined => {
    if (window.siyuan.config.readonly || !["[[", "【【"].includes(protyle.hint.splitChar)) {
        return undefined;
    }
    const result = parseDailyNoteDate(key, window.siyuan.config.appearance.lang);
    if (!result) {
        return undefined;
    }
    if ("error" in result) {
        return {value: "", html: escapeHtml(window.siyuan.languages.dailyNoteDateInvalid)};
    }
    const notebooks = getNotebooks(protyle.notebookId);
    if (notebooks.length === 0) {
        return undefined;
    }
    const notebookID = getLastDailyNoteNotebookId(notebooks, window.siyuan.storage[Constants.LOCAL_DAILYNOTEID]);
    const notebook = notebooks.find(item => item.id === notebookID);
    return {
        value: `daily-note:${result.date}:${notebookID || ""}`,
        html: `<div class="b3-list-item__first"><svg class="b3-list-item__graphic"><use xlink:href="#iconCalendar"></use></svg><span class="b3-list-item__text">${escapeHtml(window.siyuan.languages.dailyNote)} <mark>${result.date}</mark></span></div><div class="b3-list-item__meta">${escapeHtml(notebook?.name || window.siyuan.languages.plsChoose)}</div>`,
    };
};

// 用户选中候选后才创建日记；候选生成不会改动工作区。
export const createDailyNoteReference = (protyle: IProtyle, date: string, notebookID: string,
                                        onCreated: (id: string, title: string) => void) => {
    const notebooks = getNotebooks(protyle.notebookId);
    const create = (notebook: string) => {
        if (!getNotebooks(protyle.notebookId).some(item => item.id === notebook)) {
            return;
        }
        fetchPost("/api/filetree/createDailyNote", {notebook, date, app: Constants.SIYUAN_APPID}, response => {
            if (response.code === 0 && response.data?.id) {
                const id = response.data.id;
                fetchPost("/api/block/getDocInfo", {id, notebook}, info => {
                    if (info.code === 0 && info.data) {
                        onCreated(id, info.data.name || info.data.ial?.title || date);
                    }
                });
            }
        });
    };
    if (notebookID && notebooks.some(item => item.id === notebookID)) {
        create(notebookID);
    } else if (notebooks.length > 0) {
        selectDailyNoteNotebook(notebooks, create);
    }
};
