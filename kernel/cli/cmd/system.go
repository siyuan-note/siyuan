// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package cmd

import (
	"encoding/json"
	"fmt"
	"time"

	"github.com/siyuan-note/siyuan/kernel/util"

	"github.com/spf13/cobra"
)

var systemCmd = &cobra.Command{
	Use:   "system",
	Short: "System information",
}

var systemCurrentTimeCmd = &cobra.Command{
	Use:   "current-time",
	Short: "Show current server time",
	RunE: func(cmd *cobra.Command, args []string) error {
		t := time.UnixMilli(util.CurrentTimeMillis())
		switch outputFormat {
		case "json":
			data, _ := json.MarshalIndent(map[string]string{"time": t.Format(time.RFC3339)}, "", "  ")
			fmt.Println(string(data))
		default:
			fmt.Println(t.Format(time.RFC3339))
		}
		return nil
	},
}

func init() {
	rootCmd.AddCommand(systemCmd)
	systemCmd.AddCommand(systemCurrentTimeCmd)
}
