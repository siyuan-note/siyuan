// SiYuan - Build Your Eternal Digital Garden
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
	"github.com/siyuan-note/siyuan/kernel/util"
	"reflect"
	"sync"
	"time"

	"github.com/siyuan-note/logging"
)

var (
	taskQueue       []*Task
	taskQueueStatus int
	queueLock       = sync.Mutex{}
)

const (
	QueueStatusRunning = iota
	QueueStatusClosing
)

type Task struct {
	Action  string
	Handler reflect.Value
	Args    []interface{}
	Created time.Time
}

func PrependTask(action string, handler interface{}, args ...interface{}) {
	queueLock.Lock()
	defer queueLock.Unlock()

	if QueueStatusRunning != taskQueueStatus {
		//logging.LogWarnf("task queue is paused, action [%s] will be ignored", action)
		return
	}

	cancelTask(action, args...)
	taskQueue = append([]*Task{newTask(action, handler, args...)}, taskQueue...)
}

func AppendTask(action string, handler interface{}, args ...interface{}) {
	queueLock.Lock()
	defer queueLock.Unlock()

	if QueueStatusRunning != taskQueueStatus {
		//logging.LogWarnf("task queue is paused, action [%s] will be ignored", action)
		return
	}

	cancelTask(action, args...)
	taskQueue = append(taskQueue, newTask(action, handler, args...))
}

func cancelTask(action string, args ...interface{}) {
	for i := len(taskQueue) - 1; i >= 0; i-- {
		task := taskQueue[i]
		if action == task.Action {
			if len(task.Args) != len(args) {
				continue
			}

			for j, arg := range args {
				if arg != task.Args[j] {
					continue
				}
			}

			taskQueue = append(taskQueue[:i], taskQueue[i+1:]...)
			break
		}
	}
}

func newTask(action string, handler interface{}, args ...interface{}) *Task {
	return &Task{
		Action:  action,
		Handler: reflect.ValueOf(handler),
		Args:    args,
		Created: time.Now(),
	}
}

const (
	RepoCheckout            = "task.repo.checkout"             // 从快照中检出
	DatabaseIndexFull       = "task.database.index.full"       // 重建索引
	DatabaseIndex           = "task.database.index"            // 数据库索引
	DatabaseIndexCommit     = "task.database.index.commit"     // 数据库索引提交
	DatabaseIndexRef        = "task.database.index.ref"        // 数据库索引引用
	DatabaseIndexFix        = "task.database.index.fix"        // 数据库索引订正
	OCRImage                = "task.ocr.image"                 // 图片 OCR 提取文本
	HistoryGenerateDoc      = "task.history.generateDoc"       // 生成文件历史
	DatabaseIndexEmbedBlock = "task.database.index.embedBlock" // 数据库索引嵌入块
	ReloadUI                = "task.reload.ui"                 // 重载 UI
)

func ContainIndexTask() bool {
	for _, task := range taskQueue {
		if DatabaseIndex == task.Action || DatabaseIndexFull == task.Action {
			return true
		}
	}
	return false
}

func StatusJob() {
	tasks := taskQueue
	data := map[string]interface{}{}
	var items []map[string]interface{}
	for _, task := range tasks {
		if OCRImage == task.Action || DatabaseIndexEmbedBlock == task.Action {
			continue
		}

		actionLangs := util.TaskActionLangs[util.Lang]
		action := task.Action
		if nil != actionLangs {
			if label := actionLangs[task.Action]; nil != label {
				action = label.(string)
			}
		}
		item := map[string]interface{}{
			"action": action,
		}
		items = append(items, item)
	}
	if 1 > len(items) {
		items = []map[string]interface{}{}
	}
	data["tasks"] = items
	util.PushBackgroundTask(data)
}

func ExecTaskJob() {
	if QueueStatusClosing == taskQueueStatus {
		clearQueue()
		return
	}

	task := popTask()
	if nil == task {
		return
	}

	if util.IsExiting {
		return
	}

	execTask(task)
}

func clearQueue() {
	queueLock.Lock()
	defer queueLock.Unlock()

	taskQueue = []*Task{}
}

func popTask() (ret *Task) {
	queueLock.Lock()
	defer queueLock.Unlock()

	if 0 == len(taskQueue) {
		return
	}

	ret = taskQueue[0]
	taskQueue = taskQueue[1:]
	return
}

func execTask(task *Task) {
	defer logging.Recover()

	args := make([]reflect.Value, len(task.Args))
	for i, v := range task.Args {
		if nil == v {
			args[i] = reflect.New(task.Handler.Type().In(i)).Elem()
		} else {
			args[i] = reflect.ValueOf(v)
		}
	}

	ctx, cancel := context.WithTimeout(context.Background(), time.Second*12)
	defer cancel()
	ch := make(chan bool, 1)
	go func() {
		task.Handler.Call(args)
		ch <- true
	}()

	select {
	case <-ctx.Done():
		//logging.LogWarnf("task [%s] timeout", task.Action)
	case <-ch:
		//logging.LogInfof("task [%s] done", task.Action)
	}
}
