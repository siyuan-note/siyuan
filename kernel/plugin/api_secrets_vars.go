// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

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
func injectSecretsVars(_ *KernelPlugin, rt *goja.Runtime, siyuan *goja.Object) (err error) {
	defer func() {
		if r := recover(); r != nil {
			err = fmt.Errorf("injectSecretsVars: %v", r)
		}
	}()

	secrets := rt.NewObject()
	lo.Must0(secrets.Set("resolve", rt.ToValue(makeResolver(func(tpl string) string {
		return model.Conf.Secrets.Load().Resolve(tpl)
	}))))
	lo.Must0(siyuan.Set("secrets", secrets))

	vars := rt.NewObject()
	lo.Must0(vars.Set("resolve", rt.ToValue(makeResolver(func(tpl string) string {
		return model.Conf.Variables.Load().Resolve(tpl)
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
