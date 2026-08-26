interface IWindowPluginKernel {
    kernel?: {
        destroy: () => Promise<void> | void;
    };
}

export const destroyWindowPluginKernels = (plugins: IWindowPluginKernel[], onError: (error: unknown) => void) => {
    plugins.forEach(plugin => {
        try {
            void Promise.resolve(plugin.kernel?.destroy()).catch(onError);
        } catch (error) {
            onError(error);
        }
    });
};
