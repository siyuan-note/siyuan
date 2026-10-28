// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package plugin

import (
	"fmt"
	"runtime/debug"

	"github.com/dop251/goja"
	"github.com/dop251/goja_nodejs/eventloop"
	"github.com/siyuan-note/logging"
)

type TaskExecutor func(rt *goja.Runtime) (result any, err error)
type TaskCallback func(rt *goja.Runtime, result any, err error)

type Worker struct {
	loop *eventloop.EventLoop
}

type TaskResult struct {
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
				// 捕获回调中的 panic 并保留原始调用栈，便于定位 Promise 处理异常。
				if r := recover(); r != nil {
					logging.LogErrorf("task callback panicked: %v\n%s", r, debug.Stack())
				}
			}()

			// 捕获执行器中的 panic 并保留原始调用栈，同时将错误传给回调。
			if r := recover(); r != nil {
				logging.LogErrorf("task executor panicked: %v\n%s", r, debug.Stack())
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
	response := make(chan TaskResult, 1)
	err = w.Run(fn, func(rt *goja.Runtime, result any, err error) {
		response <- TaskResult{result, err}
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
