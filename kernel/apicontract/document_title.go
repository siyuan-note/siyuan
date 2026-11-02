// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package apicontract

// DocumentTitleSource 保存完整行级源；content 是规范 .sy 行级节点 JSON 数组，不是 Markdown 或渲染 HTML。
type DocumentTitleSource struct {
	Spec    int    `json:"spec" api:"const=1"`
	Format  string `json:"format" api:"enum=inline-ast"`
	Content string `json:"content"`
}

type DocumentTitleRequest struct {
	ID       string `json:"id"`
	Notebook string `json:"notebook,omitempty" api:"optional"`
}

// DocumentTitleData 的摘要和 BlockDOM 均为派生显示，纯文本标题的 source 返回 null。
// revision 排除动态锚文本缓存，包含完整源的文字、样式和引用身份，用于条件写入。
type DocumentTitleData struct {
	ID       string               `json:"id"`
	Notebook string               `json:"notebook"`
	Format   string               `json:"format" api:"enum=plain|inline-ast"`
	Text     string               `json:"text"`
	Empty    bool                 `json:"empty"`
	BlockDOM string               `json:"blockDOM"`
	Source   *DocumentTitleSource `json:"source"`
	Revision string               `json:"revision"`
}

// TransactionDocumentTitle 必须以独立单操作事务提交，blockDOM 与 source 恰好提供一项。
// blockDOM 只允许一个段落的行级内容；source 必须为已支持的完整格式，不能传入纯文本摘要。
// expectedRevision 必须匹配当前语义源版本，撤销快照由内核生成，不接受客户端伪造快照。
// 可无损还原的普通文字保存为纯文本标题；行级格式、资源、引用及换行保留完整标题源。
// TransactionDocumentTitle 的版本冲突返回响应 code=-409；调用方必须保留草稿并重新读取标题。
type TransactionDocumentTitle struct {
	BlockDOM         *string              `json:"blockDOM,omitempty" api:"optional,nonnullable"`
	Source           *DocumentTitleSource `json:"source,omitempty" api:"optional,nonnullable"`
	ExpectedRevision string               `json:"expectedRevision"`
}
