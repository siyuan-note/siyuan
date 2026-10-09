// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"crypto/rand"
	"fmt"
	"io"
	"os"
	"path"
	"sort"
	"strings"

	"github.com/88250/lute/parse"
	"github.com/88250/lute/render"
	"github.com/siyuan-note/dataparser"
	"github.com/siyuan-note/siyuan/kernel/util"
)

const markdownImportBatchDocuments = 32
const markdownImportBatchBytes = 8 * 1024 * 1024

type markdownImportEntry struct {
	id, box, path, hpath string
	rootType             string
	hasRootType          bool
	offset               int64
	size, rawSize        int
}

// markdownImportSpool 只在内存中保留路径和链接索引，文档树使用独立会话密钥加密暂存。
// 临时文件不是恢复数据；来源 Markdown 保持原样，退出导入时关闭文件并清除会话密钥。
type markdownImportSpool struct {
	file        *os.File
	key         []byte
	singleTree  *parse.Tree
	entries     []markdownImportEntry
	searchLinks map[string]string
}

func newMarkdownImportSpool() (*markdownImportSpool, error) {
	key := make([]byte, 32)
	if _, err := rand.Read(key); err != nil {
		return nil, err
	}
	file, err := os.CreateTemp(util.TempDir, "markdown-import-*")
	if err != nil {
		clear(key)
		return nil, err
	}
	return &markdownImportSpool{file: file, key: key, searchLinks: map[string]string{}}, nil
}

func (spool *markdownImportSpool) close() {
	clear(spool.key)
	if spool.file != nil {
		spool.file.Close()
		os.Remove(spool.file.Name())
	}
}

func markdownImportAAD(index int) []byte {
	return []byte(fmt.Sprintf("siyuan/markdown-import/v1/%d", index))
}

func (spool *markdownImportSpool) add(tree *parse.Tree) error {
	// 单文件导入只保留这一棵树，不创建临时文件或增加序列化开销。
	if spool.file == nil {
		if spool.singleTree != nil {
			return fmt.Errorf("single-file Markdown import already contains a document")
		}
		spool.singleTree = tree
		spool.entries = append(spool.entries, markdownImportEntry{
			id: tree.ID, box: tree.Box, path: tree.Path, hpath: tree.HPath,
		})
		addImportSearchLinks(tree, spool.searchLinks)
		return nil
	}
	luteEngine := util.NewLute()
	raw := render.NewJSONRenderer(tree, luteEngine.RenderOptions, luteEngine.ParseOptions).Render()
	ciphertext, err := util.EncryptWithAAD(spool.key, raw, markdownImportAAD(len(spool.entries)))
	if err != nil {
		return err
	}
	offset, err := spool.file.Seek(0, io.SeekCurrent)
	if err != nil {
		return err
	}
	if n, err := spool.file.Write(ciphertext); err != nil {
		return err
	} else if n != len(ciphertext) {
		return io.ErrShortWrite
	}
	entry := markdownImportEntry{
		id: tree.ID, box: tree.Box, path: tree.Path, hpath: tree.HPath,
		offset: offset, size: len(ciphertext), rawSize: len(raw),
	}
	for _, attribute := range tree.Root.KramdownIAL {
		if attribute[0] == "type" {
			entry.rootType, entry.hasRootType = attribute[1], true
			break
		}
	}
	spool.entries = append(spool.entries, entry)
	addImportSearchLinks(tree, spool.searchLinks)
	return nil
}

func (spool *markdownImportSpool) load(index int) (*parse.Tree, error) {
	if spool.singleTree != nil {
		return spool.singleTree, nil
	}
	entry := spool.entries[index]
	ciphertext := make([]byte, entry.size)
	if _, err := spool.file.ReadAt(ciphertext, entry.offset); err != nil {
		return nil, err
	}
	raw, err := util.DecryptWithAAD(spool.key, ciphertext, markdownImportAAD(index))
	if err != nil {
		return nil, err
	}
	tree, err := dataparser.ParseJSONWithoutFix(raw, util.NewLute().ParseOptions)
	if err != nil {
		return nil, err
	}
	tree.ID, tree.Box, tree.Path, tree.HPath = entry.id, entry.box, entry.path, entry.hpath
	// 暂存往返保留来源属性，不将解析器补充的默认文档类型写回来源。
	if entry.hasRootType {
		tree.Root.SetIALAttr("type", entry.rootType)
	} else {
		tree.Root.RemoveIALAttr("type")
	}
	return tree, nil
}

func (spool *markdownImportSpool) movePaths(moveIDs map[string]string) {
	for id, newID := range moveIDs {
		for i := range spool.entries {
			entry := &spool.entries[i]
			entry.id = strings.ReplaceAll(entry.id, id, newID)
			entry.path = strings.ReplaceAll(entry.path, id, newID)
		}
	}
}

func (spool *markdownImportSpool) rootIDs(parentPath string) (ret []string) {
	for _, entry := range spool.entries {
		if path.Dir(entry.path) == parentPath {
			ret = append(ret, entry.id)
		}
	}
	sort.Strings(ret)
	return
}

func (spool *markdownImportSpool) finish(write func(*parse.Tree) error, flush func()) error {
	luteEngine := NewLute()
	luteEngine.SetHTMLTag2TextMark(true)
	batchCount, batchBytes := 0, 0
	defer func() {
		if batchCount > 0 {
			flush()
		}
	}()
	for i, entry := range spool.entries {
		tree, err := spool.load(i)
		if err != nil {
			return fmt.Errorf("read Markdown import staging entry %d: %w", i, err)
		}
		convertMdHyperlinks2WikiLinks(tree)
		convertWikiLinksAndTags(tree, spool.searchLinks)
		mergeTextAndHandlerNestedInlines(tree, luteEngine)
		if err = write(tree); err != nil {
			return err
		}
		batchCount++
		batchBytes += entry.rawSize
		if batchCount >= markdownImportBatchDocuments || batchBytes >= markdownImportBatchBytes {
			flush()
			batchCount, batchBytes = 0, 0
		}
	}
	return nil
}
