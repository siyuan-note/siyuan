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

package job

import (
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/task"
	"github.com/siyuan-note/siyuan/kernel/util"
	"time"

	"github.com/go-co-op/gocron"
	"github.com/siyuan-note/siyuan/kernel/treenode"
)

func StartCron() {
	s := gocron.NewScheduler(time.Local)
	s.Every(1).Seconds().Do(task.ExecTaskJob)
	s.Every(5).Seconds().Do(task.StatusJob)
	s.Every(1).Second().Do(treenode.SaveBlockTreeJob)
	s.Every(5).Seconds().Do(model.SyncDataJob)
	s.Every(2).Hours().Do(model.StatJob)
	s.Every(2).Hours().Do(model.RefreshCheckJob)
	s.Every(3).Seconds().Do(model.FlushUpdateRefTextRenameDocJob)
	s.Every(2).Seconds().Do(model.FlushTxJob)
	s.Every(util.SQLFlushInterval).Do(sql.FlushTxJob)
	s.Every(10).Minutes().Do(model.FixIndexJob)
	s.Every(10).Minutes().Do(model.IndexEmbedBlockJob)
	s.Every(7).Seconds().Do(model.OCRAssetsJob)
	s.Every(7).Seconds().Do(model.FlushAssetsTextsJob)
	s.Every(30).Seconds().Do(model.HookDesktopUIProcJob)
	s.StartAsync()
}
