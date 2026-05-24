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

var searchCmd = &cobra.Command{
	Use:   "search <query>",
	Short: "Full-text search",
	Args:  cobra.MinimumNArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		query := args[0]
		notebooks, _ := cmd.Flags().GetStringArray("notebook")
		paths, _ := cmd.Flags().GetStringArray("path")
		typeFlags, _ := cmd.Flags().GetStringArray("type")
		subtypeFlags, _ := cmd.Flags().GetStringArray("subtype")
		method, _ := cmd.Flags().GetInt("method")
		orderBy, _ := cmd.Flags().GetInt("order-by")
		page, _ := cmd.Flags().GetInt("page")
		pageSize, _ := cmd.Flags().GetInt("page-size")
		groupBy, _ := cmd.Flags().GetInt("group-by")

		if page < 1 {
			page = 1
		}
		if pageSize < 1 {
			pageSize = 32
		}

		types := stringSliceToMap(typeFlags)
		subTypes := stringSliceToMap(subtypeFlags)

		blocks, matchedBlockCount, matchedRootCount, pageCount, docMode :=
			model.FullTextSearchBlock(query, notebooks, paths, types, subTypes, method, orderBy, groupBy, page, pageSize)

		switch outputFormat {
		case "json":
			result := map[string]any{
				"blocks":             blocks,
				"matchedBlockCount":  matchedBlockCount,
				"matchedRootCount":   matchedRootCount,
				"pageCount":          pageCount,
				"docMode":            docMode,
			}
			data, _ := json.MarshalIndent(result, "", "  ")
			fmt.Println(string(data))
		default:
			printSearchResult(blocks, matchedBlockCount, matchedRootCount, pageCount, docMode, page, pageSize, groupBy)
		}
		return nil
	},
}

func printSearchResult(blocks []*model.Block, matchedBlockCount, matchedRootCount, pageCount int, docMode bool, page, pageSize, groupBy int) {
	if len(blocks) == 0 {
		fmt.Println("No results found.")
		return
	}

	w := tabwriter.NewWriter(os.Stdout, 0, 0, 2, ' ', 0)
	fmt.Fprintln(w, "ID\tTYPE\tNAME\tHPATH")
	for _, b := range blocks {
		title := b.Name
		if title == "" {
			title = truncate(b.Content, 60)
		}
		fmt.Fprintf(w, "%s\t%s\t%s\t%s\n", b.ID, b.Type, title, b.HPath)
	}
	w.Flush()

	fmt.Printf("\nShowing results %d-%d", (page-1)*pageSize+1, (page-1)*pageSize+len(blocks))
	if groupBy == 1 {
		fmt.Printf(" (grouped by document)")
	}
	fmt.Printf(" | %d blocks matched, %d pages", matchedBlockCount, pageCount)
	if groupBy == 0 && matchedRootCount > 0 {
		fmt.Printf(", %d documents matched", matchedRootCount)
	}
	fmt.Println()
}

func truncate(s string, maxLen int) string {
	if len(s) <= maxLen {
		return s
	}
	return s[:maxLen] + "..."
}

func stringSliceToMap(s []string) map[string]bool {
	if len(s) == 0 {
		return nil
	}
	m := make(map[string]bool, len(s))
	for _, v := range s {
		m[v] = true
	}
	return m
}

func init() {
	searchCmd.Flags().StringArrayP("notebook", "n", nil, "notebook ID filter (repeatable)")
	searchCmd.Flags().StringArray("path", nil, "path prefix filter (repeatable)")
	searchCmd.Flags().StringArrayP("type", "t", nil, "block type filter, repeatable (document heading paragraph list listItem codeBlock mathBlock table blockquote superBlock htmlBlock embedBlock databaseBlock audioBlock videoBlock iframeBlock widgetBlock callout)")
	searchCmd.Flags().StringArray("subtype", nil, "block subtype filter, repeatable (o u t)")
	searchCmd.Flags().IntP("method", "m", 0, "search method: 0=keyword 1=query-syntax 2=sql 3=regex")
	searchCmd.Flags().IntP("order-by", "o", 0, "order: 0=type 1=created-asc 2=created-desc 3=updated-asc 4=updated-desc 5=content 6=relevance-asc 7=relevance-desc")
	searchCmd.Flags().IntP("page", "p", 1, "page number")
	searchCmd.Flags().IntP("page-size", "s", 32, "results per page")
	searchCmd.Flags().IntP("group-by", "g", 0, "group by: 0=none 1=document")

	rootCmd.AddCommand(searchCmd)
}
