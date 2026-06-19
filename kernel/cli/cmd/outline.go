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
	"strings"

	"github.com/siyuan-note/siyuan/kernel/model"

	"github.com/spf13/cobra"
)

var outlineCmd = &cobra.Command{
	Use:   "outline",
	Short: "Document outline (heading tree)",
}

var outlineGetCmd = &cobra.Command{
	Use:   "get --id <id>",
	Short: "Get document outline",
	RunE: func(cmd *cobra.Command, args []string) error {
		id, _ := cmd.Flags().GetString("id")
		if id == "" {
			return fmt.Errorf("--id is required")
		}
		paths, err := model.Outline(id, false)
		if err != nil {
			return err
		}
		if len(paths) == 0 {
			return fmt.Errorf("document not found or has no headings")
		}
		switch outputFormat {
		case "json":
			data, _ := json.MarshalIndent(paths, "", "  ")
			fmt.Println(string(data))
		default:
			var sb strings.Builder
			sb.WriteString(fmt.Sprintf("Document outline (%d headings):\n\n", countOutlineHeadings(paths)))
			for _, p := range paths {
				writeOutlinePath(&sb, p, 0)
			}
			fmt.Print(sb.String())
		}
		return nil
	},
}

func countOutlineHeadings(paths []*model.Path) int {
	n := 0
	for _, p := range paths {
		n++
		for _, b := range p.Blocks {
			n++
			n += countOutlineBlockChildren(b)
		}
		n += countOutlineHeadings(p.Children)
	}
	return n
}

func countOutlineBlockChildren(b *model.Block) int {
	n := 0
	for _, c := range b.Children {
		n++
		n += countOutlineBlockChildren(c)
	}
	return n
}

func writeOutlinePath(sb *strings.Builder, p *model.Path, depth int) {
	prefix := strings.Repeat("  ", depth)
	sb.WriteString(fmt.Sprintf("%s- [%s] (id: %s, depth: %d)\n", prefix, p.Name, p.ID, p.Depth))
	for _, b := range p.Blocks {
		writeOutlineBlock(sb, b, depth+1)
	}
	for _, c := range p.Children {
		writeOutlinePath(sb, c, depth+1)
	}
}

func writeOutlineBlock(sb *strings.Builder, b *model.Block, depth int) {
	prefix := strings.Repeat("  ", depth)
	sb.WriteString(fmt.Sprintf("%s- [%s] (id: %s, depth: %d)\n", prefix, b.Content, b.ID, b.Depth))
	for _, c := range b.Children {
		writeOutlineBlock(sb, c, depth+1)
	}
}

func init() {
	outlineGetCmd.Flags().String("id", "", "document block ID")

	rootCmd.AddCommand(outlineCmd)
	outlineCmd.AddCommand(outlineGetCmd)
}
