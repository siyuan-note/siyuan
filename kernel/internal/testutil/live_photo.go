// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package testutil

import (
	"bytes"
	"encoding/binary"
	"math"
	"testing"

	"github.com/Eyevinn/mp4ff/avc"
	"github.com/Eyevinn/mp4ff/mp4"
	go264 "github.com/oops1/go.264"
)

// LivePhotoMOV 构造三帧纯色画面和短音调，不包含相册文件或个人元数据。
func LivePhotoMOV(t testing.TB) []byte {
	t.Helper()
	encoder, err := go264.NewEncoder(go264.EncoderConfig{Width: 32, Height: 32, FPSNum: 30, FPSDen: 1, QP: 26, GOPSize: 30, ForceSoftware: true})
	if err != nil {
		t.Fatal(err)
	}
	defer encoder.Close()
	init := mp4.CreateEmptyInit()
	video := init.AddEmptyTrack(30000, "video", "und")
	audio := init.AddEmptyTrack(44100, "audio", "und")
	audio.Mdia.Minf.Stbl.Stsd.AddChild(mp4.CreateAudioSampleEntryBox("sowt", 1, 16, 44100, nil))
	fragment, err := mp4.CreateMultiTrackFragment(1, []uint32{video.Tkhd.TrackID, audio.Tkhd.TrackID})
	if err != nil {
		t.Fatal(err)
	}
	for i := range 3 {
		frame := make([]byte, 32*32*3/2)
		for j := range frame {
			frame[j] = byte(100 + i*10)
		}
		packet, err := encoder.Encode(frame)
		if err != nil {
			t.Fatal(err)
		}
		if i == 0 {
			sps, pps := avc.GetParameterSetsFromByteStream(packet)
			if err := video.SetAVCDescriptor("avc1", sps, pps, true); err != nil {
				t.Fatal(err)
			}
		}
		data := avc.ConvertByteStreamToNaluSample(packet)
		flags := uint32(0x01010000)
		if i == 0 {
			flags = 0x02000000
		}
		if err := fragment.AddFullSampleToTrack(mp4.FullSample{Sample: mp4.Sample{Flags: flags, Dur: 1000, Size: uint32(len(data))}, DecodeTime: uint64(i * 1000), Data: data}, video.Tkhd.TrackID); err != nil {
			t.Fatal(err)
		}
	}
	pcm := make([]byte, 4410*2)
	for i := range 4410 {
		binary.LittleEndian.PutUint16(pcm[i*2:], uint16(int16(10000*math.Sin(2*math.Pi*440*float64(i)/44100))))
	}
	if err := fragment.AddFullSampleToTrack(mp4.FullSample{Sample: mp4.Sample{Flags: 0x02000000, Dur: 4410, Size: uint32(len(pcm))}, Data: pcm}, audio.Tkhd.TrackID); err != nil {
		t.Fatal(err)
	}
	var fragmented, output bytes.Buffer
	if err := init.Encode(&fragmented); err != nil {
		t.Fatal(err)
	}
	if err := fragment.Encode(&fragmented); err != nil {
		t.Fatal(err)
	}
	file, err := mp4.DecodeFile(bytes.NewReader(fragmented.Bytes()))
	if err != nil {
		t.Fatal(err)
	}
	if err := mp4.Defragment(file, bytes.NewReader(fragmented.Bytes()), &output); err != nil {
		t.Fatal(err)
	}
	return output.Bytes()
}
