package api

import (
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/model"
)

func avContractSlice[S, D any](values []S, convert func(S) D) []D {
	if values == nil {
		return nil
	}
	ret := make([]D, len(values))
	for i, value := range values {
		ret[i] = convert(value)
	}
	return ret
}
func avContractMap[S, D any](values map[string]S, convert func(S) D) map[string]D {
	if values == nil {
		return nil
	}
	ret := make(map[string]D, len(values))
	for key, value := range values {
		ret[key] = convert(value)
	}
	return ret
}
func avContractView(value av.Viewable) apicontract.AVViewInstance {
	switch view := value.(type) {
	case *av.Table:
		return apicontract.NewAVTableInstance(toContractAVTable(view))
	case *av.Calendar:
		return apicontract.NewAVTableInstance(toContractAVTable(view.Table))
	case *av.List:
		return apicontract.NewAVTableInstance(toContractAVTable(view.Table))
	case *av.Gallery:
		return apicontract.NewAVGalleryInstance(toContractAVGallery(view))
	case *av.Kanban:
		return apicontract.NewAVKanbanInstance(toContractAVKanban(view))
	default:
		return apicontract.AVViewInstance{}
	}
}
func toContractAVTable(value *av.Table) *apicontract.AVTable {
	if value == nil {
		return nil
	}
	return &apicontract.AVTable{
		AVBaseInstance:     toContractAVBaseInstance(value.BaseInstance),
		Calendar:           toContractAVCalendarSettings(value.Calendar),
		CalendarRange:      toContractAVCalendarRange(value.CalendarRange),
		CalendarTargetDate: value.CalendarTargetDate,
		Columns:            avContractSlice(value.Columns, func(value *av.TableColumn) *apicontract.AVTableColumn { return toContractAVTableColumn(value) }),
		Rows:               avContractSlice(value.Rows, func(value *av.TableRow) *apicontract.AVTableRow { return toContractAVTableRow(value) }),
		RowCount:           value.RowCount,
	}
}
func toContractAVBaseInstance(value *av.BaseInstance) *apicontract.AVBaseInstance {
	if value == nil {
		return nil
	}
	return &apicontract.AVBaseInstance{
		ID:               value.ID,
		Icon:             value.Icon,
		Name:             value.Name,
		Desc:             value.Desc,
		HideAttrViewName: value.HideAttrViewName,
		Filters:          avContractSlice(value.Filters, func(value *av.ViewFilter) *apicontract.AVViewFilter { return toContractAVViewFilter(value) }),
		Sorts:            avContractSlice(value.Sorts, func(value *av.ViewSort) *apicontract.AVViewSort { return toContractAVViewSort(value) }),
		Group:            toContractAVViewGroup(value.Group),
		PageSize:         value.PageSize,
		ShowIcon:         value.ShowIcon,
		WrapField:        value.WrapField,
		GroupKey:         toContractAVKey(value.GroupKey),
		GroupValue:       toContractAVValue(value.GroupValue),
		Groups:           avContractSlice(value.Groups, func(value av.Viewable) apicontract.AVViewInstance { return avContractView(value) }),
		GroupCalc:        toContractAVGroupCalc(value.GroupCalc),
		GroupFolded:      value.GroupFolded,
		GroupHidden:      value.GroupHidden,
	}
}
func toContractAVViewFilter(value *av.ViewFilter) *apicontract.AVViewFilter {
	if value == nil {
		return nil
	}
	return &apicontract.AVViewFilter{
		Column:        value.Column,
		ValueSource:   string(value.ValueSource),
		Qualifier:     string(value.Qualifier),
		Operator:      string(value.Operator),
		Value:         toContractAVValue(value.Value),
		RelativeDate:  toContractAVRelativeDate(value.RelativeDate),
		RelativeDate2: toContractAVRelativeDate(value.RelativeDate2),
		DateEndpoint:  string(value.DateEndpoint),
		Combination:   string(value.Combination),
		Filters:       avContractSlice(value.Filters, func(value *av.ViewFilter) *apicontract.AVViewFilter { return toContractAVViewFilter(value) }),
	}
}
func fromContractAVViewFilter(value *apicontract.AVViewFilter) *av.ViewFilter {
	if value == nil {
		return nil
	}
	return &av.ViewFilter{
		Column:        value.Column,
		ValueSource:   av.ValueSource(value.ValueSource),
		Qualifier:     av.FilterQuantifier(value.Qualifier),
		Operator:      av.FilterOperator(value.Operator),
		Value:         fromContractAVValue(value.Value),
		RelativeDate:  fromContractAVRelativeDate(value.RelativeDate),
		RelativeDate2: fromContractAVRelativeDate(value.RelativeDate2),
		DateEndpoint:  av.DateEndpoint(value.DateEndpoint),
		Combination:   av.FilterCombination(value.Combination),
		Filters:       avContractSlice(value.Filters, func(value *apicontract.AVViewFilter) *av.ViewFilter { return fromContractAVViewFilter(value) }),
	}
}
func toContractAVValue(value *av.Value) *apicontract.AVValue {
	if value == nil {
		return nil
	}
	return &apicontract.AVValue{
		ID:              value.ID,
		KeyID:           value.KeyID,
		BlockID:         value.BlockID,
		Type:            string(value.Type),
		IsDetached:      value.IsDetached,
		CreatedAt:       value.CreatedAt,
		UpdatedAt:       value.UpdatedAt,
		Block:           toContractAVValueBlock(value.Block),
		Text:            toContractAVValueText(value.Text),
		Number:          toContractAVValueNumber(value.Number),
		Date:            toContractAVValueDate(value.Date),
		MSelect:         avContractSlice(value.MSelect, func(value *av.ValueSelect) *apicontract.AVValueSelect { return toContractAVValueSelect(value) }),
		URL:             toContractAVValueURL(value.URL),
		Email:           toContractAVValueEmail(value.Email),
		Phone:           toContractAVValuePhone(value.Phone),
		MAsset:          avContractSlice(value.MAsset, func(value *av.ValueAsset) *apicontract.AVValueAsset { return toContractAVValueAsset(value) }),
		Template:        toContractAVValueTemplate(value.Template),
		Created:         toContractAVValueCreated(value.Created),
		Updated:         toContractAVValueUpdated(value.Updated),
		Checkbox:        toContractAVValueCheckbox(value.Checkbox),
		Relation:        toContractAVValueRelation(value.Relation),
		Rollup:          toContractAVValueRollup(value.Rollup),
		RenderedContent: value.RenderedContent,
	}
}
func fromContractAVValue(value *apicontract.AVValue) *av.Value {
	if value == nil {
		return nil
	}
	return &av.Value{
		ID:              value.ID,
		KeyID:           value.KeyID,
		BlockID:         value.BlockID,
		Type:            av.KeyType(value.Type),
		IsDetached:      value.IsDetached,
		CreatedAt:       value.CreatedAt,
		UpdatedAt:       value.UpdatedAt,
		Block:           fromContractAVValueBlock(value.Block),
		Text:            fromContractAVValueText(value.Text),
		Number:          fromContractAVValueNumber(value.Number),
		Date:            fromContractAVValueDate(value.Date),
		MSelect:         avContractSlice(value.MSelect, func(value *apicontract.AVValueSelect) *av.ValueSelect { return fromContractAVValueSelect(value) }),
		URL:             fromContractAVValueURL(value.URL),
		Email:           fromContractAVValueEmail(value.Email),
		Phone:           fromContractAVValuePhone(value.Phone),
		MAsset:          avContractSlice(value.MAsset, func(value *apicontract.AVValueAsset) *av.ValueAsset { return fromContractAVValueAsset(value) }),
		Template:        fromContractAVValueTemplate(value.Template),
		Created:         fromContractAVValueCreated(value.Created),
		Updated:         fromContractAVValueUpdated(value.Updated),
		Checkbox:        fromContractAVValueCheckbox(value.Checkbox),
		Relation:        fromContractAVValueRelation(value.Relation),
		Rollup:          fromContractAVValueRollup(value.Rollup),
		RenderedContent: value.RenderedContent,
	}
}
func toContractAVValueBlock(value *av.ValueBlock) *apicontract.AVValueBlock {
	if value == nil {
		return nil
	}
	return &apicontract.AVValueBlock{
		ID:         value.ID,
		Icon:       value.Icon,
		Content:    value.Content,
		RefSubtype: string(value.RefSubtype),
		Created:    value.Created,
		Updated:    value.Updated,
	}
}
func fromContractAVValueBlock(value *apicontract.AVValueBlock) *av.ValueBlock {
	if value == nil {
		return nil
	}
	return &av.ValueBlock{
		ID:         value.ID,
		Icon:       value.Icon,
		Content:    value.Content,
		RefSubtype: av.BlockRefSubtype(value.RefSubtype),
		Created:    value.Created,
		Updated:    value.Updated,
	}
}
func toContractAVValueText(value *av.ValueText) *apicontract.AVValueText {
	if value == nil {
		return nil
	}
	return &apicontract.AVValueText{
		Content: value.Content,
		Rich:    toContractAVValueTextRich(value.Rich),
	}
}
func fromContractAVValueText(value *apicontract.AVValueText) *av.ValueText {
	if value == nil {
		return nil
	}
	return &av.ValueText{
		Content: value.Content,
		Rich:    fromContractAVValueTextRich(value.Rich),
	}
}
func toContractAVValueTextRich(value *av.ValueTextRich) *apicontract.AVValueTextRich {
	if value == nil {
		return nil
	}
	return &apicontract.AVValueTextRich{
		Spec:    value.Spec,
		Format:  string(value.Format),
		Content: value.Content,
	}
}
func fromContractAVValueTextRich(value *apicontract.AVValueTextRich) *av.ValueTextRich {
	if value == nil {
		return nil
	}
	return &av.ValueTextRich{
		Spec:    value.Spec,
		Format:  av.ValueTextRichFormat(value.Format),
		Content: value.Content,
	}
}
func toContractAVValueNumber(value *av.ValueNumber) *apicontract.AVValueNumber {
	if value == nil {
		return nil
	}
	return &apicontract.AVValueNumber{
		Content:          value.Content,
		IsNotEmpty:       value.IsNotEmpty,
		Format:           string(value.Format),
		FormattedContent: value.FormattedContent,
	}
}
func fromContractAVValueNumber(value *apicontract.AVValueNumber) *av.ValueNumber {
	if value == nil {
		return nil
	}
	return &av.ValueNumber{
		Content:          value.Content,
		IsNotEmpty:       value.IsNotEmpty,
		Format:           av.NumberFormat(value.Format),
		FormattedContent: value.FormattedContent,
	}
}
func toContractAVValueDate(value *av.ValueDate) *apicontract.AVValueDate {
	if value == nil {
		return nil
	}
	return &apicontract.AVValueDate{
		Content:          value.Content,
		IsNotEmpty:       value.IsNotEmpty,
		HasEndDate:       value.HasEndDate,
		IsNotTime:        value.IsNotTime,
		Content2:         value.Content2,
		IsNotEmpty2:      value.IsNotEmpty2,
		FormattedContent: value.FormattedContent,
	}
}
func fromContractAVValueDate(value *apicontract.AVValueDate) *av.ValueDate {
	if value == nil {
		return nil
	}
	return &av.ValueDate{
		Content:          value.Content,
		IsNotEmpty:       value.IsNotEmpty,
		HasEndDate:       value.HasEndDate,
		IsNotTime:        value.IsNotTime,
		Content2:         value.Content2,
		IsNotEmpty2:      value.IsNotEmpty2,
		FormattedContent: value.FormattedContent,
	}
}
func toContractAVValueSelect(value *av.ValueSelect) *apicontract.AVValueSelect {
	if value == nil {
		return nil
	}
	return &apicontract.AVValueSelect{
		Content:       value.Content,
		Color:         value.Color,
		ResolvedColor: toContractAVAttributeViewColor(value.ResolvedColor),
	}
}
func fromContractAVValueSelect(value *apicontract.AVValueSelect) *av.ValueSelect {
	if value == nil {
		return nil
	}
	return &av.ValueSelect{
		Content:       value.Content,
		Color:         value.Color,
		ResolvedColor: fromContractAVAttributeViewColor(value.ResolvedColor),
	}
}
func toContractAVAttributeViewColor(value *av.AttributeViewColor) *apicontract.AVAttributeViewColor {
	if value == nil {
		return nil
	}
	return &apicontract.AVAttributeViewColor{
		Light: *toContractAVAttributeViewColorTheme(&value.Light),
		Dark:  *toContractAVAttributeViewColorTheme(&value.Dark),
	}
}
func fromContractAVAttributeViewColor(value *apicontract.AVAttributeViewColor) *av.AttributeViewColor {
	if value == nil {
		return nil
	}
	return &av.AttributeViewColor{
		Light: *fromContractAVAttributeViewColorTheme(&value.Light),
		Dark:  *fromContractAVAttributeViewColorTheme(&value.Dark),
	}
}
func toContractAVAttributeViewColorTheme(value *av.AttributeViewColorTheme) *apicontract.AVAttributeViewColorTheme {
	if value == nil {
		return nil
	}
	return &apicontract.AVAttributeViewColorTheme{
		Color:           value.Color,
		BackgroundColor: value.BackgroundColor,
	}
}
func fromContractAVAttributeViewColorTheme(value *apicontract.AVAttributeViewColorTheme) *av.AttributeViewColorTheme {
	if value == nil {
		return nil
	}
	return &av.AttributeViewColorTheme{
		Color:           value.Color,
		BackgroundColor: value.BackgroundColor,
	}
}
func toContractAVValueURL(value *av.ValueURL) *apicontract.AVValueURL {
	if value == nil {
		return nil
	}
	return &apicontract.AVValueURL{
		Content: value.Content,
	}
}
func fromContractAVValueURL(value *apicontract.AVValueURL) *av.ValueURL {
	if value == nil {
		return nil
	}
	return &av.ValueURL{
		Content: value.Content,
	}
}
func toContractAVValueEmail(value *av.ValueEmail) *apicontract.AVValueEmail {
	if value == nil {
		return nil
	}
	return &apicontract.AVValueEmail{
		Content: value.Content,
	}
}
func fromContractAVValueEmail(value *apicontract.AVValueEmail) *av.ValueEmail {
	if value == nil {
		return nil
	}
	return &av.ValueEmail{
		Content: value.Content,
	}
}
func toContractAVValuePhone(value *av.ValuePhone) *apicontract.AVValuePhone {
	if value == nil {
		return nil
	}
	return &apicontract.AVValuePhone{
		Content: value.Content,
	}
}
func fromContractAVValuePhone(value *apicontract.AVValuePhone) *av.ValuePhone {
	if value == nil {
		return nil
	}
	return &av.ValuePhone{
		Content: value.Content,
	}
}
func toContractAVValueAsset(value *av.ValueAsset) *apicontract.AVValueAsset {
	if value == nil {
		return nil
	}
	return &apicontract.AVValueAsset{
		Type:    string(value.Type),
		Name:    value.Name,
		Content: value.Content,
	}
}
func fromContractAVValueAsset(value *apicontract.AVValueAsset) *av.ValueAsset {
	if value == nil {
		return nil
	}
	return &av.ValueAsset{
		Type:    av.AssetType(value.Type),
		Name:    value.Name,
		Content: value.Content,
	}
}
func toContractAVValueTemplate(value *av.ValueTemplate) *apicontract.AVValueTemplate {
	if value == nil {
		return nil
	}
	return &apicontract.AVValueTemplate{
		Content: value.Content,
	}
}
func fromContractAVValueTemplate(value *apicontract.AVValueTemplate) *av.ValueTemplate {
	if value == nil {
		return nil
	}
	return &av.ValueTemplate{
		Content: value.Content,
	}
}
func toContractAVValueCreated(value *av.ValueCreated) *apicontract.AVValueCreated {
	if value == nil {
		return nil
	}
	return &apicontract.AVValueCreated{
		Content:          value.Content,
		IsNotEmpty:       value.IsNotEmpty,
		Content2:         value.Content2,
		IsNotEmpty2:      value.IsNotEmpty2,
		FormattedContent: value.FormattedContent,
	}
}
func fromContractAVValueCreated(value *apicontract.AVValueCreated) *av.ValueCreated {
	if value == nil {
		return nil
	}
	return &av.ValueCreated{
		Content:          value.Content,
		IsNotEmpty:       value.IsNotEmpty,
		Content2:         value.Content2,
		IsNotEmpty2:      value.IsNotEmpty2,
		FormattedContent: value.FormattedContent,
	}
}
func toContractAVValueUpdated(value *av.ValueUpdated) *apicontract.AVValueUpdated {
	if value == nil {
		return nil
	}
	return &apicontract.AVValueUpdated{
		Content:          value.Content,
		IsNotEmpty:       value.IsNotEmpty,
		Content2:         value.Content2,
		IsNotEmpty2:      value.IsNotEmpty2,
		FormattedContent: value.FormattedContent,
	}
}
func fromContractAVValueUpdated(value *apicontract.AVValueUpdated) *av.ValueUpdated {
	if value == nil {
		return nil
	}
	return &av.ValueUpdated{
		Content:          value.Content,
		IsNotEmpty:       value.IsNotEmpty,
		Content2:         value.Content2,
		IsNotEmpty2:      value.IsNotEmpty2,
		FormattedContent: value.FormattedContent,
	}
}
func toContractAVValueCheckbox(value *av.ValueCheckbox) *apicontract.AVValueCheckbox {
	if value == nil {
		return nil
	}
	return &apicontract.AVValueCheckbox{
		Checked: value.Checked,
	}
}
func fromContractAVValueCheckbox(value *apicontract.AVValueCheckbox) *av.ValueCheckbox {
	if value == nil {
		return nil
	}
	return &av.ValueCheckbox{
		Checked: value.Checked,
	}
}
func toContractAVValueRelation(value *av.ValueRelation) *apicontract.AVValueRelation {
	if value == nil {
		return nil
	}
	return &apicontract.AVValueRelation{
		BlockIDs: value.BlockIDs,
		Contents: avContractSlice(value.Contents, func(value *av.Value) *apicontract.AVValue { return toContractAVValue(value) }),
	}
}
func fromContractAVValueRelation(value *apicontract.AVValueRelation) *av.ValueRelation {
	if value == nil {
		return nil
	}
	return &av.ValueRelation{
		BlockIDs: value.BlockIDs,
		Contents: avContractSlice(value.Contents, func(value *apicontract.AVValue) *av.Value { return fromContractAVValue(value) }),
	}
}
func toContractAVValueRollup(value *av.ValueRollup) *apicontract.AVValueRollup {
	if value == nil {
		return nil
	}
	return &apicontract.AVValueRollup{
		Contents: avContractSlice(value.Contents, func(value *av.Value) *apicontract.AVValue { return toContractAVValue(value) }),
	}
}
func fromContractAVValueRollup(value *apicontract.AVValueRollup) *av.ValueRollup {
	if value == nil {
		return nil
	}
	return &av.ValueRollup{
		Contents: avContractSlice(value.Contents, func(value *apicontract.AVValue) *av.Value { return fromContractAVValue(value) }),
	}
}
func toContractAVRelativeDate(value *av.RelativeDate) *apicontract.AVRelativeDate {
	if value == nil {
		return nil
	}
	return &apicontract.AVRelativeDate{
		Count:     value.Count,
		Unit:      int(value.Unit),
		Direction: int(value.Direction),
	}
}
func fromContractAVRelativeDate(value *apicontract.AVRelativeDate) *av.RelativeDate {
	if value == nil {
		return nil
	}
	return &av.RelativeDate{
		Count:     value.Count,
		Unit:      av.RelativeDateUnit(value.Unit),
		Direction: av.RelativeDateDirection(value.Direction),
	}
}
func toContractAVViewSort(value *av.ViewSort) *apicontract.AVViewSort {
	if value == nil {
		return nil
	}
	return &apicontract.AVViewSort{
		Column:       value.Column,
		ValueSource:  string(value.ValueSource),
		Order:        string(value.Order),
		DateEndpoint: string(value.DateEndpoint),
	}
}
func fromContractAVViewSort(value *apicontract.AVViewSort) *av.ViewSort {
	if value == nil {
		return nil
	}
	return &av.ViewSort{
		Column:       value.Column,
		ValueSource:  av.ValueSource(value.ValueSource),
		Order:        av.SortOrder(value.Order),
		DateEndpoint: av.DateEndpoint(value.DateEndpoint),
	}
}
func toContractAVViewGroup(value *av.ViewGroup) *apicontract.AVViewGroup {
	if value == nil {
		return nil
	}
	return &apicontract.AVViewGroup{
		Field:       value.Field,
		ValueSource: string(value.ValueSource),
		Method:      int(value.Method),
		Range:       toContractAVGroupRange(value.Range),
		Order:       int(value.Order),
		HideEmpty:   value.HideEmpty,
	}
}
func fromContractAVViewGroup(value *apicontract.AVViewGroup) *av.ViewGroup {
	if value == nil {
		return nil
	}
	return &av.ViewGroup{
		Field:       value.Field,
		ValueSource: av.ValueSource(value.ValueSource),
		Method:      av.GroupMethod(value.Method),
		Range:       fromContractAVGroupRange(value.Range),
		Order:       av.GroupOrder(value.Order),
		HideEmpty:   value.HideEmpty,
	}
}
func toContractAVGroupRange(value *av.GroupRange) *apicontract.AVGroupRange {
	if value == nil {
		return nil
	}
	return &apicontract.AVGroupRange{
		NumStart: value.NumStart,
		NumEnd:   value.NumEnd,
		NumStep:  value.NumStep,
	}
}
func fromContractAVGroupRange(value *apicontract.AVGroupRange) *av.GroupRange {
	if value == nil {
		return nil
	}
	return &av.GroupRange{
		NumStart: value.NumStart,
		NumEnd:   value.NumEnd,
		NumStep:  value.NumStep,
	}
}
func toContractAVKey(value *av.Key) *apicontract.AVKey {
	if value == nil {
		return nil
	}
	return &apicontract.AVKey{
		ID:             value.ID,
		Name:           value.Name,
		Type:           string(value.Type),
		Icon:           value.Icon,
		Desc:           value.Desc,
		Options:        avContractSlice(value.Options, func(value *av.SelectOption) *apicontract.AVSelectOption { return toContractAVSelectOption(value) }),
		NumberFormat:   string(value.NumberFormat),
		DateFormat:     string(value.DateFormat),
		Template:       value.Template,
		RenderTemplate: value.RenderTemplate,
		Relation:       toContractAVRelation(value.Relation),
		Rollup:         toContractAVRollup(value.Rollup),
		Date:           toContractAVDate(value.Date),
		Created:        toContractAVCreated(value.Created),
		Updated:        toContractAVUpdated(value.Updated),
	}
}
func toContractAVSelectOption(value *av.SelectOption) *apicontract.AVSelectOption {
	if value == nil {
		return nil
	}
	return &apicontract.AVSelectOption{
		Name:          value.Name,
		Color:         value.Color,
		Desc:          value.Desc,
		ResolvedColor: toContractAVAttributeViewColor(value.ResolvedColor),
	}
}
func toContractAVRelation(value *av.Relation) *apicontract.AVRelation {
	if value == nil {
		return nil
	}
	return &apicontract.AVRelation{
		AvID:             value.AvID,
		IsTwoWay:         value.IsTwoWay,
		BackKeyID:        value.BackKeyID,
		CandidateFilters: avContractSlice(value.CandidateFilters, func(value *av.ViewFilter) *apicontract.AVViewFilter { return toContractAVViewFilter(value) }),
	}
}
func toContractAVRollup(value *av.Rollup) *apicontract.AVRollup {
	if value == nil {
		return nil
	}
	return &apicontract.AVRollup{
		RelationKeyID: value.RelationKeyID,
		KeyID:         value.KeyID,
		Calc:          toContractAVRollupCalc(value.Calc),
		Filters:       avContractSlice(value.Filters, func(value *av.ViewFilter) *apicontract.AVViewFilter { return toContractAVViewFilter(value) }),
	}
}
func toContractAVRollupCalc(value *av.RollupCalc) *apicontract.AVRollupCalc {
	if value == nil {
		return nil
	}
	return &apicontract.AVRollupCalc{
		Operator: string(value.Operator),
		Result:   toContractAVValue(value.Result),
	}
}
func toContractAVDate(value *av.Date) *apicontract.AVDate {
	if value == nil {
		return nil
	}
	return &apicontract.AVDate{
		AutoFillNow:      value.AutoFillNow,
		FillSpecificTime: value.FillSpecificTime,
	}
}
func toContractAVCreated(value *av.Created) *apicontract.AVCreated {
	if value == nil {
		return nil
	}
	return &apicontract.AVCreated{
		IncludeTime: value.IncludeTime,
	}
}
func toContractAVUpdated(value *av.Updated) *apicontract.AVUpdated {
	if value == nil {
		return nil
	}
	return &apicontract.AVUpdated{
		IncludeTime: value.IncludeTime,
	}
}
func toContractAVGroupCalc(value *av.GroupCalc) *apicontract.AVGroupCalc {
	if value == nil {
		return nil
	}
	return &apicontract.AVGroupCalc{
		Field:     value.Field,
		FieldCalc: toContractAVFieldCalc(value.FieldCalc),
	}
}
func toContractAVFieldCalc(value *av.FieldCalc) *apicontract.AVFieldCalc {
	if value == nil {
		return nil
	}
	return &apicontract.AVFieldCalc{
		Operator: string(value.Operator),
		Result:   toContractAVValue(value.Result),
		Template: value.Template,
	}
}
func toContractAVTableColumn(value *av.TableColumn) *apicontract.AVTableColumn {
	if value == nil {
		return nil
	}
	return &apicontract.AVTableColumn{
		AVBaseInstanceField: toContractAVBaseInstanceField(value.BaseInstanceField),
		Pin:                 value.Pin,
		Width:               value.Width,
		Align:               string(value.Align),
	}
}
func toContractAVBaseInstanceField(value *av.BaseInstanceField) *apicontract.AVBaseInstanceField {
	if value == nil {
		return nil
	}
	return &apicontract.AVBaseInstanceField{
		ID:             value.ID,
		Name:           value.Name,
		Type:           string(value.Type),
		Icon:           value.Icon,
		Wrap:           value.Wrap,
		Hidden:         value.Hidden,
		Desc:           value.Desc,
		Calc:           toContractAVFieldCalc(value.Calc),
		Options:        avContractSlice(value.Options, func(value *av.SelectOption) *apicontract.AVSelectOption { return toContractAVSelectOption(value) }),
		NumberFormat:   string(value.NumberFormat),
		DateFormat:     string(value.DateFormat),
		Template:       value.Template,
		RenderTemplate: value.RenderTemplate,
		Relation:       toContractAVRelation(value.Relation),
		Rollup:         toContractAVRollup(value.Rollup),
		Date:           toContractAVDate(value.Date),
		Created:        toContractAVCreated(value.Created),
		Updated:        toContractAVUpdated(value.Updated),
	}
}
func toContractAVTableRow(value *av.TableRow) *apicontract.AVTableRow {
	if value == nil {
		return nil
	}
	return &apicontract.AVTableRow{
		ID:    value.ID,
		Cells: avContractSlice(value.Cells, func(value *av.TableCell) *apicontract.AVTableCell { return toContractAVTableCell(value) }),
	}
}
func toContractAVTableCell(value *av.TableCell) *apicontract.AVTableCell {
	if value == nil {
		return nil
	}
	return &apicontract.AVTableCell{
		AVBaseValue: toContractAVBaseValue(value.BaseValue),
		Color:       value.Color,
		BgColor:     value.BgColor,
	}
}
func toContractAVBaseValue(value *av.BaseValue) *apicontract.AVBaseValue {
	if value == nil {
		return nil
	}
	return &apicontract.AVBaseValue{
		ID:        value.ID,
		Value:     toContractAVValue(value.Value),
		ValueType: string(value.ValueType),
	}
}
func toContractAVGallery(value *av.Gallery) *apicontract.AVGallery {
	if value == nil {
		return nil
	}
	return &apicontract.AVGallery{
		AVBaseInstance:       toContractAVBaseInstance(value.BaseInstance),
		CoverFrom:            int(value.CoverFrom),
		CoverFromAssetKeyID:  value.CoverFromAssetKeyID,
		CardAspectRatio:      int(value.CardAspectRatio),
		CardAspectRatioValue: value.CardAspectRatioValue,
		CardSize:             int(value.CardSize),
		CardWidth:            value.CardWidth,
		CardLayout:           int(value.CardLayout),
		FitImage:             value.FitImage,
		DisplayFieldName:     value.DisplayFieldName,
		DisplayEmptyFields:   value.DisplayEmptyFields,
		Fields:               avContractSlice(value.Fields, func(value *av.GalleryField) *apicontract.AVGalleryField { return toContractAVGalleryField(value) }),
		Cards:                avContractSlice(value.Cards, func(value *av.GalleryCard) *apicontract.AVGalleryCard { return toContractAVGalleryCard(value) }),
		CardCount:            value.CardCount,
	}
}
func toContractAVGalleryField(value *av.GalleryField) *apicontract.AVGalleryField {
	if value == nil {
		return nil
	}
	return &apicontract.AVGalleryField{
		AVBaseInstanceField: toContractAVBaseInstanceField(value.BaseInstanceField),
		FullRow:             value.FullRow,
	}
}
func toContractAVGalleryCard(value *av.GalleryCard) *apicontract.AVGalleryCard {
	if value == nil {
		return nil
	}
	return &apicontract.AVGalleryCard{
		ID: value.ID,
		Values: avContractSlice(value.Values, func(value *av.GalleryFieldValue) *apicontract.AVGalleryFieldValue {
			return toContractAVGalleryFieldValue(value)
		}),
		CoverURL:      value.CoverURL,
		CoverContent:  value.CoverContent,
		CoverPosition: toContractAVCardCoverPosition(value.CoverPosition),
	}
}
func toContractAVGalleryFieldValue(value *av.GalleryFieldValue) *apicontract.AVGalleryFieldValue {
	if value == nil {
		return nil
	}
	return &apicontract.AVGalleryFieldValue{
		AVBaseValue: toContractAVBaseValue(value.BaseValue),
	}
}
func toContractAVCardCoverPosition(value *av.CardCoverPosition) *apicontract.AVCardCoverPosition {
	if value == nil {
		return nil
	}
	return &apicontract.AVCardCoverPosition{
		Image: value.Image,
		X:     value.X,
		Y:     value.Y,
	}
}
func toContractAVKanban(value *av.Kanban) *apicontract.AVKanban {
	if value == nil {
		return nil
	}
	return &apicontract.AVKanban{
		AVBaseInstance:         toContractAVBaseInstance(value.BaseInstance),
		CoverFrom:              int(value.CoverFrom),
		CoverFromAssetKeyID:    value.CoverFromAssetKeyID,
		CardAspectRatio:        int(value.CardAspectRatio),
		CardAspectRatioValue:   value.CardAspectRatioValue,
		CardSize:               int(value.CardSize),
		CardWidth:              value.CardWidth,
		CardLayout:             int(value.CardLayout),
		FitImage:               value.FitImage,
		DisplayFieldName:       value.DisplayFieldName,
		DisplayEmptyFields:     value.DisplayEmptyFields,
		FillColBackgroundColor: value.FillColBackgroundColor,
		Fields:                 avContractSlice(value.Fields, func(value *av.KanbanField) *apicontract.AVKanbanField { return toContractAVKanbanField(value) }),
		Cards:                  avContractSlice(value.Cards, func(value *av.KanbanCard) *apicontract.AVKanbanCard { return toContractAVKanbanCard(value) }),
		CardCount:              value.CardCount,
	}
}
func toContractAVKanbanField(value *av.KanbanField) *apicontract.AVKanbanField {
	if value == nil {
		return nil
	}
	return &apicontract.AVKanbanField{
		AVBaseInstanceField: toContractAVBaseInstanceField(value.BaseInstanceField),
		FullRow:             value.FullRow,
	}
}
func toContractAVKanbanCard(value *av.KanbanCard) *apicontract.AVKanbanCard {
	if value == nil {
		return nil
	}
	return &apicontract.AVKanbanCard{
		ID: value.ID,
		Values: avContractSlice(value.Values, func(value *av.KanbanFieldValue) *apicontract.AVKanbanFieldValue {
			return toContractAVKanbanFieldValue(value)
		}),
		CoverURL:      value.CoverURL,
		CoverContent:  value.CoverContent,
		CoverPosition: toContractAVCardCoverPosition(value.CoverPosition),
	}
}
func toContractAVKanbanFieldValue(value *av.KanbanFieldValue) *apicontract.AVKanbanFieldValue {
	if value == nil {
		return nil
	}
	return &apicontract.AVKanbanFieldValue{
		AVBaseValue: toContractAVBaseValue(value.BaseValue),
	}
}
func toContractAVKeyValues(value *av.KeyValues) *apicontract.AVKeyValues {
	if value == nil {
		return nil
	}
	return &apicontract.AVKeyValues{
		Key:    toContractAVKey(value.Key),
		Values: avContractSlice(value.Values, func(value *av.Value) *apicontract.AVValue { return toContractAVValue(value) }),
	}
}
func toContractAVViewData(value *av.ViewData) *apicontract.AVViewData {
	if value == nil {
		return nil
	}
	return &apicontract.AVViewData{
		ID:               value.ID,
		Icon:             value.Icon,
		Name:             value.Name,
		Desc:             value.Desc,
		HideAttrViewName: value.HideAttrViewName,
		Type:             string(value.Type),
		PageSize:         value.PageSize,
	}
}
func toContractAVNewItemTemplate(value *av.NewItemTemplate) *apicontract.AVNewItemTemplate {
	if value == nil {
		return nil
	}
	return &apicontract.AVNewItemTemplate{
		ID:                 value.ID,
		Name:               value.Name,
		Icon:               value.Icon,
		TargetType:         string(value.TargetType),
		PrimaryKeyTemplate: value.PrimaryKeyTemplate,
		FieldValues: avContractMap(value.FieldValues, func(value *av.NewItemFieldValue) *apicontract.AVNewItemFieldValue {
			return toContractAVNewItemFieldValue(value)
		}),
		SaveLocation:        toContractAVNewItemSaveLocation(value.SaveLocation),
		ContentTemplatePath: value.ContentTemplatePath,
		HideInFileTree:      value.HideInFileTree,
	}
}
func toContractAVNewItemFieldValue(value *av.NewItemFieldValue) *apicontract.AVNewItemFieldValue {
	if value == nil {
		return nil
	}
	return &apicontract.AVNewItemFieldValue{
		Mode:  string(value.Mode),
		Value: toContractAVValue(value.Value),
	}
}
func toContractAVNewItemSaveLocation(value *av.NewItemSaveLocation) *apicontract.AVNewItemSaveLocation {
	if value == nil {
		return nil
	}
	return &apicontract.AVNewItemSaveLocation{
		BoxID:        value.BoxID,
		PathTemplate: value.PathTemplate,
	}
}
func toContractAVAttributeViewContextFilter(value *av.AttributeViewContextFilter) *apicontract.AVAttributeViewContextFilter {
	if value == nil {
		return nil
	}
	return &apicontract.AVAttributeViewContextFilter{
		Spec:  value.Spec,
		KeyID: value.KeyID,
	}
}
func toContractAVAttributeViewContextFilterField(value *av.AttributeViewContextFilterField) *apicontract.AVAttributeViewContextFilterField {
	if value == nil {
		return nil
	}
	return &apicontract.AVAttributeViewContextFilterField{
		ID:         value.ID,
		Name:       value.Name,
		Icon:       value.Icon,
		TargetAvID: value.TargetAvID,
	}
}
func toContractAVAttributeViewData(value *model.AttributeViewData) *apicontract.AVAttributeViewData {
	if value == nil {
		return nil
	}
	return &apicontract.AVAttributeViewData{
		Spec: value.Spec,
		ID:   value.ID,
		Name: value.Name,
		CustomColors: avContractSlice(value.CustomColors, func(value *av.AttributeViewCustomColor) *apicontract.AVAttributeViewCustomColor {
			return toContractAVAttributeViewCustomColor(value)
		}),
		KeyValues: avContractSlice(value.KeyValues, func(value *av.KeyValues) *apicontract.AVKeyValues { return toContractAVKeyValues(value) }),
		KeyIDs:    value.KeyIDs,
		ViewID:    value.ViewID,
		Views:     avContractSlice(value.Views, func(value *av.View) *apicontract.AVView { return toContractAVView(value) }),
		NewItemTemplates: avContractSlice(value.NewItemTemplates, func(value *av.NewItemTemplate) *apicontract.AVNewItemTemplate {
			return toContractAVNewItemTemplate(value)
		}),
		DefaultTemplateID: value.DefaultTemplateID,
		CardCoverPositions: avContractMap(value.CardCoverPositions, func(value map[string]*av.CardCoverPosition) map[string]*apicontract.AVCardCoverPosition {
			return avContractMap(value, func(value *av.CardCoverPosition) *apicontract.AVCardCoverPosition {
				return toContractAVCardCoverPosition(value)
			})
		}),
	}
}
func toContractAVAttributeViewCustomColor(value *av.AttributeViewCustomColor) *apicontract.AVAttributeViewCustomColor {
	if value == nil {
		return nil
	}
	return &apicontract.AVAttributeViewCustomColor{
		Index:                value.Index,
		Hidden:               value.Hidden,
		AVAttributeViewColor: *toContractAVAttributeViewColor(&value.AttributeViewColor),
	}
}
func toContractAVView(value *av.View) *apicontract.AVView {
	if value == nil {
		return nil
	}
	return &apicontract.AVView{
		ID:               value.ID,
		Icon:             value.Icon,
		Name:             value.Name,
		HideAttrViewName: value.HideAttrViewName,
		Desc:             value.Desc,
		Filters:          avContractSlice(value.Filters, func(value *av.ViewFilter) *apicontract.AVViewFilter { return toContractAVViewFilter(value) }),
		Sorts:            avContractSlice(value.Sorts, func(value *av.ViewSort) *apicontract.AVViewSort { return toContractAVViewSort(value) }),
		PageSize:         value.PageSize,
		LayoutType:       string(value.LayoutType),
		Table:            toContractAVLayoutTable(value.Table),
		List:             toContractAVLayoutTable(value.List),
		Calendar:         toContractAVLayoutCalendar(value.Calendar),
		Gallery:          toContractAVLayoutGallery(value.Gallery),
		Kanban:           toContractAVLayoutKanban(value.Kanban),
		ItemIDs:          value.ItemIDs,
		Group:            toContractAVViewGroup(value.Group),
		GroupCreated:     value.GroupCreated,
		Groups:           avContractSlice(value.Groups, func(value *av.View) *apicontract.AVView { return toContractAVView(value) }),
		GroupItemIDs:     value.GroupItemIDs,
		GroupCalc:        toContractAVGroupCalc(value.GroupCalc),
		GroupKey:         toContractAVKey(value.GroupKey),
		GroupVal:         toContractAVValue(value.GroupVal),
		GroupFolded:      value.GroupFolded,
		GroupHidden:      value.GroupHidden,
		GroupSort:        value.GroupSort,
	}
}
func toContractAVLayoutTable(value *av.LayoutTable) *apicontract.AVLayoutTable {
	if value == nil {
		return nil
	}
	return &apicontract.AVLayoutTable{
		AVBaseLayout: toContractAVBaseLayout(value.BaseLayout),
		Columns: avContractSlice(value.Columns, func(value *av.ViewTableColumn) *apicontract.AVViewTableColumn {
			return toContractAVViewTableColumn(value)
		}),
		RowIDs: value.RowIDs,
	}
}
func toContractAVBaseLayout(value *av.BaseLayout) *apicontract.AVBaseLayout {
	if value == nil {
		return nil
	}
	return &apicontract.AVBaseLayout{
		Spec:      value.Spec,
		ID:        value.ID,
		ShowIcon:  value.ShowIcon,
		WrapField: value.WrapField,
		Filters:   avContractSlice(value.Filters, func(value *av.ViewFilter) *apicontract.AVViewFilter { return toContractAVViewFilter(value) }),
		Sorts:     avContractSlice(value.Sorts, func(value *av.ViewSort) *apicontract.AVViewSort { return toContractAVViewSort(value) }),
		PageSize:  value.PageSize,
	}
}
func toContractAVViewTableColumn(value *av.ViewTableColumn) *apicontract.AVViewTableColumn {
	if value == nil {
		return nil
	}
	return &apicontract.AVViewTableColumn{
		AVBaseField: toContractAVBaseField(value.BaseField),
		Pin:         value.Pin,
		Width:       value.Width,
		Align:       string(value.Align),
		Calc:        toContractAVFieldCalc(value.Calc),
	}
}
func toContractAVBaseField(value *av.BaseField) *apicontract.AVBaseField {
	if value == nil {
		return nil
	}
	return &apicontract.AVBaseField{
		ID:     value.ID,
		Wrap:   value.Wrap,
		Hidden: value.Hidden,
		Desc:   value.Desc,
		Calc:   toContractAVFieldCalc(value.Calc),
	}
}
func toContractAVLayoutGallery(value *av.LayoutGallery) *apicontract.AVLayoutGallery {
	if value == nil {
		return nil
	}
	return &apicontract.AVLayoutGallery{
		AVBaseLayout:         toContractAVBaseLayout(value.BaseLayout),
		CoverFrom:            int(value.CoverFrom),
		CoverFromAssetKeyID:  value.CoverFromAssetKeyID,
		CardAspectRatio:      int(value.CardAspectRatio),
		CardAspectRatioValue: value.CardAspectRatioValue,
		CardSize:             int(value.CardSize),
		CardWidth:            value.CardWidth,
		CardLayout:           int(value.CardLayout),
		FitImage:             value.FitImage,
		DisplayFieldName:     value.DisplayFieldName,
		DisplayEmptyFields:   value.DisplayEmptyFields,
		CardFields: avContractSlice(value.CardFields, func(value *av.ViewGalleryCardField) *apicontract.AVViewGalleryCardField {
			return toContractAVViewGalleryCardField(value)
		}),
		CardIDs: value.CardIDs,
	}
}
func toContractAVViewGalleryCardField(value *av.ViewGalleryCardField) *apicontract.AVViewGalleryCardField {
	if value == nil {
		return nil
	}
	return &apicontract.AVViewGalleryCardField{
		AVBaseField: toContractAVBaseField(value.BaseField),
		FullRow:     value.FullRow,
	}
}
func toContractAVLayoutKanban(value *av.LayoutKanban) *apicontract.AVLayoutKanban {
	if value == nil {
		return nil
	}
	return &apicontract.AVLayoutKanban{
		AVBaseLayout:           toContractAVBaseLayout(value.BaseLayout),
		CoverFrom:              int(value.CoverFrom),
		CoverFromAssetKeyID:    value.CoverFromAssetKeyID,
		CardAspectRatio:        int(value.CardAspectRatio),
		CardAspectRatioValue:   value.CardAspectRatioValue,
		CardSize:               int(value.CardSize),
		CardWidth:              value.CardWidth,
		CardLayout:             int(value.CardLayout),
		FitImage:               value.FitImage,
		DisplayFieldName:       value.DisplayFieldName,
		DisplayEmptyFields:     value.DisplayEmptyFields,
		FillColBackgroundColor: value.FillColBackgroundColor,
		Fields: avContractSlice(value.Fields, func(value *av.ViewKanbanField) *apicontract.AVViewKanbanField {
			return toContractAVViewKanbanField(value)
		}),
	}
}
func toContractAVViewKanbanField(value *av.ViewKanbanField) *apicontract.AVViewKanbanField {
	if value == nil {
		return nil
	}
	return &apicontract.AVViewKanbanField{
		AVBaseField: toContractAVBaseField(value.BaseField),
		FullRow:     value.FullRow,
	}
}
func toContractAVAttributeViewFieldView(value *model.AttributeViewFieldView) *apicontract.AVAttributeViewFieldView {
	if value == nil {
		return nil
	}
	return &apicontract.AVAttributeViewFieldView{
		ID:     value.ID,
		Icon:   value.Icon,
		Name:   value.Name,
		Type:   string(value.Type),
		Hidden: value.Hidden,
	}
}
func toContractAVAvSearchResult(value *model.AvSearchResult) *apicontract.AVAvSearchResult {
	if value == nil {
		return nil
	}
	return &apicontract.AVAvSearchResult{
		AvID:       value.AvID,
		AvName:     value.AvName,
		ViewName:   value.ViewName,
		ViewID:     value.ViewID,
		ViewLayout: string(value.ViewLayout),
		BlockID:    value.BlockID,
		HPath:      value.HPath,
		Matched:    value.Matched,
		Children: avContractSlice(value.Children, func(value *model.AvSearchResult) *apicontract.AVAvSearchResult {
			return toContractAVAvSearchResult(value)
		}),
	}
}
func toContractAVBlockAttributeViewKeys(value *model.BlockAttributeViewKeys) *apicontract.AVBlockAttributeViewKeys {
	if value == nil {
		return nil
	}
	return &apicontract.AVBlockAttributeViewKeys{
		AvID:   value.AvID,
		AvName: value.AvName,
		CustomColors: avContractSlice(value.CustomColors, func(value *av.AttributeViewCustomColor) *apicontract.AVAttributeViewCustomColor {
			return toContractAVAttributeViewCustomColor(value)
		}),
		BlockIDs:  value.BlockIDs,
		KeyValues: avContractSlice(value.KeyValues, func(value *av.KeyValues) *apicontract.AVKeyValues { return toContractAVKeyValues(value) }),
		ItemPositions: avContractSlice(value.ItemPositions, func(value *model.AttributeViewItemPosition) *apicontract.AVAttributeViewItemPosition {
			return toContractAVAttributeViewItemPosition(value)
		}),
	}
}
func toContractAVAttributeViewItemPosition(value *model.AttributeViewItemPosition) *apicontract.AVAttributeViewItemPosition {
	if value == nil {
		return nil
	}
	return &apicontract.AVAttributeViewItemPosition{
		ViewID:     value.ViewID,
		PreviousID: value.PreviousID,
		Groups: avContractSlice(value.Groups, func(value *model.AttributeViewGroupItemPosition) *apicontract.AVAttributeViewGroupItemPosition {
			return toContractAVAttributeViewGroupItemPosition(value)
		}),
	}
}
func toContractAVAttributeViewGroupItemPosition(value *model.AttributeViewGroupItemPosition) *apicontract.AVAttributeViewGroupItemPosition {
	if value == nil {
		return nil
	}
	return &apicontract.AVAttributeViewGroupItemPosition{
		GroupID:    value.GroupID,
		PreviousID: value.PreviousID,
	}
}
func toContractAVAttributeViewSearchTarget(value *model.AttributeViewSearchTarget) *apicontract.AVAttributeViewSearchTarget {
	if value == nil {
		return nil
	}
	return &apicontract.AVAttributeViewSearchTarget{
		AvID:            value.AvID,
		DatabaseBlockID: value.DatabaseBlockID,
		NotebookID:      value.NotebookID,
		ViewID:          value.ViewID,
		GroupID:         value.GroupID,
		ItemID:          value.ItemID,
		ValueID:         value.ValueID,
		MatchedValueID:  value.MatchedValueID,
		MatchedKeyID:    value.MatchedKeyID,
		Title:           value.Title,
		BoundBlockID:    value.BoundBlockID,
		IsDetached:      value.IsDetached,
		Keywords:        value.Keywords,
	}
}
func toContractAVAttributeViewBacklinks(value *model.AttributeViewBacklinks) *apicontract.AVAttributeViewBacklinks {
	if value == nil {
		return nil
	}
	return &apicontract.AVAttributeViewBacklinks{
		Total: value.Total,
		Items: avContractSlice(value.Items, func(value *model.AttributeViewBacklink) *apicontract.AVAttributeViewBacklink {
			return toContractAVAttributeViewBacklink(value)
		}),
	}
}
func toContractAVAttributeViewBacklink(value *model.AttributeViewBacklink) *apicontract.AVAttributeViewBacklink {
	if value == nil {
		return nil
	}
	return &apicontract.AVAttributeViewBacklink{
		AvID:            value.AvID,
		AvName:          value.AvName,
		BlockIDs:        value.BlockIDs,
		DatabaseBlockID: value.DatabaseBlockID,
		BoxID:           value.BoxID,
		DatabasePath:    value.DatabasePath,
		ItemID:          value.ItemID,
		ValueID:         value.ValueID,
		Title:           value.Title,
		Icon:            value.Icon,
		BoundBlockID:    value.BoundBlockID,
		IsDetached:      value.IsDetached,
		Relations: avContractSlice(value.Relations, func(value *model.AttributeViewBacklinkRelation) *apicontract.AVAttributeViewBacklinkRelation {
			return toContractAVAttributeViewBacklinkRelation(value)
		}),
	}
}
func toContractAVAttributeViewBacklinkRelation(value *model.AttributeViewBacklinkRelation) *apicontract.AVAttributeViewBacklinkRelation {
	if value == nil {
		return nil
	}
	return &apicontract.AVAttributeViewBacklinkRelation{
		KeyID:        value.KeyID,
		KeyName:      value.KeyName,
		TargetAvID:   value.TargetAvID,
		TargetItemID: value.TargetItemID,
	}
}
func toContractAVAttributeViewRenderTarget(value *model.AttributeViewRenderTarget) *apicontract.AVAttributeViewRenderTarget {
	if value == nil {
		return nil
	}
	return &apicontract.AVAttributeViewRenderTarget{
		Status:   value.Status,
		ItemID:   value.ItemID,
		GroupID:  value.GroupID,
		Index:    value.Index,
		Offset:   value.Offset,
		PageSize: value.PageSize,
	}
}
func toContractAVCreateAttributeViewItemResult(value *model.CreateAttributeViewItemResult) *apicontract.AVCreateAttributeViewItemResult {
	if value == nil {
		return nil
	}
	return &apicontract.AVCreateAttributeViewItemResult{
		ItemID:     value.ItemID,
		BlockID:    value.BlockID,
		Content:    value.Content,
		IsDetached: value.IsDetached,
		Warnings:   value.Warnings,
	}
}
func toContractAVCreateAttributeViewItemDocsResult(value *model.CreateAttributeViewItemDocsResult) *apicontract.AVCreateAttributeViewItemDocsResult {
	if value == nil {
		return nil
	}
	return &apicontract.AVCreateAttributeViewItemDocsResult{
		ItemIDs:        value.ItemIDs,
		BlockIDs:       value.BlockIDs,
		SkippedItemIDs: value.SkippedItemIDs,
		Warnings:       value.Warnings,
	}
}
