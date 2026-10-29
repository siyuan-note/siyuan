// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package plugin

import (
	"fmt"
	"strings"

	"github.com/siyuan-note/siyuan/kernel/plugin/gojaext"

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
func print(name, s string, logf func(format string, v ...any)) {
	rows := strings.SplitSeq(s, "\n")
	for row := range rows {
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

	lo.Must0(gojaext.Freeze(rt, logger))

	lo.Must0(siyuan.Set("logger", logger))
	return
}

// loggerWrapper returns a JS-callable function that logs a message at the given level.
// Logging is synchronous (in-process, no I/O), so resolve is called inline without worker.Run.
func loggerWrapper(p *KernelPlugin, logf func(format string, args ...any)) func(goja.FunctionCall, *goja.Runtime) goja.Value {
	return func(call goja.FunctionCall, rt *goja.Runtime) goja.Value {
		parts := make([]string, 0, len(call.Arguments))
		for _, arg := range call.Arguments {
			if goja.IsString(arg) {
				parts = append(parts, arg.String())
				continue
			}
			if arg == nil || goja.IsUndefined(arg) || goja.IsNull(arg) {
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
		go print(p.Name, strings.Join(parts, " "), logf)
		return goja.Undefined()
	}
}
