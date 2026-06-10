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
	"path/filepath"

	"github.com/siyuan-note/siyuan/kernel/model"

	"github.com/spf13/cobra"
)

var importCmd = &cobra.Command{
	Use:   "import",
	Short: "Import files",
}

var importMdCmd = &cobra.Command{
	Use:   "md --file <path> --notebook <id>",
	Short: "Import Markdown file or directory",
	RunE: func(cmd *cobra.Command, args []string) error {
		filePath, _ := cmd.Flags().GetString("file")
		notebook, _ := cmd.Flags().GetString("notebook")
		toPath, _ := cmd.Flags().GetString("path")
		hpath, _ := cmd.Flags().GetString("hpath")
		if filePath == "" {
			return fmt.Errorf("--file is required")
		}
		if notebook == "" {
			return fmt.Errorf("--notebook is required")
		}

		absPath, err := filepath.Abs(filePath)
		if err != nil {
			return err
		}

		if dryRun {
			fmt.Printf("[dry-run] Would import Markdown from \"%s\" to notebook %s\n", filePath, notebook)
			return nil
		}

		if err := model.ImportFromLocalPath(notebook, absPath, resolvePath(notebook, toPath, hpath)); err != nil {
			return err
		}
		model.AppendPushReloadFiletreeEntry()
		fmt.Println("ok")
		return nil
	},
}

var importSYCmd = &cobra.Command{
	Use:   "sy --file <path> --notebook <id>",
	Short: "Import .sy.zip archive",
	RunE: func(cmd *cobra.Command, args []string) error {
		filePath, _ := cmd.Flags().GetString("file")
		notebook, _ := cmd.Flags().GetString("notebook")
		toPath, _ := cmd.Flags().GetString("path")
		hpath, _ := cmd.Flags().GetString("hpath")
		if filePath == "" {
			return fmt.Errorf("--file is required")
		}
		if notebook == "" {
			return fmt.Errorf("--notebook is required")
		}

		absPath, err := filepath.Abs(filePath)
		if err != nil {
			return err
		}

		if dryRun {
			fmt.Printf("[dry-run] Would import .sy.zip from \"%s\" to notebook %s\n", filePath, notebook)
			return nil
		}

		if err := model.ImportSY(absPath, notebook, resolvePath(notebook, toPath, hpath)); err != nil {
			return err
		}
		model.AppendPushReloadFiletreeEntry()
		fmt.Println("ok")
		return nil
	},
}

var importDataCmd = &cobra.Command{
	Use:   "data --file <path>",
	Short: "Import data backup",
	RunE: func(cmd *cobra.Command, args []string) error {
		filePath, _ := cmd.Flags().GetString("file")
		if filePath == "" {
			return fmt.Errorf("--file is required")
		}

		absPath, err := filepath.Abs(filePath)
		if err != nil {
			return err
		}

		if dryRun {
			fmt.Printf("[dry-run] Would import data backup from \"%s\"\n", filePath)
			return nil
		}

		if err := model.ImportData(absPath); err != nil {
			return err
		}
		fmt.Println("ok")
		return nil
	},
}

func init() {
	importMdCmd.Flags().String("file", "", "file or directory path")
	importMdCmd.Flags().StringP("notebook", "n", "", "notebook ID")
	importMdCmd.Flags().String("path", "", "target internal path (default /)")
	importMdCmd.Flags().String("hpath", "", "target human-readable path")

	importSYCmd.Flags().String("file", "", ".sy.zip file path")
	importSYCmd.Flags().StringP("notebook", "n", "", "notebook ID")
	importSYCmd.Flags().String("path", "", "target internal path (default /)")
	importSYCmd.Flags().String("hpath", "", "target human-readable path")

	importDataCmd.Flags().String("file", "", "data backup zip path")

	rootCmd.AddCommand(importCmd)
	importCmd.AddCommand(importMdCmd)
	importCmd.AddCommand(importSYCmd)
	importCmd.AddCommand(importDataCmd)
}
