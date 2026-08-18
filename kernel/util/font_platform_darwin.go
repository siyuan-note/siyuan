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

//go:build darwin && !ios

package util

/*
#cgo CFLAGS: -x objective-c
#cgo LDFLAGS: -framework CoreText -framework Foundation
#include <stdlib.h>
#include <string.h>
#import <CoreText/CoreText.h>
#import <Foundation/Foundation.h>

// siyuanCopyDescriptorString 读取字体描述符字符串，并在需要时使用系统首选语言返回本地化值。
static NSString *siyuanCopyDescriptorString(CTFontDescriptorRef descriptor, CFStringRef attribute, BOOL localized) {
	CFTypeRef value = localized
		? CTFontDescriptorCopyLocalizedAttribute(descriptor, attribute, NULL)
		: CTFontDescriptorCopyAttribute(descriptor, attribute);
	if (!value) return nil;

	NSString *ret = nil;
	if (CFGetTypeID(value) == CFStringGetTypeID()) {
		ret = [(NSString *)value copy];
	}
	CFRelease(value);
	return [ret autorelease];
}

// siyuanAppendFontAlias 添加非空且不重复的字体检索别名。
static void siyuanAppendFontAlias(NSMutableArray *aliases, NSString *value) {
	if ([value length] == 0 || [aliases containsObject:value]) return;
	[aliases addObject:value];
}

// siyuanCopyAvailableFontsJSON 通过 CoreText 枚举当前应用可用字体，包括不在常规字体目录中的系统字体。
static char *siyuanCopyAvailableFontsJSON(void) {
	@autoreleasepool {
		NSMutableArray *fonts = [NSMutableArray array];
		CTFontCollectionRef collection = CTFontCollectionCreateFromAvailableFonts(NULL);
		if (collection) {
			CFArrayRef descriptors = CTFontCollectionCreateMatchingFontDescriptors(collection);
			CFRelease(collection);
			if (descriptors) {
				CFIndex count = CFArrayGetCount(descriptors);
				for (CFIndex i = 0; i < count; i++) {
					CTFontDescriptorRef descriptor =
						(CTFontDescriptorRef)CFArrayGetValueAtIndex(descriptors, i);
					NSString *family = siyuanCopyDescriptorString(descriptor, kCTFontFamilyNameAttribute, NO);
					if ([family length] == 0 || [family hasPrefix:@"."]) continue;

					NSString *localizedFamily =
						siyuanCopyDescriptorString(descriptor, kCTFontFamilyNameAttribute, YES);
					NSString *style = siyuanCopyDescriptorString(descriptor, kCTFontStyleNameAttribute, NO);
					NSString *localizedStyle =
						siyuanCopyDescriptorString(descriptor, kCTFontStyleNameAttribute, YES);
					NSString *displayName =
						siyuanCopyDescriptorString(descriptor, kCTFontDisplayNameAttribute, NO);
					NSString *localizedDisplayName =
						siyuanCopyDescriptorString(descriptor, kCTFontDisplayNameAttribute, YES);
					NSString *postscriptName =
						siyuanCopyDescriptorString(descriptor, kCTFontNameAttribute, NO);

					double weight = 0;
					CFTypeRef traitsValue = CTFontDescriptorCopyAttribute(descriptor, kCTFontTraitsAttribute);
					if (traitsValue && CFGetTypeID(traitsValue) == CFDictionaryGetTypeID()) {
						CFNumberRef weightValue = (CFNumberRef)CFDictionaryGetValue(
							(CFDictionaryRef)traitsValue, kCTFontWeightTrait);
						if (weightValue && CFGetTypeID(weightValue) == CFNumberGetTypeID()) {
							CFNumberGetValue(weightValue, kCFNumberDoubleType, &weight);
						}
					}
					if (traitsValue) CFRelease(traitsValue);

					NSMutableArray *aliases = [NSMutableArray array];
					siyuanAppendFontAlias(aliases, localizedFamily);
					siyuanAppendFontAlias(aliases, style);
					siyuanAppendFontAlias(aliases, localizedStyle);
					siyuanAppendFontAlias(aliases, displayName);
					siyuanAppendFontAlias(aliases, localizedDisplayName);
					siyuanAppendFontAlias(aliases, postscriptName);

					[fonts addObject:@{
						@"family": family,
						@"displayName": [localizedDisplayName length] ? localizedDisplayName :
							([displayName length] ? displayName : family),
						@"style": [style length] ? style : @"",
						@"weight": @(weight),
						@"aliases": aliases,
					}];
				}
				CFRelease(descriptors);
			}
		}

		NSData *data = [NSJSONSerialization dataWithJSONObject:fonts options:0 error:nil];
		if (!data) return strdup("[]");
		char *ret = malloc([data length] + 1);
		if (!ret) return NULL;
		memcpy(ret, [data bytes], [data length]);
		ret[[data length]] = '\0';
		return ret;
	}
}
*/
import "C"

import (
	"encoding/json"
	"strings"
	"unsafe"

	"github.com/siyuan-note/logging"
)

type coreTextFont struct {
	Family      string   `json:"family"`
	DisplayName string   `json:"displayName"`
	Style       string   `json:"style"`
	Weight      float64  `json:"weight"`
	Aliases     []string `json:"aliases"`
}

func loadPlatformFonts() (ret []*Font) {
	data := C.siyuanCopyAvailableFontsJSON()
	if nil == data {
		return nil
	}
	defer C.free(unsafe.Pointer(data))

	var coreTextFonts []*coreTextFont
	if err := json.Unmarshal([]byte(C.GoString(data)), &coreTextFonts); err != nil {
		logging.LogWarnf("load CoreText fonts failed: %s", err)
		return nil
	}
	for _, font := range coreTextFonts {
		font.Family = strings.TrimSpace(font.Family)
		font.DisplayName = strings.TrimSpace(font.DisplayName)
		if "" == font.Family || strings.HasPrefix(font.Family, ".") {
			continue
		}
		if "" == font.DisplayName {
			font.DisplayName = font.Family
		}
		ret = addFont(ret, &Font{
			Family:      font.Family,
			Weight:      fontWeightFromNormalizedTrait(font.Weight, font.Style),
			DisplayName: font.DisplayName,
			Aliases:     font.Aliases,
		})
	}
	return
}
