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

package search

import (
	"bufio"
	"bytes"
	"os"
	"path/filepath"
	"runtime"
	"sync"
)

type Match struct {
	Path   string
	Target string
}

func FindAllMatchedPaths(root string, targets []string) []string {
	matches := FindAllMatches(root, targets)
	return pathsFromMatches(matches)
}

func FindAllMatchedTargets(root string, targets []string) []string {
	matches := FindAllMatches(root, targets)
	return targetsFromMatches(matches)
}

// FindAllMatches 遍历 root 下的文件，返回所有命中的结果（文件路径 + 命中目标）
// targets 为空或 root 为空时返回 nil
func FindAllMatches(root string, targets []string) []Match {
	if root == "" || len(targets) == 0 {
		return nil
	}

	var searchBytes [][]byte
	for _, t := range targets {
		if t != "" {
			searchBytes = append(searchBytes, []byte(t))
		}
	}
	if len(searchBytes) == 0 {
		return nil
	}

	jobs := make(chan string, 256)
	results := make(chan Match, 256)

	var wg sync.WaitGroup
	var collectWg sync.WaitGroup

	var matches []Match
	collectWg.Add(1)
	go func() {
		defer collectWg.Done()
		for m := range results {
			matches = append(matches, m)
		}
	}()

	numWorkers := runtime.NumCPU()
	for i := 0; i < numWorkers; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for p := range jobs {
				hits := scanFileForTargets(p, searchBytes)
				if len(hits) > 0 {
					for _, t := range hits {
						results <- Match{Path: p, Target: t}
					}
				}
			}
		}()
	}

	_ = filepath.WalkDir(root, func(path string, d os.DirEntry, err error) error {
		if err == nil && d.Type().IsRegular() {
			jobs <- path
		}
		return nil
	})

	close(jobs)
	wg.Wait()
	close(results)
	collectWg.Wait()
	return matches
}

// scanFileForTargets 在文件中搜索所有目标，返回去重后的命中目标字符串列表
func scanFileForTargets(path string, targets [][]byte) []string {
	f, err := os.Open(path)
	if err != nil {
		return nil
	}
	defer f.Close()

	reader := bufio.NewReaderSize(f, 1024*1024) // 1MB 缓冲
	found := make(map[string]struct{})
	remaining := len(targets)

	for {
		line, err := reader.ReadSlice('\n')
		if len(line) > 0 {
			for _, t := range targets {
				ts := string(t)
				if _, ok := found[ts]; ok {
					continue
				}
				if bytes.Contains(line, t) {
					found[ts] = struct{}{}
					remaining--
					if remaining == 0 {
						// 找到所有目标，提前返回
						res := make([]string, 0, len(found))
						for k := range found {
							res = append(res, k)
						}
						return res
					}
				}
			}
		}
		if err != nil {
			if err == bufio.ErrBufferFull {
				for err == bufio.ErrBufferFull {
					_, err = reader.ReadSlice('\n')
				}
				continue
			}
			break
		}
	}

	if len(found) == 0 {
		return nil
	}
	res := make([]string, 0, len(found))
	for k := range found {
		res = append(res, k)
	}
	return res
}

// pathsFromMatches 从 Match 列表中返回去重的路径切片（保留首次出现顺序）
func pathsFromMatches(ms []Match) []string {
	if len(ms) == 0 {
		return nil
	}
	seen := make(map[string]struct{})
	paths := make([]string, 0)
	for _, m := range ms {
		if _, ok := seen[m.Path]; ok {
			continue
		}
		seen[m.Path] = struct{}{}
		paths = append(paths, m.Path)
	}
	return paths
}

// targetsFromMatches 从 Match 列表中返回去重的目标切片（保留首次出现顺序）
func targetsFromMatches(ms []Match) []string {
	if len(ms) == 0 {
		return nil
	}
	seen := make(map[string]struct{})
	targets := make([]string, 0)
	for _, m := range ms {
		if _, ok := seen[m.Target]; ok {
			continue
		}
		seen[m.Target] = struct{}{}
		targets = append(targets, m.Target)
	}
	return targets
}
