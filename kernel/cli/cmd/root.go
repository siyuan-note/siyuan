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
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"

	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/util"

	"github.com/spf13/cobra"
)

var (
	workspacePath string
	outputFormat  string
)

var rootCmd = &cobra.Command{
	Use:     "SiYuan-Kernel",
	Version: util.Ver,
	PersistentPreRunE: func(cmd *cobra.Command, args []string) error {
		// 确定工作目录
		if exePath, err := os.Executable(); err == nil {
			util.WorkingDir = filepath.Dir(exePath)
		}

		// 尝试在常见位置查找 appearance 目录
		appDir := findAppDir()
		if appDir != "" {
			util.WorkingDir = appDir
		}

		langsDir := filepath.Join(util.WorkingDir, "appearance", "langs")
		if _, err := os.Stat(langsDir); os.IsNotExist(err) {
			return fmt.Errorf("appearance files not found at [%s]", langsDir)
		}

		// 设置工作空间路径
		if workspacePath == "" {
			workspacePath = os.Getenv("SIYUAN_WORKSPACE_PATH")
		}
		if workspacePath == "" {
			workspacePath = filepath.Join(util.HomeDir, "SiYuan")
		}

		if _, err := os.Stat(workspacePath); os.IsNotExist(err) {
			return fmt.Errorf("directory not found: %s", workspacePath)
		}
		if !util.IsWorkspaceDir(workspacePath) {
			return fmt.Errorf("not a valid workspace: %s", workspacePath)
		}

		util.Mode = "prod"
		util.InitWorkspace(workspacePath, util.WorkingDir)

		logging.SetLogPath(filepath.Join(util.TempDir, "siyuan-cli.log"))
		logging.SetLogToStdout(false)

		model.InitConf()
		sql.InitDatabase(false)
		sql.InitHistoryDatabase(false)
		sql.InitAssetContentDatabase(false)
		sql.SetCaseSensitive(model.Conf.Search.CaseSensitive)
		sql.SetIndexAssetPath(model.Conf.Search.IndexAssetPath)
		return nil
	},
}

func findAppDir() string {
	if exePath, err := os.Executable(); err == nil {
		exeDir := filepath.Dir(exePath)
		candidates := []string{
			filepath.Join(exeDir, ".."),              // resources/kernel/ → resources/ (production)
			filepath.Join(exeDir, "..", "app"),       // kernel/cli/ → kernel/ → app/
			filepath.Join(exeDir, "app"),             // kernel/ → app/
			filepath.Join(exeDir, "..", "..", "app"), // kernel/cli/cmd/... → .../app/
		}
		// 添加 macOS app bundle 路径
		if runtime.GOOS == "darwin" {
			candidates = append(candidates,
				filepath.Join(exeDir, "..", "..", "..", "..", "Resources"),
			)
		}
		for _, d := range candidates {
			langsDir := filepath.Join(d, "appearance", "langs")
			if fi, err := os.Stat(langsDir); err == nil && fi.IsDir() {
				return d
			}
		}
	}
	return ""
}

func init() {
	rootCmd.Use = strings.TrimSuffix(filepath.Base(os.Args[0]), ".exe")
	rootCmd.Short = "SiYuan Kernel v" + util.Ver
	rootCmd.Long = "SiYuan Kernel v" + util.Ver + ". Manage workspace data directly or start the HTTP server."

	rootCmd.PersistentFlags().StringVarP(&workspacePath, "workspace", "w", "", "workspace path")
	rootCmd.PersistentFlags().StringVarP(&outputFormat, "format", "f", "table", "output format: table | json")
}

func Execute() error {
	return rootCmd.Execute()
}
