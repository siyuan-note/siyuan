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
	Timeout time.Duration
}

func AppendTask(action string, handler interface{}, args ...interface{}) {
	AppendTaskWithTimeout(action, 24*time.Hour, handler, args...)
}

func AppendTaskWithTimeout(action string, timeout time.Duration, handler interface{}, args ...interface{}) {
	if util.IsExiting {
		//logging.LogWarnf("task queue is paused, action [%s] will be ignored", action)
		return
	}

	currentActions := getCurrentActions()
	if gulu.Str.Contains(action, currentActions) && gulu.Str.Contains(action, uniqueActions) {
		//logging.LogWarnf("task [%s] is already in queue, will be ignored", action)
		return
	}

	queueLock.Lock()
	defer queueLock.Unlock()
	taskQueue = append(taskQueue, &Task{
		Action:  action,
		Timeout: timeout,
		Handler: reflect.ValueOf(handler),
		Args:    args,
		Created: time.Now(),
	})
}

func getCurrentActions() (ret []string) {
	queueLock.Lock()
	defer queueLock.Unlock()

	if "" != currentTaskAction {
		ret = append(ret, currentTaskAction)
	}

	for _, task := range taskQueue {
		ret = append(ret, task.Action)
	}
	return
}

const (
	RepoCheckout               = "task.repo.checkout"                 // 从快照中检出
	DatabaseIndexFull          = "task.database.index.full"           // 重建索引
	DatabaseIndex              = "task.database.index"                // 数据库索引
	DatabaseIndexCommit        = "task.database.index.commit"         // 数据库索引提交
	DatabaseIndexRef           = "task.database.index.ref"            // 数据库索引引用
	DatabaseIndexFix           = "task.database.index.fix"            // 数据库索引订正
	OCRImage                   = "task.ocr.image"                     // 图片 OCR 提取文本
	HistoryGenerateDoc         = "task.history.generateDoc"           // 生成文件历史
	HistoryDatabaseIndexFull   = "task.history.database.index.full"   // 历史数据库重建索引
	HistoryDatabaseIndexCommit = "task.history.database.index.commit" // 历史数据库索引提交
	DatabaseIndexEmbedBlock    = "task.database.index.embedBlock"     // 数据库索引嵌入块
	ReloadUI                   = "task.reload.ui"                     // 重载 UI
	UpgradeUserGuide           = "task.upgrade.userGuide"             // 升级用户指南文档笔记本
)

// uniqueActions 描述了唯一的任务，即队列中只能存在一个在执行的任务。
var uniqueActions = []string{
	RepoCheckout,
	DatabaseIndexFull,
	DatabaseIndexCommit,
	OCRImage,
	HistoryGenerateDoc,
	HistoryDatabaseIndexFull,
	HistoryDatabaseIndexCommit,
	DatabaseIndexEmbedBlock,
}

func Contain(action string, moreActions ...string) bool {
	actions := append(moreActions, action)
	actions = gulu.Str.RemoveDuplicatedElem(actions)

	for _, task := range taskQueue {
		if gulu.Str.Contains(task.Action, actions) {
			return true
		}
	}
	return false
}

func StatusJob() {
	tasks := taskQueue
	var items []map[string]interface{}
	count := map[string]int{}
	actionLangs := util.TaskActionLangs[util.Lang]
	for _, task := range tasks {
		action := task.Action
		if c := count[action]; 2 < c {
			logging.LogWarnf("too many tasks [%s], ignore show its status", action)
			continue
		}
		count[action]++

		if nil != actionLangs {
			if label := actionLangs[task.Action]; nil != label {
				action = label.(string)
			}
		}

		item := map[string]interface{}{"action": action}
		items = append(items, item)
	}

	if "" != currentTaskAction {
		if nil != actionLangs {
			if label := actionLangs[currentTaskAction]; nil != label {
				items = append([]map[string]interface{}{{"action": label.(string)}}, items...)
			}
		}
	}

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

	if util.IsExiting {
		return
	}

	execTask(task)
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

var currentTaskAction string

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

	currentTaskAction = task.Action

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

	currentTaskAction = ""
}
