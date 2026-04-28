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
	"github.com/siyuan-note/siyuan/kernel/bazaar"
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
	lo.Must0(lifecycle.Set("onloaded", goja.Null()))
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
	lo.Must0(ObjectFreeze(rt, plugin))

	lo.Must0(siyuan.Set("plugin", plugin))
	return
}
