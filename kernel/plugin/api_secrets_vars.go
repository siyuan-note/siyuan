// SiYuan - Refactor your thinking
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

	"github.com/dop251/goja"
	"github.com/samber/lo"
	"github.com/siyuan-note/siyuan/kernel/model"
)

// injectSecretsVars adds siyuan.secrets and siyuan.vars to the plugin JS sandbox.
// siyuan.secrets.resolve(tpl) 仅替换模板里的 {{secrets.NAME}} 占位符，
// siyuan.vars.resolve(tpl) 仅替换 {{vars.NAME}}。两者各自只返回替换后的字符串，
// 不向插件暴露密钥/变量清单。同步执行（纯内存操作，无 I/O）。
func injectSecretsVars(p *KernelPlugin, rt *goja.Runtime, siyuan *goja.Object) (err error) {
	defer func() {
		if r := recover(); r != nil {
			err = fmt.Errorf("injectSecretsVars: %v", r)
		}
	}()

	secrets := rt.NewObject()
	lo.Must0(secrets.Set("resolve", rt.ToValue(makeResolver(func(tpl string) string {
		return model.Conf.Secrets.Resolve(tpl)
	}))))
	lo.Must0(siyuan.Set("secrets", secrets))

	vars := rt.NewObject()
	lo.Must0(vars.Set("resolve", rt.ToValue(makeResolver(func(tpl string) string {
		return model.Conf.Variables.Resolve(tpl)
	}))))
	lo.Must0(siyuan.Set("vars", vars))

	return
}

// makeResolver 构造一个 JS 可调用函数：接收模板字符串，返回经 resolver 替换后的结果。
func makeResolver(resolver func(string) string) func(goja.FunctionCall, *goja.Runtime) goja.Value {
	return func(call goja.FunctionCall, rt *goja.Runtime) goja.Value {
		if len(call.Arguments) < 1 || !goja.IsString(call.Argument(0)) {
			return rt.ToValue("")
		}
		return rt.ToValue(resolver(call.Argument(0).String()))
	}
}
