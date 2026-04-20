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
