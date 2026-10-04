// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.

package plugin

import (
	"bytes"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/dop251/goja"
	"github.com/dop251/goja_nodejs/eventloop"
	"github.com/dop251/goja_nodejs/require"
	"github.com/siyuan-note/siyuan/kernel/model"
)

const requireTestSecret = "require-test-secret"

// newRequireTestPlugin 构造 require 测试用插件，脚本名与 NewKernelPlugin 的约定一致。
func newRequireTestPlugin(pluginsDir, name string) *KernelPlugin {
	return &KernelPlugin{
		Petal:     &model.Petal{Name: name},
		file:      fmt.Sprintf("%s/kernel.js", name),
		pluginDir: filepath.Join(pluginsDir, name),
	}
}

// writeRequireTestFiles 按斜杠分隔的相对路径在 dir 下写入文件。
func writeRequireTestFiles(t *testing.T, dir string, files map[string]string) {
	t.Helper()
	for name, content := range files {
		path := filepath.Join(dir, filepath.FromSlash(name))
		if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(content), 0644); err != nil {
			t.Fatal(err)
		}
	}
}

// requireFromKernelJS 按 InitRuntime 的方式创建事件循环并启用扩展模块，再在 kernel.js 的脚本名下调用 require，
// 返回 "ok:" 加导出值的 JSON，或 "error:" 加捕获到的异常。
func requireFromKernelJS(t *testing.T, p *KernelPlugin, specifier string) string {
	t.Helper()

	var result string
	var runErr error
	loop := eventloop.NewEventLoop(eventloop.EnableConsole(true))
	loop.Run(func(rt *goja.Runtime) {
		if runErr = EnableExtendModules(p, rt); runErr != nil {
			return
		}
		if runErr = rt.Set("specifier", specifier); runErr != nil {
			return
		}
		var value goja.Value
		value, runErr = rt.RunScript(p.file, `(() => {
			try {
				return "ok:" + JSON.stringify(require(specifier));
			} catch (e) {
				return "error:" + e;
			}
		})()`)
		if runErr == nil {
			result = value.String()
		}
	})
	if runErr != nil {
		t.Fatalf("require(%q): %v", specifier, runErr)
	}
	return result
}

func TestPluginRequireLoadsFromPluginDir(t *testing.T) {
	root := t.TempDir()
	pluginsDir := filepath.Join(root, "plugins")
	p := newRequireTestPlugin(pluginsDir, "test-require")
	writeRequireTestFiles(t, p.pluginDir, map[string]string{
		"index.js":                      `module.exports = "root-index";`,
		"lib/a.js":                      `module.exports = "a+" + require("./b");`,
		"lib/b.js":                      `module.exports = "b";`,
		"lib/sub/index.js":              `module.exports = "sub-index";`,
		"data.json":                     `{"value": "inside"}`,
		"node_modules/dep/package.json": `{"main": "main.js"}`,
		"node_modules/dep/main.js":      `module.exports = "dep";`,
	})

	for _, tt := range []struct {
		name      string
		specifier string
		want      string
	}{
		{"relative file with nested extensionless require", "./lib/a.js", `ok:"a+b"`},
		{"directory index", "./lib/sub", `ok:"sub-index"`},
		// 解析插件目录本身时会先尝试插件目录外的同名 .js/.json，这些候选必须按不存在处理才能继续解析
		{"plugin directory as a module", "./", `ok:"root-index"`},
		{"json file", "./data.json", `ok:{"value":"inside"}`},
		{"node_modules inside the plugin directory", "dep", `ok:"dep"`},
	} {
		t.Run(tt.name, func(t *testing.T) {
			if got := requireFromKernelJS(t, p, tt.specifier); got != tt.want {
				t.Fatalf("require(%q) = %s, want %s", tt.specifier, got, tt.want)
			}
		})
	}

	t.Run("symlink pointing outside the plugin directory", func(t *testing.T) {
		outside := filepath.Join(root, "outside.json")
		writeRequireTestFiles(t, root, map[string]string{"outside.json": fmt.Sprintf(`{"secret": %q}`, requireTestSecret)})
		if err := os.Symlink(outside, filepath.Join(p.pluginDir, "escape.json")); err != nil {
			// Windows 未开启开发者模式时创建符号链接需要特权
			t.Skipf("symlink is unavailable: %s", err)
		}
		got := requireFromKernelJS(t, p, "./escape.json")
		if !strings.HasPrefix(got, "error:") || strings.Contains(got, requireTestSecret) {
			t.Fatalf("require followed a symlink outside the plugin directory: %s", got)
		}
	})

	t.Run("plugin directory is a symlink", func(t *testing.T) {
		target := filepath.Join(root, "dev", "linked-plugin")
		writeRequireTestFiles(t, target, map[string]string{"lib/b.js": `module.exports = "linked";`})
		linked := newRequireTestPlugin(pluginsDir, "test-require-linked")
		if err := os.Symlink(target, linked.pluginDir); err != nil {
			t.Skipf("symlink is unavailable: %s", err)
		}
		if got := requireFromKernelJS(t, linked, "./lib/b.js"); got != `ok:"linked"` {
			t.Fatalf("require from a symlinked plugin directory = %s", got)
		}
	})
}

func TestPluginRequireRejectsPathsOutsidePluginDir(t *testing.T) {
	root := t.TempDir()
	pluginsDir := filepath.Join(root, "plugins")
	p := newRequireTestPlugin(pluginsDir, "test-require")
	secretJSON := fmt.Sprintf(`{"secret": %q}`, requireTestSecret)
	writeRequireTestFiles(t, root, map[string]string{
		"outside.json":                           secretJSON,
		"plugins/test-require/kernel.js":         "",
		"plugins/test-require-other/secret.json": secretJSON,
		"plugins/node_modules/hoisted/index.js":  fmt.Sprintf(`module.exports = %q;`, requireTestSecret),
	})
	// 工作目录切到插件根目录后，不受限的加载器能按相对路径读到同级插件与上级 node_modules，用例因此能发现限制失效
	t.Chdir(pluginsDir)

	for _, tt := range []struct {
		name      string
		specifier string
	}{
		{"absolute path", filepath.ToSlash(filepath.Join(root, "outside.json"))},
		{"relative traversal", "../../outside.json"},
		{"sibling plugin sharing the name prefix", "../test-require-other/secret.json"},
		{"node_modules above the plugin directory", "hoisted"},
	} {
		t.Run(tt.name, func(t *testing.T) {
			got := requireFromKernelJS(t, p, tt.specifier)
			if strings.Contains(got, requireTestSecret) {
				t.Fatalf("require(%q) loaded a file outside the plugin directory: %s", tt.specifier, got)
			}
			// 插件目录外的文件与不存在的模块无法区分
			if !strings.HasPrefix(got, "error:") || !strings.Contains(got, require.InvalidModuleError.Error()) {
				t.Fatalf("require(%q) = %s, want %q", tt.specifier, got, require.InvalidModuleError)
			}
		})
	}
}

func TestEnableExtendModulesInstallsTextEncoderAndDecoder(t *testing.T) {
	p := &KernelPlugin{Petal: &model.Petal{Name: "test-text-encoding"}}

	var got string
	var runErr error
	loop := eventloop.NewEventLoop(eventloop.EnableConsole(true))
	loop.Run(func(rt *goja.Runtime) {
		// 与 InitRuntime 一致先设置字段名映射，TextDecoder 依赖它读取 fatal 等选项
		rt.SetFieldNameMapper(goja.TagFieldNameMapper("json", true))
		if runErr = EnableExtendModules(p, rt); runErr != nil {
			return
		}
		var value goja.Value
		value, runErr = rt.RunString(`(() => {
			const bytes = new TextEncoder().encode("思源 ✓");
			const fatal = new TextDecoder("utf-8", {fatal: true});
			let threw = false;
			try {
				fatal.decode(new Uint8Array([0xff]));
			} catch (e) {
				threw = e instanceof TypeError;
			}
			return [new TextDecoder().decode(bytes), bytes.length, fatal.fatal, threw].join(",");
		})()`)
		if runErr == nil {
			got = value.String()
		}
	})
	if runErr != nil {
		t.Fatalf("run script: %v", runErr)
	}
	if want := "思源 ✓,10,true,true"; got != want {
		t.Fatalf("TextEncoder/TextDecoder = %s, want %s", got, want)
	}
}

// dataObjectTestRuntime 是在事件循环上执行脚本的辅助对象，与 kernel/plugin/formdata 测试中的 formDataTestRuntime
// 同构：其他包的测试文件对本包不可见，因此复制一份。
type dataObjectTestRuntime struct {
	t    *testing.T
	loop *eventloop.EventLoop
}

// withRuntime 在事件循环上同步执行 fn。fn 运行在事件循环的 goroutine 上，不能调用 t.Fatal。
func (r *dataObjectTestRuntime) withRuntime(fn func(rt *goja.Runtime)) {
	r.t.Helper()

	done := make(chan struct{})
	r.loop.RunOnLoop(func(rt *goja.Runtime) {
		defer close(done)
		fn(rt)
	})
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		r.t.Fatal("timed out waiting for the event loop")
	}
}

// await 执行一段返回 Promise 的脚本，等待其完成后返回结果的字符串形式；被拒绝时以 "rejected:" 开头。
func (r *dataObjectTestRuntime) await(script string) string {
	r.t.Helper()

	result := make(chan string, 1)
	var err error
	r.withRuntime(func(rt *goja.Runtime) {
		var value goja.Value
		if value, err = rt.RunString(script); err != nil {
			return
		}
		promise := value.ToObject(rt)
		then, ok := goja.AssertFunction(promise.Get("then"))
		if !ok {
			err = fmt.Errorf("script did not return a promise")
			return
		}
		_, err = then(promise, rt.ToValue(func(call goja.FunctionCall) goja.Value {
			result <- call.Argument(0).String()
			return goja.Undefined()
		}), rt.ToValue(func(call goja.FunctionCall) goja.Value {
			result <- "rejected:" + call.Argument(0).String()
			return goja.Undefined()
		}))
	})
	if err != nil {
		r.t.Fatalf("script failed: %v\n%s", err, script)
	}

	select {
	case got := <-result:
		return got
	case <-time.After(5 * time.Second):
		r.t.Fatalf("timed out waiting for:\n%s", script)
		return ""
	}
}

// newDataObjectTestPlugin 按 InitRuntime 的方式启用扩展模块，返回事件循环已启动的测试插件，以及在其 runtime 中执行
// 脚本的辅助对象。
func newDataObjectTestPlugin(t *testing.T) (*KernelPlugin, *dataObjectTestRuntime) {
	t.Helper()

	loop := eventloop.NewEventLoop(eventloop.EnableConsole(true))
	loop.Start()
	t.Cleanup(func() { loop.Stop() })

	p := &KernelPlugin{Petal: &model.Petal{Name: "test-data-object"}}
	p.worker.Start(loop)
	r := &dataObjectTestRuntime{t: t, loop: loop}
	var err error
	r.withRuntime(func(rt *goja.Runtime) {
		rt.SetFieldNameMapper(goja.TagFieldNameMapper("json", true))
		err = EnableExtendModules(p, rt)
	})
	if err != nil {
		t.Fatalf("EnableExtendModules: %v", err)
	}
	return p, r
}

// setDataObjects 为 contentTypes 的每个键创建内容为 data 副本的数据对象，挂到同名全局变量。
func setDataObjects(t *testing.T, p *KernelPlugin, r *dataObjectTestRuntime, data []byte, contentTypes map[string]string) {
	t.Helper()

	var err error
	r.withRuntime(func(rt *goja.Runtime) {
		for name, contentType := range contentTypes {
			var object *goja.Object
			if object, err = NewDataObject(p, rt, bytes.Clone(data), contentType); err != nil {
				return
			}
			if err = rt.Set(name, object); err != nil {
				return
			}
		}
	})
	if err != nil {
		t.Fatalf("create data objects: %v", err)
	}
}

func TestDataObjectBytesAndBlob(t *testing.T) {
	p, r := newDataObjectTestPlugin(t)
	setDataObjects(t, p, r, []byte("hi\x00\xff"), map[string]string{
		"typed":   "Text/Plain; Charset=UTF-8",
		"untyped": "",
		"invalid": "text/plain; name=\u00e9",
	})

	got := r.await(`(async () => {
		const bytes = await typed.bytes();
		const blob = await typed.blob();
		const bytesBefore = Array.from(bytes);
		// arrayBuffer() 与 bytes() 的结果和数据对象共享内存，改写其中一个会反映到另一个，但不影响此前由 blob() 复制出的 Blob。
		new Uint8Array(await typed.arrayBuffer()).fill(0);
		return JSON.stringify([
			Object.getPrototypeOf(bytes) === Uint8Array.prototype, bytesBefore, Array.from(bytes),
			Object.getPrototypeOf(blob) === Blob.prototype, blob.type, blob.size, Array.from(await blob.bytes()),
			(await untyped.blob()).type, (await invalid.blob()).type,
		]);
	})()`)
	want := `[true,[104,105,0,255],[0,0,0,0],true,"text/plain; charset=utf-8",4,[104,105,0,255],"",""]`
	if got != want {
		t.Fatalf("bytes() and blob() = %s, want %s", got, want)
	}
}

func TestDataObjectIgnoresReplacedGlobals(t *testing.T) {
	p, r := newDataObjectTestPlugin(t)
	setDataObjects(t, p, r, []byte("x"), map[string]string{"data": ""})

	got := r.await(`(async () => {
		const OriginalBlob = Blob;
		const OriginalUint8Array = Uint8Array;
		globalThis.Blob = class {};
		globalThis.Uint8Array = class {};
		return JSON.stringify([
			(await data.blob()) instanceof OriginalBlob,
			(await data.bytes()) instanceof OriginalUint8Array,
		]);
	})()`)
	if want := `[true,true]`; got != want {
		t.Fatalf("results after replacing globals = %s, want %s", got, want)
	}
}

func TestRequestDataObjectsUseContentTypes(t *testing.T) {
	p, r := newDataObjectTestPlugin(t)
	body := []byte(`{"a":1}`)
	typedFile := []byte("hello")
	untypedFile := []byte("x")
	requests := map[string]*Request{
		"bodyRequest": {Request: RequestContent{
			Headers: map[string][]string{"Content-Type": {"Application/JSON; Charset=UTF-8"}},
			Body:    RequestBody{Data: &body},
		}},
		"formRequest": {Request: RequestContent{
			Headers: map[string][]string{"Content-Type": {"multipart/form-data; boundary=x"}},
			Body: RequestBody{Form: &RequestForm{File: map[string][]*RequestFile{"file": {
				{Headers: map[string][]string{"Content-Type": {"Text/Plain"}}, Data: &typedFile},
				{Headers: map[string][]string{}, Data: &untypedFile},
			}}}},
		}},
	}

	var err error
	r.withRuntime(func(rt *goja.Runtime) {
		for name, request := range requests {
			var value goja.Value
			if value, err = requestGoToJs(p, rt, request); err != nil {
				return
			}
			if err = rt.Set(name, value); err != nil {
				return
			}
		}
	})
	if err != nil {
		t.Fatalf("convert requests: %v", err)
	}

	// 请求体使用请求的 Content-Type；表单文件使用各自分段的 Content-Type，分段没有 Content-Type 时为空串。
	got := r.await(`(async () => {
		const files = formRequest.request.body.form.files.file;
		const blobs = [
			await bodyRequest.request.body.data.blob(),
			await files[0].data.blob(),
			await files[1].data.blob(),
		];
		return JSON.stringify(await Promise.all(blobs.map(async (blob) => [blob.type, await blob.text()])));
	})()`)
	want := `[["application/json; charset=utf-8","{\"a\":1}"],["text/plain","hello"],["","x"]]`
	if got != want {
		t.Fatalf("request blobs = %s, want %s", got, want)
	}
}
