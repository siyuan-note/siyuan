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
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

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

// newDataObjectTestPlugin 按 InitRuntime 的方式启用扩展模块，返回事件循环已启动的测试插件，以及在其 runtime 中执行
// 脚本的辅助对象。
func newDataObjectTestPlugin(t *testing.T) (*KernelPlugin, *formDataTestRuntime) {
	t.Helper()

	loop := eventloop.NewEventLoop(eventloop.EnableConsole(true))
	loop.Start()
	t.Cleanup(func() { loop.Stop() })

	p := &KernelPlugin{Petal: &model.Petal{Name: "test-data-object"}}
	p.worker.Start(loop)
	r := &formDataTestRuntime{t: t, loop: loop}
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
