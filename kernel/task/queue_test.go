package task

import (
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
		{"slice_arguments", &Task{Action: UpdateIDs, Args: []any{[]string{"a", "b"}}}, []*Task{{Action: UpdateIDs, Args: []any{[]string{"a"}}}, {Action: UpdateIDs, Args: []any{[]string{"a", "b"}}}}, true},
		{"nil_arguments", &Task{Action: SetDefRefCount, Args: []any{nil}}, []*Task{{Action: SetDefRefCount, Args: []any{"doc"}}, {Action: SetDefRefCount, Args: []any{nil}}}, true},
	} {
		t.Run(tt.name, func(t *testing.T) {
			if got := containTask(tt.task, tt.tasks); got != tt.want {
				t.Fatalf("containTask() = %v, want %v", got, tt.want)
			}
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
