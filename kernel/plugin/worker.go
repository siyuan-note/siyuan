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
	"context"
	"errors"
	"fmt"
	"sync"
	"sync/atomic"
)

type Continuation func(result any, err any)

// Task is the smallest unit of work submitted to the queue.
// The fn signature is func() (any, error), with business parameters captured by the caller via closure.
type Task struct {
	fn       func() (result any, err any)
	callback Continuation
}

type Result struct {
	value any
	err   any
}

// Worker guarantees that all tasks are executed serially on a single goroutine.
// Callers block waiting for task completion, and tasks are never dropped (backpressure is controlled by the mailbox buffer).
type Worker struct {
	mailbox chan Task     // buffered channel acting as a mailbox for incoming tasks, ensuring they are processed in order
	stop    chan struct{} // channel to signal the worker to stop accepting new tasks and exit after processing current tasks
	done    chan struct{} // channel to signal that the worker has fully stopped, used for graceful shutdown
	once    sync.Once     // ensures the queue is closed only once
	closed  atomic.Bool   // indicates whether the queue has been closed, allowing Run to return an error immediately if the queue is closed
}

var ErrQueueClosed = errors.New("queue is closed")

// NewWorker creates a new Worker with the specified mailbox buffer size.
//   - mailboxSize: the buffer size of the mailbox channel, which controls how many tasks can be enqueued without blocking the caller.
//     It's recommended to set this based on concurrency benchmarks, initially around 64~256.
func NewWorker(mailboxSize int) *Worker {
	w := &Worker{
		mailbox: make(chan Task, mailboxSize),
		stop:    make(chan struct{}),
		done:    make(chan struct{}),
	}
	w.closed.Store(false)
	go w.loop()
	return w
}

// loop is the single worker goroutine that consumes tasks serially.
func (w *Worker) loop() {
	defer close(w.done)
	for {
		select {
		case t := <-w.mailbox:
			t.do()
		case <-w.stop:
			// When the stop signal is received, we first drain the mailbox to ensure all enqueued tasks are completed before exiting.
			for {
				select {
				case t := <-w.mailbox:
					t.do()
				default:
					return
				}
			}
		}
	}
}

func (t *Task) do() (result any, err any) {
	defer func() {
		if r := recover(); r != nil {
			err = fmt.Errorf("task panicked: %v", r)
		}
		if t.callback != nil {
			t.callback(result, err)
		}
	}()
	result, err = t.fn()
	return
}

// Run submits a task and blocks waiting for its result.
// If ctx is canceled while waiting to enqueue, it returns ctx.Err() immediately and the task will not be executed.
func (w *Worker) Run(fn func() (result any, err any), callback Continuation, ctx context.Context) error {
	// Each call creates a unique result channel for the task, ensuring that results are correctly matched to their callers without interference.
	if w.closed.Load() {
		return ErrQueueClosed
	}

	select {
	case w.mailbox <- Task{fn: fn, callback: callback}:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	case <-w.stop:
		return ErrQueueClosed
	}
}

func (w *Worker) RunSync(fn func() (result any, err any), ctx context.Context) (result any, err any) {
	resCh := make(chan Result, 1)
	err = w.Run(fn, func(result any, err any) {
		// Imediately return after writing to resCh, without blocking the worker.
		// The worker will continue to execute and write to resCh (buffered channel, no leak).
		resCh <- Result{result, err}
	}, ctx)
	if err != nil {
		return
	}
	select {
	case r := <-resCh:
		result = r.value
		err = r.err
		return
	case <-ctx.Done():
		// Task has been enqueued, the worker will execute and write to resCh (buffered channel, no leak).
		// The caller gives up waiting, but there are no side effects on the worker side.
		err = ctx.Err()
		return
	}
}

// Close gracefully closes the queue, waiting for all enqueued tasks to complete before returning.
// Can be safely called multiple times; subsequent calls will have no effect.
func (w *Worker) Close() {
	w.once.Do(func() {
		// Notify the worker to stop accepting new tasks and exit after processing current tasks.
		w.closed.Store(true)
		close(w.stop)
	})
	// Await the worker to fully stop.
	<-w.done
}

// Len returns the number of tasks currently waiting in the mailbox.
func (w *Worker) Len() int {
	return len(w.mailbox)
}
