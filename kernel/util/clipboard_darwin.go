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

//go:build darwin && !ios

// 本文件实现 macOS NSPasteboard 写入文件路径列表：通过 writeObjects: 写入 NSURL 数组
//（NSPasteboardTypeFileURL / public.file-url），使 Finder 等应用可识别并粘贴为文件。
//
// 逻辑依据 Apple 官方「复制到剪贴板」三步：
// 1) 获取 general pasteboard；2) clearContents 清空；3) writeObjects: 写入符合 NSPasteboardWriting 的对象。
// NSURL 为系统内置支持类型，写入 file URL 后系统会自动提供 public.file-url、
// NSFilenamesPboardType、public.utf8-plain-text 等表示，兼容 Finder 与旧版 API。
//
// 官方文档与参考：
//   - Pasteboard Programming Guide (macOS)
//     https://developer.apple.com/library/archive/documentation/Cocoa/Conceptual/PasteboardGuide106/Introduction/Introduction.html
//   - Copying to a Pasteboard（三步流程与 writeObjects:）
//     https://developer.apple.com/library/archive/documentation/Cocoa/Conceptual/PasteboardGuide106/Articles/pbCopying.html
//   - NSPasteboard
//     https://developer.apple.com/documentation/appkit/nspasteboard
//   - NSPasteboardWriting（NSURL、NSString 等已实现）
//     https://developer.apple.com/documentation/appkit/nspasteboardwriting
//
// 下文 /* ... */ 内为 CGO 内联的 Objective-C 代码，由 cgo 提取并编译，并非被注释掉的代码。

package util

/*
#cgo CFLAGS: -x objective-c
#cgo LDFLAGS: -framework AppKit -framework Foundation
#import <AppKit/AppKit.h>
#import <Foundation/Foundation.h>

// writeFilePathsToPasteboard 将路径列表写入通用剪贴板，遵循 Copying to a Pasteboard 三步：
// 1) generalPasteboard；2) clearContents；3) writeObjects: 传入 NSURL 数组。
// NSURL 符合 NSPasteboardWriting，写入后系统自动提供 public.file-url、NSFilenamesPboardType 等。
// paths 为 UTF-8 路径字符串数组，count 为数量。
static int writeFilePathsToPasteboard(const char** paths, int count) {
	if (count <= 0) return 0;
	NSMutableArray *arr = [NSMutableArray arrayWithCapacity:(NSUInteger)count];
	for (int i = 0; i < count; i++) {
		NSString *path = [NSString stringWithUTF8String:paths[i]];
		if (!path) continue;
		NSURL *url = [NSURL fileURLWithPath:path];
		if (url) [arr addObject:url];
	}
	// 若无一有效路径（如全为非法 UTF-8 或无法转为 NSURL），返回 -2 以便 Go 侧报错
	if ([arr count] == 0) return -2;
	// 步骤 1：获取通用剪贴板（cut/copy/paste 用）
	NSPasteboard *pb = [NSPasteboard generalPasteboard];
	// 步骤 2：清空已有内容，再只写入本次文件路径
	[pb clearContents];
	// 步骤 3：writeObjects: 要求对象符合 NSPasteboardWriting，NSURL 已支持
	BOOL ok = [pb writeObjects:arr];
	return ok ? 0 : -1;
}
*/
import "C"

import (
	"errors"
	"unsafe"
)

// WriteFilePaths 将文件路径列表写入系统剪贴板（general pasteboard），
// 使 Finder 等可粘贴为文件。实现见 Pasteboard Guide — Copying to a Pasteboard。
func WriteFilePaths(paths []string) error {
	if len(paths) == 0 {
		return nil
	}
	// 分配 C 的 char* 数组，便于传入 Objective-C
	cPaths := make([]*C.char, len(paths))
	for i, p := range paths {
		cPaths[i] = C.CString(p)
	}
	defer func() {
		for _, c := range cPaths {
			C.free(unsafe.Pointer(c))
		}
	}()
	// 取首元素地址作为 const char** 传入
	ret := C.writeFilePathsToPasteboard((**C.char)(unsafe.Pointer(&cPaths[0])), C.int(len(paths)))
	switch ret {
	case 0:
		return nil
	case -2:
		return errors.New("no valid file paths to write (invalid UTF-8 or path)")
	default:
		return errors.New("failed to write file paths to pasteboard")
	}
}
