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
	"os"

	"github.com/siyuan-note/siyuan/kernel/model"

	"github.com/spf13/cobra"
)

var exportCmd = &cobra.Command{
	Use:   "export",
	Short: "Export documents",
}

var exportMdCmd = &cobra.Command{
	Use:   "md --id <id>",
	Short: "Export as Markdown",
	RunE: func(cmd *cobra.Command, args []string) error {
		id, _ := cmd.Flags().GetString("id")
		if id == "" {
			return fmt.Errorf("--id is required")
		}

		_, content := model.ExportMarkdownContent(id, 4, 0, true, false, false, false, false)
		output, _ := cmd.Flags().GetString("output")
		if output != "" {
			return os.WriteFile(output, []byte(content), 0644)
		}
		fmt.Print(content)
		return nil
	},
}

var exportHTMLCmd = &cobra.Command{
	Use:   "html --id <id>",
	Short: "Export as HTML",
	RunE: func(cmd *cobra.Command, args []string) error {
		id, _ := cmd.Flags().GetString("id")
		if id == "" {
			return fmt.Errorf("--id is required")
		}

		_, dom, _ := model.ExportHTML(id, "", false, false, false)
		output, _ := cmd.Flags().GetString("output")
		if output != "" {
			return os.WriteFile(output, []byte(dom), 0644)
		}
		fmt.Print(dom)
		return nil
	},
}

var exportPreviewCmd = &cobra.Command{
	Use:   "preview --id <id>",
	Short: "Export as preview HTML",
	RunE: func(cmd *cobra.Command, args []string) error {
		id, _ := cmd.Flags().GetString("id")
		if id == "" {
			return fmt.Errorf("--id is required")
		}

		html := model.ExportPreview(id, false)
		output, _ := cmd.Flags().GetString("output")
		if output != "" {
			return os.WriteFile(output, []byte(html), 0644)
		}
		fmt.Print(html)
		return nil
	},
}

var exportDocxCmd = &cobra.Command{
	Use:   "docx --id <id> --output <file>",
	Short: "Export as Word (.docx)",
	RunE: func(cmd *cobra.Command, args []string) error {
		id, _ := cmd.Flags().GetString("id")
		output, _ := cmd.Flags().GetString("output")
		if id == "" {
			return fmt.Errorf("--id is required")
		}
		if output == "" {
			return fmt.Errorf("--output is required for docx")
		}

		fullPath, err := model.ExportDocx(id, output, false, false)
		if err != nil {
			return err
		}
		fmt.Println(fullPath)
		return nil
	},
}

var exportSYCmd = &cobra.Command{
	Use:   "sy --id <id> [--output <dir>]",
	Short: "Export as .sy.zip",
	RunE: func(cmd *cobra.Command, args []string) error {
		id, _ := cmd.Flags().GetString("id")
		if id == "" {
			return fmt.Errorf("--id is required")
		}

		_, zipPath := model.ExportPandocConvertZip([]string{id}, "", ".sy")
		output, _ := cmd.Flags().GetString("output")
		if output == "" {
			fmt.Println(zipPath)
			return nil
		}
		data, err := os.ReadFile(zipPath)
		if err != nil {
			return err
		}
		return os.WriteFile(output, data, 0644)
	},
}

var exportMdZipCmd = &cobra.Command{
	Use:   "md-zip --id <id> [--output <file>]",
	Short: "Export as Markdown zip",
	RunE: func(cmd *cobra.Command, args []string) error {
		id, _ := cmd.Flags().GetString("id")
		if id == "" {
			return fmt.Errorf("--id is required")
		}

		_, zipPath := model.ExportPandocConvertZip([]string{id}, "", ".md")
		output, _ := cmd.Flags().GetString("output")
		if output == "" {
			fmt.Println(zipPath)
			return nil
		}
		data, err := os.ReadFile(zipPath)
		if err != nil {
			return err
		}
		return os.WriteFile(output, data, 0644)
	},
}

var exportDataCmd = &cobra.Command{
	Use:   "data [--output <file>]",
	Short: "Export full workspace data backup",
	RunE: func(cmd *cobra.Command, args []string) error {
		zipPath, err := model.ExportData()
		if err != nil {
			return err
		}
		output, _ := cmd.Flags().GetString("output")
		if output == "" {
			fmt.Println(zipPath)
			return nil
		}
		data, err := os.ReadFile(zipPath)
		if err != nil {
			return err
		}
		return os.WriteFile(output, data, 0644)
	},
}

func init() {
	exportMdCmd.Flags().String("id", "", "block ID")
	exportMdCmd.Flags().String("output", "", "output file path (default: stdout)")

	exportHTMLCmd.Flags().String("id", "", "block ID")
	exportHTMLCmd.Flags().String("output", "", "output file path (default: stdout)")

	exportPreviewCmd.Flags().String("id", "", "block ID")
	exportPreviewCmd.Flags().String("output", "", "output file path (default: stdout)")

	exportDocxCmd.Flags().String("id", "", "block ID")
	exportDocxCmd.Flags().String("output", "", "output file path (required)")

	exportSYCmd.Flags().String("id", "", "block ID")
	exportSYCmd.Flags().String("output", "", "output file path (default: print temp path)")

	exportMdZipCmd.Flags().String("id", "", "block ID")
	exportMdZipCmd.Flags().String("output", "", "output file path (default: print temp path)")

	exportDataCmd.Flags().String("output", "", "output file path (default: print temp path)")

	rootCmd.AddCommand(exportCmd)
	exportCmd.AddCommand(exportMdCmd)
	exportCmd.AddCommand(exportHTMLCmd)
	exportCmd.AddCommand(exportPreviewCmd)
	exportCmd.AddCommand(exportDocxCmd)
	exportCmd.AddCommand(exportSYCmd)
	exportCmd.AddCommand(exportMdZipCmd)
	exportCmd.AddCommand(exportDataCmd)
}
