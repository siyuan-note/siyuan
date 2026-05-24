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
	"strings"

	"github.com/dop251/goja"
	"github.com/samber/lo"
	"github.com/siyuan-note/logging"
)

type Printer struct {
	name string // plugin name for log prefix
}

func (p *Printer) Log(s string) {
	go print(p.name, s, logging.LogInfof)
}

func (p *Printer) Warn(s string) {
	go print(p.name, s, logging.LogWarnf)
}

func (p *Printer) Error(s string) {
	go print(p.name, s, logging.LogErrorf)
}

// print logs the message line by line with the plugin name as prefix, using the provided log function.
func print(name, s string, logf func(format string, v ...interface{})) {
	rows := strings.Split(s, "\n")
	for _, row := range rows {
		logf("[plugin:%s] %s", name, row)
	}
}

// injectLogger adds siyuan.logger to the goja context.
func injectLogger(p *KernelPlugin, rt *goja.Runtime, siyuan *goja.Object) (err error) {
	defer func() {
		if r := recover(); r != nil {
			err = fmt.Errorf("injectLogger: %v", r)
		}
	}()

	logger := rt.NewObject()

	lo.Must0(logger.Set("trace", rt.ToValue(loggerWrapper(p, logging.LogTracef))))
	lo.Must0(logger.Set("debug", rt.ToValue(loggerWrapper(p, logging.LogDebugf))))
	lo.Must0(logger.Set("info", rt.ToValue(loggerWrapper(p, logging.LogInfof))))
	lo.Must0(logger.Set("warn", rt.ToValue(loggerWrapper(p, logging.LogWarnf))))
	lo.Must0(logger.Set("error", rt.ToValue(loggerWrapper(p, logging.LogErrorf))))

	lo.Must0(ObjectFreeze(rt, logger))

	lo.Must0(siyuan.Set("logger", logger))
	return
}

// loggerWrapper returns a JS-callable function that logs a message at the given level.
// Logging is synchronous (in-process, no I/O), so resolve is called inline without worker.Run.
func loggerWrapper(p *KernelPlugin, logf func(format string, args ...any)) func(goja.FunctionCall, *goja.Runtime) goja.Value {
	return func(call goja.FunctionCall, rt *goja.Runtime) goja.Value {
		promise, resolve, reject := rt.NewPromise()

		runErr := p.worker.Run(func(rt *goja.Runtime) (result any, err error) {
			parts := make([]string, 0, len(call.Arguments))
			for _, arg := range call.Arguments {
				if goja.IsString(arg) {
					parts = append(parts, arg.String())
					continue
				}

				if arg == nil {
					parts = append(parts, "null")
					continue
				}

				if goja.IsUndefined(arg) || goja.IsNull(arg) {
					parts = append(parts, arg.String())
					continue
				}

				argObj := arg.ToObject(rt)
				if argObj != nil {
					if argJson, marshalErr := argObj.MarshalJSON(); marshalErr == nil {
						parts = append(parts, string(argJson))
						continue
					}
				}

				parts = append(parts, arg.String())
			}
			msg := strings.Join(parts, " ")

			go print(p.Name, msg, logf)
			return
		}, func(rt *goja.Runtime, result any, err error) {
			if lo.IsNil(err) {
				if resolveErr := resolve(result); resolveErr != nil {
					logging.LogErrorf("[plugin:%s] siyuan.logger resolve: %v", p.Name, resolveErr)
				}
			} else {
				if rejectErr := reject(rt.NewGoError(err)); rejectErr != nil {
					logging.LogErrorf("[plugin:%s] siyuan.logger reject: %v", p.Name, rejectErr)
				}
			}
		})
		if runErr != nil {
			logging.LogErrorf("[plugin:%s] siyuan.logger worker run: %v", p.Name, runErr)
		}

		return rt.ToValue(promise)
	}
}
