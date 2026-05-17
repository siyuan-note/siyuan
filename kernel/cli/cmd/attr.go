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
	"os"
	"sort"
	"strings"
	"text/tabwriter"

	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/sql"

	"github.com/spf13/cobra"
)

var attrCmd = &cobra.Command{
	Use:   "attr",
	Short: "Manage block attributes",
}

var attrGetCmd = &cobra.Command{
	Use:   "get --id <id>",
	Short: "Get block attributes",
	RunE: func(cmd *cobra.Command, args []string) error {
		id, _ := cmd.Flags().GetString("id")
		if id == "" {
			return fmt.Errorf("--id is required")
		}

		attrs := sql.GetBlockAttrs(id)
		switch outputFormat {
		case "json":
			data, _ := json.MarshalIndent(attrs, "", "  ")
			fmt.Println(string(data))
		default:
			printAttrTable(attrs)
		}
		return nil
	},
}

var attrSetCmd = &cobra.Command{
	Use:   "set --id <id> --attr name=value",
	Short: "Set block attributes",
	RunE: func(cmd *cobra.Command, args []string) error {
		id, _ := cmd.Flags().GetString("id")
		if id == "" {
			return fmt.Errorf("--id is required")
		}

		attrFlags, _ := cmd.Flags().GetStringArray("attr")
		if len(attrFlags) == 0 {
			return fmt.Errorf("--attr is required (format: name=value)")
		}

		nameValues := make(map[string]string, len(attrFlags))
		for _, a := range attrFlags {
			parts := strings.SplitN(a, "=", 2)
			if len(parts) != 2 {
				return fmt.Errorf("invalid attr format [%s], expected name=value", a)
			}
			nameValues[strings.TrimSpace(parts[0])] = parts[1]
		}

		if err := model.SetBlockAttrs(id, nameValues); err != nil {
			return err
		}
		model.AppendPushReloadFiletreeEntry()
		fmt.Println("ok")
		return nil
	},
}

var attrBatchGetCmd = &cobra.Command{
	Use:   "batch-get --ids id1,id2,...",
	Short: "Batch get block attributes",
	RunE: func(cmd *cobra.Command, args []string) error {
		idsStr, _ := cmd.Flags().GetString("ids")
		if idsStr == "" {
			return fmt.Errorf("--ids is required")
		}

		ids := strings.Split(idsStr, ",")
		for i := range ids {
			ids[i] = strings.TrimSpace(ids[i])
		}

		attrs := sql.BatchGetBlockAttrs(ids)
		switch outputFormat {
		case "json":
			data, _ := json.MarshalIndent(attrs, "", "  ")
			fmt.Println(string(data))
		default:
			for id, a := range attrs {
				fmt.Printf("\n[%s]\n", id)
				printAttrTable(a)
			}
		}
		return nil
	},
}

func printAttrTable(attrs map[string]string) {
	if len(attrs) == 0 {
		fmt.Println("(empty)")
		return
	}

	keys := make([]string, 0, len(attrs))
	for k := range attrs {
		keys = append(keys, k)
	}
	sort.Strings(keys)

	w := tabwriter.NewWriter(os.Stdout, 0, 0, 2, ' ', 0)
	fmt.Fprintln(w, "NAME\tVALUE")
	for _, k := range keys {
		fmt.Fprintf(w, "%s\t%s\n", k, attrs[k])
	}
	w.Flush()
}

func init() {
	attrGetCmd.Flags().String("id", "", "block ID")
	attrSetCmd.Flags().String("id", "", "block ID")
	attrSetCmd.Flags().StringArray("attr", nil, "attribute in name=value format (repeatable)")
	attrBatchGetCmd.Flags().String("ids", "", "comma-separated block IDs")

	rootCmd.AddCommand(attrCmd)
	attrCmd.AddCommand(attrGetCmd)
	attrCmd.AddCommand(attrSetCmd)
	attrCmd.AddCommand(attrBatchGetCmd)
}
