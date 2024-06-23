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

//go:build !mobile

package main

import (
	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/job"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/server"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func main() {
	util.Boot()

	model.InitConf()
	go server.Serve(false)
	model.InitAppearance()
	sql.InitDatabase(false)
	sql.InitHistoryDatabase(false)
	sql.InitAssetContentDatabase(false)
	sql.SetCaseSensitive(model.Conf.Search.CaseSensitive)
	sql.SetIndexAssetPath(model.Conf.Search.IndexAssetPath)

	model.BootSyncData()
	model.InitBoxes()
	model.LoadFlashcards()
	util.LoadAssetsTexts()

	util.SetBooted()
	util.PushClearAllMsg()

	job.StartCron()
	go model.AutoGenerateFileHistory()
	go cache.LoadAssets()
	go util.CheckFileSysStatus()

	model.WatchAssets()
	model.WatchEmojis()
	model.HandleSignal()
}
