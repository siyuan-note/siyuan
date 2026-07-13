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
	"slices"
	"strings"

	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"

	"github.com/spf13/cobra"
)

var (
	workspacePath string
	outputFormat  string
	dryRun        bool
	logLevel      string
)

var rootCmd = &cobra.Command{
	Use:     "SiYuan-Kernel",
	Version: util.Ver,
	PersistentPostRunE: func(cmd *cobra.Command, args []string) error {
		// CLI 单次命令没有后台 cron 周期性 flush SQL 队列（server 模式才有 job.StartCron），进程在 main 返回后
		// 即退出，内存里的 SQL 索引队列会随进程丢失（操作虽已落 index.queue，但要等下次启动 recoverIndexQueue
		// 才恢复）。这里在命令执行完后统一落库，保证写完即可搜索。
		name := cmd.Name()
		// serve 子命令有自己的长驻退出流程（HandleSignal → model.Close 会 flush），不在此处理；
		// workspace 子命令在 PersistentPreRunE 中跳过了数据库初始化，此时 sql 包未就绪，调用会 panic。
		if name == "serve" || (cmd.Parent() != nil && cmd.Parent().Name() == "workspace") {
			return nil
		}
		model.FlushTxQueue()
		sql.FlushQueue()
		return nil
	},
	PersistentPreRunE: func(cmd *cobra.Command, args []string) error {
		// workspace 子命令不需要工作空间校验
		if cmd.Parent() != nil && cmd.Parent().Name() == "workspace" {
			return nil
		}

		// 默认工作目录取内核可执行文件所在目录的上一级（打包后的 resources/，appearance/、stage/ 所在目录），
		// 而非内核可执行文件所在目录本身（resources/kernel/）。resolveWorkingDir() 会校验 appearance/langs 实际存在，
		// 兼容开发态等多种目录布局。
		if workingDir := resolveWorkingDir(); workingDir != "" {
			util.WorkingDir = workingDir
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

		// CLI 单次命令默认 warn 级别（siyuan-cli.log 只保留警告及以上），避免内核初始化的大量 Info/Debug 日志噪声；
		// 用户可通过 --log-level 显式覆盖。把级别记入 util.CLILogLevel，使随后的 model.InitConf 不再用 conf.json 覆盖。
		// 注意 serve 子命令走自己的 PersistentPreRunE，不受此默认值影响，仍跟随 conf.json 的 system.logLevel。
		effectiveLevel := logLevel
		if "" == effectiveLevel {
			effectiveLevel = "warn"
		}
		logging.SetLogLevel(effectiveLevel)
		util.CLILogLevel = effectiveLevel

		model.InitConf()
		sql.InitDatabase(false)
		sql.InitHistoryDatabase(false)
		sql.InitAssetContentDatabase(false)
		sql.SetCaseSensitive(model.Conf.Search.CaseSensitive)
		sql.SetIndexAssetPath(model.Conf.Search.IndexAssetPath)
		// 让 CLI 一次性命令（如 search -m 4）也能命中语义搜索：StartEmbeddingIndexer 是死循环不能用于会立即退出的进程，这里只把开关置真
		model.PrepareEmbeddingSearch()
		if err := rejectEncryptedNotebookCLI(cmd, args); err != nil {
			return err
		}
		return nil
	},
}

// rejectEncryptedNotebookCLI 拒绝 CLI 对加密笔记本及其块的操作。
// 加密笔记本只能通过应用内专用流程解锁和操作，避免 CLI 进程成为明文或密文文件的旁路入口。
func rejectEncryptedNotebookCLI(cmd *cobra.Command, args []string) error {
	if cmd == serveCmd {
		return nil
	}
	if (cmd == notebookRandomIconCmd && !cmd.Flags().Changed("id")) || cmd == exportDataCmd {
		boxID, err := firstEncryptedNotebookID()
		if err != nil {
			return err
		}
		if boxID != "" {
			return fmt.Errorf("CLI does not support encrypted notebook [%s]", boxID)
		}
	}

	var encryptedTarget string
	checkID := func(id string) bool {
		if id == "" {
			return false
		}
		if model.IsEncryptedBox(id) {
			encryptedTarget = id
			return true
		}
		if bt := treenode.GetBlockTree(id); bt != nil && model.IsEncryptedBox(bt.BoxID) {
			encryptedTarget = bt.BoxID
			return true
		}
		return false
	}

	for _, flagName := range []string{"notebook", "box", "id", "ids", "parent", "previous", "block"} {
		flag := cmd.Flags().Lookup(flagName)
		if flag == nil {
			continue
		}
		values := []string{flag.Value.String()}
		if flag.Value.Type() == "stringArray" {
			values, _ = cmd.Flags().GetStringArray(flagName)
		}
		for _, value := range values {
			for id := range strings.SplitSeq(value, ",") {
				if checkID(strings.TrimSpace(id)) {
					return fmt.Errorf("CLI does not support encrypted notebook [%s]", encryptedTarget)
				}
			}
		}
	}

	if cmd.Parent() == fileCmd {
		if slices.ContainsFunc(args, isEncryptedNotebookWorkspacePath) {
			return fmt.Errorf("CLI does not support files in encrypted notebooks")
		}
		if pathFlag := cmd.Flags().Lookup("path"); pathFlag != nil && pathFlag.Value.String() != "" && isEncryptedNotebookWorkspacePath(pathFlag.Value.String()) {
			return fmt.Errorf("CLI does not support files in encrypted notebooks")
		}
	}
	if cmd.Parent() == assetCmd {
		if pathFlag := cmd.Flags().Lookup("path"); pathFlag != nil && pathFlag.Value.String() != "" {
			assetPath := pathFlag.Value.String()
			if !filepath.IsAbs(assetPath) {
				assetPath = filepath.Join("data", assetPath)
			}
			if isEncryptedNotebookWorkspacePath(assetPath) {
				return fmt.Errorf("CLI does not support files in encrypted notebooks")
			}
		}
	}
	return nil
}

func firstEncryptedNotebookID() (string, error) {
	boxes, err := model.ListNotebooks()
	if err != nil {
		return "", err
	}
	for _, box := range boxes {
		if model.IsEncryptedBox(box.ID) {
			return box.ID, nil
		}
	}
	return "", nil
}

// isEncryptedNotebookWorkspacePath 判断工作区内路径是否位于加密笔记本目录。
func isEncryptedNotebookWorkspacePath(p string) bool {
	return isEncryptedNotebookWorkspacePathWith(p, util.WorkspaceDir, util.DataDir, model.IsEncryptedBox)
}

func isEncryptedNotebookWorkspacePathWith(p, workspaceDir, dataDir string, isEncryptedBox func(string) bool) bool {
	abs := p
	if !filepath.IsAbs(abs) {
		abs = filepath.Join(workspaceDir, p)
	}
	rel, err := filepath.Rel(dataDir, filepath.Clean(abs))
	if err != nil || rel == "." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) || rel == ".." {
		return false
	}
	boxID := strings.Split(rel, string(filepath.Separator))[0]
	return isEncryptedBox(boxID)
}

// resolveWorkingDir 从内核可执行文件路径出发，探测若干候选目录，返回首个包含 appearance/langs 的目录作为
// 工作目录（打包后为 resources/，开发态视目录布局而定）；找不到返回空串。rootCmd.PersistentPreRunE 与
// serve 子命令的 --wd 默认值都走这个函数，确保两条启动路径行为一致。
func resolveWorkingDir() string {
	if exePath, err := os.Executable(); err == nil {
		if resolved, err2 := filepath.EvalSymlinks(exePath); err2 == nil {
			exePath = resolved
		}
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
	rootCmd.PersistentFlags().BoolVar(&dryRun, "dry-run", false, "dry run mode: validate and print what would happen without making changes")
	rootCmd.PersistentFlags().StringVarP(&logLevel, "log-level", "v", "", "log level: off | trace | debug | info | warn | error | fatal (defaults to conf.json system.logLevel)")
}

func Execute() error {
	return rootCmd.Execute()
}

func HasSubCommand(name string) bool {
	for _, c := range rootCmd.Commands() {
		if c.Name() == name {
			return true
		}
	}
	return false
}
