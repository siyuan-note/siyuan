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
	"bytes"
	"fmt"
	"strings"

	"github.com/fastschema/qjs"
)

// KernelPluginLogger splits writes by \n and forwards each line to a logging function.
type KernelPluginLogger struct {
	name  string
	buf   bytes.Buffer
	logFn func(string)
}

// Write implements the io.Writer interface, buffering data until a newline is encountered, then logging each line with the plugin name prefix.
func (w *KernelPluginLogger) Write(p []byte) (int, error) {
	w.buf.Write(p)
	for {
		line, err := w.buf.ReadString('\n')
		if trimmed := strings.TrimRight(line, "\r\n"); len(trimmed) > 0 {
			w.logFn(fmt.Sprintf("[plugin:%s] %s", w.name, trimmed))
		}
		if err != nil {
			break
		}
	}
	return len(p), nil
}

// loggerWrapper creates a function that can be registered as a JavaScript logger method (e.g., debug, info, error) for the plugin. It formats the log message with the plugin name and forwards it to the provided logFn.
func loggerWrapper(ctx *qjs.Context, pluginName string, logFn func(format string, args ...any)) func(this *qjs.This) (*qjs.Value, error) {
	return func(this *qjs.This) (result *qjs.Value, err error) {
		defer func() {
			if r := recover(); r != nil {
				err = fmt.Errorf("qjs panic during invoke siyuan.logger.%s: %v", pluginName, r)
			}
		}()

		// Get arguments via this.Args()
		args := this.Args()
		if len(args) < 1 {
			result = ctx.NewUndefined()
			return
		}

		parts := make([]string, 0, len(args))
		for _, arg := range args {
			parts = append(parts, arg.String())
		}
		msg := strings.Join(parts, " ")

		logFn("[plugin:%s] %s", pluginName, msg)

		result = ctx.NewUndefined()
		return
	}
}
