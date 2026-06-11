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

	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"

	"github.com/spf13/cobra"
)

var historyCmd = &cobra.Command{
	Use:   "history",
	Short: "Data history",
}

var historyListCmd = &cobra.Command{
	Use:   "list",
	Short: "List all history",
	RunE: func(cmd *cobra.Command, args []string) error {
		return runHistoryQuery("", cmd)
	},
}

var historySearchCmd = &cobra.Command{
	Use:   "search <query>",
	Short: "Search history",
	Args:  cobra.MinimumNArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		return runHistoryQuery(args[0], cmd)
	},
}

func runHistoryQuery(query string, cmd *cobra.Command) error {
	box, _ := cmd.Flags().GetString("notebook")
	op, _ := cmd.Flags().GetString("op")
	typ, _ := cmd.Flags().GetInt("type")
	page, _ := cmd.Flags().GetInt("page")
	if page < 1 {
		page = 1
	}

	timestamps, pageCount, totalCount := model.FullTextSearchHistory(query, box, op, typ, page)

	switch outputFormat {
	case "json":
		result := map[string]any{
			"timestamps": timestamps,
			"pageCount":  pageCount,
			"totalCount": totalCount,
		}
		data, _ := json.MarshalIndent(result, "", "  ")
		fmt.Println(string(data))
	default:
		if len(timestamps) == 0 {
			fmt.Println("No history found.")
			return nil
		}
		for _, ts := range timestamps {
			items := model.FullTextSearchHistoryItems(ts, query, box, op, typ)
			fmt.Printf("[%s] %d item(s)\n", ts, len(items))
			for _, item := range items {
				fmt.Printf("  %-8s %s  %s\n", item.Op, truncate(item.Title, 60), item.Path)
			}
		}
		fmt.Printf("\nPage %d/%d, %d total\n", page, pageCount, totalCount)
	}
	return nil
}

var historyGetCmd = &cobra.Command{
	Use:   "get --path <path>",
	Short: "Get historical file content",
	RunE: func(cmd *cobra.Command, args []string) error {
		historyPath, _ := cmd.Flags().GetString("path")
		if historyPath == "" {
			return fmt.Errorf("--path is required")
		}

		_, _, content, _, err := model.GetDocHistoryContent(historyPath, "", false)
		if err != nil {
			return err
		}
		fmt.Print(content)
		return nil
	},
}

var historyRollbackCmd = &cobra.Command{
	Use:   "rollback --path <path>",
	Short: "Rollback a document to historical version",
	RunE: func(cmd *cobra.Command, args []string) error {
		historyPath, _ := cmd.Flags().GetString("path")
		if historyPath == "" {
			return fmt.Errorf("--path is required")
		}

		if dryRun {
			fmt.Printf("[dry-run] Would rollback to history version: %s\n", historyPath)
			return nil
		}

		if err := model.RollbackDocHistory(historyPath); err != nil {
			return err
		}
		docID := util.GetTreeID(historyPath)
		if bt := treenode.GetBlockTree(docID); bt != nil {
			model.AppendPushReloadProtyleEntry(bt.RootID)
		}
		model.AppendPushReloadFiletreeEntry()
		fmt.Println("ok")
		return nil
	},
}

var historyClearCmd = &cobra.Command{
	Use:   "clear",
	Short: "Clear all history",
	RunE: func(cmd *cobra.Command, args []string) error {
		if dryRun {
			fmt.Println("[dry-run] Would clear all history")
			return nil
		}

		if err := model.ClearWorkspaceHistory(); err != nil {
			return err
		}
		fmt.Println("ok")
		return nil
	},
}

func init() {
	historyListCmd.Flags().String("notebook", "", "notebook ID filter")
	historyListCmd.Flags().String("op", "", "operation filter (delete, update, create)")
	historyListCmd.Flags().IntP("type", "t", 1, "type: 0=doc-name 1=doc-content 2=asset 3=doc-id 4=database")
	historyListCmd.Flags().IntP("page", "p", 1, "page number")

	historySearchCmd.Flags().String("notebook", "", "notebook ID filter")
	historySearchCmd.Flags().String("op", "", "operation filter (delete, update, create)")
	historySearchCmd.Flags().IntP("type", "t", 1, "type: 0=doc-name 1=doc-content 2=asset 3=doc-id 4=database")
	historySearchCmd.Flags().IntP("page", "p", 1, "page number")

	historyGetCmd.Flags().String("path", "", "history file path")

	historyRollbackCmd.Flags().String("path", "", "history file path")

	rootCmd.AddCommand(historyCmd)
	historyCmd.AddCommand(historyListCmd)
	historyCmd.AddCommand(historySearchCmd)
	historyCmd.AddCommand(historyGetCmd)
	historyCmd.AddCommand(historyRollbackCmd)
	historyCmd.AddCommand(historyClearCmd)
}
