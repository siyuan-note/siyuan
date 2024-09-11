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

package task

import (
	"context"
	"reflect"
	"slices"
	"sync"
	"time"

	"github.com/88250/gulu"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/util"
)

var (
	taskQueue []*Task
	queueLock = sync.Mutex{}
)

type Task struct {
	Action  string
	Handler reflect.Value
	Args    []interface{}
	Created time.Time
	Async   bool // 为 true 说明是异步任务，不会阻塞任务队列，满足 Delay 条件后立即执行
	Delay   time.Duration
	Timeout time.Duration
}

func AppendTask(action string, handler interface{}, args ...interface{}) {
	appendTaskWithDelayTimeout(action, false, 0, 24*time.Hour, handler, args...)
}

func AppendAsyncTaskWithDelay(action string, delay time.Duration, handler interface{}, args ...interface{}) {
	appendTaskWithDelayTimeout(action, true, delay, 24*time.Hour, handler, args...)
}

func AppendTaskWithTimeout(action string, timeout time.Duration, handler interface{}, args ...interface{}) {
	appendTaskWithDelayTimeout(action, false, 0, timeout, handler, args...)
}

func appendTaskWithDelayTimeout(action string, async bool, delay, timeout time.Duration, handler interface{}, args ...interface{}) {
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

	if gulu.Str.Contains(action, uniqueActions) {
		if currentTasks := getCurrentTasks(); containTask(task, currentTasks) {
			//logging.LogWarnf("task [%s] is already in queue, will be ignored", action)
			return
		}
	}

	queueLock.Lock()
	defer queueLock.Unlock()
	taskQueue = append(taskQueue, task)
}

func containTask(task *Task, tasks []*Task) bool {
	for _, t := range tasks {
		if t.Action == task.Action {
			if len(t.Args) != len(task.Args) {
				return false
			}

			for i, arg := range t.Args {
				if arg != task.Args[i] {
					return false
				}
			}
			return true
		}
	}
	return false
}

func getCurrentTasks() (ret []*Task) {
	queueLock.Lock()
	defer queueLock.Unlock()

	currentTaskLock.Lock()
	if nil != currentTask {
		ret = append(ret, currentTask)
	}
	currentTaskLock.Unlock()

	for _, task := range taskQueue {
		ret = append(ret, task)
	}
	return
}

const (
	RepoCheckout                    = "task.repo.checkout"                 // 从快照中检出
	DatabaseIndexFull               = "task.database.index.full"           // 重建索引
	DatabaseIndex                   = "task.database.index"                // 数据库索引
	DatabaseIndexCommit             = "task.database.index.commit"         // 数据库索引提交
	DatabaseIndexRef                = "task.database.index.ref"            // 数据库索引引用
	DatabaseIndexFix                = "task.database.index.fix"            // 数据库索引订正
	OCRImage                        = "task.ocr.image"                     // 图片 OCR 提取文本
	HistoryGenerateFile             = "task.history.generateFile"          // 生成文件历史
	HistoryDatabaseIndexFull        = "task.history.database.index.full"   // 历史数据库重建索引
	HistoryDatabaseIndexCommit      = "task.history.database.index.commit" // 历史数据库索引提交
	DatabaseIndexEmbedBlock         = "task.database.index.embedBlock"     // 数据库索引嵌入块
	ReloadUI                        = "task.reload.ui"                     // 重载 UI
	AssetContentDatabaseIndexFull   = "task.asset.database.index.full"     // 资源文件数据库重建索引
	AssetContentDatabaseIndexCommit = "task.asset.database.index.commit"   // 资源文件数据库索引提交
	CacheVirtualBlockRef            = "task.cache.virtualBlockRef"         // 缓存虚拟块引用
	ReloadAttributeView             = "task.reload.attributeView"          // 重新加载属性视图
	ReloadProtyle                   = "task.reload.protyle"                // 重新加载编辑器
	SetRefDynamicText               = "task.ref.setDynamicText"            // 设置引用的动态锚文本
	SetDefRefCount                  = "task.def.setRefCount"               // 设置定义的引用计数
	PushMsg                         = "task.push.msg"                      // 推送消息
)

// uniqueActions 描述了唯一的任务，即队列中只能存在一个在执行的任务。
var uniqueActions = []string{
	RepoCheckout,
	DatabaseIndexFull,
	DatabaseIndexCommit,
	OCRImage,
	HistoryGenerateFile,
	HistoryDatabaseIndexFull,
	HistoryDatabaseIndexCommit,
	AssetContentDatabaseIndexFull,
	AssetContentDatabaseIndexCommit,
	ReloadAttributeView,
	ReloadProtyle,
	SetRefDynamicText,
	SetDefRefCount,
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
	var items []map[string]interface{}
	count := map[string]int{}
	actionLangs := util.TaskActionLangs[util.Lang]

	queueLock.Lock()
	for _, task := range taskQueue {
		action := task.Action
		if c := count[action]; 2 < c {
			logging.LogWarnf("too many tasks [%s], ignore show its status", action)
			continue
		}
		count[action]++

		if nil != actionLangs {
			if label := actionLangs[task.Action]; nil != label {
				action = label.(string)
			} else {
				continue
			}
		}

		item := map[string]interface{}{"action": action}
		items = append(items, item)
	}
	defer queueLock.Unlock()

	currentTaskLock.Lock()
	if nil != currentTask && nil != actionLangs {
		if label := actionLangs[currentTask.Action]; nil != label {
			items = append([]map[string]interface{}{{"action": label.(string)}}, items...)
		}
	}
	currentTaskLock.Unlock()

	if 1 > len(items) {
		items = []map[string]interface{}{}
	}
	data := map[string]interface{}{}
	data["tasks"] = items
	util.PushBackgroundTask(data)
}

func ExecTaskJob() {
	task := popTask()
	if nil == task {
		return
	}

	if util.IsExiting.Load() {
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

	var popedIndexes []int
	for i, task := range taskQueue {
		if !task.Async {
			continue
		}

		if time.Since(task.Created) <= task.Delay {
			continue
		}

		if task.Async {
			ret = append(ret, task)
			popedIndexes = append(popedIndexes, i)
		}
	}

	if 0 < len(popedIndexes) {
		var newQueue []*Task
		for i, task := range taskQueue {
			if !slices.Contains(popedIndexes, i) {
				newQueue = append(newQueue, task)
			}
		}
		taskQueue = newQueue
	}
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

	args := make([]reflect.Value, len(task.Args))
	for i, v := range task.Args {
		if nil == v {
			args[i] = reflect.New(task.Handler.Type().In(i)).Elem()
		} else {
			args[i] = reflect.ValueOf(v)
		}
	}

	if !task.Async {
		currentTaskLock.Lock()
		currentTask = task
		currentTaskLock.Unlock()
	}

	ctx, cancel := context.WithTimeout(context.Background(), task.Timeout)
	defer cancel()
	ch := make(chan bool, 1)
	go func() {
		task.Handler.Call(args)
		ch <- true
	}()

	select {
	case <-ctx.Done():
		logging.LogWarnf("task [%s] timeout", task.Action)
	case <-ch:
		//logging.LogInfof("task [%s] done", task.Action)
	}

	if !task.Async {
		currentTaskLock.Lock()
		currentTask = nil
		currentTaskLock.Unlock()
	}
}
