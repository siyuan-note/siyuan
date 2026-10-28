// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package conf

type Stat struct {
	TreeCount   int   `json:"treeCount"`
	CTreeCount  int   `json:"cTreeCount"`
	BlockCount  int   `json:"blockCount"`
	CBlockCount int   `json:"cBlockCount"`
	DataSize    int64 `json:"dataSize"`
	CDataSize   int64 `json:"cDataSize"`
	AssetsSize  int64 `json:"assetsSize"`
	CAssetsSize int64 `json:"cAssetsSize"`
}

func NewStat() *Stat {
	return &Stat{}
}
