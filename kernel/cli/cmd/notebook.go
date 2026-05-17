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
	"text/tabwriter"

	"github.com/siyuan-note/siyuan/kernel/model"

	"github.com/spf13/cobra"
)

var notebookCmd = &cobra.Command{
	Use:   "notebook",
	Short: "Manage notebooks",
}

var notebookListCmd = &cobra.Command{
	Use:   "list",
	Short: "List all notebooks",
	RunE: func(cmd *cobra.Command, args []string) error {
		boxes, err := model.ListNotebooks()
		if err != nil {
			return err
		}
		switch outputFormat {
		case "json":
			data, _ := json.MarshalIndent(boxes, "", "  ")
			fmt.Println(string(data))
		default:
			printNotebookTable(boxes)
		}
		return nil
	},
}

var notebookCreateCmd = &cobra.Command{
	Use:   "create --name <name>",
	Short: "Create a notebook",
	RunE: func(cmd *cobra.Command, args []string) error {
		name, _ := cmd.Flags().GetString("name")
		if name == "" {
			return fmt.Errorf("--name is required")
		}
		id, err := model.CreateBox(name)
		if err != nil {
			return err
		}
		model.AppendPushReloadFiletreeEntry()
		fmt.Println(id)
		return nil
	},
}

var notebookRemoveCmd = &cobra.Command{
	Use:   "remove --id <id>",
	Short: "Remove a notebook",
	RunE: func(cmd *cobra.Command, args []string) error {
		id, _ := cmd.Flags().GetString("id")
		if id == "" {
			return fmt.Errorf("--id is required")
		}
		if err := model.RemoveBox(id); err != nil {
			return err
		}
		model.AppendPushReloadFiletreeEntry()
		fmt.Println(id)
		return nil
	},
}

var notebookRenameCmd = &cobra.Command{
	Use:   "rename --id <id> --name <name>",
	Short: "Rename a notebook",
	RunE: func(cmd *cobra.Command, args []string) error {
		id, _ := cmd.Flags().GetString("id")
		name, _ := cmd.Flags().GetString("name")
		if id == "" {
			return fmt.Errorf("--id is required")
		}
		if name == "" {
			return fmt.Errorf("--name is required")
		}
		if err := model.RenameBox(id, name); err != nil {
			return err
		}
		model.AppendPushReloadFiletreeEntry()
		return nil
	},
}

func printNotebookTable(boxes []*model.Box) {
	w := tabwriter.NewWriter(os.Stdout, 0, 0, 2, ' ', 0)
	fmt.Fprintln(w, "ID\tNAME\tCLOSED\tSORT")
	for _, b := range boxes {
		fmt.Fprintf(w, "%s\t%s\t%v\t%d\n", b.ID, b.Name, b.Closed, b.Sort)
	}
	w.Flush()
}

func init() {
	notebookCreateCmd.Flags().String("name", "", "notebook name")
	notebookRemoveCmd.Flags().String("id", "", "notebook ID")
	notebookRenameCmd.Flags().String("id", "", "notebook ID")
	notebookRenameCmd.Flags().String("name", "", "new notebook name")

	rootCmd.AddCommand(notebookCmd)
	notebookCmd.AddCommand(notebookListCmd)
	notebookCmd.AddCommand(notebookCreateCmd)
	notebookCmd.AddCommand(notebookRemoveCmd)
	notebookCmd.AddCommand(notebookRenameCmd)
}
