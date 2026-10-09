package model

import (
	"reflect"
	"testing"
	"time"

	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/cache"
)

func TestAttributeViewLunarFieldPreservesLegacyDates(t *testing.T) {
	setupAttributeViewValidationTest(t)
	attrView := av.NewAttributeView("20261009120000-lunart1")
	key := av.NewKey("20261009120000-lunark1", "Birthday", "", av.KeyTypeDate)
	key.DateFormat = av.DateDisplayFormatFull
	values := []*av.Value{
		{ID: "20261009120000-lunarv1", KeyID: key.ID, Type: av.KeyTypeDate, Date: &av.ValueDate{
			Content: time.Date(2025, 7, 25, 14, 7, 35, 123000000, time.Local).UnixMilli(), IsNotEmpty: true,
			Content2: time.Date(2025, 7, 26, 15, 8, 45, 456000000, time.Local).UnixMilli(), IsNotEmpty2: true, HasEndDate: true}},
		{ID: "20261009120000-lunarv2", KeyID: key.ID, Type: av.KeyTypeDate, Date: &av.ValueDate{
			Content: time.Date(1800, 1, 2, 0, 0, 0, 0, time.Local).UnixMilli(), IsNotEmpty: true, IsNotTime: true}},
		{ID: "20261009120000-lunarv3", KeyID: key.ID, Type: av.KeyTypeDate, Date: &av.ValueDate{IsNotTime: true}},
	}
	attrView.KeyValues = append(attrView.KeyValues, &av.KeyValues{Key: key, Values: values})
	if err := av.SaveAttributeView(attrView); err != nil {
		t.Fatal(err)
	}
	for _, format := range []av.DateDisplayFormat{av.DateDisplayFormatLunar, av.DateDisplayFormatFull} {
		if err := setAttributeViewColDateFormat(&Operation{AvID: attrView.ID, ID: key.ID, Typ: "date", Format: string(format)}); err != nil {
			t.Fatal(err)
		}
		cache.ClearAVCache()
		stored, err := av.ParseAttributeView(attrView.ID)
		if err != nil {
			t.Fatal(err)
		}
		actual := stored.KeyValues[len(stored.KeyValues)-1]
		if actual.Key.DateFormat != format || !reflect.DeepEqual(actual.Values, values) {
			t.Fatalf("calendar switch changed legacy values: %+v", actual)
		}
	}
}
