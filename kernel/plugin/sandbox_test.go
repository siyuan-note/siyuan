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
	"testing"

	"github.com/dop251/goja"
	"github.com/dop251/goja_nodejs/eventloop"
	"github.com/siyuan-note/siyuan/kernel/model"
)

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
