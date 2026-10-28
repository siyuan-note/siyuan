package model

import (
	"fmt"
	"github.com/siyuan-note/siyuan/kernel/av"
)

func setAttributeViewGroupNames(attrView *av.AttributeView, view *av.View) {
	groupKey := view.GetGroupKey(attrView)
	if groupKey == nil {
		return
	}
	for _, group := range view.Groups {
		group.Name = group.GetGroupValue()
		switch group.Name {
		case groupValueDefault:
			group.Name = fmt.Sprintf(Conf.language(264), groupKey.Name)
		case groupValueNotInRange:
			group.Name = Conf.language(265)
		case groupValueLast30Days:
			group.Name = fmt.Sprintf(Conf.language(259), 30)
		case groupValueLast7Days:
			group.Name = fmt.Sprintf(Conf.language(259), 7)
		case groupValueYesterday:
			group.Name = Conf.language(260)
		case groupValueToday:
			group.Name = Conf.language(261)
		case groupValueTomorrow:
			group.Name = Conf.language(262)
		case groupValueNext7Days:
			group.Name = fmt.Sprintf(Conf.language(263), 7)
		case groupValueNext30Days:
			group.Name = fmt.Sprintf(Conf.language(263), 30)
		}
	}
}
