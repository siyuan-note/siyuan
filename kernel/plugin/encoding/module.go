package encoding

import "github.com/dop251/goja"

// Enable 把 TextEncoder 与 TextDecoder 构造函数挂到 runtime 的 globalThis，调用方式与 goja_nodejs 的 url、buffer、console
// 一致，失败时 panic。TextDecoder 的 fatal、ignoreBOM、stream 选项依赖 runtime 已设置能识别 json 或 js 标签的字段名映射。
func Enable(runtime *goja.Runtime) {
	if err := RegisterRuntime(runtime); err != nil {
		panic(err)
	}
}
