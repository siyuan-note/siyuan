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
	"io"
	"os"
	"path/filepath"
	"strings"
	"text/tabwriter"

	"github.com/88250/gulu"
	"github.com/siyuan-note/siyuan/kernel/model"
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
	if boxID := model.EncryptedRawPathBoxID(abs); boxID != "" {
		return "", fmt.Errorf("path belongs to encrypted notebook [%s]: %s", boxID, rel)
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

		if dryRun {
			fmt.Printf("[dry-run] Would write file: %s\n", args[0])
			return nil
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

		if dryRun {
			fmt.Printf("[dry-run] Would delete: %s\n", args[0])
			return nil
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

		if dryRun {
			fmt.Printf("[dry-run] Would rename/move: %s -> %s\n", args[0], args[1])
			return nil
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

		if dryRun {
			fmt.Printf("[dry-run] Would copy: %s -> %s\n", args[0], args[1])
			return nil
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

var fileGrepCmd = &cobra.Command{
	Use:   "grep --pattern <regex> --path <path>",
	Short: "Search file contents with regex",
	RunE: func(cmd *cobra.Command, args []string) error {
		pattern, _ := cmd.Flags().GetString("pattern")
		if pattern == "" {
			return fmt.Errorf("--pattern is required")
		}
		relPath, _ := cmd.Flags().GetString("path")
		if relPath == "" {
			return fmt.Errorf("--path is required")
		}
		abs, err := absPath(relPath)
		if err != nil {
			return err
		}
		include, _ := cmd.Flags().GetString("include")
		ctx, _ := cmd.Flags().GetInt("context")
		max, _ := cmd.Flags().GetInt("limit")
		if max <= 0 {
			max = 200
		}
		results, err := gulu.File.Grep(abs, include, pattern, ctx, max)
		if err != nil {
			return err
		}
		switch outputFormat {
		case "json":
			data, _ := json.MarshalIndent(results, "", "  ")
			fmt.Println(string(data))
		default:
			fmt.Printf("Found %d lines:\n\n", len(results))
			for _, r := range results {
				rel, relErr := filepath.Rel(util.WorkspaceDir, r.File)
				if relErr != nil {
					rel = r.File
				}
				sep := ":"
				if r.Context {
					sep = "-:"
				}
				fmt.Printf("%s:%d%s %s\n", rel, r.Line, sep, r.Text)
			}
		}
		return nil
	},
}

var fileFindCmd = &cobra.Command{
	Use:   "find <path>",
	Short: "Find files under a path",
	Args:  cobra.MinimumNArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		abs, err := absPath(args[0])
		if err != nil {
			return err
		}
		include, _ := cmd.Flags().GetString("include")
		max, _ := cmd.Flags().GetInt("limit")
		if max <= 0 {
			max = 200
		}
		var results []string
		total := 0
		err = filepath.WalkDir(abs, func(path string, d os.DirEntry, err error) error {
			if err != nil {
				return nil
			}
			if d.IsDir() {
				name := d.Name()
				if name == ".git" || name == ".svn" || name == ".hg" || strings.HasPrefix(name, ".") {
					return filepath.SkipDir
				}
				return nil
			}
			if !d.Type().IsRegular() {
				return nil
			}
			if include != "" && !matchGlob(d.Name(), include) {
				return nil
			}
			total++
			if len(results) < max {
				rel, relErr := filepath.Rel(util.WorkspaceDir, path)
				if relErr != nil {
					rel = path
				}
				results = append(results, rel)
			}
			if total >= max {
				return filepath.SkipAll
			}
			return nil
		})
		if err != nil {
			return err
		}
		switch outputFormat {
		case "json":
			data, _ := json.MarshalIndent(results, "", "  ")
			fmt.Println(string(data))
		default:
			if max < total {
				fmt.Printf("Found %d files (showing first %d):\n\n", total, max)
			} else {
				fmt.Printf("Found %d files:\n\n", len(results))
			}
			for _, r := range results {
				fmt.Println(r)
			}
		}
		return nil
	},
}

var fileStatCmd = &cobra.Command{
	Use:   "stat <path>",
	Short: "Show file or directory info",
	Args:  cobra.MinimumNArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		abs, err := absPath(args[0])
		if err != nil {
			return err
		}
		info, err := os.Stat(abs)
		if err != nil {
			return err
		}
		switch outputFormat {
		case "json":
			data, _ := json.MarshalIndent(map[string]any{
				"path":    args[0],
				"size":    info.Size(),
				"isDir":   info.IsDir(),
				"modTime": info.ModTime().Format("2006-01-02 15:04:05"),
			}, "", "  ")
			fmt.Println(string(data))
		default:
			fmt.Printf("Path:    %s\n", args[0])
			fmt.Printf("Size:    %d\n", info.Size())
			fmt.Printf("IsDir:   %v\n", info.IsDir())
			fmt.Printf("ModTime: %s\n", info.ModTime().Format("2006-01-02 15:04:05"))
		}
		return nil
	},
}

func matchGlob(filename, pattern string) bool {
	for _, p := range expandGlobBrace(pattern) {
		if matched, _ := filepath.Match(p, filename); matched {
			return true
		}
	}
	return false
}

func expandGlobBrace(pattern string) []string {
	i := strings.Index(pattern, "{")
	if i < 0 {
		return []string{pattern}
	}
	j := strings.Index(pattern[i:], "}")
	if j < 0 {
		return []string{pattern}
	}
	j += i
	prefix := pattern[:i]
	body := pattern[i+1 : j]
	suffix := pattern[j+1:]
	var result []string
	for opt := range strings.SplitSeq(body, ",") {
		result = append(result, expandGlobBrace(prefix+strings.TrimSpace(opt)+suffix)...)
	}
	return result
}

func init() {
	fileWriteCmd.Flags().String("file", "", "source file path (default: stdin)")

	fileGrepCmd.Flags().String("pattern", "", "regex pattern")
	fileGrepCmd.Flags().String("path", "", "relative path within workspace")
	fileGrepCmd.Flags().String("include", "", "file glob filter, e.g. *.go or *.{ts,tsx}")
	fileGrepCmd.Flags().Int("context", 0, "context lines before and after each match")
	fileGrepCmd.Flags().Int("limit", 200, "maximum matches (0 or negative for unlimited)")

	fileFindCmd.Flags().String("include", "", "file glob filter, e.g. *.go or *.{ts,tsx}")
	fileFindCmd.Flags().Int("limit", 200, "maximum files (0 or negative for unlimited)")

	rootCmd.AddCommand(fileCmd)
	fileCmd.AddCommand(fileListCmd)
	fileCmd.AddCommand(fileReadCmd)
	fileCmd.AddCommand(fileWriteCmd)
	fileCmd.AddCommand(fileDeleteCmd)
	fileCmd.AddCommand(fileRenameCmd)
	fileCmd.AddCommand(fileCopyCmd)
	fileCmd.AddCommand(fileGrepCmd)
	fileCmd.AddCommand(fileFindCmd)
	fileCmd.AddCommand(fileStatCmd)
}
