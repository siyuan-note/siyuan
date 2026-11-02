// `siyuan-get` 的连接命令：连接历史、当前内核连接信息与远程导出文件的落地保存。
import * as electron from "electron";
import * as path from "node:path";
import {paths, writeLog} from "../shared/runtime";
import {errorMessage} from "../shared/errors";
import {beginRemoteExport, endRemoteExport, saveRemoteExport} from "../remote/remoteExport";
import {readConnections} from "../remote/connectionStore";
import {getKernelConnection} from "../remote/remoteKernel";
import type {BrowserWindow} from "electron";
import type {GetHandler} from "./getContract";

const remoteConnections: GetHandler = ({kernelTarget, isMainFrame}) => {
    if (!kernelTarget || !isMainFrame) {
        return [];
    }
    try {
        return readConnections(path.join(paths.confDir, "connections.json")).origins;
    } catch (error) {
        writeLog("read connection history failed: " + errorMessage(error));
        return [];
    }
};

const kernelConnection: GetHandler = ({kernelTarget}) => getKernelConnection(kernelTarget);

const saveRemoteExportHandler: GetHandler = async ({event, data, kernelTarget, isMainFrame, initialized}) => {
    if (!kernelTarget || !initialized || !isMainFrame || kernelTarget.mode !== "remote") {
        return {status: "error"};
    }
    if (!beginRemoteExport(event.sender)) {
        return {status: "error"};
    }
    const controller = new AbortController();
    const abort = () => controller.abort();
    event.sender.once("destroyed", abort);
    try {
        return await saveRemoteExport({
            uri: data.uri as string,
            origin: kernelTarget.origin,
            choosePath: (defaultPath: string) => electron.dialog.showSaveDialog(
                electron.BrowserWindow.fromWebContents(event.sender) as BrowserWindow,
                {defaultPath, properties: ["showOverwriteConfirmation"]}),
            fetch: (url: string, options: Record<string, unknown>) => event.sender.session.fetch(url, options),
            signal: controller.signal,
        });
    } catch (error) {
        writeLog("save remote export failed: " + errorMessage(error));
        return {status: "error"};
    } finally {
        event.sender.removeListener("destroyed", abort);
        endRemoteExport(event.sender);
    }
};

const connectionHandlers: Record<string, GetHandler> = {
    "remoteConnections": remoteConnections,
    "kernelConnection": kernelConnection,
    "saveRemoteExport": saveRemoteExportHandler,
};

export {connectionHandlers};
