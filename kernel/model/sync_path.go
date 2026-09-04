// SiYuan - From thought to insight, with agents
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

package model

import (
	"io/fs"
	"os"
	"path/filepath"
	"strings"

	"github.com/88250/gulu"
	ignore "github.com/sabhiram/go-gitignore"
	"github.com/siyuan-note/siyuan/kernel/util"
)

// PathsAffectSync 判断指定路径的变更是否会影响数据同步仓库。
func PathsAffectSync(absPaths ...string) bool {
	if 0 == len(absPaths) {
		return false
	}
	dataDir := util.ResolveLongestExistingParent(util.DataDir)
	var dataPaths []string
	for _, absPath := range absPaths {
		resolved := util.ResolveLongestExistingParent(absPath)
		if _, ok := dataRelativePath(dataDir, resolved); ok {
			dataPaths = append(dataPaths, resolved)
		}
	}
	if 0 == len(dataPaths) {
		return false
	}

	matcher := ignore.CompileIgnoreLines(getSyncIgnoreLines()...)
	for _, absPath := range dataPaths {
		if pathAffectsSync(dataDir, absPath, matcher) {
			return true
		}
	}
	return false
}

// IncSyncIfNeeded 在指定路径的变更会影响数据同步仓库时重新计划同步。
func IncSyncIfNeeded(absPaths ...string) {
	if PathsAffectSync(absPaths...) {
		IncSync()
	}
}

func pathAffectsSync(dataDir, absPath string, matcher *ignore.GitIgnore) bool {
	absPath = util.ResolveLongestExistingParent(absPath)
	relPath, ok := dataRelativePath(dataDir, absPath)
	if !ok {
		return false
	}

	// 修改同步忽略规则会改变仓库内容，规则文件本身虽然不参与同步也需要重新计划同步。
	if "/.siyuan/syncignore" == relPath {
		return true
	}

	info, err := os.Stat(absPath)
	if nil != err || !info.IsDir() {
		return syncFilePathIncluded(absPath, relPath, info, matcher)
	}

	syncIgnorePath := filepath.Join(dataDir, ".siyuan", "syncignore")
	if _, containsSyncIgnore := dataRelativePath(absPath, syncIgnorePath); containsSyncIgnore {
		if _, statErr := os.Stat(syncIgnorePath); nil == statErr {
			return true
		}
	}
	if syncPathHasSkippedDir(relPath, true) {
		return false
	}
	affects := false
	err = filepath.WalkDir(absPath, func(path string, entry fs.DirEntry, walkErr error) error {
		if nil != walkErr {
			affects = true
			return fs.SkipAll
		}
		rel, included := dataRelativePath(dataDir, path)
		if !included {
			return nil
		}
		if entry.IsDir() {
			if path != absPath && syncPathHasSkippedDir(rel, true) {
				return filepath.SkipDir
			}
			return nil
		}
		entryInfo, infoErr := entry.Info()
		if nil != infoErr {
			affects = true
			return fs.SkipAll
		}
		if syncFilePathIncluded(path, rel, entryInfo, matcher) {
			affects = true
			return fs.SkipAll
		}
		return nil
	})
	return affects || nil != err
}

func dataRelativePath(dataDir, absPath string) (string, bool) {
	relPath, err := filepath.Rel(dataDir, absPath)
	if nil != err || filepath.IsAbs(relPath) || ".." == relPath || strings.HasPrefix(relPath, ".."+string(os.PathSeparator)) {
		return "", false
	}
	if "." == relPath {
		return "/", true
	}
	return "/" + filepath.ToSlash(relPath), true
}

func syncFilePathIncluded(absPath, relPath string, info os.FileInfo, matcher *ignore.GitIgnore) bool {
	if syncPathHasSkippedDir(relPath, false) {
		return false
	}
	name := filepath.Base(absPath)
	if strings.HasPrefix(name, ".") || strings.HasSuffix(name, ".tmp") {
		return false
	}
	if "/storage/local.json" == relPath || "/storage/recent-doc.json" == relPath || "/storage/ref-used.json" == relPath {
		return false
	}
	if nil != info && (!info.Mode().IsRegular() || gulu.File.IsHidden(absPath)) {
		return false
	}
	return !matcher.MatchesPath(relPath)
}

func syncPathHasSkippedDir(relPath string, includeLast bool) bool {
	parts := strings.Split(strings.TrimPrefix(filepath.ToSlash(relPath), "/"), "/")
	if !includeLast && 0 < len(parts) {
		parts = parts[:len(parts)-1]
	}
	for _, part := range parts {
		if strings.HasPrefix(part, ".") || "filesys_status_check" == part {
			return true
		}
	}
	return false
}
