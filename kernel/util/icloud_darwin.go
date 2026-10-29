// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build darwin && !ios

package util

/*
#cgo CFLAGS: -x objective-c
#cgo LDFLAGS: -framework Foundation
#include <stdlib.h>
#import <Foundation/Foundation.h>

// siyuanIsUbiquitousItem 通过系统文件资源属性判断路径是否位于 iCloud 存储中。
// 参考 https://developer.apple.com/documentation/foundation/urlresourcevalues/isubiquitousitem
static int siyuanIsUbiquitousItem(const char *path) {
	@autoreleasepool {
		NSString *filePath = [NSString stringWithUTF8String:path];
		if (!filePath) return -2;

		NSURL *url = [NSURL fileURLWithPath:filePath];
		NSNumber *value = nil;
		NSError *error = nil;
		if (![url getResourceValue:&value forKey:NSURLIsUbiquitousItemKey error:&error]) return -1;
		return [value boolValue] ? 1 : 0;
	}
}
*/
import "C"

import (
	"errors"
	"unsafe"
)

func isUbiquitousItem(path string) (bool, error) {
	cPath := C.CString(path)
	defer C.free(unsafe.Pointer(cPath))

	switch C.siyuanIsUbiquitousItem(cPath) {
	case 1:
		return true, nil
	case 0:
		return false, nil
	case -2:
		return false, errors.New("invalid UTF-8 path")
	default:
		return false, errors.New("failed to read iCloud file resource status")
	}
}
