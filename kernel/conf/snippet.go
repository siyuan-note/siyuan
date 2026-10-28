// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package conf

type Snpt struct {
	EnabledCSS bool `json:"enabledCSS"`
	EnabledJS  bool `json:"enabledJS"`
}

func NewSnpt() *Snpt {
	return &Snpt{
		EnabledCSS: true,
		EnabledJS:  true,
	}
}

type Snippet struct {
	ID                string `json:"id"`
	Name              string `json:"name"`
	Type              string `json:"type"` // js/css
	Enabled           bool   `json:"enabled"`
	DisabledInPublish bool   `json:"disabledInPublish"`
	Content           string `json:"content"`
}
