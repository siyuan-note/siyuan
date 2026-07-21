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
	Short: "Full-text search (blocks, semantic, or asset file contents with --asset)",
	Args:  cobra.MinimumNArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		query := args[0]
		method, _ := cmd.Flags().GetInt("method")
		orderBy, _ := cmd.Flags().GetInt("order-by")
		page, _ := cmd.Flags().GetInt("page")
		pageSize, _ := cmd.Flags().GetInt("page-size")

		if page < 1 {
			page = 1
		}
		if pageSize < 1 {
			pageSize = 32
		}

		// --asset 切换到资源文件内容搜索模式
		if assetMode, _ := cmd.Flags().GetBool("asset"); assetMode {
			return runAssetSearch(cmd, query, method, orderBy, page, pageSize)
		}

		// --get-asset 切换到按路径取单个资源文件全文模式
		if getAssetMode, _ := cmd.Flags().GetBool("get-asset"); getAssetMode {
			return runGetAsset(query)
		}

		notebooks, _ := cmd.Flags().GetStringArray("notebook")
		paths, _ := cmd.Flags().GetStringArray("path")
		typeFlags, _ := cmd.Flags().GetStringArray("type")
		subtypeFlags, _ := cmd.Flags().GetStringArray("subtype")
		groupBy, _ := cmd.Flags().GetInt("group-by")

		types := stringSliceToMap(typeFlags)
		subTypes := stringSliceToMap(subtypeFlags)

		var docMode bool
		var blocks []*model.Block
		var matchedBlockCount, matchedRootCount, pageCount int
		if method == 4 {
			blocks, matchedBlockCount, matchedRootCount, pageCount =
				model.SemanticSearchBlock(query, notebooks, paths, types, subTypes, page, pageSize)
		} else {
			blocks, matchedBlockCount, matchedRootCount, pageCount, docMode =
				model.FullTextSearchBlock(query, notebooks, paths, types, subTypes, method, orderBy, groupBy, page, pageSize)
		}

		switch outputFormat {
		case "json":
			result := map[string]any{
				"blocks":            blocks,
				"matchedBlockCount": matchedBlockCount,
				"matchedRootCount":  matchedRootCount,
				"pageCount":         pageCount,
				"docMode":           docMode,
			}
			data, _ := json.MarshalIndent(result, "", "  ")
			fmt.Println(string(data))
		default:
			printSearchResult(blocks, matchedBlockCount, matchedRootCount, pageCount, docMode, page, pageSize, groupBy)
		}
		return nil
	},
}

func runAssetSearch(cmd *cobra.Command, query string, method, orderBy, page, pageSize int) error {
	extFlags, _ := cmd.Flags().GetStringArray("ext")
	types := stringSliceToMap(extFlags)

	assetContents, matchedAssetCount, pageCount, err := model.FullTextSearchAssetContent(query, types, method, orderBy, page, pageSize)
	if err != nil {
		return err
	}

	switch outputFormat {
	case "json":
		result := map[string]any{
			"assetContents":     assetContents,
			"matchedAssetCount": matchedAssetCount,
			"pageCount":         pageCount,
		}
		data, _ := json.MarshalIndent(result, "", "  ")
		fmt.Println(string(data))
	default:
		printAssetSearchResult(assetContents, matchedAssetCount, pageCount, page, pageSize)
	}
	return nil
}

func runGetAsset(path string) error {
	a := model.GetAssetContentByPath(path)
	if a == nil {
		fmt.Println("No indexed content found for path:", path)
		return nil
	}

	switch outputFormat {
	case "json":
		data, _ := json.MarshalIndent(a, "", "  ")
		fmt.Println(string(data))
	default:
		fmt.Printf("ID:  %s\n", a.ID)
		fmt.Printf("Name: %s\n", a.Name)
		fmt.Printf("Ext:  %s\n", a.Ext)
		fmt.Printf("Path: %s\n", a.Path)
		fmt.Printf("Size: %s\n", a.HSize)
		fmt.Println("\nContent:")
		fmt.Println(a.Content)
	}
	return nil
}

func printAssetSearchResult(assetContents []*model.AssetContent, matchedAssetCount, pageCount, page, pageSize int) {
	if len(assetContents) == 0 {
		fmt.Println("No asset content results found.")
		return
	}

	w := tabwriter.NewWriter(os.Stdout, 0, 0, 2, ' ', 0)
	fmt.Fprintln(w, "ID\tEXT\tNAME\tSIZE\tPATH\tCONTENT")
	for _, a := range assetContents {
		content := truncate(a.Content, 60)
		fmt.Fprintf(w, "%s\t%s\t%s\t%s\t%s\t%s\n", a.ID, a.Ext, a.Name, a.HSize, a.Path, content)
	}
	w.Flush()

	fmt.Printf("\nShowing results %d-%d | %d asset matches, %d pages\n",
		(page-1)*pageSize+1, (page-1)*pageSize+len(assetContents), matchedAssetCount, pageCount)
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
	searchCmd.Flags().Bool("asset", false, "search asset file contents (PDF/Word/Excel/txt etc.) instead of blocks")
	searchCmd.Flags().Bool("get-asset", false, "get the full indexed content of one asset file; the query argument is treated as the asset path, e.g. 'assets/foo.pdf'")
	searchCmd.Flags().StringArray("ext", nil, "asset file extension filter, repeatable, e.g. --ext pdf --ext docx (asset mode only)")
	searchCmd.Flags().StringArrayP("notebook", "n", nil, "notebook ID filter (repeatable)")
	searchCmd.Flags().StringArray("path", nil, "path prefix filter (repeatable)")
	searchCmd.Flags().StringArrayP("type", "t", nil, "block type filter, repeatable (document heading paragraph list listItem codeBlock mathBlock table blockquote superBlock htmlBlock embedBlock databaseBlock audioBlock videoBlock iframeBlock widgetBlock callout)")
	searchCmd.Flags().StringArray("subtype", nil, "block subtype filter, repeatable (o u t)")
	searchCmd.Flags().IntP("method", "m", 0, "search method: 0=keyword 1=query-syntax 2=sql 3=regex 4=semantic (asset mode ignores 4=semantic; uses 0-3 with same meanings)")
	searchCmd.Flags().IntP("order-by", "o", 0, "order — blocks: 0=type 1=created-asc 2=created-desc 3=updated-asc 4=updated-desc 5=content 6=relevance-asc 7=relevance-desc; asset: 0=relevance-desc 1=relevance-asc 2=updated-asc 3=updated-desc")
	searchCmd.Flags().IntP("page", "p", 1, "page number")
	searchCmd.Flags().IntP("page-size", "s", 32, "results per page")
	searchCmd.Flags().IntP("group-by", "g", 0, "group by: 0=none 1=document (blocks mode only)")

	rootCmd.AddCommand(searchCmd)
}
