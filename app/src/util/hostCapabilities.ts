export type TKernelConnection = {
    kernelMode: "local" | "remote";
    ownsKernel: boolean;
    kernelOrigin: string;
};

export type THostCapabilities = {
    remoteKernel: boolean;
    ownsKernel: boolean;
    localFileSystem: boolean;
    importExport: boolean;
    plugins: boolean;
    workspaces: boolean;
    customAppearance: boolean;
    widgets: boolean;
    oidcAuthentication: boolean;
};

const hasRemoteQuery = (search: string) => new URLSearchParams(search).get("remote") === "1";

export const hasRemoteArgument = (args: readonly string[]) => args.some((arg) =>
    arg === "--remote" || arg.startsWith("--remote="));

export const detectRemoteKernel = (search: string, args: readonly string[]) =>
    hasRemoteQuery(search) || hasRemoteArgument(args);

export const resolveRemoteKernel = (connection: TKernelConnection | undefined, search: string, args: readonly string[]) =>
    connection ? connection.kernelMode === "remote" : detectRemoteKernel(search, args);

const getProcessArgs = () => {
    /// #if !BROWSER
    return process.argv;
    /// #else
    return [];
    /// #endif
};

let hostConnection: TKernelConnection | undefined;

export const setHostConnection = (connection: TKernelConnection | undefined) => {
    if (!connection || !["local", "remote"].includes(connection.kernelMode)) {
        return;
    }
    hostConnection = connection;
};

export const isRemoteKernel = () => resolveRemoteKernel(hostConnection, window.location.search, getProcessArgs());

export const getHostCapabilities = (): THostCapabilities => {
    const remoteKernel = isRemoteKernel();
    const ownsKernel = !remoteKernel && hostConnection?.ownsKernel !== false;
    return {
        remoteKernel,
        ownsKernel,
        localFileSystem: !remoteKernel,
        importExport: !remoteKernel,
        plugins: !remoteKernel,
        workspaces: !remoteKernel,
        customAppearance: !remoteKernel,
        widgets: !remoteKernel,
        oidcAuthentication: !remoteKernel,
    };
};

export const appendRemoteQuery = (url: URL) => {
    if (isRemoteKernel()) {
        url.searchParams.set("remote", "1");
    }
    return url;
};

export const isExternalURLAllowed = (
    url: string,
    remoteKernel: boolean,
) => {
    if (!remoteKernel) {
        return true;
    }
    try {
        const parsed = new URL(url);
        return parsed.protocol === "http:" || parsed.protocol === "https:";
    } catch {
        return false;
    }
};

export const canOpenExternalURL = (url: string) =>
    isExternalURLAllowed(url, isRemoteKernel());

export const sanitizeKernelHTML = (html: string) => {
    if (!isRemoteKernel()) {
        return html;
    }
    return window.DOMPurify.sanitize(String(html ?? ""));
};
