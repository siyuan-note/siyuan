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
)

// injectServer adds siyuan.server to the goja context.
func injectServer(p *KernelPlugin, rt *goja.Runtime, siyuan *goja.Object) (err error) {
	defer func() {
		if r := recover(); r != nil {
			err = fmt.Errorf("injectServer: %v", r)
		}
	}()

	http := rt.NewObject()
	ws := rt.NewObject()
	es := rt.NewObject()

	lo.Must0(http.Set("handler", goja.Null()))
	lo.Must0(ws.Set("handler", goja.Null()))
	lo.Must0(es.Set("handler", goja.Null()))

	lo.Must0(ObjectSeal(rt, http))
	lo.Must0(ObjectSeal(rt, ws))
	lo.Must0(ObjectSeal(rt, es))

	private := rt.NewObject()

	lo.Must0(private.Set(string(RequestTypeHTTP), http))
	lo.Must0(private.Set(string(RequestTypeWS), ws))
	lo.Must0(private.Set(string(RequestTypeSSE), es))

	lo.Must0(ObjectFreeze(rt, private))

	server := rt.NewObject()

	lo.Must0(server.Set("private", private))

	lo.Must0(ObjectFreeze(rt, server))

	lo.Must0(siyuan.Set("server", server))
	return
}
