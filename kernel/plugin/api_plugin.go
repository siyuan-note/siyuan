// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package plugin

import (
	"fmt"

	"github.com/dop251/goja"
	"github.com/samber/lo"
	"github.com/siyuan-note/siyuan/kernel/bazaar"
	"github.com/siyuan-note/siyuan/kernel/plugin/gojaext"
)

// injectPlugin adds siyuan.plugin to the goja context.
func injectPlugin(p *KernelPlugin, rt *goja.Runtime, siyuan *goja.Object) (err error) {
	defer func() {
		if r := recover(); r != nil {
			err = fmt.Errorf("injectPlugin: %v", r)
		}
	}()

	lifecycle := rt.NewObject()
	lo.Must0(lifecycle.Set("onload", goja.Null()))
	lo.Must0(lifecycle.Set("onrunning", goja.Null()))
	lo.Must0(lifecycle.Set("onunload", goja.Null()))
	lo.Must0(ObjectSeal(rt, lifecycle))

	plugin := rt.NewObject()
	lo.Must0(plugin.Set("name", p.Name))
	lo.Must0(plugin.Set("version", p.Version))
	lo.Must0(plugin.Set("displayName", p.DisplayName))
	lo.Must0(plugin.Set("platform", bazaar.GetCurrentBackend()))
	lo.Must0(plugin.Set("i18n", p.I18n))
	lo.Must0(plugin.Set("lifecycle", lifecycle))
	lo.Must0(gojaext.Freeze(rt, plugin))

	lo.Must0(siyuan.Set("plugin", plugin))
	return
}
