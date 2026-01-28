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
	"bytes"
	"io"
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

	// 构建基于首字节的模式索引，并计算最长模式长度
	patternIndex := make(map[byte][][]byte)
	var maxLen int
	for _, t := range targets {
		if t == "" {
			continue
		}
		b := []byte(t)
		if len(b) > maxLen {
			maxLen = len(b)
		}
		patternIndex[b[0]] = append(patternIndex[b[0]], b)
	}
	if len(patternIndex) == 0 {
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
				hits := scanFileForTargets(p, patternIndex, maxLen)
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

// scanFileForTargets 在文件中流式搜索所有目标（基于首字节索引），返回去重后的命中目标字符串列表
func scanFileForTargets(path string, patternIndex map[byte][][]byte, maxLen int) []string {
	f, err := os.Open(path)
	if err != nil {
		return nil
	}
	defer f.Close()

	// 构建字节位图，加速首字节检测
	var bitmap [256]bool
	for b := range patternIndex {
		bitmap[b] = true
	}

	found := make(map[string]struct{})
	buf := make([]byte, 64<<10) // 64KB
	// 保留上一次块末尾的重叠数据以支持跨块匹配
	var tail []byte

	for {
		n, err := f.Read(buf)
		if n > 0 {
			// data = tail + buf[:n]
			data := make([]byte, len(tail)+n)
			copy(data, tail)
			copy(data[len(tail):], buf[:n])

			// 扫描 data，查找任意候选首字节位置
			i := 0
			for i < len(data) {
				// 快速跳过非候选字节
				for i < len(data) && !bitmap[data[i]] {
					i++
				}
				if i >= len(data) {
					break
				}
				b := data[i]
				// 对应首字节的所有模式进行校验
				for _, pat := range patternIndex[b] {
					pl := len(pat)
					// 如果剩余字节不足以完全匹配，则交由下一轮（通过 tail 保证）
					if i+pl <= len(data) {
						if bytes.Equal(pat, data[i:i+pl]) {
							found[string(pat)] = struct{}{}
						}
					}
				}
				i++
			}

			// 保留最后 maxLen-1 字节作为下一块的 tail（避免超长内存分配）
			if maxLen <= 1 {
				tail = nil
			} else {
				if len(data) >= maxLen-1 {
					tail = append(tail[:0], data[len(data)-(maxLen-1):]...)
				} else {
					tail = append(tail[:0], data...)
				}
			}
		}
		if err != nil {
			if err == io.EOF {
				break
			}
			// 读取出错，返回已有结果
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
