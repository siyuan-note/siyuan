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

package bazaar

import (
	"bytes"
	"sync"
	"testing"
)

func TestRenderPackageREADMEDoesNotMutateInput(t *testing.T) {
	source := []byte(`<div style="display: flex;">
  <!-- 按钮：感谢您的支持 -->
  <a href="https://example.com">❤️ 感谢您的支持</a>
</div>

</br>

## 更新日志

> 如果未检测到旧数据，请重新导入。
`)
	backing := bytes.Repeat([]byte{0xA5}, len(source)+1024)
	markdown := backing[:len(source)]
	copy(markdown, source)
	original := bytes.Clone(backing)

	renderPackageREADME("https://example.com/package", markdown)

	if !bytes.Equal(original, backing) {
		t.Fatal("rendering package README mutated the input backing array")
	}
}

func TestRenderPackageREADMEConcurrently(t *testing.T) {
	source := []byte(`<div style="display: flex;">
  <!-- 按钮：感谢您的支持 -->
  <a href="https://example.com">❤️ 感谢您的支持</a>
</div>

</br>

## 更新日志

> 如果未检测到旧数据，请重新导入。
`)
	backing := make([]byte, len(source), len(source)+1024)
	copy(backing, source)
	markdown := backing[:len(source)]
	expected := renderPackageREADME("https://example.com/package", bytes.Clone(markdown))
	const workers = 32
	var waitGroup sync.WaitGroup
	waitGroup.Add(workers)
	errors := make(chan string, workers)
	for range workers {
		go func() {
			defer waitGroup.Done()
			for range 20 {
				if actual := renderPackageREADME("https://example.com/package", markdown); actual != expected {
					errors <- actual
					return
				}
			}
		}()
	}
	waitGroup.Wait()
	close(errors)
	if actual, ok := <-errors; ok {
		t.Fatalf("concurrent README rendering returned corrupted HTML:\n%s", actual)
	}
}
