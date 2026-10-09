// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

const {contextBridge, ipcRenderer} = require("electron");

// 预载脚本不暴露 IPC 方法、Node 对象、文件路径或导航能力。
if (process.isMainFrame) {
    contextBridge.exposeInMainWorld("siyuanMapDesktop", Object.freeze({version: 1}));
    ipcRenderer.once("siyuan-map-port", (event, data) => {
        if (data?.version !== 1 || !/^[a-f0-9]{48}$/.test(data.instanceID || "") ||
            !/^[a-f0-9]{48}$/.test(data.nonce || "") || event.ports.length !== 1 ||
            !["openfreemap", "amap", "tencent", "baidu"].includes(data.provider)) {
            event.ports.forEach(port => port.close());
            return;
        }
        window.postMessage({type: "siyuan-map-desktop-connect", version: 1, instanceID: data.instanceID,
            nonce: data.nonce, provider: data.provider}, "*", [event.ports[0]]);
    });
    ipcRenderer.on("siyuan-map-viewport", (_event, data) => {
        const map = document.getElementById("map");
        const size = data?.logicalSize;
        const crop = data?.crop;
        if (!map || !size || !crop || ![size.width, size.height, crop.x, crop.y]
            .every(value => Number.isFinite(value) && value >= 0 && value <= 32768)) return;
        map.style.width = size.width + "px";
        map.style.height = size.height + "px";
        map.style.transform = "translate(" + -crop.x + "px," + -crop.y + "px)";
    });
}
