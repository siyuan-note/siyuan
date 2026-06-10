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

	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"

	"github.com/spf13/cobra"
)

var dailynoteCmd = &cobra.Command{
	Use:   "dailynote",
	Short: "Daily note (dailynote) operations",
}

var dailynoteCreateCmd = &cobra.Command{
	Use:   "create --notebook <id>",
	Short: "Create today's daily note",
	RunE: func(cmd *cobra.Command, args []string) error {
		notebook, _ := cmd.Flags().GetString("notebook")
		if notebook == "" {
			return fmt.Errorf("--notebook is required")
		}

		if dryRun {
			fmt.Printf("[dry-run] Would create daily note in notebook %s\n", notebook)
			return nil
		}

		p, _, err := model.CreateDailyNote(notebook)
		if err != nil {
			return err
		}

		model.FlushTxQueue()
		model.AppendPushReloadFiletreeEntry()

		id := util.GetTreeID(p)
		fmt.Println(id)
		return nil
	},
}

var dailynoteAppendCmd = &cobra.Command{
	Use:   "append --notebook <id> [--data <markdown> | --file <path>]",
	Short: "Append block to today's daily note",
	RunE: func(cmd *cobra.Command, args []string) error {
		notebook, _ := cmd.Flags().GetString("notebook")
		if notebook == "" {
			return fmt.Errorf("--notebook is required")
		}

		if dryRun {
			fmt.Printf("[dry-run] Would ensure daily note in notebook %s and append block\n", notebook)
			return nil
		}

		data, err := resolveData(cmd)
		if err != nil {
			return err
		}

		p, _, err := model.CreateDailyNote(notebook)
		if err != nil {
			return err
		}

		parentID := util.GetTreeID(p)
		dom := markdownToBlockDOM(data)
		transactions := []*model.Transaction{{
			DoOperations: []*model.Operation{{
				Action:   "appendInsert",
				Data:     dom,
				ParentID: parentID,
			}},
		}}
		model.PerformTransactions(&transactions)
		model.FlushTxQueue()
		model.AppendPushReloadProtyleEntry(parentID)
		fmt.Println(parentID)
		return nil
	},
}

var dailynotePrependCmd = &cobra.Command{
	Use:   "prepend --notebook <id> [--data <markdown> | --file <path>]",
	Short: "Prepend block to today's daily note",
	RunE: func(cmd *cobra.Command, args []string) error {
		notebook, _ := cmd.Flags().GetString("notebook")
		if notebook == "" {
			return fmt.Errorf("--notebook is required")
		}

		if dryRun {
			fmt.Printf("[dry-run] Would ensure daily note in notebook %s and prepend block\n", notebook)
			return nil
		}

		data, err := resolveData(cmd)
		if err != nil {
			return err
		}

		p, _, err := model.CreateDailyNote(notebook)
		if err != nil {
			return err
		}

		parentID := util.GetTreeID(p)
		dom := markdownToBlockDOM(data)
		transactions := []*model.Transaction{{
			DoOperations: []*model.Operation{{
				Action:   "prependInsert",
				Data:     dom,
				ParentID: parentID,
			}},
		}}
		model.PerformTransactions(&transactions)
		model.FlushTxQueue()
		model.AppendPushReloadProtyleEntry(parentID)
		fmt.Println(parentID)
		return nil
	},
}

func init() {
	dailynoteCreateCmd.Flags().String("notebook", "", "notebook ID")

	dailynoteAppendCmd.Flags().String("notebook", "", "notebook ID")
	dailynoteAppendCmd.Flags().String("data", "", "markdown content")
	dailynoteAppendCmd.Flags().String("file", "", "read content from file path (- for stdin)")

	dailynotePrependCmd.Flags().String("notebook", "", "notebook ID")
	dailynotePrependCmd.Flags().String("data", "", "markdown content")
	dailynotePrependCmd.Flags().String("file", "", "read content from file path (- for stdin)")

	rootCmd.AddCommand(dailynoteCmd)
	dailynoteCmd.AddCommand(dailynoteCreateCmd)
	dailynoteCmd.AddCommand(dailynoteAppendCmd)
	dailynoteCmd.AddCommand(dailynotePrependCmd)
}
