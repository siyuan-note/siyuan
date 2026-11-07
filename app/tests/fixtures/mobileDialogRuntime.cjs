const {readFileSync} = require("node:fs");
const path = require("node:path");
const {ModuleKind, ScriptTarget, transpileModule} = require("typescript");

const createRuntime = (sources, Dialog, mobile) => {
    const cache = {};
    const state = window.siyuan;
    state.config ||= {};
    state.languages ||= {};
    if (mobile) {
        state.mobile ||= {};
        state.mobile.size ||= {isLandscape: false, portrait: {height1: innerHeight}, landscape: {height1: innerHeight}};
    }
    const dependencies = {
        dialog: {Dialog}, "dialog/index": {Dialog},
        "util/functions": {isMobile: () => mobile},
        constants: {Constants: {TIMEOUT_OPENDIALOG: 0, TIMEOUT_DBLCLICK: 0, DIALOG_CONFIRM: "confirm"}},
        "protyle/util/compatibility": {isNotCtrl: () => true, isInMobileApp: () => mobile},
        "mobile/util/mobileAppUtil": {callMobileAppShowKeyboard() {}},
        "dialog/message": {showMessage: message => { throw new Error(message); }},
    };
    const load = name => {
        if (dependencies[name]) return dependencies[name];
        if (!cache[name]) {
            if (!sources[name]) throw new Error("Missing mobile dialog runtime module: " + name);
            cache[name] = {};
            const resolve = dependency => load(require("node:path").posix.normalize(
                require("node:path").posix.dirname(name) + "/" + dependency));
            new Function("require", "exports", sources[name])(resolve, cache[name]);
        }
        return cache[name];
    };
    return {...load("dialog/mobileDialog"), ...load("dialog/mobileInputDialog"), ...load("dialog/mobileConfirmDialog"),
        secondaryEditors: load("mobile/util/secondaryEditors"), pendingCardAction: load("card/pendingAction")};
};

exports.mobileDialogRuntimeSource = () => {
    const sources = {};
    for (const name of ["dialog/mobileDialog", "dialog/mobileInputDialog", "dialog/mobileConfirmDialog",
        "dialog/inputDialog", "dialog/confirmDialog", "mobile/util/bindBottomSheetDialog", "mobile/util/bindBottomSheetDrag",
        "mobile/util/mobileSheetLayout", "mobile/util/mobileSheetGesture", "mobile/util/keyboardSheetState", "mobile/util/visibleViewport", "mobile/util/orientation",
        "protyle/util/browserCompatibility", "menus/sheetOpen", "menus/sheetActions", "util/escape",
        "mobile/util/secondaryEditors", "protyle/util/editorSave", "card/pendingAction"]) {
        sources[name] = transpileModule(readFileSync(path.join(__dirname, "../../src", name + ".ts"), "utf8"), {
            compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
        }).outputText;
    }
    return `(${createRuntime.toString()})(${JSON.stringify(sources)}, Dialog, mobile)`;
};
