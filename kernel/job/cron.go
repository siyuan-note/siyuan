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

package job

import (
	"time"

	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/task"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func StartCron() {
	go every(100*time.Millisecond, task.ExecTaskJob)
	go every(5*time.Second, task.StatusJob)
	go every(5*time.Second, treenode.SaveBlockTreeJob)
	go every(5*time.Second, model.SyncDataJob)
	go every(2*time.Hour, model.StatJob)
	go every(2*time.Hour, model.RefreshCheckJob)
	go every(3*time.Second, model.FlushUpdateRefTextRenameDocJob)
	go every(50*time.Millisecond, model.FlushTxJob)
	go every(util.SQLFlushInterval, sql.FlushTxJob)
	go every(util.SQLFlushInterval, sql.FlushHistoryTxJob)
	go every(10*time.Minute, model.FixIndexJob)
	go every(10*time.Minute, model.IndexEmbedBlockJob)
	go every(10*time.Minute, model.CacheVirtualBlockRefJob)
	go every(12*time.Second, model.OCRAssetsJob)
	go every(12*time.Second, model.FlushAssetsTextsJob)
	go every(30*time.Second, model.HookDesktopUIProcJob)
}

func every(interval time.Duration, f func()) {
	util.RandomSleep(50, 200)
	for {
		func() {
			defer logging.Recover()
			f()
		}()

		time.Sleep(interval)
	}
}
