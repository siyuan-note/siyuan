// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

const path = require("node:path");

const MAP_WEBVIEW_PREFERENCES = Object.freeze({sandbox: true, contextIsolation: true, webSecurity: true,
    nodeIntegration: false, nodeIntegrationInSubFrames: false, nodeIntegrationInWorker: false,
    webviewTag: false, allowRunningInsecureContent: false, plugins: false, experimentalFeatures: false,
    navigateOnDragDrop: false, disablePopups: true, safeDialogs: true, disableDialogs: true, devTools: false,
    spellcheck: false, backgroundThrottling: false, autoplayPolicy: "user-gesture-required"});

const hardenMapWebviewPreferences = (preferences, session, partition) => {
    for (const name of Object.keys(preferences)) delete preferences[name];
    Object.assign(preferences, MAP_WEBVIEW_PREFERENCES, {session, partition,
        preload: path.join(__dirname, "mapHostPreload.js")});
};

const isMapWebviewAttachment = (params, host) => !!params && params.src === host.entryURL &&
    params.partition === host.partition && !["preload", "webpreferences", "nodeintegration", "nodeintegrationinsubframes",
        "disablewebsecurity", "allowpopups", "plugins", "blinkfeatures", "disableblinkfeatures", "useragent", "httpreferrer"]
        .some(name => !!params[name]);

// Electron 44 的回读只包括安全偏好子集，不包括 preload、partition 等构造参数。
const reportedPreferences = ["sandbox", "contextIsolation", "webSecurity", "nodeIntegration",
    "nodeIntegrationInSubFrames", "nodeIntegrationInWorker", "webviewTag", "allowRunningInsecureContent",
    "experimentalFeatures", "disablePopups", "safeDialogs", "disableDialogs"];
const getMapWebviewPreferenceMismatch = actual => reportedPreferences.find(name => actual?.[name] !== MAP_WEBVIEW_PREFERENCES[name]);

module.exports = {MAP_WEBVIEW_PREFERENCES, hardenMapWebviewPreferences, isMapWebviewAttachment, getMapWebviewPreferenceMismatch};
