// Electron 默认应用通过动态导入执行此入口，不使用 require.main 判断。
// 可复用测试只导入 harnessSupport.cjs，该模块导入时不会创建窗口。
const {app, BrowserWindow} = require("electron");
const {createHarness, createTemporaryProfile, verifyHarness} = require("./harnessSupport.cjs");

if (!app || !BrowserWindow) {
    console.error("Map webview prototype requires Electron GUI mode; check ELECTRON_RUN_AS_NODE.");
    process.exitCode = 1;
} else {
    let temporary;
    let remoteRequested = false;
    const fail = error => {
        console.error("Map webview prototype startup failed.");
        if (remoteRequested) console.error("Remote map webview verification: FAIL.");
        const codes = ["attachPreferenceMismatch", "hostAttachFailed", "hostDocumentLoadFailed", "hostDocumentMismatch",
            "hostRendererGone", "hostDestroyed", "hostBootstrapTimeout", "hostSDKTimeout", "documentCSPBlocked",
            "isolationAssertionFailed", "isolationCheckTimeout", "fixtureSetupFailed", "remoteOwnerPolicyFailed", "ownerClosed", "sdkUnavailable", "hostUnavailable",
            "sdkScriptLoadFailed", "sdkGlobalMissing", "mapCreationFailed", "mapReadyTimeout", "mapUnavailable"];
        if (codes.includes(error?.code)) {
            const prefKeys = ["sandbox", "contextIsolation", "webSecurity", "nodeIntegration", "nodeIntegrationInSubFrames",
                "nodeIntegrationInWorker", "webviewTag", "allowRunningInsecureContent", "experimentalFeatures", "disablePopups", "safeDialogs", "disableDialogs"];
            console.error("Boundary stage: " + error.code +
                (prefKeys.includes(error.preference) ? "; preference: " + error.preference : "") +
                (Number.isInteger(error.netError) && error.netError < 0 && error.netError > -1000 ? "; net error: " + error.netError : ""));
        }
        if (error?.code === "MAP_FIXTURE_ASSETS_MISSING") {
            console.error("Real mode requires existing app/stage/build/map assets. Run your normal development build first; this fixture does not build or substitute them.");
        }
        try {
            for (const win of BrowserWindow.getAllWindows()) if (!win.isDestroyed()) win.destroy();
        } finally {
            temporary?.cleanup();
            app.exit(1);
        }
    };
    try {
        console.info("Map webview prototype starting...");
        const flags = new Set(process.argv.slice(2));
        remoteRequested = flags.has("--remote");
        if ([...flags].some(flag => !["--real", "--synthetic", "--verify", "--remote"].includes(flag)) ||
            (flags.has("--real") && flags.has("--synthetic")) || (flags.has("--verify") && !flags.has("--synthetic"))) {
            throw new Error("Invalid fixture mode");
        }
        temporary = createTemporaryProfile();
        app.once("will-quit", temporary.cleanup);
        app.once("quit", temporary.cleanup);
        void createHarness({profile: temporary.profile, mode: flags.has("--synthetic") ? "synthetic" : "real",
            automate: flags.has("--verify"), ...(flags.has("--remote") && {kernelMode: "remote"})}).then(async harness => {
            console.info("Map webview prototype window ready.");
            if (flags.has("--verify")) {
                try { await verifyHarness(harness); }
                catch (failure) {
                    const error = new Error("Fixture verification failed");
                    error.code = failure?.code === "isolationCheckTimeout" ? "isolationCheckTimeout" : "isolationAssertionFailed";
                    throw error;
                }
                console.info("Map webview prototype verification passed.");
                await harness.destroy();
                app.exit(0);
            }
        }).catch(fail);
    } catch (error) {
        fail(error);
    }
}
