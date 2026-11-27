import {installStartupError} from "./startupError";
import "../assets/scss/startup.scss";

declare const SIYUAN_VERSION: string;

/// #if BROWSER
installStartupError(window, SIYUAN_VERSION);
/// #else
installStartupError(window, SIYUAN_VERSION, undefined, () => window.close());
/// #endif
