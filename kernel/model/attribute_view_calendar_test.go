package model

import (
	"errors"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestValidateCalendarMappingField(t *testing.T) {
	attrView := &av.AttributeView{
		KeyValues: []*av.KeyValues{
			{Key: &av.Key{ID: "text", Type: av.KeyTypeText}},
			{Key: &av.Key{ID: "template", Type: av.KeyTypeTemplate}},
			{Key: &av.Key{ID: "select", Type: av.KeyTypeSelect}},
			{Key: &av.Key{ID: "mSelect", Type: av.KeyTypeMSelect}},
			{Key: &av.Key{ID: "date", Type: av.KeyTypeDate}},
		},
	}

	if err := validateCalendarMappingField(attrView, "", "empty", av.KeyTypeText); nil != err {
		t.Fatalf("empty field should clear mapping without error: %v", err)
	}
	if err := validateCalendarMappingField(attrView, "text", "recurrenceFieldID", av.KeyTypeText); nil != err {
		t.Fatalf("text field should be accepted: %v", err)
	}
	// 可写元数据映射只允许纯文本字段：模板单元格每次渲染都会被重算，写入会丢失
	if err := validateCalendarMappingField(attrView, "template", "descriptionFieldID", av.KeyTypeText); nil == err {
		t.Fatal("template field should be rejected for writable metadata mappings")
	}
	if err := validateCalendarMappingField(attrView, "select", "colorFieldID", av.KeyTypeSelect, av.KeyTypeMSelect); nil != err {
		t.Fatalf("select field should be accepted for color mapping: %v", err)
	}
	if err := validateCalendarMappingField(attrView, "mSelect", "colorFieldID", av.KeyTypeSelect, av.KeyTypeMSelect); nil != err {
		t.Fatalf("mSelect field should be accepted for color mapping: %v", err)
	}
	if err := validateCalendarMappingField(attrView, "date", "colorFieldID", av.KeyTypeSelect, av.KeyTypeMSelect); nil == err {
		t.Fatal("date field should be rejected for color mapping")
	}
	if err := validateCalendarMappingField(attrView, "missing", "locationFieldID", av.KeyTypeText); nil == err {
		t.Fatal("missing field should be rejected")
	}
}

func TestCalendarDateFieldFromOperationData(t *testing.T) {
	attrView := &av.AttributeView{
		KeyValues: []*av.KeyValues{
			{Key: &av.Key{ID: "date", Type: av.KeyTypeDate}},
			{Key: &av.Key{ID: "text", Type: av.KeyTypeText}},
		},
	}

	dateFieldID, err := calendarDateFieldFromOperationData(attrView, &Operation{KeyID: "date"})
	if err != nil {
		t.Fatalf("date keyID should be accepted: %v", err)
	}
	if dateFieldID != "date" {
		t.Fatalf("expected date field from keyID, got %s", dateFieldID)
	}

	dateFieldID, err = calendarDateFieldFromOperationData(attrView, &Operation{Data: "date"})
	if err != nil {
		t.Fatalf("date data should be accepted: %v", err)
	}
	if dateFieldID != "date" {
		t.Fatalf("expected date field from data, got %s", dateFieldID)
	}

	dateFieldID, err = calendarDateFieldFromOperationData(attrView, &Operation{Data: ""})
	if err != nil {
		t.Fatalf("empty data should clear date field without error: %v", err)
	}
	if dateFieldID != "" {
		t.Fatalf("expected empty date field, got %s", dateFieldID)
	}

	if _, err = calendarDateFieldFromOperationData(attrView, &Operation{Data: float64(1)}); err == nil {
		t.Fatal("non-string data should be rejected")
	}
	if _, err = calendarDateFieldFromOperationData(attrView, &Operation{Data: "text"}); err == nil {
		t.Fatal("non-date field should be rejected")
	}
	if _, err = calendarDateFieldFromOperationData(attrView, &Operation{Data: "missing"}); err == nil {
		t.Fatal("missing field should be rejected")
	}
}

func TestValidateCalendarFieldMappingUnique(t *testing.T) {
	if err := validateCalendarFieldMappingUnique(nil); err != nil {
		t.Fatalf("nil mapping should be accepted: %v", err)
	}
	if err := validateCalendarFieldMappingUnique(&av.CalendarFieldMapping{
		RecurrenceFieldID:  "recurrence",
		ExceptionFieldID:   "exception",
		LocationFieldID:    "location",
		DescriptionFieldID: "description",
		ColorFieldID:       "recurrence",
	}); err != nil {
		t.Fatalf("color mapping may reuse text metadata field IDs because it has a different key type: %v", err)
	}
	if err := validateCalendarFieldMappingUnique(&av.CalendarFieldMapping{
		RecurrenceFieldID: "metadata",
		ExceptionFieldID:  "metadata",
	}); err == nil {
		t.Fatal("duplicate text metadata fields should be rejected")
	}
}

func TestCalendarFieldMappingFromOperationDataMergesExisting(t *testing.T) {
	attrView := &av.AttributeView{
		KeyValues: []*av.KeyValues{
			{Key: &av.Key{ID: "recurrence", Type: av.KeyTypeText}},
			{Key: &av.Key{ID: "exception", Type: av.KeyTypeText}},
			{Key: &av.Key{ID: "location", Type: av.KeyTypeText}},
			{Key: &av.Key{ID: "description", Type: av.KeyTypeTemplate}},
			{Key: &av.Key{ID: "color", Type: av.KeyTypeSelect}},
			{Key: &av.Key{ID: "newColor", Type: av.KeyTypeMSelect}},
		},
	}
	existing := &av.CalendarFieldMapping{
		RecurrenceFieldID:  "recurrence",
		ExceptionFieldID:   "exception",
		LocationFieldID:    "location",
		DescriptionFieldID: "description",
		ColorFieldID:       "color",
	}

	mapping, err := calendarFieldMappingFromOperationData(attrView, existing, map[string]any{
		"colorFieldID": "newColor",
	})
	if err != nil {
		t.Fatalf("partial mapping update should be accepted: %v", err)
	}
	if mapping.RecurrenceFieldID != "recurrence" || mapping.ExceptionFieldID != "exception" ||
		mapping.LocationFieldID != "location" || mapping.DescriptionFieldID != "description" ||
		mapping.ColorFieldID != "newColor" {
		t.Fatalf("partial update should preserve existing mapping fields: %#v", mapping)
	}

	mapping, err = calendarFieldMappingFromOperationData(attrView, existing, map[string]any{
		"locationFieldID": "",
	})
	if err != nil {
		t.Fatalf("empty field should clear only that mapping: %v", err)
	}
	if mapping.LocationFieldID != "" || mapping.RecurrenceFieldID != "recurrence" {
		t.Fatalf("empty update should clear only requested mapping: %#v", mapping)
	}
}

func TestCalendarWeekStartFromOperationData(t *testing.T) {
	weekStart, err := calendarWeekStartFromOperationData(float64(0))
	if err != nil {
		t.Fatalf("float sunday should be accepted: %v", err)
	}
	if weekStart != av.WeekStartSunday {
		t.Fatalf("expected sunday, got %d", weekStart)
	}

	weekStart, err = calendarWeekStartFromOperationData(1)
	if err != nil {
		t.Fatalf("int monday should be accepted: %v", err)
	}
	if weekStart != av.WeekStartMonday {
		t.Fatalf("expected monday, got %d", weekStart)
	}

	if _, err = calendarWeekStartFromOperationData(float64(2)); err == nil {
		t.Fatal("invalid week start should be rejected")
	}
	if _, err = calendarWeekStartFromOperationData(float64(1.5)); err == nil {
		t.Fatal("fractional week start should be rejected")
	}
	if _, err = calendarWeekStartFromOperationData("1"); err == nil {
		t.Fatal("non-number week start should be rejected")
	}
}

func TestCalendarViewModeFromOperationData(t *testing.T) {
	viewMode, err := calendarViewModeFromOperationData(float64(0))
	if err != nil {
		t.Fatalf("float month should be accepted: %v", err)
	}
	if viewMode != av.ViewModeMonth {
		t.Fatalf("expected month, got %d", viewMode)
	}

	viewMode, err = calendarViewModeFromOperationData(3)
	if err != nil {
		t.Fatalf("int schedule should be accepted: %v", err)
	}
	if viewMode != av.ViewModeSchedule {
		t.Fatalf("expected schedule, got %d", viewMode)
	}

	viewMode, err = calendarViewModeFromOperationData(float64(4))
	if err != nil {
		t.Fatalf("float year should be accepted: %v", err)
	}
	if viewMode != av.ViewModeYear {
		t.Fatalf("expected year, got %d", viewMode)
	}

	viewMode, err = calendarViewModeFromOperationData(5)
	if err != nil {
		t.Fatalf("int five-day should be accepted: %v", err)
	}
	if viewMode != av.ViewModeFiveDay {
		t.Fatalf("expected five-day, got %d", viewMode)
	}

	if _, err = calendarViewModeFromOperationData(float64(6)); err == nil {
		t.Fatal("invalid view mode should be rejected")
	}
	if _, err = calendarViewModeFromOperationData(float64(1.5)); err == nil {
		t.Fatal("fractional view mode should be rejected")
	}
	if _, err = calendarViewModeFromOperationData("1"); err == nil {
		t.Fatal("non-number view mode should be rejected")
	}
}

func TestAddCalendarField(t *testing.T) {
	calendar := &av.LayoutCalendar{
		BaseLayout: &av.BaseLayout{WrapField: true},
		Fields: []*av.ViewCalendarCardField{
			{BaseField: &av.BaseField{ID: "first"}},
			{BaseField: &av.BaseField{ID: "second"}},
		},
	}

	addCalendarField(calendar, &av.BaseField{ID: "inserted"}, "first")
	if len(calendar.Fields) != 3 {
		t.Fatalf("expected 3 fields, got %d", len(calendar.Fields))
	}
	if calendar.Fields[1].ID != "inserted" {
		t.Fatalf("expected inserted field after first, got %s", calendar.Fields[1].ID)
	}
	if !calendar.Fields[1].Wrap {
		t.Fatal("inserted field should inherit calendar wrap setting")
	}

	addCalendarField(calendar, &av.BaseField{ID: "fallback"}, "missing")
	if calendar.Fields[len(calendar.Fields)-1].ID != "fallback" {
		t.Fatalf("missing previous field should append, got %s", calendar.Fields[len(calendar.Fields)-1].ID)
	}
}

func TestRemoveCalendarFieldReferences(t *testing.T) {
	calendar := &av.LayoutCalendar{
		DateFieldID: "date",
		Fields: []*av.ViewCalendarCardField{
			{BaseField: &av.BaseField{ID: "date"}},
			{BaseField: &av.BaseField{ID: "recurrence"}},
			{BaseField: &av.BaseField{ID: "color"}},
		},
		FieldMapping: &av.CalendarFieldMapping{
			RecurrenceFieldID:  "recurrence",
			ExceptionFieldID:   "exception",
			LocationFieldID:    "location",
			DescriptionFieldID: "description",
			ColorFieldID:       "color",
		},
	}

	removeCalendarFieldReferences(calendar, "date")
	if calendar.DateFieldID != "" {
		t.Fatalf("date field should be cleared, got %s", calendar.DateFieldID)
	}
	if len(calendar.Fields) != 2 || calendar.Fields[0].ID != "recurrence" {
		t.Fatalf("date field should be removed from fields: %#v", calendar.Fields)
	}

	removeCalendarFieldReferences(calendar, "recurrence")
	if calendar.FieldMapping.RecurrenceFieldID != "" {
		t.Fatalf("recurrence mapping should be cleared, got %s", calendar.FieldMapping.RecurrenceFieldID)
	}
	removeCalendarFieldReferences(calendar, "color")
	if calendar.FieldMapping.ColorFieldID != "" {
		t.Fatalf("color mapping should be cleared, got %s", calendar.FieldMapping.ColorFieldID)
	}
}

func TestPruneCalendarFieldReferencesByType(t *testing.T) {
	newCalendar := func() *av.LayoutCalendar {
		return &av.LayoutCalendar{
			DateFieldID: "date",
			FieldMapping: &av.CalendarFieldMapping{
				RecurrenceFieldID:  "recurrence",
				ExceptionFieldID:   "exception",
				LocationFieldID:    "location",
				DescriptionFieldID: "description",
				ColorFieldID:       "color",
			},
		}
	}

	calendar := newCalendar()
	pruneCalendarFieldReferencesByType(calendar, "date", av.KeyTypeNumber)
	if calendar.DateFieldID != "" {
		t.Fatalf("date field should be cleared after type change, got %s", calendar.DateFieldID)
	}

	calendar = newCalendar()
	pruneCalendarFieldReferencesByType(calendar, "recurrence", av.KeyTypeNumber)
	if calendar.FieldMapping.RecurrenceFieldID != "" {
		t.Fatalf("recurrence mapping should be cleared after type change, got %s", calendar.FieldMapping.RecurrenceFieldID)
	}

	// 模板字段由内核计算，写入会被丢弃，所以改成模板类型后映射必须清除。
	calendar = newCalendar()
	pruneCalendarFieldReferencesByType(calendar, "recurrence", av.KeyTypeTemplate)
	if calendar.FieldMapping.RecurrenceFieldID != "" {
		t.Fatalf("recurrence mapping should be cleared when the key becomes a template, got %s", calendar.FieldMapping.RecurrenceFieldID)
	}

	calendar = newCalendar()
	pruneCalendarFieldReferencesByType(calendar, "description", av.KeyTypeText)
	if calendar.FieldMapping.DescriptionFieldID != "description" {
		t.Fatalf("text stays valid for description mapping, got %s", calendar.FieldMapping.DescriptionFieldID)
	}

	calendar = newCalendar()
	pruneCalendarFieldReferencesByType(calendar, "color", av.KeyTypeText)
	if calendar.FieldMapping.ColorFieldID != "" {
		t.Fatalf("color mapping should be cleared after type change, got %s", calendar.FieldMapping.ColorFieldID)
	}

	calendar = newCalendar()
	pruneCalendarFieldReferencesByType(calendar, "color", av.KeyTypeMSelect)
	if calendar.FieldMapping.ColorFieldID != "color" {
		t.Fatalf("mSelect stays valid for color mapping, got %s", calendar.FieldMapping.ColorFieldID)
	}

	calendar = newCalendar()
	pruneCalendarFieldReferencesByType(calendar, "unrelated", av.KeyTypeNumber)
	if calendar.DateFieldID != "date" || calendar.FieldMapping.LocationFieldID != "location" {
		t.Fatalf("unrelated key must not touch calendar references: %#v", calendar.FieldMapping)
	}
}

// seedCalendarI18n 让 av.NewCalendarView() 在单元测试里可用（它会读取 i18n 词条）。
func seedCalendarI18n(t *testing.T) {
	t.Helper()
	if _, ok := util.AttrViewLangs[util.Lang]["calendar"]; ok {
		return
	}
	prevLang := util.Lang
	util.Lang = "test"
	if nil == util.AttrViewLangs {
		util.AttrViewLangs = map[string]map[string]any{}
	}
	util.AttrViewLangs["test"] = map[string]any{"calendar": "Calendar"}
	t.Cleanup(func() {
		delete(util.AttrViewLangs, "test")
		util.Lang = prevLang
	})
}

// K1: 复制日历视图不能空指针，并且必须保留日历专有配置。
func TestDuplicateCalendarViewLayout(t *testing.T) {
	seedCalendarI18n(t)

	masterView := av.NewCalendarView()
	masterView.Calendar.Fields = []*av.ViewCalendarCardField{
		{BaseField: &av.BaseField{ID: "date", Wrap: true, Hidden: false, Desc: "when"}},
		{BaseField: &av.BaseField{ID: "location", Wrap: false, Hidden: true, Desc: "where"}},
	}
	masterView.Calendar.DateFieldID = "date"
	masterView.Calendar.ViewMode = av.ViewModeWeek
	masterView.Calendar.WeekStart = av.WeekStartMonday
	masterView.Calendar.ShowIcon = false
	masterView.Calendar.WrapField = true
	masterView.Calendar.FieldMapping = &av.CalendarFieldMapping{
		RecurrenceFieldID:  "recurrence",
		ExceptionFieldID:   "exception",
		LocationFieldID:    "location",
		DescriptionFieldID: "description",
		ColorFieldID:       "color",
	}

	view := newAttrViewViewByLayoutType(masterView.LayoutType)
	if nil == view {
		t.Fatal("duplicating a calendar view must not yield a nil view")
	}
	if nil == view.Calendar {
		t.Fatal("duplicated calendar view must have a calendar layout")
	}

	copyAttrViewViewLayout(view, masterView)

	if len(view.Calendar.Fields) != 2 {
		t.Fatalf("expected 2 copied fields, got %d", len(view.Calendar.Fields))
	}
	if view.Calendar.Fields[0].ID != "date" || !view.Calendar.Fields[0].Wrap || view.Calendar.Fields[0].Desc != "when" {
		t.Fatalf("first field not copied faithfully: %#v", view.Calendar.Fields[0].BaseField)
	}
	if view.Calendar.Fields[1].ID != "location" || !view.Calendar.Fields[1].Hidden {
		t.Fatalf("second field not copied faithfully: %#v", view.Calendar.Fields[1].BaseField)
	}
	if view.Calendar.Fields[0] == masterView.Calendar.Fields[0] {
		t.Fatal("copied fields must be new structs, not shared pointers")
	}
	if view.Calendar.DateFieldID != "date" {
		t.Fatalf("date field ID not copied, got %s", view.Calendar.DateFieldID)
	}
	if view.Calendar.ViewMode != av.ViewModeWeek {
		t.Fatalf("view mode not copied, got %d", view.Calendar.ViewMode)
	}
	if view.Calendar.WeekStart != av.WeekStartMonday {
		t.Fatalf("week start not copied, got %d", view.Calendar.WeekStart)
	}
	if view.Calendar.ShowIcon || !view.Calendar.WrapField {
		t.Fatalf("showIcon/wrapField not copied: showIcon=%v wrapField=%v", view.Calendar.ShowIcon, view.Calendar.WrapField)
	}
	if nil == view.Calendar.FieldMapping {
		t.Fatal("field mapping not copied")
	}
	if view.Calendar.FieldMapping == masterView.Calendar.FieldMapping {
		t.Fatal("field mapping must be copied by value, not by pointer")
	}
	if *view.Calendar.FieldMapping != *masterView.Calendar.FieldMapping {
		t.Fatalf("field mapping content differs: %#v", view.Calendar.FieldMapping)
	}

	// 改动副本不得影响原视图
	view.Calendar.FieldMapping.ColorFieldID = "other"
	if masterView.Calendar.FieldMapping.ColorFieldID != "color" {
		t.Fatal("mutating the duplicate must not affect the master view mapping")
	}

	// 未知布局仍然返回 nil，由调用方报错而不是空指针
	if nil != newAttrViewViewByLayoutType(av.LayoutType("bogus")) {
		t.Fatal("unknown layout type should yield nil so the caller can report an error")
	}
}

// K5: 显式 ViewID 必须命中对应视图，而不是块上的当前视图。
func TestCalendarSetterResolvesViewByOperationViewID(t *testing.T) {
	seedCalendarI18n(t)

	first := av.NewCalendarView()
	first.ID = "20240101000000-view0001"
	second := av.NewCalendarView()
	second.ID = "20240101000000-view0002"
	attrView := &av.AttributeView{
		ID:     "20240101000000-avavav1",
		ViewID: first.ID,
		Views:  []*av.View{first, second},
	}

	view, err := resolveAttrViewViewByOperation(attrView, &Operation{ViewID: second.ID})
	if err != nil {
		t.Fatalf("explicit view ID should resolve: %v", err)
	}
	if view != second {
		t.Fatalf("explicit view ID must target the second view, got %s", view.ID)
	}

	view, err = resolveAttrViewViewByOperation(attrView, &Operation{ViewID: first.ID})
	if err != nil {
		t.Fatalf("explicit view ID should resolve: %v", err)
	}
	if view != first {
		t.Fatalf("explicit view ID must target the first view, got %s", view.ID)
	}

	if _, err = resolveAttrViewViewByOperation(attrView, &Operation{ViewID: "20240101000000-missing"}); !errors.Is(err, av.ErrViewNotFound) {
		t.Fatalf("unknown explicit view ID should return ErrViewNotFound, got %v", err)
	}

	// 旧版载荷不带 ViewID，回退到当前视图
	view, err = resolveAttrViewViewByOperation(attrView, &Operation{})
	if err != nil {
		t.Fatalf("legacy payload without view ID should fall back: %v", err)
	}
	if view != first {
		t.Fatalf("legacy fallback should return the current view, got %s", view.ID)
	}
}

// K7: 模板字段是计算字段，写入会被渲染覆盖，不能再作为可写元数据映射。
func TestCalendarMetadataMappingRejectsTemplate(t *testing.T) {
	attrView := &av.AttributeView{
		KeyValues: []*av.KeyValues{
			{Key: &av.Key{ID: "text", Type: av.KeyTypeText}},
			{Key: &av.Key{ID: "template", Type: av.KeyTypeTemplate}},
		},
	}

	for _, fieldName := range []string{"recurrenceFieldID", "exceptionFieldID", "locationFieldID", "descriptionFieldID"} {
		if _, err := calendarFieldMappingFromOperationData(attrView, nil, map[string]any{fieldName: "template"}); err == nil {
			t.Fatalf("%s must reject a template field because template cells are recomputed on render", fieldName)
		}
		if _, err := calendarFieldMappingFromOperationData(attrView, nil, map[string]any{fieldName: "text"}); err != nil {
			t.Fatalf("%s must still accept a text field: %v", fieldName, err)
		}
	}
}

// K4: 新建的日历视图默认「每个条目是一个页面」，磁盘上已有的视图（零值）保持只建行。
func TestCalendarNewItemTargetDefaults(t *testing.T) {
	seedCalendarI18n(t)

	fresh := av.NewCalendarView()
	if av.CalendarNewItemTargetDocument != fresh.Calendar.NewItemTarget {
		t.Fatalf("a freshly created calendar view must default to document, got %q", fresh.Calendar.NewItemTarget)
	}

	// 解析磁盘上已有的视图得到的是零值，必须继续走只建行的老行为
	legacy := &av.LayoutCalendar{BaseLayout: &av.BaseLayout{}}
	if "" != legacy.NewItemTarget {
		t.Fatalf("a legacy calendar layout must keep the zero value, got %q", legacy.NewItemTarget)
	}
	if av.CalendarNewItemTargetDocument == legacy.NewItemTarget {
		t.Fatal("a legacy calendar layout must not be treated as document target")
	}
}

// K4: setAttrViewCalendarNewItemTarget 的取值校验。
func TestCalendarNewItemTargetFromOperationData(t *testing.T) {
	for _, valid := range []string{"", "row", "document"} {
		target, err := calendarNewItemTargetFromOperationData(valid)
		if err != nil {
			t.Fatalf("%q should be accepted: %v", valid, err)
		}
		if target != valid {
			t.Fatalf("expected %q, got %q", valid, target)
		}
	}
	for _, invalid := range []any{"page", "Document", 1, 1.0, true, nil, map[string]any{}} {
		if _, err := calendarNewItemTargetFromOperationData(invalid); err == nil {
			t.Fatalf("%#v should be rejected", invalid)
		}
	}
}

// K3: 日历视图按需补一个文档类型的新增条目模板，且不覆盖已有的。
func TestEnsureCalendarNewItemDocumentTemplate(t *testing.T) {
	seedCalendarI18n(t)

	attrView := &av.AttributeView{}
	created := ensureCalendarNewItemDocumentTemplate(attrView)
	if nil == created {
		t.Fatal("a document template should have been seeded")
	}
	if 1 != len(attrView.NewItemTemplates) {
		t.Fatalf("expected exactly one template, got %d", len(attrView.NewItemTemplates))
	}
	if av.NewItemTargetDocument != created.TargetType {
		t.Fatalf("seeded template must target a document, got %q", created.TargetType)
	}
	if "" == created.Name {
		t.Fatal("seeded template must have a name, SetNewItemTemplates rejects empty names")
	}
	if nil == created.SaveLocation || "" != created.SaveLocation.BoxID || "" != created.SaveLocation.PathTemplate {
		// 空 BoxID/PathTemplate 才会解析成数据库块自己的笔记本 + 以其根文档为父
		t.Fatalf("seeded template save location must be empty, got %#v", created.SaveLocation)
	}

	// 幂等：已经有文档模板时不再追加，也不覆盖用户改过的保存位置
	created.SaveLocation.PathTemplate = "/custom"
	again := ensureCalendarNewItemDocumentTemplate(attrView)
	if again != created {
		t.Fatal("an existing document template must be reused, not replaced")
	}
	if 1 != len(attrView.NewItemTemplates) {
		t.Fatalf("expected no extra template, got %d", len(attrView.NewItemTemplates))
	}
	if "/custom" != created.SaveLocation.PathTemplate {
		t.Fatalf("an existing template must not be overwritten, got %q", created.SaveLocation.PathTemplate)
	}

	// 只有游离模板时仍然需要补一个文档模板
	detachedOnly := &av.AttributeView{NewItemTemplates: []*av.NewItemTemplate{
		{ID: "20240101000000-detached", Name: "Row", TargetType: av.NewItemTargetDetached},
	}}
	if nil == ensureCalendarNewItemDocumentTemplate(detachedOnly) {
		t.Fatal("a detached-only AV should still get a document template")
	}
	if 2 != len(detachedOnly.NewItemTemplates) {
		t.Fatalf("expected two templates, got %d", len(detachedOnly.NewItemTemplates))
	}
}

// K1: 调用方传入的字段值必须校验后才写入，计算字段与主键一律拒绝。
func TestResolveCallerItemFieldValuesForCalendar(t *testing.T) {
	attrView := &av.AttributeView{
		KeyValues: []*av.KeyValues{
			{Key: &av.Key{ID: "block", Type: av.KeyTypeBlock}},
			{Key: &av.Key{ID: "date", Type: av.KeyTypeDate}},
			{Key: &av.Key{ID: "text", Type: av.KeyTypeText}},
			{Key: &av.Key{ID: "template", Type: av.KeyTypeTemplate}},
			{Key: &av.Key{ID: "rollup", Type: av.KeyTypeRollup}},
			{Key: &av.Key{ID: "created", Type: av.KeyTypeCreated}},
		},
	}

	empty, err := resolveCallerItemFieldValues(attrView, nil)
	if err != nil {
		t.Fatalf("nil field values should be accepted: %v", err)
	}
	if 0 != len(empty) {
		t.Fatalf("nil field values should resolve to nothing, got %d", len(empty))
	}

	resolved, err := resolveCallerItemFieldValues(attrView, map[string]*av.Value{
		"date": {Type: av.KeyTypeDate, Date: &av.ValueDate{Content: 1, IsNotEmpty: true}},
		"text": {Text: &av.ValueText{Content: "Room A"}},
	})
	if err != nil {
		t.Fatalf("valid field values should be accepted: %v", err)
	}
	if 2 != len(resolved) {
		t.Fatalf("expected two resolved values, got %d", len(resolved))
	}
	if av.KeyTypeText != resolved["text"].Type {
		t.Fatalf("a value with no type must inherit the field type, got %q", resolved["text"].Type)
	}
	if "" != resolved["date"].ID || "" != resolved["date"].BlockID {
		t.Fatalf("caller supplied identifiers must be stripped: %#v", resolved["date"])
	}

	for _, keyID := range []string{"block", "template", "rollup", "created"} {
		if _, err = resolveCallerItemFieldValues(attrView, map[string]*av.Value{
			keyID: {Text: &av.ValueText{Content: "x"}},
		}); err == nil {
			t.Fatalf("field %s must be rejected as not writable", keyID)
		}
	}
	if _, err = resolveCallerItemFieldValues(attrView, map[string]*av.Value{
		"missing": {Text: &av.ValueText{Content: "x"}},
	}); err == nil {
		t.Fatal("an unknown field must be rejected")
	}
	if _, err = resolveCallerItemFieldValues(attrView, map[string]*av.Value{
		"date": {Type: av.KeyTypeText, Text: &av.ValueText{Content: "x"}},
	}); err == nil {
		t.Fatal("a value whose type contradicts the field must be rejected")
	}
}

// K1: 调用方给的标题优先于模板的 primaryKeyTemplate；为空时回退到模板。
func TestCreateItemOptionsPrimaryKeyOverride(t *testing.T) {
	merged := mergeCreateItemOptions([]*CreateItemOptions{nil, {PrimaryKey: "Standup"}})
	if "Standup" != merged.PrimaryKey {
		t.Fatalf("expected the supplied primary key, got %q", merged.PrimaryKey)
	}
	merged = mergeCreateItemOptions(nil)
	if "" != merged.PrimaryKey || 0 != len(merged.FieldValues) {
		t.Fatalf("no options must merge to the zero value, got %#v", merged)
	}
}
