// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package task

import (
	"context"
	"reflect"
	"sync"
	"time"

	"github.com/88250/gulu"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/util"
)

var (
	taskQueue    []*Task
	queueLock    = sync.Mutex{}
	runningTasks = map[*Task]struct{}{}
)

type Task struct {
	Action  string
	Handler reflect.Value
	Args    []any
	Created time.Time
	Async   bool // 为 true 说明是异步任务，不会阻塞任务队列，满足 Delay 条件后立即执行
	Delay   time.Duration
	Timeout time.Duration
}

func AppendTask(action string, handler any, args ...any) {
	appendTaskWithDelayTimeout(action, false, 0, 24*time.Hour, handler, args...)
}

func AppendAsyncTaskWithDelay(action string, delay time.Duration, handler any, args ...any) {
	appendTaskWithDelayTimeout(action, true, delay, 24*time.Hour, handler, args...)
}

// AppendTaskWithTimeout 限制队列等待处理器的时间，不强制中止处理器；超时后仍跟踪运行实例并参与去重。
func AppendTaskWithTimeout(action string, timeout time.Duration, handler any, args ...any) {
	appendTaskWithDelayTimeout(action, false, 0, timeout, handler, args...)
}

func appendTaskWithDelayTimeout(action string, async bool, delay, timeout time.Duration, handler any, args ...any) {
	if util.IsExiting.Load() {
		//logging.LogWarnf("task queue is paused, action [%s] will be ignored", action)
		return
	}

	task := &Task{
		Action:  action,
		Handler: reflect.ValueOf(handler),
		Args:    args,
		Created: time.Now(),
		Async:   async,
		Delay:   delay,
		Timeout: timeout,
	}

	queueLock.Lock()
	defer queueLock.Unlock()
	if gulu.Str.Contains(action, uniqueActions) {
		if currentTasks := getCurrentTasksLocked(); containTask(task, currentTasks) {
			//logging.LogWarnf("task [%s] is already in queue, will be ignored", action)
			return
		}
	}

	taskQueue = append(taskQueue, task)
}

func containTask(task *Task, tasks []*Task) bool {
nextTask:
	for _, t := range tasks {
		if t.Action == task.Action {
			if len(t.Args) != len(task.Args) {
				continue nextTask
			}

			for i, arg := range t.Args {
				if !areArgsEqual(arg, task.Args[i]) {
					continue nextTask
				}
			}
			return true
		}
	}
	return false
}

func areArgsEqual(a, b any) bool {
	if a == nil || b == nil {
		return a == nil && b == nil
	}

	// 处理器和调用方可并发修改引用内容；只按值比较不可变标量，其他参数的任务独立入队。
	switch reflect.TypeOf(a).Kind() {
	case reflect.Bool, reflect.String,
		reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64,
		reflect.Uint, reflect.Uint8, reflect.Uint16, reflect.Uint32, reflect.Uint64, reflect.Uintptr,
		reflect.Float32, reflect.Float64, reflect.Complex64, reflect.Complex128:
		return a == b
	}
	return false
}

func getCurrentTasks() (ret []*Task) {
	queueLock.Lock()
	defer queueLock.Unlock()
	return getCurrentTasksLocked()
}

func getCurrentTasksLocked() (ret []*Task) {
	currentTaskLock.Lock()
	if nil != currentTask {
		ret = append(ret, currentTask)
	}
	for task := range runningTasks {
		if task != currentTask {
			ret = append(ret, task)
		}
	}
	currentTaskLock.Unlock()

	for _, task := range taskQueue {
		ret = append(ret, task)
	}
	return
}

const (
	RepoCheckout        = "task.repo.checkout"         // 从快照中检出
	RepoAutoPurge       = "task.repo.autoPurge"        // 自动清理数据仓库
	DatabaseIndexFull   = "task.database.index.full"   // 重建索引
	DatabaseIndexFTS    = "task.database.index.fts"    // 重建搜索索引
	DatabaseIndex       = "task.database.index"        // 数据库索引
	DatabaseIndexCommit = "task.database.index.commit" // 数据库索引提交
	DatabaseIndexRef    = "task.database.index.ref"    // 数据库索引引用

	OCRImage                          = "task.ocr.image"                            // 图片 OCR 提取文本
	HistoryGenerateFile               = "task.history.generateFile"                 // 生成文件历史
	HistoryDatabaseIndexFull          = "task.history.database.index.full"          // 历史数据库重建索引
	HistoryDatabaseIndexCommit        = "task.history.database.index.commit"        // 历史数据库索引提交
	DatabaseIndexEmbedBlock           = "task.database.index.embedBlock"            // 数据库索引嵌入块
	ReloadUI                          = "task.reload.ui"                            // 重载 UI
	AssetContentDatabaseIndexFull     = "task.asset.database.index.full"            // 资源文件数据库重建索引
	AssetContentDatabaseIndexCommit   = "task.asset.database.index.commit"          // 资源文件数据库索引提交
	DatabaseIndexEmbeddingFull        = "task.database.index.embedding.full"        // 嵌入向量重建索引
	DatabaseIndexEmbeddingRetryFailed = "task.database.index.embedding.retryFailed" // 嵌入向量重试失败块
	CacheVirtualBlockRef              = "task.cache.virtualBlockRef"                // 缓存虚拟块引用
	ReloadAttributeView               = "task.reload.attributeView"                 // 重新加载属性视图
	ReloadProtyle                     = "task.reload.protyle"                       // 重新加载编辑器
	ReloadTag                         = "task.reload.tag"                           // 重新加载标签面板
	ReloadFiletree                    = "task.reload.filetree"                      // 重新加载文档树面板
	SetRefDynamicText                 = "task.ref.setDynamicText"                   // 设置引用的动态锚文本
	SetDefRefCount                    = "task.def.setRefCount"                      // 设置定义的引用计数
	RefreshCrossTreeMoveRefs          = "task.ref.refreshCrossTreeMove"             // 刷新跨文档移动块的引用索引
	UpdateIDs                         = "task.update.ids"                           // 更新 ID
	PushMsg                           = "task.push.msg"                             // 推送消息
)

// uniqueActions 描述了唯一的任务，即队列中只能存在一个在执行的任务。
var uniqueActions = []string{
	RepoCheckout,
	RepoAutoPurge,
	DatabaseIndexFull,
	DatabaseIndexFTS,
	DatabaseIndexCommit,
	OCRImage,
	HistoryGenerateFile,
	HistoryDatabaseIndexFull,
	HistoryDatabaseIndexCommit,
	AssetContentDatabaseIndexFull,
	AssetContentDatabaseIndexCommit,
	DatabaseIndexEmbeddingFull,
	DatabaseIndexEmbeddingRetryFailed,
	ReloadAttributeView,
	ReloadProtyle,
	ReloadTag,
	ReloadFiletree,
	SetRefDynamicText,
	SetDefRefCount,
	RefreshCrossTreeMoveRefs,
	UpdateIDs,
}

func ContainIndexTask() bool {
	tasks := getCurrentTasks()
	for _, task := range tasks {
		if gulu.Str.Contains(task.Action, []string{DatabaseIndexFull, DatabaseIndex}) {
			return true
		}
	}
	return false
}

func StatusJob() {
	var items []map[string]any
	count := map[string]int{}
	actionLangs := util.TaskActionLangs[util.Lang]

	for _, task := range getCurrentTasks() {
		action := task.Action
		if c := count[action]; 7 < c {
			logging.LogWarnf("too many tasks [%s], ignore show its status", action)
			continue
		}
		count[action]++

		if skipPushTaskAction(action) {
			continue
		}

		if nil != actionLangs {
			if label := actionLangs[task.Action]; nil != label {
				action = label.(string)
			} else {
				continue
			}
		}

		item := map[string]any{"action": action}
		items = append(items, item)
	}
	if 1 > len(items) {
		items = []map[string]any{}
	}
	data := map[string]any{}
	data["tasks"] = items
	util.PushBackgroundTask(data)
}

func skipPushTaskAction(action string) bool {
	switch action {
	case DatabaseIndexCommit:
		return util.StatusBarCfg.Load().MsgTaskDatabaseIndexCommitDisabled
	case HistoryDatabaseIndexCommit:
		return util.StatusBarCfg.Load().MsgTaskHistoryDatabaseIndexCommitDisabled
	case AssetContentDatabaseIndexCommit:
		return util.StatusBarCfg.Load().MsgTaskAssetDatabaseIndexCommitDisabled
	case HistoryGenerateFile:
		return util.StatusBarCfg.Load().MsgTaskHistoryGenerateFileDisabled
	default:
		return false
	}
}

func ExecTaskJob() {
	task := popTask()
	if nil == task {
		return
	}

	if util.IsExiting.Load() {
		finishRunningTask(task)
		return
	}

	execTask(task)
}

func popTask() (ret *Task) {
	queueLock.Lock()
	defer queueLock.Unlock()

	if 1 > len(taskQueue) {
		return
	}

	for i, task := range taskQueue {
		if time.Since(task.Created) <= task.Delay {
			continue
		}

		if !task.Async {
			ret = task
			runningTasks[task] = struct{}{}
			taskQueue = append(taskQueue[:i], taskQueue[i+1:]...)
			return
		}
	}
	return
}

func ExecAsyncTaskJob() {
	tasks := popAsyncTasks()
	if 1 > len(tasks) {
		return
	}

	if util.IsExiting.Load() {
		for _, task := range tasks {
			finishRunningTask(task)
		}
		return
	}

	for _, task := range tasks {
		go func() {
			execTask(task)
		}()
	}
}

func popAsyncTasks() (ret []*Task) {
	queueLock.Lock()
	defer queueLock.Unlock()

	if 1 > len(taskQueue) {
		return
	}

	// writeIdx 指向下一个要写入的位置
	writeIdx := 0
	for readIdx := 0; readIdx < len(taskQueue); readIdx++ {
		task := taskQueue[readIdx]

		// 判断是否应该弹出此任务
		shouldPop := task.Async && time.Since(task.Created) > task.Delay
		if shouldPop {
			ret = append(ret, task)
			runningTasks[task] = struct{}{}
			// 不写入 taskQueue，相当于删除
		} else {
			// 保留此任务，移动到 writeIdx 位置
			if writeIdx != readIdx {
				taskQueue[writeIdx] = task
			}
			writeIdx++
		}
	}

	// 清理队列尾部的引用，防止内存泄漏
	for i := writeIdx; i < len(taskQueue); i++ {
		taskQueue[i] = nil
	}
	taskQueue = taskQueue[:writeIdx]
	return
}

var (
	currentTask     *Task
	currentTaskLock = sync.Mutex{}
)

func execTask(task *Task) {
	if nil == task {
		return
	}

	defer logging.Recover()

	queueLock.Lock()
	runningTasks[task] = struct{}{}
	if !task.Async {
		currentTaskLock.Lock()
		currentTask = task
		currentTaskLock.Unlock()
	}
	queueLock.Unlock()

	ctx, cancel := context.WithTimeout(context.Background(), task.Timeout)
	defer cancel()
	ch := make(chan struct{})
	go func() {
		defer close(ch)
		defer finishRunningTask(task)
		defer logging.Recover()
		args := make([]reflect.Value, len(task.Args))
		for i, v := range task.Args {
			if nil == v {
				args[i] = reflect.New(task.Handler.Type().In(i)).Elem()
			} else {
				args[i] = reflect.ValueOf(v)
			}
		}
		task.Handler.Call(args)
	}()

	select {
	case <-ctx.Done():
		logging.LogWarnf("task [%s] wait timeout; handler remains tracked until completion", task.Action)
	case <-ch:
		//logging.LogInfof("task [%s] done", task.Action)
	}
}

func finishRunningTask(task *Task) {
	queueLock.Lock()
	defer queueLock.Unlock()
	delete(runningTasks, task)
	currentTaskLock.Lock()
	defer currentTaskLock.Unlock()
	if currentTask == task {
		currentTask = nil
	}
}
