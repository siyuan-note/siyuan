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

	ignore "github.com/sabhiram/go-gitignore"
	"github.com/siyuan-note/siyuan/kernel/util"
)

// PathsAffectSync 判断指定路径的变更是否会影响数据同步仓库。
func PathsAffectSync(absPaths ...string) bool {
	return pathsAffectSync(false, absPaths...)
}

func pathsAffectSync(invalidate bool, absPaths ...string) bool {
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
	if invalidate {
		invalidateResolvedSyncIgnoreRules(dataDir, dataPaths...)
	}

	_, matcher, err := getSyncIgnoreRules()
	if err != nil {
		return true
	}
	for _, absPath := range dataPaths {
		if pathAffectsSync(dataDir, absPath, matcher) {
			return true
		}
	}
	return false
}

// IncSyncIfNeeded 在指定路径的变更会影响数据同步仓库时重新计划同步。
func IncSyncIfNeeded(absPaths ...string) {
	if pathsAffectSync(true, absPaths...) {
		IncSync()
	}
}

func pathAffectsSync(dataDir, absPath string, matcher *ignore.GitIgnore) bool {
	relPath, ok := dataRelativePath(dataDir, absPath)
	if !ok {
		return false
	}

	// 修改同步忽略规则会改变仓库内容，即使规则排除了规则文件本身也需要重新计划同步。
	if "/.siyuan/syncignore" == relPath {
		return true
	}

	info, err := os.Stat(absPath)
	if nil != err || !info.IsDir() {
		return syncFilePathIncluded(dataDir, absPath, relPath, info, matcher)
	}

	syncIgnorePath := filepath.Join(dataDir, ".siyuan", "syncignore")
	if _, containsSyncIgnore := dataRelativePath(absPath, syncIgnorePath); containsSyncIgnore {
		if _, statErr := os.Stat(syncIgnorePath); nil == statErr {
			return true
		}
	}
	if syncPathHasSkippedDir(dataDir, relPath, true) {
		return false
	}
	if _, filterErr := syncPathFilter(dataDir, info, absPath); filterErr != nil {
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
			if path != absPath && syncPathHasSkippedDir(dataDir, rel, true) {
				return filepath.SkipDir
			}
			info, infoErr := entry.Info()
			if infoErr != nil {
				return infoErr
			}
			if _, filterErr := syncPathFilter(dataDir, info, path); filterErr != nil {
				return filterErr
			}
			return nil
		}
		entryInfo, infoErr := entry.Info()
		if nil != infoErr {
			affects = true
			return fs.SkipAll
		}
		if syncFilePathIncluded(dataDir, path, rel, entryInfo, matcher) {
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

func syncFilePathIncluded(dataDir, absPath, relPath string, info os.FileInfo, matcher *ignore.GitIgnore) bool {
	if syncPathHasSkippedDir(dataDir, relPath, false) {
		return false
	}
	if ignored, err := syncPathFilter(dataDir, info, absPath); ignored || err != nil {
		return false
	}
	return !matcher.MatchesPath(relPath)
}

func syncPathHasSkippedDir(dataDir, relPath string, includeLast bool) bool {
	parts := strings.Split(strings.TrimPrefix(filepath.ToSlash(relPath), "/"), "/")
	if !includeLast && 0 < len(parts) {
		parts = parts[:len(parts)-1]
	}
	absPath := dataDir
	for _, part := range parts {
		if part == "" {
			continue
		}
		absPath = filepath.Join(absPath, part)
		if _, err := syncPathFilter(dataDir, syncMissingDirectory{name: part}, absPath); err != nil {
			return true
		}
	}
	return false
}
