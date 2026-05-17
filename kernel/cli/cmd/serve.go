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

package cmd

import (
	"os"
	"path/filepath"

	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/job"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/plugin"
	"github.com/siyuan-note/siyuan/kernel/server"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/util"

	"github.com/spf13/cobra"
)

var serveCmd = &cobra.Command{
	Use:   "serve",
	Short: "Start kernel HTTP server",
	FParseErrWhitelist: cobra.FParseErrWhitelist{UnknownFlags: true},
	PersistentPreRunE: func(cmd *cobra.Command, args []string) error {
		return nil // bypass root's init — Boot() handles it
	},
	Run: func(cmd *cobra.Command, args []string) {
		// Boot() uses flag.Parse() which expects raw --flags, not a cobra subcommand
		// Strip the "serve" subcommand from os.Args before calling Boot()
		saved := os.Args
		newArgs := make([]string, 1, len(os.Args))
		newArgs[0] = os.Args[0]
		for i := 1; i < len(os.Args); i++ {
			if i == 1 && os.Args[1] == "serve" {
				continue
			}
			newArgs = append(newArgs, os.Args[i])
		}
		os.Args = newArgs
		defer func() { os.Args = saved }()

		// 设置工作目录为可执行文件所在目录
		if exePath, err := os.Executable(); err == nil {
			util.WorkingDir = filepath.Dir(exePath)
		}

		util.Boot()

		model.InitJwtKey()
		model.InitConf()
		go server.Serve(false, model.Conf.CookieKey)
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
		go plugin.InitManager()

		model.WatchAssets()
		model.WatchEmojis()
		model.WatchThemes()
		model.HandleSignal()
	},
}

func init() {
	rootCmd.AddCommand(serveCmd)
}
