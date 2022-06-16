// SiYuan - Build Your Eternal Digital Garden
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
	"os"
	"path"
	"path/filepath"
	"sort"
	"strings"

	"github.com/88250/gulu"
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

func RemoveID(name string) string {
	ext := path.Ext(name)
	name = strings.TrimSuffix(name, ext)
	if 23 < len(name) {
		name = name[:len(name)-23]
	}
	return name + ext
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

func LatestTmpFile(p string) string {
	dir, base := filepath.Split(p)
	files, err := os.ReadDir(dir)
	if nil != err {
		LogErrorf("read dir [%s] failed: %s", dir, err)
		return ""
	}

	var tmps []os.DirEntry
	for _, f := range files {
		if f.IsDir() {
			continue
		}
		if strings.HasSuffix(f.Name(), ".tmp") && strings.HasPrefix(f.Name(), base) && len(base)+7+len(".tmp") == len(f.Name()) {
			tmps = append(tmps, f)
		}
	}

	if 1 > len(tmps) {
		return ""
	}

	sort.Slice(tmps, func(i, j int) bool {
		info1, err := tmps[i].Info()
		if nil != err {
			LogErrorf("read file info [%s] failed: %s", tmps[i].Name(), err)
			return false
		}
		info2, err := tmps[j].Info()
		if nil != err {
			LogErrorf("read file info [%s] failed: %s", tmps[j].Name(), err)
			return false
		}
		return info1.ModTime().After(info2.ModTime())
	})
	return filepath.Join(dir, tmps[0].Name())
}

func IsCorruptedSYData(data []byte) bool {
	if 64 > len(data) || '{' != data[0] {
		return true
	}
	return false
}

func FilterUploadFileName(name string) string {
	ret := FilterFileName(name)
	ret = strings.ReplaceAll(ret, "~", "")
	//ret = strings.ReplaceAll(ret, "_", "") // https://github.com/siyuan-note/siyuan/issues/3534
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
	return ret
}

func FilterFilePath(p string) (ret string) {
	ret = strings.ReplaceAll(p, "/", "__@sep__")
	ret = FilterFileName(ret)
	ret = strings.ReplaceAll(ret, "__@sep__", "/")
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
	return name
}

func IsSubFolder(parent, sub string) bool {
	if 1 > len(parent) || 1 > len(sub) {
		return false
	}
	if gulu.OS.IsWindows() {
		if filepath.IsAbs(parent) && filepath.IsAbs(sub) {
			if strings.ToLower(parent)[0] != strings.ToLower(sub)[0] {
				// 不在一个盘
				return false
			}
		}
	}

	up := ".." + string(os.PathSeparator)
	rel, err := filepath.Rel(parent, sub)
	if err != nil {
		return false
	}
	if !strings.HasPrefix(rel, up) && rel != ".." {
		return true
	}
	return false
}

const CloudSingleFileMaxSizeLimit = 96 * 1000 * 1000

func SizeOfDirectory(path string, includeBigFile bool) (int64, error) {
	var size int64
	err := filepath.Walk(path, func(_ string, info os.FileInfo, err error) error {
		if nil != err {
			return err
		}
		if !info.IsDir() {
			s := info.Size()
			if CloudSingleFileMaxSizeLimit < s {
				if includeBigFile {
					size += s
				}
			} else {
				size += s
			}
		} else {
			size += 4096
		}
		return nil
	})
	if nil != err {
		LogErrorf("size of dir [%s] failed: %s", path, err)
	}
	return size, err
}

func IsReservedFilename(baseName string) bool {
	return "assets" == baseName || "templates" == baseName || "widgets" == baseName || "emojis" == baseName || ".siyuan" == baseName || strings.HasPrefix(baseName, ".")
}
