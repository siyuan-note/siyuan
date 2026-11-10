// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package av

import "errors"

func (view *AttributeView) validateRecoveryStructure(id string) error {
	if view.ID != id {
		return errors.New("database recovery ID does not match its filename")
	}
	for _, field := range view.KeyValues {
		if field == nil || field.Key == nil {
			return errors.New("database recovery contains an invalid field")
		}
		for _, value := range field.Values {
			if value == nil {
				return errors.New("database recovery contains an invalid value")
			}
		}
	}
	if view.GetBlockKeyValues() == nil {
		return errors.New("database recovery has no primary field")
	}
	var validate func(*View) error
	validate = func(layout *View) error {
		if layout == nil {
			return errors.New("database recovery contains an invalid view")
		}
		switch layout.LayoutType {
		case LayoutTypeTable:
			if layout.Table == nil || layout.Table.BaseLayout == nil {
				return errors.New("database recovery contains an invalid table")
			}
		case LayoutTypeGallery:
			if layout.Gallery == nil || layout.Gallery.BaseLayout == nil {
				return errors.New("database recovery contains an invalid gallery")
			}
		case LayoutTypeKanban:
			if layout.Kanban == nil || layout.Kanban.BaseLayout == nil {
				return errors.New("database recovery contains an invalid kanban")
			}
		case LayoutTypeCalendar, LayoutTypeList:
		default:
			return errors.New("database recovery contains an unknown layout")
		}
		for _, table := range layout.TableLayouts() {
			if table == nil {
				continue
			}
			if table.BaseLayout == nil {
				return errors.New("database recovery contains an invalid table")
			}
			for _, column := range table.Columns {
				if column == nil || column.BaseField == nil {
					return errors.New("database recovery contains an invalid column")
				}
			}
		}
		for _, group := range layout.Groups {
			if err := validate(group); err != nil {
				return err
			}
		}
		return nil
	}
	for _, layout := range view.Views {
		if err := validate(layout); err != nil {
			return err
		}
	}
	return nil
}
