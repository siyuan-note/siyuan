package api

import (
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/av"
)

func toContractAVMapSettings(value *av.MapSettings) *apicontract.AVMapSettings {
	if value == nil {
		return nil
	}
	return &apicontract.AVMapSettings{LocationKeyID: value.LocationKeyID, Height: apicontract.AVMapHeight(value.Height)}
}

func toContractAVLayoutMap(value *av.LayoutMap) *apicontract.AVLayoutMap {
	if value == nil {
		return nil
	}
	return &apicontract.AVLayoutMap{
		AVBaseLayout: toContractAVBaseLayout(value.BaseLayout),
		Columns:      avContractSlice(value.Columns, toContractAVViewTableColumn),
		RowIDs:       value.RowIDs,
		Settings:     *toContractAVMapSettings(&value.Settings),
	}
}
