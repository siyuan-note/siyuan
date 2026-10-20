// Clean the first output normally, then retain assets used by already-open windows.
class PreserveWatchAssetsPlugin {
    apply(compiler) {
        if (compiler.options.mode === "production") return;
        let emitted = false;
        compiler.hooks.thisCompilation.tap("PreserveWatchAssetsPlugin", compilation => {
            compiler.webpack.CleanPlugin.getCompilationHooks(compilation).keep.tap(
                "PreserveWatchAssetsPlugin", () => emitted ? true : undefined,
            );
        });
        compiler.hooks.afterEmit.tap("PreserveWatchAssetsPlugin", () => {
            emitted = true;
        });
    }
}

module.exports = PreserveWatchAssetsPlugin;
