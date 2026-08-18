/*
Package heic decodes HEIF images that carry HEVC-coded item data, the format
commonly called HEIC.

# Color

[Decode] returns RGB, converted with the matrix and range the file declares in
its nclx color description. [Options.ToYCbCr] skips that and hands back the
planes the bitstream carries: *[image.YCbCr], *[image.NYCbCrA] with alpha, or
*[image.Gray] for monochrome. Above 8 bits there is no such image type, so
*[image.NRGBA64] is returned anyway.

[image.YCbCr] reads its planes as full-range BT.601 whatever the file signals,
which is rarely what a HEIC file means. [DecodeColor] reports what they
actually are, so ToYCbCr is for reaching the samples rather than for display:

	img, ci, err := heic.DecodeColor(r, heic.Options{ToYCbCr: true})

[ColorInfo] carries the CICP code points and the range flag, plus the ICC
profile when the file has one. Matrix and FullRange are what the conversion to
RGB uses. Primaries and Transfer are reported but not applied, so RGB output
stays in the file's own color space.

# Metadata

[DecodeExif] reads the Exif item a file describes its image with, and
[RawExif] and [RawXMP] return the payloads unparsed.
*/
package heic

import (
	"errors"
	"image"
	"io"
	"runtime"

	"github.com/gen2brain/h265/hevc"
)

// ErrUnsupported is returned for a file this package cannot render but which
// is otherwise well formed: an essential property it does not implement, or a
// sample format it has no conversion for. A caller that has another decoder to
// fall back on should test for this one rather than [ErrInvalid].
var ErrUnsupported = errors.New("heic: unsupported image")

// DefaultFrameSizeLimit 限制文件头能够请求分配的像素面积。
const DefaultFrameSizeLimit = 50_000_000

// ColorInfo describes the color space an image was decoded from.
type ColorInfo struct {
	Primaries uint16
	Transfer  uint16
	Matrix    uint16
	FullRange bool
	// ICCP is the embedded ICC profile, for files that carry one in place of
	// an nclx description. It aliases the input, so it is not a copy.
	ICCP []byte
}

// Options controls decoding.
type Options struct {
	// AutoRotate applies the clap/irot/imir transforms, forcing NRGBA output
	// when it transforms.
	AutoRotate bool
	// FrameSizeLimit 限制单帧的像素面积，零值或过大的值会使用 DefaultFrameSizeLimit。
	FrameSizeLimit int
	// ToYCbCr forces the image's native color space instead of NRGBA:
	// *image.YCbCr, *image.NYCbCrA when there is alpha, or *image.Gray when
	// the image is monochrome. Above 8 bits NRGBA64 is returned anyway.
	// image.YCbCr reads the planes as full-range BT.601 whatever the file
	// signals, so this is for reaching the samples, not for display.
	// DecodeColor reports what the samples actually are.
	ToYCbCr bool
	// Threads 保留接口兼容性，解码始终使用单线程。
	Threads int
}

func options(opts []Options) Options {
	var ret Options
	if len(opts) > 0 {
		ret = opts[0]
	}
	if ret.FrameSizeLimit <= 0 || ret.FrameSizeLimit > DefaultFrameSizeLimit {
		ret.FrameSizeLimit = DefaultFrameSizeLimit
	}
	ret.Threads = 1

	return ret
}

type file struct {
	src            *source
	meta           *metaBox
	frameSizeLimit int
	threads        int
	decodedBytes   uint64
}

func (f *file) consumeDecodedBytes(size uint64) error {
	if f.decodedBytes > maxItemDataBytes || size > maxItemDataBytes-f.decodedBytes {
		return ErrUnsupported
	}
	f.decodedBytes += size
	return nil
}

// workers is how many goroutines a grid may use, never more than it has tiles.
func (f *file) workers(n int) int {
	w := f.threads
	if w == 0 {
		w = runtime.GOMAXPROCS(0)
	}

	if n <= 0 {
		return max(w, 1)
	}

	return max(min(w, n), 1)
}

// HEIC holds the images of a file, which may be an image sequence.
type HEIC struct {
	// Image holds the decoded frames, *image.NRGBA or *image.NRGBA64.
	Image []image.Image
	// Delay holds each frame's duration in seconds.
	Delay []float64
	// LoopCount controls how many times the animation restarts, following
	// image/gif: zero loops forever, -1 shows each frame once, and any other
	// value plays the animation LoopCount+1 times.
	LoopCount int
	// Color describes the color space the frames were decoded from.
	Color ColorInfo
}

func parse(src *source) (*file, error) {
	if src == nil || src.size == 0 {
		return nil, ErrInvalid
	}
	if src.size > maxContainerBytes {
		return nil, ErrUnsupported
	}

	f := &file{src: src}

	seen := false

	err := src.eachBox(func(typ string, off, n uint64) error {
		// Only these carry anything parse needs, so the media data is never
		// read here: the items that reference it are read on demand.
		switch typ {
		case "ftyp":
			seen = true

			return nil
		case "meta":
			if f.meta != nil {
				return nil
			}
			if n > maxMetadataBytes {
				return ErrUnsupported
			}

			b, err := src.at(off, n)
			if err != nil {
				return err
			}
			m, err := parseMeta(b)
			if err != nil {
				return err
			}
			f.meta = m

			return nil
		case "moov", "mini":
			// The MinimizedImageBox of the low overhead profile carries the
			// whole description in place of meta, so a file built on it is one
			// we can read nothing from rather than a malformed one.
			return ErrUnsupported
		default:
			return nil
		}
	})
	if err != nil {
		return nil, err
	}

	if !seen || f.meta == nil {
		return nil, ErrInvalid
	}

	return f, nil
}

// srcFor addresses the file by range when the reader allows it, so only the
// items a decode reaches are read. Anything else is buffered whole, which is
// what image.Decode leaves us with: it hands the decoder a bufio.Reader.
func srcFor(r io.Reader) (*source, error) {
	ra, raOK := r.(io.ReaderAt)
	sk, skOK := r.(io.Seeker)

	if raOK && skOK {
		cur, err1 := sk.Seek(0, io.SeekCurrent)
		end, err2 := sk.Seek(0, io.SeekEnd)

		if err1 == nil && err2 == nil && end > cur {
			n := end - cur
			if n > maxContainerBytes {
				return nil, ErrUnsupported
			}

			return &source{r: io.NewSectionReader(ra, cur, n), size: uint64(n)}, nil
		}
	}

	data, err := io.ReadAll(io.LimitReader(r, maxContainerBytes+1))
	if err != nil {
		return nil, err
	}
	if len(data) > maxContainerBytes {
		return nil, ErrUnsupported
	}

	return memSource(data), nil
}

// parseHeader reads only the boxes a configuration needs and stops as soon as
// one can be derived, so a stream that cannot be addressed by range still
// costs no more than its header.
func parseHeader(r io.Reader) (*file, error) {
	f := &file{}

	seen := false

	err := eachBoxReader(r, func(typ string, n int64, body io.Reader) error {
		switch typ {
		case "ftyp":
			seen = true

		case "meta":
			if f.meta != nil {
				return nil
			}

			b, err := boxBytes(body, n)
			if err != nil {
				return err
			}

			m, err := parseMeta(b)
			if err != nil {
				return err
			}

			f.meta = m

		case "moov":
			return ErrUnsupported

		default:
			return nil
		}

		// Only a configuration from the primary item ends the walk. A picture
		// track is the fallback for a file that has no usable image item, and
		// a meta box after moov would still outrank it.
		if seen {
			if _, err := f.config(); err == nil {
				return errStop
			}
		}

		return nil
	})
	if err != nil && !errors.Is(err, errStop) {
		return nil, err
	}

	if !seen || f.meta == nil {
		return nil, ErrInvalid
	}

	return f, nil
}

// config is the image configuration of the primary item, or of the picture
// track when a file carries no image item.
func (f *file) config() (image.Config, error) {
	it, err := f.primary()
	if err != nil {
		return image.Config{}, err
	}

	w, h, err := f.size(it)
	if err != nil {
		return image.Config{}, err
	}

	return image.Config{Width: w, Height: h, ColorModel: colorModelFor(f, it)}, nil
}

func (f *file) limit() int {
	switch {
	case f.frameSizeLimit < 0:
		return 0
	case f.frameSizeLimit == 0:
		return DefaultFrameSizeLimit
	}

	return f.frameSizeLimit
}

// primary is the item a file describes itself with.
func (f *file) primary() (*item, error) {
	if f.meta == nil {
		return nil, ErrInvalid
	}

	it := f.meta.items[f.meta.primary]
	if it == nil {
		return nil, ErrInvalid
	}

	if it.unsupported {
		return nil, ErrUnsupported
	}

	return it, nil
}

// alphaOf finds the auxiliary item that carries this item's alpha channel.
func (f *file) alphaOf(id uint32) *item {
	for _, r := range f.meta.refs {
		if r.typ != "auxl" || len(r.to) == 0 || r.to[0] != id {
			continue
		}

		it := f.meta.items[r.from]
		if it == nil || it.unsupported {
			continue
		}

		if p := f.meta.prop(it, "auxC"); p != nil && isAlphaURN(p.auxC) {
			return it
		}
	}

	return nil
}

func isAlphaURN(s string) bool {
	return s == "urn:mpeg:mpegB:cicp:systems:auxiliary:alpha" ||
		s == "urn:mpeg:hevc:2015:auxid:1"
}

// itemDecoder carries the decoder across the tiles of a grid, which keeps the
// per-picture buffers allocated once, together with the configuration already
// fed to it so the tiles after the first skip the parameter sets they share.
type itemDecoder struct {
	d              hevc.Decoder
	cfg            *hevcConfig
	frameSizeLimit int
}

// use 设置解码器的并发和分配上限。
func (dec *itemDecoder) use(threads, frameSizeLimit int) *itemDecoder {
	dec.d.Threads(threads)
	dec.d.FrameSizeLimit(frameSizeLimit)
	dec.frameSizeLimit = frameSizeLimit

	return dec
}

func (f *file) decodeItem(dec *itemDecoder, it *item) (*hevc.Picture, error) {
	if it.typ == "grid" {
		return nil, ErrUnsupported
	}

	if it.typ != "hvc1" {
		return nil, ErrUnsupported
	}

	cfg := f.meta.prop(it, "hvcC")
	if cfg == nil || cfg.hvcC == nil {
		return nil, ErrInvalid
	}

	if n := f.limit(); n > 0 {
		if p := f.meta.prop(it, "ispe"); p != nil && uint64(p.w)*uint64(p.h) > uint64(n) {
			return nil, ErrUnsupported
		}
	}

	if dec.cfg != cfg.hvcC {
		spsCount := 0
		for _, nal := range cfg.hvcC.paramSets {
			u, ok := hevc.ParseNAL(nal)
			if !ok || u.Type.IsVCL() {
				return nil, ErrInvalid
			}
			if u.Type == hevc.NALSPS {
				spsCount++
				if err := validateSPSLimits(u, dec.frameSizeLimit); err != nil {
					return nil, err
				}
			}

			if _, err := dec.d.DecodeNAL(u); err != nil {
				return nil, wrap(err)
			}
		}
		if spsCount == 0 {
			return nil, ErrInvalid
		}

		dec.cfg = cfg.hvcC
	}

	dataSize, err := f.meta.dataSize(it, f.src)
	if err != nil {
		return nil, err
	}
	if err = f.consumeDecodedBytes(dataSize); err != nil {
		return nil, err
	}
	data, err := f.meta.data(it, f.src)
	if err != nil {
		return nil, err
	}

	pictureStarts := 0
	vclCount := 0
	err = eachHVCC(data, cfg.hvcC.lengthSize, func(u hevc.NALUnit) error {
		if !u.Type.IsVCL() {
			if u.Type == hevc.NALVPS || u.Type == hevc.NALSPS || u.Type == hevc.NALPPS {
				return ErrUnsupported
			}
			return nil
		}
		if u.Type != hevc.NALIdrWRadl && u.Type != hevc.NALIdrNLP {
			return ErrUnsupported
		}
		vclCount++
		if vclCount > 1 {
			return ErrUnsupported
		}
		if len(u.RBSP) == 0 {
			return ErrInvalid
		}
		if u.RBSP[0]&0x80 != 0 {
			pictureStarts++
			if pictureStarts > 1 {
				return ErrUnsupported
			}
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	if pictureStarts != 1 || vclCount != 1 {
		return nil, ErrInvalid
	}

	var out []*hevc.Picture
	err = eachHVCC(data, cfg.hvcC.lengthSize, func(u hevc.NALUnit) error {
		pics, decodeErr := dec.d.DecodeNAL(u)
		if decodeErr != nil {
			return wrap(decodeErr)
		}
		out = append(out, pics...)
		if len(out) > 1 {
			return ErrUnsupported
		}
		return nil
	})
	if err != nil {
		for _, pic := range out {
			pic.Release()
		}
		return nil, err
	}
	out = append(out, dec.d.Flush()...)

	if len(out) != 1 {
		for _, pic := range out {
			pic.Release()
		}
		if len(out) > 1 {
			return nil, ErrUnsupported
		}
		return nil, ErrInvalid
	}

	return out[0], nil
}

func eachHVCC(data []byte, lengthSize int, fn func(hevc.NALUnit) error) error {
	if lengthSize < 1 || lengthSize > 4 {
		return ErrInvalid
	}
	count := 0
	for offset := 0; offset < len(data); {
		if len(data)-offset < lengthSize {
			return ErrInvalid
		}
		n := uint64(0)
		for range lengthSize {
			n = n<<8 | uint64(data[offset])
			offset++
		}
		if n < 2 || n > maxNALBytes || n > uint64(len(data)-offset) {
			return ErrInvalid
		}
		count++
		if count > maxNALUnits {
			return ErrUnsupported
		}
		nal, ok := hevc.ParseNAL(data[offset : offset+int(n)])
		if !ok {
			return ErrInvalid
		}
		if err := fn(nal); err != nil {
			return err
		}
		offset += int(n)
	}
	if count == 0 {
		return ErrInvalid
	}
	return nil
}

func wrap(err error) error {
	if errors.Is(err, hevc.ErrUnsupported) {
		return ErrUnsupported
	}

	return ErrInvalid
}

// decodeStill decodes the primary item, its alpha, and any grid it derives
// from, and converts the result.
func (f *file) decodeStill(o Options) (image.Image, ColorInfo, error) {
	it, err := f.primary()
	if err != nil {
		return nil, ColorInfo{}, err
	}
	hasAlpha, err := f.hasAlpha(it)
	if err != nil {
		return nil, ColorInfo{}, err
	}
	if hasAlpha {
		return nil, ColorInfo{}, ErrUnsupported
	}

	pic, err := f.decodeImage(it)
	if err != nil {
		return nil, ColorInfo{}, err
	}
	defer pic.Release()

	// ISO/IEC 23008-12 7.2.1: ispe is the displayed size.
	f.clampToISPE(it, pic)

	ci := f.colorInfo(it, pic)

	img, err := toImage(pic, nil, ci, o.ToYCbCr)
	if err != nil {
		return nil, ci, err
	}

	if o.AutoRotate {
		img, err = f.transform(it, img)
		if err != nil {
			return nil, ci, err
		}
	}

	return img, ci, nil
}

// Decode 将 HEIC 静态图像解码为 *image.NRGBA。
func Decode(r io.Reader, opts ...Options) (image.Image, error) {
	img, _, err := decode(r, opts...)

	return img, err
}

// DecodeBytes 直接使用调用方提供的只读字节，避免复制单 extent 图像数据。
func DecodeBytes(data []byte, opts ...Options) (image.Image, error) {
	img, _, err := decodeSource(memSource(data), opts...)

	return img, err
}

// DecodeColor is Decode, and also reports the color space the image was
// decoded from.
func DecodeColor(r io.Reader, opts ...Options) (image.Image, ColorInfo, error) {
	return decode(r, opts...)
}

func decode(r io.Reader, opts ...Options) (image.Image, ColorInfo, error) {
	src, err := srcFor(r)
	if err != nil {
		return nil, ColorInfo{}, err
	}
	return decodeSource(src, opts...)
}

func decodeSource(src *source, opts ...Options) (image.Image, ColorInfo, error) {
	f, err := parse(src)
	if err != nil {
		return nil, ColorInfo{}, err
	}

	o := options(opts)
	f.frameSizeLimit = o.FrameSizeLimit
	f.threads = o.Threads

	return f.decodeStill(o)
}

// DecodeAll 返回包含单张静态图像的结果；序列容器不在该适配层的支持范围内。
func DecodeAll(r io.Reader, opts ...Options) (*HEIC, error) {
	src, err := srcFor(r)
	if err != nil {
		return nil, err
	}

	f, err := parse(src)
	if err != nil {
		return nil, err
	}

	o := options(opts)
	f.frameSizeLimit = o.FrameSizeLimit
	f.threads = o.Threads

	img, ci, err := f.decodeStill(o)
	if err != nil {
		return nil, err
	}

	return &HEIC{Image: []image.Image{img}, Delay: []float64{0}, Color: ci}, nil
}

// DecodeConfig returns the dimensions and color model without decoding the
// image data.
func DecodeConfig(r io.Reader) (image.Config, error) {
	src, err := srcFor(r)
	if err != nil {
		return image.Config{}, err
	}
	f, err := parse(src)
	if err != nil {
		return image.Config{}, err
	}

	return f.config()
}

// DecodeConfigBytes 读取调用方提供的只读字节并返回静态图像尺寸。
func DecodeConfigBytes(data []byte) (image.Config, error) {
	f, err := parse(memSource(data))
	if err != nil {
		return image.Config{}, err
	}

	return f.config()
}

// clampToISPE trims a decoded picture to the size the item declares.
func (f *file) clampToISPE(it *item, pic *hevc.Picture) {
	p := f.meta.prop(it, "ispe")
	if p == nil {
		return
	}

	pic.CropW = min(pic.CropW, int(p.w))
	pic.CropH = min(pic.CropH, int(p.h))
}

// size is the stored size of an item, which is what Decode returns unless
// AutoRotate transforms it.
func (f *file) size(it *item) (int, int, error) {
	p := f.meta.prop(it, "ispe")
	if p == nil {
		return 0, 0, ErrInvalid
	}

	if p.w == 0 || p.h == 0 || p.w > 1<<20 || p.h > 1<<20 {
		return 0, 0, ErrInvalid
	}

	return int(p.w), int(p.h), nil
}
