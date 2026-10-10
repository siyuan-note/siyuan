// Electron's default app imports this entry as a module; require.main is not this file.
// Reusable tests import harnessSupport.cjs instead of this explicit manual entry.
const {app, BrowserWindow} = require("electron");
const {createHarness, createTemporaryProfile} = require("./harnessSupport.cjs");

if (!app || !BrowserWindow) {
    console.error("Map overlay prototype requires Electron GUI mode; check ELECTRON_RUN_AS_NODE.");
    process.exitCode = 1;
} else {
    let temporary;
    const fail = () => {
        console.error("Map overlay prototype startup failed.");
        try {
            for (const win of BrowserWindow.getAllWindows()) {
                if (!win.isDestroyed()) win.destroy();
            }
        } finally {
            temporary?.cleanup();
            app.exit(1);
        }
    };
    try {
        console.info("Map overlay prototype starting...");
        temporary = createTemporaryProfile();
        app.once("will-quit", temporary.cleanup);
        app.once("quit", temporary.cleanup);
        void createHarness({profile: temporary.profile}).then(() => {
            console.info("Map overlay prototype window ready.");
        }).catch(fail);
    } catch (_error) {
        fail();
    }
}
