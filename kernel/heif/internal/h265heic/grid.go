package heic

import (
	"sync"
	"sync/atomic"

	"github.com/gen2brain/h265/hevc"
)

const maxGridTiles = 256

type gridInfo struct {
	rows, cols int
	w, h       int
}

func parseGrid(b []byte) (gridInfo, error) {
	r := &reader{b: b}
	r.u8()

	flags := r.u8()

	var g gridInfo

	g.rows = int(r.u8()) + 1
	g.cols = int(r.u8()) + 1

	if flags&1 != 0 {
		g.w, g.h = int(r.u32()), int(r.u32())
	} else {
		g.w, g.h = int(r.u16()), int(r.u16())
	}

	if r.err || g.w <= 0 || g.h <= 0 {
		return g, ErrInvalid
	}
	if g.rows*g.cols > maxGridTiles {
		return g, ErrUnsupported
	}

	return g, nil
}

func (f *file) gridOf(it *item) (gridInfo, []uint32, error) {
	dataSize, err := f.meta.dataSize(it, f.src)
	if err != nil {
		return gridInfo{}, nil, err
	}
	if dataSize > 12 {
		return gridInfo{}, nil, ErrUnsupported
	}
	data, err := f.meta.data(it, f.src)
	if err != nil {
		return gridInfo{}, nil, err
	}

	g, err := parseGrid(data)
	if err != nil {
		return gridInfo{}, nil, err
	}

	tiles := f.meta.refsTo("dimg", it.id)
	if len(tiles) != g.rows*g.cols {
		return gridInfo{}, nil, ErrInvalid
	}

	return g, tiles, nil
}

// decodeImage decodes an item, stitching the tiles first when it is a grid.
func (f *file) decodeImage(it *item) (*hevc.Picture, error) {
	if it.unsupported {
		return nil, ErrUnsupported
	}

	if it.typ != "grid" {
		var dec itemDecoder
		frameLimit := f.limit()
		if p := f.meta.prop(it, "ispe"); p != nil {
			frameLimit = codedFrameLimit(uint64(p.w)*uint64(p.h), frameLimit)
		}

		return f.decodeItem(dec.use(f.workers(0), frameLimit), it)
	}

	g, tiles, err := f.gridOf(it)
	if err != nil {
		return nil, err
	}

	if n := f.limit(); n > 0 && uint64(g.w)*uint64(g.h) > uint64(n) {
		return nil, ErrUnsupported
	}

	return f.decodeTiles(g, tiles)
}

// decodeTiles decodes the tiles and copies each into its place in the output.
func (f *file) decodeTiles(g gridInfo, tiles []uint32) (*hevc.Picture, error) {
	if len(tiles) == 0 {
		return nil, ErrInvalid
	}
	seen := make(map[uint32]struct{}, len(tiles))
	for _, id := range tiles {
		if _, exists := seen[id]; exists {
			return nil, ErrUnsupported
		}
		seen[id] = struct{}{}
	}

	totalFrameLimit := f.limit()
	if totalFrameLimit > 0 {
		displayPixels := uint64(g.w) * uint64(g.h)
		totalFrameLimit = codedFrameLimit(displayPixels+uint64(codedPixelSlack*(len(tiles)-1)), totalFrameLimit)
	}
	tileFrameLimit := (totalFrameLimit + len(tiles) - 1) / len(tiles)

	var (
		out    *hevc.Picture
		tw, th int
		ready  = make(chan struct{})
		next   atomic.Int64
		fail   atomic.Pointer[error]
		wg     sync.WaitGroup
	)

	setErr := func(err error) { fail.CompareAndSwap(nil, &err) }

	next.Store(1)

	// The tiles already spread across the budget, so each one's wavefront
	// takes only what is left over rather than multiplying it.
	tileWorkers := f.workers(len(tiles))
	perTile := max(f.workers(0)/tileWorkers, 1)

	for range tileWorkers - 1 {
		wg.Add(1)

		go func() {
			defer wg.Done()

			var dec itemDecoder

			dec.use(perTile, tileFrameLimit)

			for {
				i := int(next.Add(1)) - 1
				if i >= len(tiles) || fail.Load() != nil {
					return
				}

				p, err := f.decodeTile(&dec, tiles[i])
				if err != nil {
					setErr(err)

					return
				}

				<-ready

				if fail.Load() != nil {
					p.Release()

					return
				}

				if p.CropW != tw || p.CropH != th ||
					p.ChromaFormat != out.ChromaFormat || p.BitDepth != out.BitDepth ||
					p.BitDepthC != out.BitDepthC {
					p.Release()
					setErr(ErrInvalid)

					return
				}

				blit(out, p, g, i, tw, th)
				p.Release()
			}
		}()
	}

	var dec itemDecoder

	dec.use(perTile, tileFrameLimit)

	func() {
		defer close(ready)

		p, err := f.decodeTile(&dec, tiles[0])
		if err != nil {
			setErr(err)

			return
		}

		defer p.Release()

		tw, th = p.CropW, p.CropH
		if totalFrameLimit > 0 && uint64(tw)*uint64(th)*uint64(len(tiles)) > uint64(totalFrameLimit) {
			setErr(ErrUnsupported)

			return
		}
		if tw*g.cols < g.w || th*g.rows < g.h {
			setErr(ErrInvalid)

			return
		}

		out = newGrid(p, g)

		blit(out, p, g, 0, tw, th)
	}()

	for fail.Load() == nil {
		i := int(next.Add(1)) - 1
		if i >= len(tiles) {
			break
		}

		p, err := f.decodeTile(&dec, tiles[i])
		if err != nil {
			setErr(err)

			break
		}

		if p.CropW != tw || p.CropH != th ||
			p.ChromaFormat != out.ChromaFormat || p.BitDepth != out.BitDepth ||
			p.BitDepthC != out.BitDepthC {
			p.Release()
			setErr(ErrInvalid)

			break
		}

		blit(out, p, g, i, tw, th)
		p.Release()
	}

	wg.Wait()

	if err := fail.Load(); err != nil {
		return nil, *err
	}

	return out, nil
}

func (f *file) decodeTile(dec *itemDecoder, id uint32) (*hevc.Picture, error) {
	t := f.meta.items[id]
	if t == nil {
		return nil, ErrInvalid
	}

	return f.decodeItem(dec, t)
}

// newGrid allocates the stitched picture, which may be smaller than the tiles
// cover.
func newGrid(first *hevc.Picture, g gridInfo) *hevc.Picture {
	sw, sh := subsampling(first.ChromaFormat)

	out := &hevc.Picture{
		Width:        g.w,
		Height:       g.h,
		CropW:        g.w,
		CropH:        g.h,
		ChromaFormat: first.ChromaFormat,
		BitDepth:     first.BitDepth,
		BitDepthC:    first.BitDepthC,
		StrideY:      g.w,
	}

	if first.ChromaFormat != 0 {
		out.WidthC = (g.w + sw - 1) / sw
		out.HeightC = (g.h + sh - 1) / sh
		out.StrideC = out.WidthC
	}

	if first.BitDepth > 8 {
		out.Y16 = make([]uint16, out.StrideY*g.h)
		out.Cb16 = make([]uint16, out.StrideC*out.HeightC)
		out.Cr16 = make([]uint16, out.StrideC*out.HeightC)

		return out
	}

	out.Y = make([]uint8, out.StrideY*g.h)
	out.Cb = make([]uint8, out.StrideC*out.HeightC)
	out.Cr = make([]uint8, out.StrideC*out.HeightC)

	return out
}

func subsampling(chromaFormat int) (int, int) {
	switch chromaFormat {
	case 1:
		return 2, 2
	case 2:
		return 2, 1
	}

	return 1, 1
}

// blit copies tile i of the grid into its place in out.
func blit(out, p *hevc.Picture, g gridInfo, i, tw, th int) {
	sw, sh := subsampling(out.ChromaFormat)
	row, col := i/g.cols, i%g.cols

	for pl := range 3 {
		sx, sy := col*tw, row*th
		cw, ch := tw, th
		ow, oh := g.w, g.h
		ss, ds := p.StrideY, out.StrideY
		sox, soy := p.CropX, p.CropY

		if pl != 0 {
			if out.ChromaFormat == 0 {
				return
			}

			sx, sy = sx/sw, sy/sh
			cw, ch = cw/sw, ch/sh
			ow, oh = out.WidthC, out.HeightC
			ss, ds = p.StrideC, out.StrideC
			sox, soy = sox/sw, soy/sh
		}

		cw = min(cw, ow-sx)
		ch = min(ch, oh-sy)

		if cw <= 0 || ch <= 0 {
			continue
		}

		if out.BitDepth > 8 {
			src, dst := planes16(p, out, pl)
			for y := range ch {
				copy(dst[(sy+y)*ds+sx:][:cw], src[(soy+y)*ss+sox:][:cw])
			}

			continue
		}

		src, dst := planes8(p, out, pl)
		for y := range ch {
			copy(dst[(sy+y)*ds+sx:][:cw], src[(soy+y)*ss+sox:][:cw])
		}
	}
}

func planes8(src, dst *hevc.Picture, pl int) ([]uint8, []uint8) {
	switch pl {
	case 0:
		return src.Y, dst.Y
	case 1:
		return src.Cb, dst.Cb
	default:
		return src.Cr, dst.Cr
	}
}

func planes16(src, dst *hevc.Picture, pl int) ([]uint16, []uint16) {
	switch pl {
	case 0:
		return src.Y16, dst.Y16
	case 1:
		return src.Cb16, dst.Cb16
	default:
		return src.Cr16, dst.Cr16
	}
}

// gridAlpha assembles a grid's alpha from the auxiliary items on its tiles.
func (f *file) gridAlpha(it *item) (*hevc.Picture, error) {
	g, tiles, err := f.gridOf(it)
	if err != nil {
		return nil, err
	}

	alpha := make([]uint32, len(tiles))

	for i, id := range tiles {
		a := f.alphaOf(id)
		if a == nil {
			return nil, nil
		}

		alpha[i] = a.id
	}

	return f.decodeTiles(g, alpha)
}

func (f *file) hasAlpha(it *item) (bool, error) {
	if it.typ != "grid" {
		return f.alphaOf(it.id) != nil, nil
	}
	_, tiles, err := f.gridOf(it)
	if err != nil {
		return false, err
	}
	for _, id := range tiles {
		if f.alphaOf(id) != nil {
			return true, nil
		}
	}
	return false, nil
}
