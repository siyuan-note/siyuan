package task

import (
	"reflect"
	"sync"
	"testing"
	"time"
)

func isolateTaskQueue(t *testing.T) {
	t.Helper()
	queueLock.Lock()
	currentTaskLock.Lock()
	previousQueue, previousRunning, previousCurrent := taskQueue, runningTasks, currentTask
	taskQueue, runningTasks, currentTask = nil, map[*Task]struct{}{}, nil
	currentTaskLock.Unlock()
	queueLock.Unlock()
	t.Cleanup(func() {
		queueLock.Lock()
		currentTaskLock.Lock()
		taskQueue, runningTasks, currentTask = previousQueue, previousRunning, previousCurrent
		currentTaskLock.Unlock()
		queueLock.Unlock()
	})
}

func requireTaskCount(t *testing.T, count int) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for len(getCurrentTasks()) != count {
		if time.Now().After(deadline) {
			t.Fatalf("task count=%d, want %d", len(getCurrentTasks()), count)
		}
		time.Sleep(time.Millisecond)
	}
}

func TestTimedOutTaskRemainsTrackedUntilHandlerCompletes(t *testing.T) {
	isolateTaskQueue(t)
	started, release := make(chan struct{}), make(chan struct{})
	secondStarted, secondRelease := make(chan struct{}), make(chan struct{})
	finishFirst := sync.OnceFunc(func() { close(release) })
	finishSecond := sync.OnceFunc(func() { close(secondRelease) })
	t.Cleanup(func() { finishFirst(); finishSecond(); requireTaskCount(t, 0) })
	AppendTaskWithTimeout(OCRImage, 10*time.Millisecond, func() { close(started); <-release })
	queueLock.Lock()
	taskQueue[0].Created = time.Now().Add(-time.Second)
	queueLock.Unlock()
	first := popTask()
	if first == nil {
		t.Fatal("eligible task was not dequeued")
	}
	// 出队到启动之间同样需要参与去重。
	AppendTask(OCRImage, func() {})
	requireTaskCount(t, 1)
	returned := make(chan struct{})
	go func() { execTask(first); close(returned) }()
	select {
	case <-started:
	case <-time.After(5 * time.Second):
		t.Fatal("task handler did not start")
	}
	select {
	case <-returned:
	case <-time.After(5 * time.Second):
		t.Fatal("queue wait did not time out")
	}
	AppendTask(OCRImage, func() {})
	requireTaskCount(t, 1)
	second := &Task{Action: ReloadTag, Timeout: time.Hour, Handler: reflect.ValueOf(func() {
		close(secondStarted)
		<-secondRelease
	})}
	secondReturned := make(chan struct{})
	go func() { execTask(second); close(secondReturned) }()
	select {
	case <-secondStarted:
	case <-time.After(5 * time.Second):
		t.Fatal("second task handler did not start")
	}
	requireTaskCount(t, 2)
	finishFirst()
	requireTaskCount(t, 1)
	currentTaskLock.Lock()
	current := currentTask
	currentTaskLock.Unlock()
	if current != second {
		t.Fatal("timed-out handler completion cleared the next running task")
	}
	finishSecond()
	select {
	case <-secondReturned:
	case <-time.After(5 * time.Second):
		t.Fatal("second task did not complete")
	}
	requireTaskCount(t, 0)
}

func TestConcurrentTaskAdmissionIsAtomic(t *testing.T) {
	isolateTaskQueue(t)
	var wait sync.WaitGroup
	for i := 0; i < 64; i++ {
		wait.Go(func() { AppendTask(OCRImage, func() {}) })
	}
	wait.Wait()
	if count := len(getCurrentTasks()); count != 1 {
		t.Fatalf("concurrent duplicate admissions produced %d tasks", count)
	}
}

func TestTaskHandlerPanicReleasesTracking(t *testing.T) {
	isolateTaskQueue(t)
	execTask(&Task{Action: OCRImage, Timeout: time.Second, Handler: reflect.ValueOf(func() { panic("handler failure") })})
	requireTaskCount(t, 0)
}
