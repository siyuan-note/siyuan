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

//go:build windows && !ios

package util

/*
#cgo LDFLAGS: -ldwrite
#define COBJMACROS
#include <dwrite.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <wchar.h>
#include <windows.h>

typedef struct {
	char *family;
	char *localizedFamily;
	char *style;
	char *localizedStyle;
	int weight;
	char **aliases;
	size_t aliasCount;
} SiyuanWindowsFont;

static const GUID siyuanIIDIDWriteFactory = {
	0xb859ee5a, 0xd838, 0x4b5b, {0xa2, 0xe8, 0x1a, 0xdc, 0x7d, 0x93, 0xdb, 0x48}
};

// siyuanCopyWideStringAsUTF8 将 UTF-16 字符串复制为由调用方释放的 UTF-8 字符串。
static char *siyuanCopyWideStringAsUTF8(const WCHAR *value) {
	if (!value || !value[0]) return NULL;
	int length = WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, value, -1, NULL, 0, NULL, NULL);
	if (length <= 0) return NULL;
	char *ret = (char *)malloc((size_t)length);
	if (!ret) return NULL;
	if (!WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, value, -1, ret, length, NULL, NULL)) {
		free(ret);
		return NULL;
	}
	return ret;
}

// siyuanCopyUTF8StringAsWide 将 UTF-8 字符串复制为由调用方释放的 UTF-16 字符串。
static WCHAR *siyuanCopyUTF8StringAsWide(const char *value) {
	if (!value || !value[0]) return NULL;
	int length = MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, value, -1, NULL, 0);
	if (length <= 0) return NULL;
	WCHAR *ret = (WCHAR *)malloc((size_t)length * sizeof(WCHAR));
	if (!ret) return NULL;
	if (!MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, value, -1, ret, length)) {
		free(ret);
		return NULL;
	}
	return ret;
}

// siyuanCopyLocalizedStringAt 复制指定索引处的本地化字符串。
static WCHAR *siyuanCopyLocalizedStringAt(IDWriteLocalizedStrings *strings, UINT32 index) {
	UINT32 length = 0;
	if (FAILED(IDWriteLocalizedStrings_GetStringLength(strings, index, &length))) return NULL;
	WCHAR *ret = (WCHAR *)malloc(((size_t)length + 1) * sizeof(WCHAR));
	if (!ret) return NULL;
	if (FAILED(IDWriteLocalizedStrings_GetString(strings, index, ret, length + 1))) {
		free(ret);
		return NULL;
	}
	return ret;
}

// siyuanPrimaryLanguageLength 返回 BCP 47 语言代码中主语言子标签的长度。
static size_t siyuanPrimaryLanguageLength(const WCHAR *locale) {
	size_t length = 0;
	while (locale && locale[length] && locale[length] != L'-' && locale[length] != L'_') length++;
	return length;
}

// siyuanSamePrimaryLanguage 判断两个 BCP 47 语言代码是否具有相同的主语言子标签。
static BOOL siyuanSamePrimaryLanguage(const WCHAR *left, const WCHAR *right) {
	size_t leftLength = siyuanPrimaryLanguageLength(left);
	size_t rightLength = siyuanPrimaryLanguageLength(right);
	return leftLength > 0 && leftLength == rightLength && 0 == _wcsnicmp(left, right, leftLength);
}

// siyuanFindLocalizedString 查找与界面语言最匹配的字符串，找不到时返回英文或第一个名称。
static WCHAR *siyuanFindLocalizedString(IDWriteLocalizedStrings *strings, const WCHAR *locale) {
	UINT32 index = 0;
	BOOL exists = FALSE;
	if (locale && SUCCEEDED(IDWriteLocalizedStrings_FindLocaleName(strings, locale, &index, &exists)) && exists) {
		return siyuanCopyLocalizedStringAt(strings, index);
	}

	if (locale && !wcschr(locale, L'-') && !wcschr(locale, L'_')) {
		UINT32 count = IDWriteLocalizedStrings_GetCount(strings);
		for (UINT32 i = 0; i < count; i++) {
			UINT32 localeLength = 0;
			if (FAILED(IDWriteLocalizedStrings_GetLocaleNameLength(strings, i, &localeLength))) continue;
			WCHAR *candidate = (WCHAR *)malloc(((size_t)localeLength + 1) * sizeof(WCHAR));
			if (!candidate) return NULL;
			HRESULT result = IDWriteLocalizedStrings_GetLocaleName(strings, i, candidate, localeLength + 1);
			BOOL matched = SUCCEEDED(result) && siyuanSamePrimaryLanguage(locale, candidate);
			free(candidate);
			if (matched) return siyuanCopyLocalizedStringAt(strings, i);
		}
	}

	if (SUCCEEDED(IDWriteLocalizedStrings_FindLocaleName(strings, L"en-us", &index, &exists)) && exists) {
		return siyuanCopyLocalizedStringAt(strings, index);
	}
	return IDWriteLocalizedStrings_GetCount(strings) > 0 ? siyuanCopyLocalizedStringAt(strings, 0) : NULL;
}

// siyuanAppendAlias 添加非空字体检索别名，重复项由 Go 层统一合并。
static BOOL siyuanAppendAlias(SiyuanWindowsFont *font, const WCHAR *value) {
	char *alias = siyuanCopyWideStringAsUTF8(value);
	if (!alias) return TRUE;
	char **aliases = (char **)realloc(font->aliases, (font->aliasCount + 1) * sizeof(char *));
	if (!aliases) {
		free(alias);
		return FALSE;
	}
	font->aliases = aliases;
	font->aliases[font->aliasCount++] = alias;
	return TRUE;
}

// siyuanAppendLocalizedAliases 添加本地化字符串集合中的全部名称。
static BOOL siyuanAppendLocalizedAliases(SiyuanWindowsFont *font, IDWriteLocalizedStrings *strings) {
	UINT32 count = IDWriteLocalizedStrings_GetCount(strings);
	for (UINT32 i = 0; i < count; i++) {
		WCHAR *value = siyuanCopyLocalizedStringAt(strings, i);
		if (!value) continue;
		BOOL appended = siyuanAppendAlias(font, value);
		free(value);
		if (!appended) return FALSE;
	}
	return TRUE;
}

// siyuanAppendInformationalAliases 添加字体的完整名称、PostScript 名称和首选名称。
static BOOL siyuanAppendInformationalAliases(SiyuanWindowsFont *font, IDWriteFont *directWriteFont) {
	static const DWRITE_INFORMATIONAL_STRING_ID ids[] = {
		DWRITE_INFORMATIONAL_STRING_FULL_NAME,
		DWRITE_INFORMATIONAL_STRING_POSTSCRIPT_NAME,
		DWRITE_INFORMATIONAL_STRING_PREFERRED_FAMILY_NAMES,
		DWRITE_INFORMATIONAL_STRING_PREFERRED_SUBFAMILY_NAMES,
		DWRITE_INFORMATIONAL_STRING_WIN32_FAMILY_NAMES,
		DWRITE_INFORMATIONAL_STRING_WIN32_SUBFAMILY_NAMES,
	};
	for (size_t i = 0; i < sizeof(ids) / sizeof(ids[0]); i++) {
		IDWriteLocalizedStrings *strings = NULL;
		BOOL exists = FALSE;
		HRESULT result = IDWriteFont_GetInformationalStrings(directWriteFont, ids[i], &strings, &exists);
		if (FAILED(result) || !exists || !strings) {
			if (strings) IDWriteLocalizedStrings_Release(strings);
			continue;
		}
		BOOL appended = siyuanAppendLocalizedAliases(font, strings);
		IDWriteLocalizedStrings_Release(strings);
		if (!appended) return FALSE;
	}
	return TRUE;
}

// siyuanFreeWindowsFont 释放单个字体项持有的内存。
static void siyuanFreeWindowsFont(SiyuanWindowsFont *font) {
	free(font->family);
	free(font->localizedFamily);
	free(font->style);
	free(font->localizedStyle);
	for (size_t i = 0; i < font->aliasCount; i++) free(font->aliases[i]);
	free(font->aliases);
	memset(font, 0, sizeof(*font));
}

// siyuanFreeWindowsFonts 释放 DirectWrite 枚举结果。
static void siyuanFreeWindowsFonts(SiyuanWindowsFont *fonts, size_t count) {
	if (!fonts) return;
	for (size_t i = 0; i < count; i++) siyuanFreeWindowsFont(&fonts[i]);
	free(fonts);
}

// siyuanAppendWindowsFont 将字体项移动到结果数组。
static BOOL siyuanAppendWindowsFont(SiyuanWindowsFont **fonts, size_t *count, SiyuanWindowsFont *font) {
	SiyuanWindowsFont *items =
		(SiyuanWindowsFont *)realloc(*fonts, (*count + 1) * sizeof(SiyuanWindowsFont));
	if (!items) return FALSE;
	*fonts = items;
	(*fonts)[*count] = *font;
	(*count)++;
	memset(font, 0, sizeof(*font));
	return TRUE;
}

// siyuanCopyAvailableFonts 通过 DirectWrite 枚举当前系统可用于文本排版的字体。
static int32_t siyuanCopyAvailableFonts(const char *localeUTF8, SiyuanWindowsFont **fonts, size_t *count) {
	*fonts = NULL;
	*count = 0;
	WCHAR *locale = siyuanCopyUTF8StringAsWide(localeUTF8);
	IDWriteFactory *factory = NULL;
	HRESULT result = DWriteCreateFactory(
		DWRITE_FACTORY_TYPE_SHARED, &siyuanIIDIDWriteFactory, (IUnknown **)&factory);
	if (FAILED(result)) {
		free(locale);
		return (int32_t)result;
	}

	IDWriteFontCollection *collection = NULL;
	result = IDWriteFactory_GetSystemFontCollection(factory, &collection, FALSE);
	if (FAILED(result)) {
		IDWriteFactory_Release(factory);
		free(locale);
		return (int32_t)result;
	}

	UINT32 familyCount = IDWriteFontCollection_GetFontFamilyCount(collection);
	for (UINT32 familyIndex = 0; familyIndex < familyCount; familyIndex++) {
		IDWriteFontFamily *family = NULL;
		if (FAILED(IDWriteFontCollection_GetFontFamily(collection, familyIndex, &family))) continue;

		IDWriteLocalizedStrings *familyNames = NULL;
		if (FAILED(IDWriteFontFamily_GetFamilyNames(family, &familyNames))) {
			IDWriteFontFamily_Release(family);
			continue;
		}
		WCHAR *stableFamily = siyuanFindLocalizedString(familyNames, L"en-us");
		WCHAR *localizedFamily = siyuanFindLocalizedString(familyNames, locale);
		if (!stableFamily) stableFamily = siyuanFindLocalizedString(familyNames, locale);
		if (!localizedFamily && stableFamily) localizedFamily = _wcsdup(stableFamily);

		UINT32 fontCount = IDWriteFontFamily_GetFontCount(family);
		for (UINT32 fontIndex = 0; stableFamily && fontIndex < fontCount; fontIndex++) {
			IDWriteFont *directWriteFont = NULL;
			if (FAILED(IDWriteFontFamily_GetFont(family, fontIndex, &directWriteFont))) continue;

			IDWriteLocalizedStrings *faceNames = NULL;
			if (FAILED(IDWriteFont_GetFaceNames(directWriteFont, &faceNames))) {
				IDWriteFont_Release(directWriteFont);
				continue;
			}
			WCHAR *stableStyle = siyuanFindLocalizedString(faceNames, L"en-us");
			WCHAR *localizedStyle = siyuanFindLocalizedString(faceNames, locale);
			if (!localizedStyle && stableStyle) localizedStyle = _wcsdup(stableStyle);

			SiyuanWindowsFont font = {0};
			font.family = siyuanCopyWideStringAsUTF8(stableFamily);
			font.localizedFamily = siyuanCopyWideStringAsUTF8(localizedFamily);
			font.style = siyuanCopyWideStringAsUTF8(stableStyle);
			font.localizedStyle = siyuanCopyWideStringAsUTF8(localizedStyle);
			font.weight = (int)IDWriteFont_GetWeight(directWriteFont);
			BOOL appended = font.family &&
				siyuanAppendLocalizedAliases(&font, familyNames) &&
				siyuanAppendLocalizedAliases(&font, faceNames) &&
				siyuanAppendInformationalAliases(&font, directWriteFont) &&
				siyuanAppendWindowsFont(fonts, count, &font);
			siyuanFreeWindowsFont(&font);
			free(stableStyle);
			free(localizedStyle);
			IDWriteLocalizedStrings_Release(faceNames);
			IDWriteFont_Release(directWriteFont);
			if (!appended) {
				result = E_OUTOFMEMORY;
				break;
			}
		}

		free(stableFamily);
		free(localizedFamily);
		IDWriteLocalizedStrings_Release(familyNames);
		IDWriteFontFamily_Release(family);
		if (FAILED(result)) break;
	}

	IDWriteFontCollection_Release(collection);
	IDWriteFactory_Release(factory);
	free(locale);
	if (FAILED(result)) {
		siyuanFreeWindowsFonts(*fonts, *count);
		*fonts = NULL;
		*count = 0;
	}
	return (int32_t)result;
}
*/
import "C"

import (
	"strings"
	"unsafe"

	"github.com/siyuan-note/logging"
)

func loadPlatformFonts() (ret []*Font) {
	locale := C.CString(LangToBCP47(Lang))
	defer C.free(unsafe.Pointer(locale))

	var fonts *C.SiyuanWindowsFont
	var count C.size_t
	result := int32(C.siyuanCopyAvailableFonts(locale, &fonts, &count))
	if result < 0 {
		logging.LogWarnf("load DirectWrite fonts failed: 0x%08x", uint32(result))
		return nil
	}
	defer C.siyuanFreeWindowsFonts(fonts, count)

	for _, font := range unsafe.Slice(fonts, int(count)) {
		family := directWriteString(font.family)
		localizedFamily := directWriteString(font.localizedFamily)
		style := directWriteString(font.style)
		localizedStyle := directWriteString(font.localizedStyle)
		if "" == family || strings.HasPrefix(family, ".") {
			continue
		}
		if "" == localizedFamily {
			localizedFamily = family
		}
		if "" == localizedStyle {
			localizedStyle = style
		}
		displayName := localizedFamily
		if "" != style && !strings.EqualFold(style, "Regular") {
			displayName += " " + localizedStyle
		}

		var aliases []string
		for _, alias := range unsafe.Slice(font.aliases, int(font.aliasCount)) {
			aliases = appendFontAlias(aliases, C.GoString(alias))
		}
		weight := int(font.weight)
		if weight < 1 || 1000 < weight {
			weight = inferFontWeight(400, style)
		}
		ret = addFont(ret, &Font{
			Family:      family,
			Weight:      weight,
			DisplayName: displayName,
			Aliases:     aliases,
		})
	}
	return
}

func directWriteString(value *C.char) string {
	if nil == value {
		return ""
	}
	return strings.TrimSpace(C.GoString(value))
}
