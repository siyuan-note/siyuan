package util

import (
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"sync"
	"time"

	"github.com/siyuan-note/logging"
)

const OperationStallLogName = "operation-stall.log"

const operationStallThreshold = 10 * time.Second

// OperationWatchdog 在操作仍未返回时记录阶段和调用栈，不取消操作、不改变数据写入顺序。
type OperationWatchdog struct {
	mu           sync.Mutex
	name         string
	stage        string
	started      time.Time
	stageStarted time.Time
	logTiming    bool
	done         bool
	timer        *time.Timer
}

type operationStall struct {
	name, stage string
	elapsed     time.Duration
}

func WatchOperation(name, stage string) *OperationWatchdog {
	dir := TempDir
	return watchOperation(name, stage, operationStallThreshold, func(stall operationStall) {
		// 先保存独立文件，再写常规日志，避免常规日志写入阻塞时丢失现场。
		operationStallRecorder.record(dir, stall)
		logging.LogWarnf("operation still running [%s], stage [%s], elapsed [%s]", stall.name, stall.stage, stall.elapsed)
	})
}

// WatchOperationWithTiming 记录每个阶段的开始、耗时和操作总耗时，并保留慢操作调用栈。
func WatchOperationWithTiming(name, stage string) *OperationWatchdog {
	w := WatchOperation(name, stage)
	w.mu.Lock()
	w.logTiming = true
	w.mu.Unlock()
	logging.LogInfof("operation [%s], stage [%s] started", name, stage)
	return w
}

func watchOperation(name, stage string, threshold time.Duration, report func(operationStall)) *OperationWatchdog {
	now := time.Now()
	w := &OperationWatchdog{name: name, stage: stage, started: now, stageStarted: now}
	w.timer = time.AfterFunc(threshold, func() {
		w.mu.Lock()
		if w.done {
			w.mu.Unlock()
			return
		}
		stall := operationStall{w.name, w.stage, time.Since(w.started)}
		w.mu.Unlock()
		report(stall)
	})
	return w
}

func (w *OperationWatchdog) Stage(stage string) {
	w.mu.Lock()
	previous, elapsed, total := w.stage, time.Since(w.stageStarted), time.Since(w.started)
	logTiming := w.logTiming
	w.stage = stage
	w.stageStarted = time.Now()
	w.mu.Unlock()
	if logTiming {
		logging.LogInfof("operation [%s], stage [%s] finished, elapsed [%s], total [%s]", w.name, previous, elapsed, total)
		logging.LogInfof("operation [%s], stage [%s] started", w.name, stage)
	}
}

func (w *OperationWatchdog) Finish() {
	w.mu.Lock()
	w.done = true
	w.timer.Stop()
	elapsed, stage := time.Since(w.started), w.stage
	stageElapsed, logTiming := time.Since(w.stageStarted), w.logTiming
	w.mu.Unlock()
	if logTiming {
		logging.LogInfof("operation [%s], stage [%s] finished, elapsed [%s], total [%s]", w.name, stage, stageElapsed, elapsed)
		return
	}
	if elapsed >= operationStallThreshold {
		logging.LogInfof("slow operation finished [%s], stage [%s], elapsed [%s]", w.name, stage, elapsed)
	}
}

type stallRecorder struct {
	mu   sync.Mutex
	last time.Time
}

var operationStallRecorder stallRecorder

// record 每分钟最多保存一次，覆盖上次现场；快照最多 8 MiB，不持有业务锁。
func (r *stallRecorder) record(dir string, stall operationStall) {
	if dir == "" || !r.mu.TryLock() {
		return
	}
	defer r.mu.Unlock()
	if time.Since(r.last) < time.Minute {
		return
	}
	buffer := make([]byte, 64*1024)
	var n int
	for {
		n = runtime.Stack(buffer, true)
		if n < len(buffer) || len(buffer) >= 8*1024*1024 {
			break
		}
		buffer = make([]byte, len(buffer)*2)
	}
	header := fmt.Sprintf("time: %s\noperation: %s\nstage: %s\nelapsed: %s\ntruncated: %t\n\n",
		time.Now().Format(time.RFC3339), stall.name, stall.stage, stall.elapsed, n == len(buffer))
	// 用临时文件替换，避免导出读到正在写入的半份调用栈。
	file, err := os.CreateTemp(dir, "operation-stall-*.tmp")
	if err != nil {
		return
	}
	tmp := file.Name()
	defer os.Remove(tmp)
	_, writeErr := file.Write(append([]byte(header), buffer[:n]...))
	closeErr := file.Close()
	if writeErr != nil || closeErr != nil {
		return
	}
	if err = os.Rename(tmp, filepath.Join(dir, OperationStallLogName)); err == nil {
		r.last = time.Now()
	}
}
