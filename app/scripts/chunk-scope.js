const prefix = "(()=>{\n";
const suffix = "\n})();\n";

class ChunkScopePlugin {
    apply(compiler) {
        if (!compiler.options.optimization.minimize) return;
        const {Compilation, sources} = compiler.webpack;
        compiler.hooks.thisCompilation.tap("ChunkScopePlugin", compilation => {
            // 分块的下载地址使用 chunkhash，包裹方式需要参与缓存键计算。
            compilation.hooks.chunkHash.tap("ChunkScopePlugin", (chunk, hash) => {
                if (chunk.hasRuntime()) return;
                hash.update(prefix);
                hash.update(suffix);
            });
            compilation.hooks.processAssets.tap(
                {
                    name: "ChunkScopePlugin",
                    // 压缩后隔离分块的辅助函数，由后续阶段按包裹后的内容生成源映射。
                    stage: Compilation.PROCESS_ASSETS_STAGE_OPTIMIZE_SIZE + 1,
                },
                () => {
                    for (const chunk of compilation.chunks) {
                        if (chunk.hasRuntime()) continue;
                        for (const file of chunk.files) {
                            if (!file.endsWith(".js")) continue;
                            const asset = compilation.getAsset(file);
                            if (!asset || asset.info.hotModuleReplacement) continue;
                            compilation.updateAsset(file, new sources.ConcatSource(prefix, asset.source, suffix));
                        }
                    }
                },
            );
        });
    }
}

module.exports = ChunkScopePlugin;
