import {Constants} from "../../constants";
import {canReferenceDailyNoteNotebook, getLastDailyNoteNotebookId} from "../../util/dailyNote";
import {parseDailyNoteDate} from "../../util/dailyNoteDate";
import {escapeAttr, escapeHtml} from "../../util/escape";
import {isEncryptedBox} from "../../util/pathName";
import {selectDailyNoteNotebook} from "../../util/mount";
import {fetchPost, fetchSyncPost} from "../../util/fetch";
import {setStorageVal} from "../util/compatibility";

const getNotebooks = (sourceID: string) => window.siyuan.notebooks.filter(notebook => !notebook.closed &&
    canReferenceDailyNoteNotebook(sourceID, notebook.id, isEncryptedBox(sourceID), isEncryptedBox(notebook.id)));

export const getDailyNoteHints = async (key: string, protyle: IProtyle): Promise<IHintData[]> => {
    if (window.siyuan.config.readonly || !["[[", "【【"].includes(protyle.hint.splitChar)) {
        return [];
    }
    const result = parseDailyNoteDate(key, window.siyuan.config.appearance.lang);
    if (!result || "error" in result) {
        return [];
    }
    const notebooks = getNotebooks(protyle.notebookId);
    if (notebooks.length === 0) {
        return [];
    }
    const notebookID = getLastDailyNoteNotebookId(notebooks, window.siyuan.storage[Constants.LOCAL_DAILYNOTEID]);
    const targets = notebookID ? notebooks.filter(item => item.id === notebookID) : notebooks;
    const hints = await Promise.all(targets.map(async notebook => {
        const response = await fetchSyncPost("/api/filetree/getDailyNoteInfo", {notebook: notebook.id, date: result.date});
        if (response.code !== 0 || !response.data) {
            return undefined;
        }
        const info = response.data;
        const icon = info.existed ? "iconCalendar" : "iconCalendarPlus";
        const preview = info.existed ? ` data-id="${escapeAttr(info.id)}"` : "";
        const label = info.existed ? window.siyuan.languages.dailyNote : window.siyuan.languages.fileTree11;
        return {
            value: `daily-note:${result.date}:${notebook.id}`,
            html: `<div class="b3-list-item__first"><svg class="b3-list-item__graphic${info.existed ? " popover__block" : ""}"${preview}><use xlink:href="#${icon}"></use></svg><span class="b3-list-item__text">${escapeHtml(label)} <mark>${escapeHtml(info.title)}</mark></span><span class="b3-menu__accelerator">${result.date}</span></div><div class="b3-list-item__meta">${escapeHtml(notebook.name + info.hPath)}</div>`,
        };
    }));
    return hints.filter((hint): hint is IHintData => !!hint);
};

// 用户选中候选后才创建日记；候选生成不会改动工作区。
export const createDailyNoteReference = (protyle: IProtyle, date: string, notebookID: string,
                                        onCreated: (id: string, title: string) => void) => {
    const notebooks = getNotebooks(protyle.notebookId);
    const create = (notebook: string) => {
        if (!getNotebooks(protyle.notebookId).some(item => item.id === notebook)) {
            return;
        }
        window.siyuan.storage[Constants.LOCAL_DAILYNOTEID] = notebook;
        setStorageVal(Constants.LOCAL_DAILYNOTEID, notebook);
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
