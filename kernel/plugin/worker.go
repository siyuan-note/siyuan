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
	"github.com/dop251/goja_nodejs/eventloop"
	"github.com/siyuan-note/logging"
)

type TaskExecutor func(rt *goja.Runtime) (result any, err error)
type TaskCallback func(rt *goja.Runtime, result any, err error)

type Worker struct {
	loop *eventloop.EventLoop
}

type Result struct {
	value any
	err   error
}

func (w *Worker) Start(loop *eventloop.EventLoop) {
	w.loop = loop
}

func (w *Worker) Run(executor TaskExecutor, callback TaskCallback) error {
	if w.loop == nil {
		return fmt.Errorf("worker event loop not initialized")
	}

	success := w.loop.RunOnLoop(func(rt *goja.Runtime) {
		var result any
		var err error

		defer func() {
			defer func() {
				// catch panic from callback
				if r := recover(); r != nil {
					logging.LogErrorf("task callback panicked: %v\n", r)
				}
			}()

			// catch panic from executor
			if r := recover(); r != nil {
				err = fmt.Errorf("task executor panicked: %v", r)
			}
			if callback != nil {
				callback(rt, result, err)
			}
		}()

		result, err = executor(rt)
	})
	if !success {
		return fmt.Errorf("failed to run task on event loop")
	}
	return nil
}

func (w *Worker) RunSync(fn TaskExecutor) (result any, err error) {
	response := make(chan Result, 1)
	err = w.Run(fn, func(rt *goja.Runtime, result any, err error) {
		response <- Result{result, err}
	})

	if err != nil {
		close(response)
		return
	}

	r := <-response
	result = r.value
	err = r.err
	return
}
