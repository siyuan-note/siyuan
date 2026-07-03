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
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/job"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/plugin"
	"github.com/siyuan-note/siyuan/kernel/server"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/util"

	"github.com/spf13/cobra"
)

// serve 子命令自己的 flag 值。--workspace 复用 rootCmd 的 persistent flag，不再重复声明。
var (
	serveWdPath         string
	servePort           string
	serveReadOnly       string
	serveAccessAuthCode string
	serveLang           string
	serveMode           string
	serveSSL            bool
	serveAttachUI       bool
	serveSafeMode       bool
)

var serveCmd = &cobra.Command{
	Use:   "serve",
	Short: "Start kernel HTTP server",
	Long:  "Start kernel HTTP server. All serving-related options below are passed to the kernel boot.",
	// 这些 flag 由 cobra 解析（见 init），serve -h 可直接列出全部参数。
	PersistentPreRunE: func(cmd *cobra.Command, args []string) error {
		// serve 绕过 root 的初始化，但 --log-level 需在 BootWithFlags（含 logBootInfo 等启动日志）之前应用，
		// 否则命令行指定的级别会被丢弃；同时记入 util.CLILogLevel，使随后的 model.InitConf 不再用 conf.json 覆盖。
		if "" != logLevel {
			logging.SetLogLevel(logLevel)
			util.CLILogLevel = logLevel
		}
		return nil // bypass root's init — BootWithFlags() handles it
	},
	Run: func(cmd *cobra.Command, args []string) {
		// --workspace 优先取 serve 自己的（rootCmd 的 persistent flag），兜底环境变量与默认值交给 util.BootWithFlags 内部处理（与原 Boot() 行为一致）。
		ws := workspacePath

		util.BootWithFlags(ws, serveWdPath, servePort, serveReadOnly, serveAccessAuthCode, serveLang, serveMode, serveSSL, serveAttachUI, serveSafeMode)

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
		go model.StartEmbeddingIndexer()

		model.WatchAssets()
		model.WatchEmojis()
		model.WatchThemes()
		model.HandleSignal()
	},
}

func init() {
	// --wd 默认值取内核可执行文件所在目录的上一级（打包后的 resources/，appearance/、stage/ 所在目录），
	// 与 rootCmd.PersistentPreRunE 走同一个 resolveWorkingDir()，确保两条启动路径行为一致。
	serveCmd.Flags().StringVar(&serveWdPath, "wd", resolveWorkingDir(), "working directory of SiYuan")
	serveCmd.Flags().StringVar(&servePort, "port", "0", "port of the HTTP server")
	serveCmd.Flags().StringVar(&serveReadOnly, "readonly", "false", "read-only mode")
	serveCmd.Flags().StringVar(&serveAccessAuthCode, "accessAuthCode", "", "access auth code")
	serveCmd.Flags().StringVar(&serveLang, "lang", "", "ar/de/en/es/fr/he/hi/id/it/ja/ko/nl/pl/pt-BR/ru/sk/th/tr/uk/zh-CN/zh-TW")
	serveCmd.Flags().StringVar(&serveMode, "mode", "prod", "dev/prod")
	serveCmd.Flags().BoolVar(&serveSSL, "ssl", false, "for https and wss")
	serveCmd.Flags().BoolVar(&serveAttachUI, "attach-ui", false, "attach kernel lifecycle to desktop UI process (used by Electron)")
	serveCmd.Flags().BoolVar(&serveSafeMode, "safe-mode", false, "boot in safe mode")

	rootCmd.AddCommand(serveCmd)
}
