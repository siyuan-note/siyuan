// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package documentaddressing

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"strings"

	"github.com/88250/lute/html"
)

var (
	ErrInvalidTitle          = errors.New("invalid document title source")
	ErrPathAmbiguous         = errors.New("document path is ambiguous; use a document ID or resolveDocPath")
	ErrLegacyPathUnsupported = errors.New("legacy document paths are unsupported; use structured document addressing")
)

// TitleRequiresSpec reports whether an already decoded title requires Spec 6.
func TitleRequiresSpec(title string) bool { return strings.Contains(title, "/") }

// CheckTitleProperties validates every raw title property, including duplicate values.
// It decodes HTML entities exactly once and reports the independent Spec 6 requirement.
func CheckTitleProperties(data []byte) (requiresSpec bool, err error) {
	if bytes.Equal(bytes.TrimSpace(data), []byte("null")) {
		return false, nil
	}
	decoder := json.NewDecoder(bytes.NewReader(data))
	token, err := decoder.Token()
	if err != nil || token != json.Delim('{') {
		return false, ErrInvalidTitle
	}
	var titleErr error
	for decoder.More() {
		token, err = decoder.Token()
		if err != nil {
			return false, ErrInvalidTitle
		}
		var value json.RawMessage
		if decoder.Decode(&value) != nil {
			return false, ErrInvalidTitle
		}
		if token != "title" {
			continue
		}
		var title string
		if json.Unmarshal(value, &title) != nil {
			if titleErr == nil {
				titleErr = ErrInvalidTitle
			}
		} else if TitleRequiresSpec(html.UnescapeAttrVal(title)) {
			requiresSpec = true
		}
	}
	if token, err = decoder.Token(); err != nil || token != json.Delim('}') {
		return false, ErrInvalidTitle
	}
	if _, err = decoder.Token(); err != io.EOF {
		return false, ErrInvalidTitle
	}
	return requiresSpec, titleErr
}
