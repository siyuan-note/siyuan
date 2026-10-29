// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package documentaddressing

import "fmt"

type ModeSnapshot struct {
	Mode     int
	Revision string
	State    string
}

// InspectBox reports the fixed capability without source reads or migration writes.
// The API combines this with the independently tracked metadata index state.
func InspectBox(boxID string) (*ModeSnapshot, error) {
	mode, err := BoxMode(boxID)
	if err != nil {
		return nil, err
	}
	return &ModeSnapshot{Mode: mode, State: "structured", Revision: fmt.Sprintf("3:%s:2", boxID)}, nil
}
