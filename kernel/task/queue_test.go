// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package task

import (
	"sync"
	"testing"
	"time"
)

func TestContainTask(t *testing.T) {
	for _, tt := range []struct {
		name  string
		task  *Task
		tasks []*Task
		want  bool
	}{
		{"empty", &Task{Action: ReloadProtyle}, nil, false},
		{"different_action", &Task{Action: ReloadProtyle, Args: []any{"doc"}}, []*Task{{Action: ReloadAttributeView, Args: []any{"doc"}}}, false},
		{"no_arguments", &Task{Action: ReloadUI}, []*Task{{Action: ReloadUI}}, true},
		{"same_arguments", &Task{Action: ReloadProtyle, Args: []any{"doc"}}, []*Task{{Action: ReloadProtyle, Args: []any{"doc"}}}, true},
		{"different_arguments", &Task{Action: ReloadProtyle, Args: []any{"doc"}}, []*Task{{Action: ReloadProtyle, Args: []any{"other"}}}, false},
		{"later_match", &Task{Action: ReloadProtyle, Args: []any{"doc"}}, []*Task{{Action: ReloadProtyle, Args: []any{"other"}}, {Action: ReloadProtyle, Args: []any{"doc"}}}, true},
		{"different_argument_count_before_match", &Task{Action: ReloadProtyle, Args: []any{"doc"}}, []*Task{{Action: ReloadProtyle}, {Action: ReloadProtyle, Args: []any{"doc"}}}, true},
		{"later_argument_differs", &Task{Action: SetRefDynamicText, Args: []any{"doc", "text"}}, []*Task{{Action: SetRefDynamicText, Args: []any{"doc", "other"}}, {Action: SetRefDynamicText, Args: []any{"doc", "text"}}}, true},
		{"slice_arguments_remain_distinct", &Task{Action: UpdateIDs, Args: []any{[]string{"a", "b"}}}, []*Task{{Action: UpdateIDs, Args: []any{[]string{"a"}}}, {Action: UpdateIDs, Args: []any{[]string{"a", "b"}}}}, false},
		{"nil_arguments", &Task{Action: SetDefRefCount, Args: []any{nil}}, []*Task{{Action: SetDefRefCount, Args: []any{"doc"}}, {Action: SetDefRefCount, Args: []any{nil}}}, true},
	} {
		t.Run(tt.name, func(t *testing.T) {
			if got := containTask(tt.task, tt.tasks); got != tt.want {
				t.Fatalf("containTask() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestTaskArgumentEquality(t *testing.T) {
	type documentID string
	for _, value := range []any{nil, true, "doc", documentID("doc"), int(1), int8(1), int16(1), int32(1), int64(1),
		uint(1), uint8(1), uint16(1), uint32(1), uint64(1), uintptr(1), float32(1), float64(1), complex64(1), complex128(1)} {
		if !areArgsEqual(value, value) {
			t.Errorf("equal scalar %T was not deduplicated", value)
		}
	}
	for _, pair := range [][2]any{{nil, ""}, {"", nil}, {int(1), int64(1)}, {documentID("doc"), "doc"},
		{"doc", "other"}, {false, true}, {int(1), []int{1}}} {
		if areArgsEqual(pair[0], pair[1]) {
			t.Errorf("different scalar arguments compared equal: %v", pair)
		}
	}
	values := map[string]any{"rootID": "doc"}
	for _, value := range []any{values, []string{"doc"}, []int{1}, &values,
		struct{ Values map[string]any }{values}, [1]map[string]any{values}, (map[string]any)(nil), ([]string)(nil)} {
		if areArgsEqual(value, value) {
			t.Errorf("mutable argument %T was deduplicated", value)
		}
	}
}

func TestRunningTaskArgumentsCanMutateDuringAdmission(t *testing.T) {
	for _, kind := range []string{"map", "string_slice", "int_slice", "nested_map"} {
		t.Run(kind, func(t *testing.T) {
			isolateTaskQueue(t)
			values := map[string]any{"rootID": "doc"}
			strings := []string{"doc"}
			numbers := []int{0}
			var argument, candidate any
			switch kind {
			case "map":
				argument, candidate = values, map[string]any{"rootID": "doc"}
			case "string_slice":
				argument, candidate = strings, []string{"doc"}
			case "int_slice":
				argument, candidate = numbers, []int{0}
			case "nested_map":
				argument = struct{ Values map[string]any }{values}
				candidate = struct{ Values map[string]any }{map[string]any{"rootID": "doc"}}
			}
			started, release, done := make(chan struct{}), make(chan struct{}), make(chan struct{})
			finish := sync.OnceFunc(func() { close(release) })
			t.Cleanup(func() { finish(); <-done; requireTaskCount(t, 128) })
			AppendAsyncTaskWithDelay(ReloadProtyle, 0, func(any) {
				close(started)
				for i := 0; ; i++ {
					select {
					case <-release:
						return
					default:
						values["subFileCount"] = i
						strings[0] = "updated"
						numbers[0] = i
					}
				}
			}, argument)
			queueLock.Lock()
			taskQueue[0].Created = time.Now().Add(-time.Second)
			queueLock.Unlock()
			running := popAsyncTasks()[0]
			go func() { execTask(running); close(done) }()
			<-started
			for range 128 {
				AppendAsyncTaskWithDelay(ReloadProtyle, time.Hour, func(any) {}, candidate)
			}
			requireTaskCount(t, 129)
			finish()
		})
	}
}

func TestAppendTaskDeduplicatesLaterQueuedTask(t *testing.T) {
	queueLock.Lock()
	savedQueue := taskQueue
	taskQueue = nil
	queueLock.Unlock()
	currentTaskLock.Lock()
	savedCurrent := currentTask
	currentTask = &Task{Action: ReloadProtyle, Args: []any{"running"}}
	currentTaskLock.Unlock()
	t.Cleanup(func() {
		queueLock.Lock()
		taskQueue = savedQueue
		queueLock.Unlock()
		currentTaskLock.Lock()
		currentTask = savedCurrent
		currentTaskLock.Unlock()
	})

	handler := func(string) {}
	for _, id := range []string{"first", "second", "second", "running", "third"} {
		AppendAsyncTaskWithDelay(ReloadProtyle, time.Hour, handler, id)
	}

	tasks := getCurrentTasks()
	if len(tasks) != 4 {
		t.Fatalf("expected one running task and three distinct queued tasks, got %d", len(tasks))
	}
	for i, id := range []string{"running", "first", "second", "third"} {
		if tasks[i].Args[0] != id {
			t.Fatalf("task %d has arguments %v, want [%s]", i, tasks[i].Args, id)
		}
	}
}
