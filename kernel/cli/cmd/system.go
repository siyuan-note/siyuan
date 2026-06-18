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
