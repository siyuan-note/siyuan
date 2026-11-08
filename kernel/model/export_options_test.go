// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"encoding/json"
	"reflect"
	"strings"
	"sync"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/conf"
)

func TestExportOptionsSnapshot(t *testing.T) {
	previous := Conf
	Conf = &AppConf{Export: NewConfSection(conf.NewExport())}
	t.Cleanup(func() { Conf = previous })
	baseline := *Conf.Export.Load()
	options := &ExportOptions{
		HeadingNumber: new(false),
		AddTitle:      new(false), InlineMemo: new(true), BlockRefMode: new(3), BlockEmbedMode: new(0),
		FileAnnotationRefMode: new(1), BlockRefTextLeft: new("["), BlockRefTextRight: new("]"),
		TagOpenMarker: new("<"), TagCloseMarker: new(">"), IncludeSubDocs: new(false),
		IncludeRelatedDocs: new(true), MarkdownYFM: new(true), RemoveAssetsID: new(true),
	}
	resolved := resolveExportOptions(options)
	fields := reflect.ValueOf(options).Elem()
	values := reflect.ValueOf(resolved)
	for i := range fields.NumField() {
		field := fields.Field(i)
		if field.Kind() != reflect.Pointer {
			continue
		}
		name := fields.Type().Field(i).Name
		if name == "HeadingNumber" {
			if resolved.MarkdownHeadingNumber == nil || *resolved.MarkdownHeadingNumber != *options.HeadingNumber {
				t.Fatal("heading number option was not resolved")
			}
			continue
		}
		if !values.FieldByName(name).IsValid() || !reflect.DeepEqual(values.FieldByName(name).Interface(), field.Elem().Interface()) {
			t.Fatalf("option %s was not resolved", name)
		}
	}
	if *Conf.Export.Load() != baseline || resolveExportOptions(nil) != baseline || resolveExportOptions(&ExportOptions{}) != baseline {
		t.Fatal("single-export options changed defaults or the global configuration")
	}
	*options.AddTitle = true
	*options.HeadingNumber = true
	Conf.Export.Load().BlockRefMode = 2
	if resolved.AddTitle || resolved.BlockRefMode != 3 {
		t.Fatal("resolved configuration retains a mutable reference to input or defaults")
	}
	if *resolved.MarkdownHeadingNumber || resolveExportOptions(nil).MarkdownHeadingNumber != nil || resolveExportOptions(&ExportOptions{}).MarkdownHeadingNumber != nil {
		t.Fatal("heading number selection leaked between independent exports or retains an input reference")
	}
	configJSON, err := json.Marshal(resolved)
	if err != nil || !strings.Contains(string(configJSON), `"headingNumber":false`) || strings.Contains(string(configJSON), "MarkdownHeadingNumber") {
		t.Fatalf("temporary heading number selection reached persistent configuration: %s (%v)", configJSON, err)
	}
	options.Render = ExportRenderOptions{FillCSSVar: true, AVPublishFilter: func(view av.Viewable, _, _ string) av.Viewable { return view }}
	data, err := json.Marshal(options)
	if err != nil {
		t.Fatal(err)
	}
	var published map[string]json.RawMessage
	if err = json.Unmarshal(data, &published); err != nil || len(published) != 14 {
		t.Fatalf("execution context changed the existing JSON option shape: %s (%v)", data, err)
	}
}

func TestExportOptionsConcurrentSnapshots(t *testing.T) {
	previous := Conf
	Conf = &AppConf{Export: NewConfSection(conf.NewExport())}
	t.Cleanup(func() { Conf = previous })
	baseline := *Conf.Export.Load()
	var workers sync.WaitGroup
	for i := range 64 {
		workers.Go(func() {
			options := &ExportOptions{BlockRefMode: new(i), AddTitle: new(i%2 == 0), IncludeRelatedDocs: new(i%3 == 0)}
			for range 16 {
				resolved := resolveExportOptions(options)
				if resolved.BlockRefMode != i || resolved.AddTitle != (i%2 == 0) || resolved.IncludeRelatedDocs != (i%3 == 0) {
					t.Errorf("concurrent options leaked between exports: %d", i)
				}
			}
		})
	}
	workers.Wait()
	if *Conf.Export.Load() != baseline {
		t.Fatal("resolving concurrent exports changed global configuration")
	}
}
