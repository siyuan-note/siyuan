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

package treenode

import (
	"github.com/88250/gulu"
	"time"
)

func ClearRedundantBlockTrees(boxID string, paths []string) {
	redundantPaths := getRedundantPaths(boxID, paths)
	for _, p := range redundantPaths {
		removeBlockTreesByPath(boxID, p)
	}
}

func getRedundantPaths(boxID string, paths []string) (ret []string) {
	pathsMap := map[string]bool{}
	for _, path := range paths {
		pathsMap[path] = true
	}

	btPathsMap := map[string]bool{}
	blockTrees.Range(func(key, value interface{}) bool {
		slice := value.(*btSlice)
		slice.m.Lock()
		for _, b := range slice.data {
			if b.BoxID == boxID {
				btPathsMap[b.Path] = true
			}
		}
		slice.m.Unlock()
		return true
	})

	for p, _ := range btPathsMap {
		if !pathsMap[p] {
			ret = append(ret, p)
		}
	}
	ret = gulu.Str.RemoveDuplicatedElem(ret)
	return
}

func removeBlockTreesByPath(boxID, path string) {
	blockTrees.Range(func(key, value interface{}) bool {
		slice := value.(*btSlice)
		slice.m.Lock()
		for _, b := range slice.data {
			if b.Path == path && b.BoxID == boxID {
				delete(slice.data, b.ID)
				slice.changed = time.Now()
			}
		}
		slice.m.Unlock()
		return true
	})
}

func GetNotExistPaths(boxID string, paths []string) (ret []string) {
	pathsMap := map[string]bool{}
	for _, path := range paths {
		pathsMap[path] = true
	}

	btPathsMap := map[string]bool{}
	blockTrees.Range(func(key, value interface{}) bool {
		slice := value.(*btSlice)
		slice.m.Lock()
		for _, b := range slice.data {
			if b.BoxID == boxID {
				btPathsMap[b.Path] = true
			}
		}
		slice.m.Unlock()
		return true
	})

	for p, _ := range pathsMap {
		if !btPathsMap[p] {
			ret = append(ret, p)
		}
	}
	ret = gulu.Str.RemoveDuplicatedElem(ret)
	return
}

func GetRootUpdated() (ret map[string]string) {
	ret = map[string]string{}
	blockTrees.Range(func(key, value interface{}) bool {
		slice := value.(*btSlice)
		slice.m.Lock()
		for _, b := range slice.data {
			if b.RootID == b.ID {
				ret[b.RootID] = b.Updated
			}
		}
		slice.m.Unlock()
		return true
	})
	return
}
