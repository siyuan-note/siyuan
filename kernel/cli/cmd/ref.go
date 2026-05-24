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

var refCmd = &cobra.Command{
	Use:   "ref",
	Short: "Backlinks and references",
}

var refBacklinksCmd = &cobra.Command{
	Use:   "backlinks --id <id>",
	Short: "Get backlinks for a block",
	RunE: func(cmd *cobra.Command, args []string) error {
		id, _ := cmd.Flags().GetString("id")
		if id == "" {
			return fmt.Errorf("--id is required")
		}

		keyword, _ := cmd.Flags().GetString("keyword")
		sortMode, _ := cmd.Flags().GetInt("sort")

		_, backlinks, _, count, _ := model.GetBacklink2(id, keyword, "", sortMode, 0, false)

		switch outputFormat {
		case "json":
			data, _ := json.MarshalIndent(backlinks, "", "  ")
			fmt.Println(string(data))
		default:
			printPathTable(backlinks, false)
		}

		fmt.Printf("\n%d backlink(s)\n", count)
		return nil
	},
}

var refMentionsCmd = &cobra.Command{
	Use:   "mentions --id <id>",
	Short: "Get mentions for a block",
	RunE: func(cmd *cobra.Command, args []string) error {
		id, _ := cmd.Flags().GetString("id")
		if id == "" {
			return fmt.Errorf("--id is required")
		}

		keyword, _ := cmd.Flags().GetString("keyword")
		sortMode, _ := cmd.Flags().GetInt("sort")

		_, _, backmentions, _, count := model.GetBacklink2(id, "", keyword, 0, sortMode, false)

		switch outputFormat {
		case "json":
			data, _ := json.MarshalIndent(backmentions, "", "  ")
			fmt.Println(string(data))
		default:
			printPathTable(backmentions, false)
		}

		fmt.Printf("\n%d mention(s)\n", count)
		return nil
	},
}

var refRefreshCmd = &cobra.Command{
	Use:   "refresh --id <id>",
	Short: "Refresh backlinks for a block",
	RunE: func(cmd *cobra.Command, args []string) error {
		id, _ := cmd.Flags().GetString("id")
		if id == "" {
			return fmt.Errorf("--id is required")
		}

		model.RefreshBacklink(id)
		fmt.Println("ok")
		return nil
	},
}

func printPathTable(paths []*model.Path, showBox bool) {
	if len(paths) == 0 {
		fmt.Println("(none)")
		return
	}

	w := tabwriter.NewWriter(os.Stdout, 0, 0, 2, ' ', 0)
	if showBox {
		fmt.Fprintln(w, "ID\tTYPE\tNAME\tHPATH\tCOUNT")
	} else {
		fmt.Fprintln(w, "ID\tTYPE\tNAME\tCOUNT")
	}
	for _, p := range paths {
		name := p.Name
		if name == "" {
			name = truncate(p.HPath, 40)
		}
		if showBox {
			fmt.Fprintf(w, "%s\t%s\t%s\t%s\t%d\n", p.ID, p.NodeType, name, p.HPath, p.Count)
		} else {
			fmt.Fprintf(w, "%s\t%s\t%s\t%d\n", p.ID, p.NodeType, name, p.Count)
		}
	}
	w.Flush()
}

func init() {
	refBacklinksCmd.Flags().String("id", "", "block ID")
	refBacklinksCmd.Flags().String("keyword", "", "filter by keyword")
	refBacklinksCmd.Flags().Int("sort", 0, "sort: 0=updated-desc 1=updated-asc 2=created-desc 3=created-asc 4=name-desc 5=name-asc 6=alphanum-desc 7=alphanum-asc")

	refMentionsCmd.Flags().String("id", "", "block ID")
	refMentionsCmd.Flags().String("keyword", "", "filter by keyword")
	refMentionsCmd.Flags().Int("sort", 0, "sort: 0=updated-desc 1=updated-asc 2=created-desc 3=created-asc 4=name-desc 5=name-asc 6=alphanum-desc 7=alphanum-asc")

	refRefreshCmd.Flags().String("id", "", "block ID")

	rootCmd.AddCommand(refCmd)
	refCmd.AddCommand(refBacklinksCmd)
	refCmd.AddCommand(refMentionsCmd)
	refCmd.AddCommand(refRefreshCmd)
}
