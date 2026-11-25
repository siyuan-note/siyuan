// 压缩器会把私有字段等语法降级所需的辅助函数提升到分块顶层。注册型分块没有函数作用域，
// 这些辅助名（例如 fs）会直接成为全局变量，覆盖页面里已有的同名全局。
class ChunkScopePlugin {
    apply(compiler) {
        // 开发构建不压缩，也就不会生成提升到顶层的辅助函数。
        if (!compiler.options.optimization.minimize) return;
        const {Compilation, sources} = compiler.webpack;
        compiler.hooks.thisCompilation.tap("ChunkScopePlugin", compilation => {
            compilation.hooks.processAssets.tap(
                {
                    name: "ChunkScopePlugin",
                    // 必须晚于压缩阶段：先包裹会被压缩器把辅助函数移到包裹之外，包裹等于没做。
                    stage: Compilation.PROCESS_ASSETS_STAGE_OPTIMIZE_INLINE,
                },
                () => {
                    for (const chunk of compilation.chunks) {
                        // 带运行时的分块自身已经是函数作用域。
                        if (chunk.hasRuntime()) continue;
                        for (const file of chunk.files) {
                            if (!file.endsWith(".js")) continue;
                            const asset = compilation.getAsset(file);
                            if (!asset || asset.info.hotModuleReplacement) continue;
                            const {source} = asset;
                            const value = source.source();
                            const text = typeof value === "string" ? value : value.toString();
                            const wrapped = `(()=>{\n${text}\n})();\n`;
                            const originalMap = typeof source.sourceAndMap === "function" ? source.sourceAndMap().map : null;
                            if (originalMap) {
                                // 前置一行使原有行号整体下移一行，尾部追加不影响映射。
                                const map = {...originalMap, mappings: ";" + originalMap.mappings};
                                compilation.updateAsset(file,
                                    new sources.SourceMapSource(wrapped, file, map, text, map));
                            } else {
                                compilation.updateAsset(file, new sources.RawSource(wrapped));
                            }
                            // 调试构建的映射是独立资产，同样要随包裹下移一行。
                            const mapAsset = compilation.getAsset(file + ".map");
                            if (mapAsset) {
                                const map = JSON.parse(mapAsset.source.source().toString());
                                map.mappings = ";" + map.mappings;
                                compilation.updateAsset(file + ".map", new sources.RawSource(JSON.stringify(map)));
                            }
                        }
                    }
                },
            );
        });
    }
}

module.exports = ChunkScopePlugin;
