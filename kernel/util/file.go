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

package util

import (
	"bytes"
	"io"
	"io/fs"
	"os"
	"path"
	"path/filepath"
	"strings"
	"unicode/utf8"

	"github.com/88250/gulu"
	"github.com/88250/lute/ast"
	"github.com/siyuan-note/logging"
)

func IsEmptyDir(p string) bool {
	if !gulu.File.IsDir(p) {
		return false
	}

	files, err := os.ReadDir(p)
	if nil != err {
		return false
	}
	return 1 > len(files)
}

func IsSymlink(dir fs.DirEntry) bool {
	return dir.Type() == fs.ModeSymlink
}

func IsDirRegularOrSymlink(dir fs.DirEntry) bool {
	return dir.IsDir() || IsSymlink(dir)
}

func IsPathRegularDirOrSymlinkDir(path string) bool {
	fio, err := os.Stat(path)
	if os.IsNotExist(err) {
		return false
	}

	if nil != err {
		return false
	}

	return fio.IsDir()
}

func RemoveID(name string) string {
	ext := path.Ext(name)
	name = strings.TrimSuffix(name, ext)
	if 23 < len(name) {
		if id := name[len(name)-22:]; ast.IsNodeIDPattern(id) {
			name = name[:len(name)-23]
		}
	}
	return name + ext
}

func AssetName(name string) string {
	_, id := LastID(name)
	ext := path.Ext(name)
	name = name[0 : len(name)-len(ext)]
	if !ast.IsNodeIDPattern(id) {
		id = ast.NewNodeID()
		name = name + "-" + id + ext
	} else {
		if !ast.IsNodeIDPattern(name) {
			name = name[:len(name)-len(id)-1] + "-" + id + ext
		} else {
			name = name + ext
		}
	}
	return name
}

func LastID(p string) (name, id string) {
	name = path.Base(p)
	ext := path.Ext(name)
	id = strings.TrimSuffix(name, ext)
	if 22 < len(id) {
		id = id[len(id)-22:]
	}
	return
}

func IsCorruptedSYData(data []byte) bool {
	if 64 > len(data) || '{' != data[0] {
		return true
	}
	return false
}

func FilterUploadFileName(name string) string {
	ret := FilterFileName(name)

	// 插入资源文件时去除 `[`、`(` 等符号 https://github.com/siyuan-note/siyuan/issues/6708
	ret = strings.ReplaceAll(ret, "~", "")
	//ret = strings.ReplaceAll(ret, "_", "") // 插入资源文件时允许下划线 https://github.com/siyuan-note/siyuan/issues/3534
	ret = strings.ReplaceAll(ret, "[", "")
	ret = strings.ReplaceAll(ret, "]", "")
	ret = strings.ReplaceAll(ret, "(", "")
	ret = strings.ReplaceAll(ret, ")", "")
	ret = strings.ReplaceAll(ret, "!", "")
	ret = strings.ReplaceAll(ret, "`", "")
	ret = strings.ReplaceAll(ret, "&", "")
	ret = strings.ReplaceAll(ret, "{", "")
	ret = strings.ReplaceAll(ret, "}", "")
	ret = strings.ReplaceAll(ret, "=", "")
	ret = strings.ReplaceAll(ret, "#", "")
	ret = strings.ReplaceAll(ret, "%", "")
	ret = strings.ReplaceAll(ret, "$", "")
	ret = TruncateLenFileName(ret)
	return ret
}

func TruncateLenFileName(name string) (ret string) {
	// 插入资源文件时文件名长度最大限制 189 字节 https://github.com/siyuan-note/siyuan/issues/7099
	ext := filepath.Ext(name)
	var byteCount int
	truncated := false
	buf := bytes.Buffer{}
	for _, r := range name {
		byteCount += utf8.RuneLen(r)
		if 189-len(ext) < byteCount {
			truncated = true
			break
		}
		buf.WriteRune(r)
	}
	if truncated {
		buf.WriteString(ext)
	}
	ret = buf.String()
	return
}

func FilterFilePath(p string) (ret string) {
	parts := strings.Split(p, "/")
	var filteredParts []string
	for _, part := range parts {
		filteredParts = append(filteredParts, FilterFileName(part))
	}
	ret = strings.Join(filteredParts, "/")
	return
}

func FilterFileName(name string) string {
	name = strings.ReplaceAll(name, "\\", "")
	name = strings.ReplaceAll(name, "/", "")
	name = strings.ReplaceAll(name, ":", "")
	name = strings.ReplaceAll(name, "*", "")
	name = strings.ReplaceAll(name, "?", "")
	name = strings.ReplaceAll(name, "\"", "")
	name = strings.ReplaceAll(name, "'", "")
	name = strings.ReplaceAll(name, "<", "")
	name = strings.ReplaceAll(name, ">", "")
	name = strings.ReplaceAll(name, "|", "")
	name = strings.TrimSpace(name)
	return name
}

func IsSubPath(absPath, toCheckPath string) bool {
	if 1 > len(absPath) || 1 > len(toCheckPath) {
		return false
	}
	if gulu.OS.IsWindows() {
		if filepath.IsAbs(absPath) && filepath.IsAbs(toCheckPath) {
			if strings.ToLower(absPath)[0] != strings.ToLower(toCheckPath)[0] {
				// 不在一个盘
				return false
			}
		}
	}

	up := ".." + string(os.PathSeparator)
	rel, err := filepath.Rel(absPath, toCheckPath)
	if err != nil {
		return false
	}
	if !strings.HasPrefix(rel, up) && rel != ".." {
		return true
	}
	return false
}

func SizeOfDirectory(path string) (size int64, err error) {
	err = filepath.Walk(path, func(_ string, info os.FileInfo, err error) error {
		if nil != err {
			return err
		}
		if !info.IsDir() {
			s := info.Size()
			size += s
		} else {
			size += 4096
		}
		return nil
	})
	if nil != err {
		logging.LogErrorf("size of dir [%s] failed: %s", path, err)
	}
	return
}

func DataSize() (dataSize, assetsSize int64) {
	filepath.Walk(DataDir, func(path string, info os.FileInfo, err error) error {
		if nil != err {
			if os.IsNotExist(err) {
				return nil
			}
			logging.LogErrorf("size of data failed: %s", err)
			return io.EOF
		}
		if !info.IsDir() {
			s := info.Size()
			dataSize += s

			if strings.Contains(strings.TrimPrefix(path, DataDir), "assets") {
				assetsSize += s
			}
		} else {
			dataSize += 4096
		}
		return nil
	})
	return
}

func CeilSize(size int64) int64 {
	if 100*1024*1024 > size {
		return 100 * 1024 * 1024
	}

	for i := int64(1); i < 40; i++ {
		if 1024*1024*200*i > size {
			return 1024 * 1024 * 200 * i
		}
	}
	return 1024*1024*200*40 + 1
}

func IsReservedFilename(baseName string) bool {
	return "assets" == baseName || "templates" == baseName || "widgets" == baseName || "emojis" == baseName || ".siyuan" == baseName || strings.HasPrefix(baseName, ".")
}

func WalkWithSymlinks(root string, fn filepath.WalkFunc) error {
	// 感谢 https://github.com/edwardrf/symwalk/blob/main/symwalk.go

	rr, err := filepath.EvalSymlinks(root) // Find real base if there is any symlinks in the path
	if err != nil {
		return err
	}

	visitedDirs := make(map[string]struct{})
	return filepath.Walk(rr, getWalkFn(visitedDirs, fn))
}

func getWalkFn(visitedDirs map[string]struct{}, fn filepath.WalkFunc) filepath.WalkFunc {
	return func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return fn(path, info, err)
		}

		if info.IsDir() {
			if _, ok := visitedDirs[path]; ok {
				return filepath.SkipDir
			}
			visitedDirs[path] = struct{}{}
		}

		if err := fn(path, info, err); err != nil {
			return err
		}

		if info.Mode()&os.ModeSymlink == 0 {
			return nil
		}

		// path is a symlink
		rp, err := filepath.EvalSymlinks(path)
		if err != nil {
			return err
		}

		ri, err := os.Stat(rp)
		if err != nil {
			return err
		}

		if ri.IsDir() {
			return filepath.Walk(rp, getWalkFn(visitedDirs, fn))
		}

		return nil
	}
}
