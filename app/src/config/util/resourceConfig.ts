import {fetchPost, fetchSyncPost} from "../../util/fetch";
import type {APICallbackResponse, APIPOSTRoutes} from "../../types/api";
import {ContractFormData} from "../../util/contractFormData";
import {exitSiYuan} from "../../dialog/processSystem";
import {showMessage} from "../../dialog/message";
import {runSettingsMaintenance} from "../setting/maintenance";
/// #if !MOBILE
import {exportLayout} from "../../layout/util";
/// #endif

const layoutEndpoint = "/api/system/setUILayout";
const notebookEndpoint = "/api/notebook/setNotebookConf";
type NotebookRequest = APIPOSTRoutes[typeof notebookEndpoint]["request"];
type NotebookResponse = APICallbackResponse<APIPOSTRoutes[typeof notebookEndpoint]["response"]>;
type LayoutRequest = APIPOSTRoutes[typeof layoutEndpoint]["request"];
type LayoutResponse = APICallbackResponse<APIPOSTRoutes[typeof layoutEndpoint]["response"]>;

// 独立资源保留专用协议，统一请求构造，并沿用回调与同步调用各自的失败处理。
export const switchWorkspace = (path: string, onApplied = () => { void exitSiYuan(false); }) =>
    fetchPost("/api/system/setWorkspaceDir", {path}, onApplied);

export const saveUILayout = (layout: LayoutRequest["layout"], errorExit?: boolean,
                             onApplied?: (response: LayoutResponse) => void) => {
    // errorExit 仅供前端处理退出失败，不属于内核配置字段。
    const request: LayoutRequest & {errorExit?: boolean} = {layout, errorExit};
    return fetchPost(layoutEndpoint, request, onApplied);
};

export const resetUILayout = () => fetchSyncPost(layoutEndpoint, {layout: {}});

export const saveNotebookConf = (notebook: string, conf: NotebookRequest["conf"],
                                 onApplied?: (response: NotebookResponse) => void) =>
    fetchPost(notebookEndpoint, {notebook, conf}, onApplied);

export const saveNotebookConfSync = (notebook: string, conf: NotebookRequest["conf"]) =>
    fetchSyncPost(notebookEndpoint, {notebook, conf});

export const removeSearchCriterion = (name: string) => fetchPost("/api/storage/removeCriterion", {name});

export const saveOutlineState = (docID: string, expandIds: string[]) =>
    fetchPost("/api/storage/setOutlineStorage", {docID, val: {expandIds}});

// 配置导入共用成功通知和重启流程，设置窗口可在导入前完成维护任务准备。
export const importConfiguration = (file: File, prepareMaintenance = false) => {
    const importFile = () => fetchPost("/api/system/importConf", new ContractFormData({file: [file]}), (response) => {
        if (response.code !== 0) {
            showMessage(response.msg);
            return;
        }
        showMessage(window.siyuan.languages.imported);
        /// #if MOBILE
        void exitSiYuan();
        /// #else
        void exportLayout({errorExit: true, cb: exitSiYuan});
        /// #endif
    });
    return prepareMaintenance ? runSettingsMaintenance(importFile) : importFile();
};
