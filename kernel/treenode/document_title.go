// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package treenode

import "github.com/88250/lute/ast"

const DocumentTitleEmptyAttr = "custom-sy-title-empty"

// DocumentTitle 是标题源的只读摘要，不能用它覆盖未来格式的完整源内容。
type DocumentTitle struct {
	Format string `json:"format"`
	Text   string `json:"text"`
	Empty  bool   `json:"empty"`
}

// ReadDocumentTitle 只提取已经通过源格式检查的文档标题，不解释 Markdown 或重复解码属性。
// 空标题标志与实际保存的占位文字分别保留，源文档版本由调用方从根节点读取。
func ReadDocumentTitle(root *ast.Node) DocumentTitle {
	return DocumentTitle{
		Format: "plain",
		Text:   root.IALAttr("title"),
		Empty:  root.IALAttr(DocumentTitleEmptyAttr) == "true",
	}
}

// DocumentTitleFromProperties 接受已经解码的根属性，与节点读取使用相同的摘要语义。
func DocumentTitleFromProperties(properties map[string]string) DocumentTitle {
	return DocumentTitle{Format: "plain", Text: properties["title"], Empty: properties[DocumentTitleEmptyAttr] == "true"}
}
