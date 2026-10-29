// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package plugin

import (
	"fmt"

	"github.com/siyuan-note/siyuan/kernel/plugin/gojaext"

	"github.com/dop251/goja"
	"github.com/samber/lo"
)

// injectServer adds siyuan.server to the goja context.
func injectServer(_ *KernelPlugin, rt *goja.Runtime, siyuan *goja.Object) (err error) {
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

	lo.Must0(gojaext.Freeze(rt, private))

	server := rt.NewObject()

	lo.Must0(server.Set("private", private))

	lo.Must0(gojaext.Freeze(rt, server))

	lo.Must0(siyuan.Set("server", server))
	return
}
