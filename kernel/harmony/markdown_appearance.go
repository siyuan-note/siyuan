// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package main

/*
#include <stdint.h>
*/
import "C"

import (
	"sync"

	"github.com/siyuan-note/siyuan/kernel/markdownappearance"
)

var markdownAppearances = struct {
	sync.Mutex
	next  uint64
	items map[uint64]*markdownappearance.Resolver
}{items: map[uint64]*markdownappearance.Resolver{}}

func findMarkdownAppearance(handle C.uint64_t) *markdownappearance.Resolver {
	markdownAppearances.Lock()
	defer markdownAppearances.Unlock()
	return markdownAppearances.items[uint64(handle)]
}

//export NewMarkdownAppearance
func NewMarkdownAppearance(configDir, allowedRoot *C.char) C.uint64_t {
	if configDir == nil || allowedRoot == nil {
		return 0
	}
	resolver, err := markdownappearance.New(C.GoString(configDir), C.GoString(allowedRoot), "harmony")
	if err != nil {
		return 0
	}
	markdownAppearances.Lock()
	defer markdownAppearances.Unlock()
	markdownAppearances.next++
	markdownAppearances.items[markdownAppearances.next] = resolver
	return C.uint64_t(markdownAppearances.next)
}

//export ResolveMarkdownAppearance
func ResolveMarkdownAppearance(handle C.uint64_t, preferences, patch *C.char) *C.char {
	resolver := findMarkdownAppearance(handle)
	if resolver == nil || preferences == nil {
		return nil
	}
	patchJSON := ""
	if patch != nil {
		patchJSON = C.GoString(patch)
	}
	result, err := resolver.Resolve(C.GoString(preferences), patchJSON)
	if err != nil {
		return nil
	}
	return C.CString(result)
}

// 返回的缓冲区由原生调用方释放，字节长度不包含字符串终止符。
//
//export ReadMarkdownAppearanceFont
func ReadMarkdownAppearanceFont(handle C.uint64_t, token *C.char, length *C.int) *C.char {
	if length == nil {
		return nil
	}
	*length = 0
	resolver := findMarkdownAppearance(handle)
	if resolver == nil || token == nil {
		return nil
	}
	data, err := resolver.ReadFont(C.GoString(token))
	if err != nil || len(data) == 0 {
		return nil
	}
	*length = C.int(len(data))
	return (*C.char)(C.CBytes(data))
}

//export CloseMarkdownAppearance
func CloseMarkdownAppearance(handle C.uint64_t) {
	markdownAppearances.Lock()
	resolver := markdownAppearances.items[uint64(handle)]
	delete(markdownAppearances.items, uint64(handle))
	markdownAppearances.Unlock()
	if resolver != nil {
		resolver.Close()
	}
}
