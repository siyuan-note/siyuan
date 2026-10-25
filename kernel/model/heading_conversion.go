// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"bytes"
	"errors"
	"os"
	"path/filepath"

	"github.com/88250/lute/parse"
	"github.com/88250/lute/render"
	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

// 转换先保存目标，随后移除或改写源；索引仅在两个源操作成功后发布。
// 原始字节快照也适用于加密文档，补偿保持原密文，不重新加密或重建密钥。
type headingConversionSource struct {
	tree *parse.Tree
	data []byte
}

type headingConversionIO struct {
	write  func(*parse.Tree, []byte) ([]byte, error)
	remove func(*parse.Tree, []byte) error
}

func headingConversionPath(tree *parse.Tree) string {
	return filepath.Join(util.DataDir, tree.Box, tree.Path)
}

func headingConversionDocument(tree *parse.Tree) []*treenode.BlockTree {
	return []*treenode.BlockTree{{ID: tree.ID, RootID: tree.ID, BoxID: tree.Box, Path: tree.Path, Type: "d"}}
}

func checkHeadingConversionBytes(tree *parse.Tree, expected []byte) error {
	current, err := filelock.ReadFile(headingConversionPath(tree))
	if os.IsNotExist(err) && expected == nil {
		return nil
	}
	if err != nil {
		return err
	}
	if !bytes.Equal(current, expected) {
		return errors.New("document changed during heading conversion")
	}
	return nil
}

func captureHeadingConversionSource(tree *parse.Tree) (*headingConversionSource, error) {
	snapshot, data, err := filesys.LoadTreeSnapshot(tree.Box, tree.Path, util.NewLute())
	if err != nil {
		return nil, err
	}
	if !sameHeadingConversionTree(snapshot, tree) {
		return nil, errors.New("document changed before heading conversion")
	}
	return &headingConversionSource{tree: snapshot, data: data}, nil
}

func sameHeadingConversionTree(left, right *parse.Tree) bool {
	engine := util.NewLute()
	encode := func(tree *parse.Tree) []byte {
		cloned := *tree
		cloned.Root = cloneBlockSwapNode(tree.Root)
		return render.NewJSONRenderer(&cloned, engine.RenderOptions, engine.ParseOptions).Render()
	}
	return bytes.Equal(encode(left), encode(right))
}

func (source *headingConversionSource) check() error {
	return checkHeadingConversionBytes(source.tree, source.data)
}

func (source *headingConversionSource) restore(written []byte) error {
	err := filesys.MutateDocumentSources(headingConversionDocument(source.tree), func() error {
		return util.WriteFileWithPreflight(headingConversionPath(source.tree), source.data, false, func(current []byte) error {
			if !bytes.Equal(current, written) {
				return errors.New("document changed before heading conversion recovery")
			}
			return nil
		})
	})
	if err == nil {
		treenode.UpsertBlockTree(source.tree)
		sql.UpsertTreeQueue(source.tree)
	}
	return err
}

func defaultHeadingConversionIO() headingConversionIO {
	return headingConversionIO{
		write: func(tree *parse.Tree, expected []byte) ([]byte, error) {
			var writeErr error
			if expected == nil {
				_, writeErr = filesys.WriteTreeWithPreflight(tree, func() error {
					return checkHeadingConversionBytes(tree, expected)
				})
			} else {
				_, writeErr = filesys.WriteTreeIfUnchanged(tree, expected)
			}
			// 元数据发布可能在文件已写入后失败；只返回确属本次写入的认证源作为补偿基线。
			written, data, readErr := filesys.LoadTreeSnapshot(tree.Box, tree.Path, util.NewLute())
			if readErr != nil {
				return nil, errors.Join(writeErr, readErr)
			}
			if !sameHeadingConversionTree(written, tree) {
				return nil, errors.Join(writeErr, errors.New("document changed during heading conversion write"))
			}
			return data, writeErr
		},
		remove: func(tree *parse.Tree, expected []byte) error {
			return filesys.MutateDocumentSources(headingConversionDocument(tree), func() error {
				if err := checkHeadingConversionBytes(tree, expected); err != nil {
					return err
				}
				box := Conf.Box(tree.Box)
				if box == nil {
					return ErrBlockNotFound
				}
				if err := box.Remove(tree.Path); err != nil {
					return err
				}
				cache.RemoveTreeDataInBox(tree.ID, tree.Box)
				cache.RemoveDocIALInBox(tree.Path, tree.Box)
				return nil
			})
		},
	}
}
