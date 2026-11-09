// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package cmd

import (
	"encoding/json"
	"fmt"
	"os"
	"regexp"

	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/util"
	"github.com/spf13/cobra"
)

var fontLanguagePattern = regexp.MustCompile(`^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$`)

// 字体工具绕过工作空间与数据库的前后置流程，输出供独立桌面窗口读取的 JSON。
func newSystemFontsCmd(loadFonts func() []*util.Font) *cobra.Command {
	var language string
	command := &cobra.Command{
		Use: "fonts", Short: "List system fonts as JSON without opening a workspace", Args: cobra.NoArgs,
		PersistentPreRunE:  func(*cobra.Command, []string) error { return nil },
		PersistentPostRunE: func(*cobra.Command, []string) error { return nil },
		RunE: func(cmd *cobra.Command, _ []string) error {
			normalized := util.LangToBCP47(language)
			if len(normalized) > 32 || !fontLanguagePattern.MatchString(normalized) {
				return fmt.Errorf("invalid font language: %q", language)
			}
			// 系统字体解析中的损坏文件或平台警告不能污染 JSON，也不能创建工作目录日志。
			logging.SetLogPath(os.DevNull)
			logging.SetLogToStdout(false)
			oldLanguage := util.Lang
			util.Lang = normalized
			defer func() { util.Lang = oldLanguage }()
			fonts := loadFonts()
			if fonts == nil {
				fonts = []*util.Font{}
			}
			return json.NewEncoder(cmd.OutOrStdout()).Encode(fonts)
		},
	}
	command.Flags().StringVar(&language, "lang", "en", "font display name language (BCP 47 or legacy SiYuan language code)")
	return command
}

func init() {
	systemCmd.AddCommand(newSystemFontsCmd(util.ReadSysFonts))
}
