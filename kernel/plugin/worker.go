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
)

// Task is the smallest unit of work submitted to the queue.
// The fn signature is func() (any, error), with business parameters captured by the caller via closure.
type Task struct {
	fn     func() (result any, err any)
	result chan<- Result
}

type Result struct {
	value any
	err   any
}

// Worker guarantees that all tasks are executed serially on a single goroutine.
// Callers block waiting for task completion, and tasks are never dropped (backpressure is controlled by the mailbox buffer).
type Worker struct {
	mailbox chan Task      // buffered channel acting as a mailbox for incoming tasks, ensuring they are processed in order
	stop    chan struct{}  // channel to signal the worker to stop accepting new tasks and exit after processing current tasks
	once    sync.Once      // ensures the queue is closed only once
	wg      sync.WaitGroup // tracks the worker goroutine for graceful shutdown
}

// NewWorker creates a new Worker with the specified mailbox buffer size.
//   - mailboxSize: the buffer size of the mailbox channel, which controls how many tasks can be enqueued without blocking the caller.
//     It's recommended to set this based on concurrency benchmarks, initially around 64~256.
func NewWorker(mailboxSize int) *Worker {
	w := &Worker{
		mailbox: make(chan Task, mailboxSize),
		stop:    make(chan struct{}),
	}
	w.wg.Add(1)
	go w.loop()
	return w
}

// loop is the single worker goroutine that consumes tasks serially.
func (w *Worker) loop() {
	defer w.wg.Done()
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

// Run submits a task and blocks waiting for its result.
// If ctx is canceled while waiting to enqueue, it returns ctx.Err() immediately and the task will not be executed.
func (w *Worker) Run(fn func() (result any, err any), ctx context.Context) (result any, err any) {
	// Each call creates a unique result channel for the task, ensuring that results are correctly matched to their callers without interference.
	resCh := make(chan Result, 1)
	t := Task{fn: fn, result: resCh}

	// submit the task to the mailbox, respecting context cancellation and queue shutdown
	select {
	case w.mailbox <- t:
	case <-ctx.Done():
		return nil, fmt.Errorf("enqueue cancelled: %w", ctx.Err())
	case <-w.stop:
		return nil, errors.New("queue is closed")
	}

	// wait for the task result or context cancellation
	select {
	case r := <-resCh:
		return r.value, r.err
	case <-ctx.Done():
		// Note: the task has already been enqueued and will be executed, but the caller is no longer waiting for the result.
		// The result channel is buffered, so the worker can write back without blocking, preventing goroutine leaks.
		return nil, fmt.Errorf("wait result cancelled: %w", ctx.Err())
	}
}

// Close gracefully closes the queue, waiting for all enqueued tasks to complete before returning.
func (w *Worker) Close() {
	w.once.Do(func() {
		close(w.stop)
		w.wg.Wait()
	})
}

// Len returns the number of tasks currently waiting in the mailbox.
func (w *Worker) Len() int {
	return len(w.mailbox)
}

func (t *Task) do() (result any, err any) {
	defer func() {
		if r := recover(); r != nil {
			err = fmt.Errorf("task panicked: %v", r)
		}
		t.result <- Result{value: result, err: err}
	}()
	result, err = t.fn()
	return
}
