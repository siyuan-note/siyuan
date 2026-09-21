package api

import (
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/av"
)

func fromContractAVCalendarRange(value *apicontract.AVCalendarRange) *av.CalendarRange {
	if nil == value {
		return nil
	}
	return &av.CalendarRange{Start: value.Start, End: value.End, TimeZone: value.TimeZone}
}

func toContractAVCalendarRange(value *av.CalendarRange) *apicontract.AVCalendarRange {
	if nil == value {
		return nil
	}
	return &apicontract.AVCalendarRange{Start: value.Start, End: value.End, TimeZone: value.TimeZone}
}

func toContractAVCalendarSettings(value *av.CalendarSettings) *apicontract.AVCalendarSettings {
	if nil == value {
		return nil
	}
	return &apicontract.AVCalendarSettings{DateKeyID: value.DateKeyID, ColorKeyID: value.ColorKeyID,
		WeekStart: value.WeekStart, RowLimit: value.RowLimit}
}

func toContractAVLayoutCalendar(value *av.LayoutCalendar) *apicontract.AVLayoutCalendar {
	if nil == value {
		return nil
	}
	return &apicontract.AVLayoutCalendar{
		AVBaseLayout: toContractAVBaseLayout(value.BaseLayout),
		Columns:      avContractSlice(value.Columns, toContractAVViewTableColumn),
		RowIDs:       value.RowIDs,
		Settings:     *toContractAVCalendarSettings(&value.Settings),
	}
}
