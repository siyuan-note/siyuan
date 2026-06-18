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
	"path/filepath"
	"strings"
	"text/tabwriter"

	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"

	"github.com/spf13/cobra"
)

var templateCmd = &cobra.Command{
	Use:   "template",
	Short: "Manage templates",
}

var templateSearchCmd = &cobra.Command{
	Use:   "search [keyword]",
	Short: "Search templates (empty keyword lists all)",
	Args:  cobra.MaximumNArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		keyword := ""
		if len(args) > 0 {
			keyword = args[0]
		}
		results := model.SearchTemplate(keyword)
		switch outputFormat {
		case "json":
			data, _ := json.MarshalIndent(results, "", "  ")
			fmt.Println(string(data))
		default:
			if len(results) == 0 {
				fmt.Println("No templates found.")
				return nil
			}
			w := tabwriter.NewWriter(os.Stdout, 0, 0, 2, ' ', 0)
			fmt.Fprintln(w, "NAME\tPATH")
			for _, r := range results {
				fmt.Fprintf(w, "%s\t%s\n", r.Content, r.Path)
			}
			w.Flush()
			fmt.Printf("\n%d template(s)\n", len(results))
		}
		return nil
	},
}

var templateGetCmd = &cobra.Command{
	Use:   "get --path <path>",
	Short: "Read template content",
	RunE: func(cmd *cobra.Command, args []string) error {
		p, _ := cmd.Flags().GetString("path")
		abs, err := resolveTemplateAbs(p)
		if err != nil {
			return err
		}
		data, err := os.ReadFile(abs)
		if err != nil {
			return err
		}
		fmt.Print(string(data))
		return nil
	},
}

var templateRemoveCmd = &cobra.Command{
	Use:   "remove --path <path>",
	Short: "Remove a template",
	RunE: func(cmd *cobra.Command, args []string) error {
		p, _ := cmd.Flags().GetString("path")
		abs, err := resolveTemplateAbs(p)
		if err != nil {
			return err
		}
		if dryRun {
			fmt.Printf("[dry-run] Would remove template: %s\n", p)
			return nil
		}
		if err := model.RemoveTemplate(abs); err != nil {
			return err
		}
		fmt.Println("ok")
		return nil
	},
}

var templateRenderCmd = &cobra.Command{
	Use:   "render --path <path> --id <id>",
	Short: "Render a template against a block (preview)",
	RunE: func(cmd *cobra.Command, args []string) error {
		p, _ := cmd.Flags().GetString("path")
		id, _ := cmd.Flags().GetString("id")
		if id == "" {
			return fmt.Errorf("--id is required")
		}
		abs, err := resolveTemplateAbs(p)
		if err != nil {
			return err
		}
		_, dom, err := model.RenderTemplate(abs, id, true)
		if err != nil {
			return err
		}
		fmt.Print(dom)
		return nil
	},
}

var templateSaveAsCmd = &cobra.Command{
	Use:   "save-as --id <id> --name <name>",
	Short: "Save a document as a template",
	RunE: func(cmd *cobra.Command, args []string) error {
		id, _ := cmd.Flags().GetString("id")
		name, _ := cmd.Flags().GetString("name")
		if id == "" {
			return fmt.Errorf("--id is required")
		}
		if name == "" {
			return fmt.Errorf("--name is required")
		}
		overwrite, _ := cmd.Flags().GetBool("overwrite")
		if dryRun {
			fmt.Printf("[dry-run] Would save document %s as template \"%s\"\n", id, name)
			return nil
		}
		code, err := model.DocSaveAsTemplate(id, name, overwrite)
		if err != nil {
			return err
		}
		if code == 1 {
			return fmt.Errorf("template already exists, use --overwrite to replace: %s", name)
		}
		fmt.Printf("%s.md\n", name)
		return nil
	},
}

var templateCreateCmd = &cobra.Command{
	Use:   "create --name <name> [--data <markdown> | --file <path>]",
	Short: "Create a template from markdown content",
	RunE: func(cmd *cobra.Command, args []string) error {
		name, _ := cmd.Flags().GetString("name")
		if name == "" {
			return fmt.Errorf("--name is required")
		}
		content, err := resolveData(cmd)
		if err != nil {
			return err
		}
		overwrite, _ := cmd.Flags().GetBool("overwrite")
		if dryRun {
			fmt.Printf("[dry-run] Would create template \"%s\"\n", name)
			return nil
		}
		code, err := model.CreateTemplate(name, content, overwrite)
		if err != nil {
			return err
		}
		if code == 1 {
			return fmt.Errorf("template already exists, use --overwrite to replace: %s", name)
		}
		fmt.Printf("%s.md\n", name)
		return nil
	},
}

// resolveTemplateAbs 把模板路径解析为 data/templates 下的绝对路径，拒绝越界。
// 接受绝对路径或相对 data/templates 的相对路径。
func resolveTemplateAbs(p string) (string, error) {
	if p == "" {
		return "", fmt.Errorf("--path is required")
	}
	abs := p
	if !filepath.IsAbs(abs) {
		abs = filepath.Join(util.DataDir, "templates", p)
	}
	abs = filepath.Clean(abs)
	templatesBase := filepath.Clean(filepath.Join(util.DataDir, "templates"))
	rel, err := filepath.Rel(templatesBase, abs)
	if err != nil || strings.HasPrefix(rel, "..") || rel == ".." {
		return "", fmt.Errorf("path escapes templates dir: %s", p)
	}
	return abs, nil
}

func init() {
	templateGetCmd.Flags().String("path", "", "template path (absolute or relative to data/templates)")
	templateRemoveCmd.Flags().String("path", "", "template path (absolute or relative to data/templates)")
	templateRenderCmd.Flags().String("path", "", "template path (absolute or relative to data/templates)")
	templateRenderCmd.Flags().String("id", "", "block ID to render against")
	templateSaveAsCmd.Flags().String("id", "", "source document block ID")
	templateSaveAsCmd.Flags().String("name", "", "template name without extension")
	templateSaveAsCmd.Flags().Bool("overwrite", false, "overwrite if exists")
	templateCreateCmd.Flags().String("name", "", "template name without extension")
	templateCreateCmd.Flags().String("data", "", "markdown content")
	templateCreateCmd.Flags().String("file", "", "read content from file path (- for stdin)")
	templateCreateCmd.Flags().Bool("overwrite", false, "overwrite if exists")

	rootCmd.AddCommand(templateCmd)
	templateCmd.AddCommand(templateSearchCmd)
	templateCmd.AddCommand(templateGetCmd)
	templateCmd.AddCommand(templateRemoveCmd)
	templateCmd.AddCommand(templateRenderCmd)
	templateCmd.AddCommand(templateSaveAsCmd)
	templateCmd.AddCommand(templateCreateCmd)
}
