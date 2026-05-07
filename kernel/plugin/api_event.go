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
	"github.com/siyuan-note/logging"
)

// injectEvent adds siyuan.event to the goja context.
func injectEvent(p *KernelPlugin, rt *goja.Runtime, siyuan *goja.Object) (err error) {
	defer func() {
		if r := recover(); r != nil {
			err = fmt.Errorf("injectEvent: %v", r)
		}
	}()

	event := rt.NewObject()

	lo.Must0(event.Set("handler", goja.Null()))

	lo.Must0(event.Set("emit", rt.ToValue(func(call goja.FunctionCall, rt *goja.Runtime) goja.Value {
		promise, resolve, reject := rt.NewPromise()

		runErr := p.worker.Run(func(rt *goja.Runtime) (result any, err error) {
			if len(call.Arguments) < 2 {
				err = fmt.Errorf("topic and event required")
				return
			}

			topic := call.Argument(0).String()
			if topic == "" {
				err = fmt.Errorf("topic required")
				return
			}

			event := call.Argument(1).Export()

			p.bus.Publish(topic, event)
			return
		}, func(rt *goja.Runtime, result any, err error) {
			if lo.IsNil(err) {
				if resolveErr := resolve(result); resolveErr != nil {
					logging.LogErrorf("[plugin:%s] siyuan.event.emit resolve: %v", p.Name, resolveErr)
				}
			} else {
				if rejectErr := reject(rt.NewGoError(err)); rejectErr != nil {
					logging.LogErrorf("[plugin:%s] siyuan.event.emit reject: %v", p.Name, rejectErr)
				}
			}
		})
		if runErr != nil {
			logging.LogErrorf("[plugin:%s] siyuan.event.emit worker run: %v", p.Name, runErr)
		}

		return rt.ToValue(promise)
	})))

	lo.Must0(ObjectSeal(rt, event))

	lo.Must0(siyuan.Set("event", event))
	return
}
