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
	"io"
	"os"
	"path/filepath"
	"strings"
	"text/tabwriter"

	"github.com/88250/gulu"
	"github.com/siyuan-note/siyuan/kernel/util"

	"github.com/spf13/cobra"
)

var fileCmd = &cobra.Command{
	Use:   "file",
	Short: "Workspace file operations",
}

func absPath(rel string) (string, error) {
	rel = filepath.Clean(strings.ReplaceAll(rel, "/", string(os.PathSeparator)))
	abs := filepath.Join(util.WorkspaceDir, rel)
	if !gulu.File.IsSubPath(util.WorkspaceDir, abs) {
		return "", fmt.Errorf("path escapes workspace: %s", rel)
	}
	return abs, nil
}

var fileListCmd = &cobra.Command{
	Use:   "list <path>",
	Short: "List directory contents",
	Args:  cobra.MinimumNArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		dir, err := absPath(args[0])
		if err != nil {
			return err
		}
		entries, err := os.ReadDir(dir)
		if err != nil {
			return err
		}
		w := tabwriter.NewWriter(os.Stdout, 0, 0, 2, ' ', 0)
		fmt.Fprintln(w, "NAME\tSIZE\tISDIR\tMODTIME")
		for _, e := range entries {
			info, err := e.Info()
			size := ""
			modTime := ""
			if err == nil {
				size = fmt.Sprintf("%d", info.Size())
				modTime = info.ModTime().Format("2006-01-02 15:04")
			}
			fmt.Fprintf(w, "%s\t%s\t%v\t%s\n", e.Name(), size, e.IsDir(), modTime)
		}
		w.Flush()
		fmt.Printf("\n%d entry(s)\n", len(entries))
		return nil
	},
}

var fileReadCmd = &cobra.Command{
	Use:   "read <path>",
	Short: "Read file content",
	Args:  cobra.MinimumNArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		p, err := absPath(args[0])
		if err != nil {
			return err
		}
		data, err := os.ReadFile(p)
		if err != nil {
			return err
		}
		fmt.Print(string(data))
		return nil
	},
}

var fileWriteCmd = &cobra.Command{
	Use:   "write <path>",
	Short: "Write file content (stdin or --file)",
	Args:  cobra.MinimumNArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		p, err := absPath(args[0])
		if err != nil {
			return err
		}
		src, _ := cmd.Flags().GetString("file")
		var data []byte
		if src != "" {
			data, err = os.ReadFile(src)
		} else {
			data, err = io.ReadAll(os.Stdin)
		}
		if err != nil {
			return err
		}
		if err := os.MkdirAll(filepath.Dir(p), 0755); err != nil {
			return err
		}
		if err := os.WriteFile(p, data, 0644); err != nil {
			return err
		}
		fmt.Println("ok")
		return nil
	},
}

var fileDeleteCmd = &cobra.Command{
	Use:   "delete <path>",
	Short: "Delete file or directory",
	Args:  cobra.MinimumNArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		p, err := absPath(args[0])
		if err != nil {
			return err
		}
		info, err := os.Stat(p)
		if err != nil {
			return err
		}
		if info.IsDir() {
			err = os.RemoveAll(p)
		} else {
			err = os.Remove(p)
		}
		if err != nil {
			return err
		}
		fmt.Println("ok")
		return nil
	},
}

var fileRenameCmd = &cobra.Command{
	Use:   "rename <old> <new>",
	Short: "Rename or move file",
	Args:  cobra.MinimumNArgs(2),
	RunE: func(cmd *cobra.Command, args []string) error {
		old, err := absPath(args[0])
		if err != nil {
			return err
		}
		newP, err := absPath(args[1])
		if err != nil {
			return err
		}
		if err := os.MkdirAll(filepath.Dir(newP), 0755); err != nil {
			return err
		}
		if err := os.Rename(old, newP); err != nil {
			return err
		}
		fmt.Println("ok")
		return nil
	},
}

var fileCopyCmd = &cobra.Command{
	Use:   "copy <src> <dst>",
	Short: "Copy file or directory",
	Args:  cobra.MinimumNArgs(2),
	RunE: func(cmd *cobra.Command, args []string) error {
		src, err := absPath(args[0])
		if err != nil {
			return err
		}
		dst, err := absPath(args[1])
		if err != nil {
			return err
		}
		if err := copyPath(src, dst); err != nil {
			return err
		}
		fmt.Println("ok")
		return nil
	},
}

func copyPath(src, dst string) error {
	srcInfo, err := os.Stat(src)
	if err != nil {
		return err
	}
	if srcInfo.IsDir() {
		return copyDir(src, dst)
	}
	return copyFile(src, dst)
}

func copyDir(src, dst string) error {
	if err := os.MkdirAll(dst, 0755); err != nil {
		return err
	}
	entries, err := os.ReadDir(src)
	if err != nil {
		return err
	}
	for _, e := range entries {
		srcPath := filepath.Join(src, e.Name())
		dstPath := filepath.Join(dst, e.Name())
		if err := copyPath(srcPath, dstPath); err != nil {
			return err
		}
	}
	return nil
}

func copyFile(src, dst string) error {
	if err := os.MkdirAll(filepath.Dir(dst), 0755); err != nil {
		return err
	}
	srcF, err := os.Open(src)
	if err != nil {
		return err
	}
	defer srcF.Close()
	dstF, err := os.Create(dst)
	if err != nil {
		return err
	}
	defer dstF.Close()
	_, err = io.Copy(dstF, srcF)
	return err
}

func init() {
	fileWriteCmd.Flags().String("file", "", "source file path (default: stdin)")

	rootCmd.AddCommand(fileCmd)
	fileCmd.AddCommand(fileListCmd)
	fileCmd.AddCommand(fileReadCmd)
	fileCmd.AddCommand(fileWriteCmd)
	fileCmd.AddCommand(fileDeleteCmd)
	fileCmd.AddCommand(fileRenameCmd)
	fileCmd.AddCommand(fileCopyCmd)
}
