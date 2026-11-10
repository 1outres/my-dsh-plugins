package buffer

import (
	"bytes"
	"testing"
)

func TestWriteAndBounds(t *testing.T) {
	b := New(16)
	if start, end := b.Bounds(); start != 0 || end != 0 {
		t.Fatalf("bounds = %d,%d", start, end)
	}
	b.Write([]byte("abc"))
	if start, end := b.Bounds(); start != 0 || end != 3 {
		t.Fatalf("bounds = %d,%d", start, end)
	}
}

func TestWrapAndLost(t *testing.T) {
	b := New(8)
	b.Write([]byte("abcdef"))
	b.Write([]byte("ghij"))
	start, end := b.Bounds()
	if start != 2 || end != 10 {
		t.Fatalf("bounds = %d,%d, want 2,10", start, end)
	}

	var chunks []Chunk
	var from, lost int64
	b.Subscribe(0, func(chunk Chunk) { chunks = append(chunks, chunk) }, func(f, l int64) { from, lost = f, l })
	if from != 2 || lost != 2 {
		t.Fatalf("from,lost = %d,%d, want 2,2", from, lost)
	}
	if len(chunks) != 1 || chunks[0].Offset != 2 || string(chunks[0].Data) != "cdefghij" {
		t.Fatalf("unexpected backlog: %+v", chunks)
	}
}

func TestWriteLargerThanCapacity(t *testing.T) {
	b := New(4)
	b.Write([]byte("abcdefgh"))
	start, end := b.Bounds()
	if start != 4 || end != 8 {
		t.Fatalf("bounds = %d,%d, want 4,8", start, end)
	}
	var from, lost int64
	b.Subscribe(0, func(chunk Chunk) {
		if string(chunk.Data) != "efgh" {
			t.Fatalf("unexpected data %q", chunk.Data)
		}
	}, func(f, l int64) { from, lost = f, l })
	if from != 4 || lost != 4 {
		t.Fatalf("from,lost = %d,%d, want 4,4", from, lost)
	}
}

func TestSubscribeBacklogThenLive(t *testing.T) {
	b := New(64)
	b.Write([]byte("abc"))

	var order []string
	var backlog []byte
	var readyFrom, readyLost int64
	subscription := b.Subscribe(0, func(chunk Chunk) {
		order = append(order, "data")
		backlog = append(backlog, chunk.Data...)
	}, func(from, lost int64) {
		order = append(order, "ready")
		readyFrom, readyLost = from, lost
	})
	if readyFrom != 0 || readyLost != 0 {
		t.Fatalf("ready = %d,%d, want 0,0", readyFrom, readyLost)
	}
	b.Write([]byte("def"))
	subscription.Cancel()
	b.Write([]byte("ghi"))

	if len(order) != 3 || order[0] != "data" || order[1] != "ready" || order[2] != "data" {
		t.Fatalf("unexpected order: %v", order)
	}
	if !bytes.Equal(backlog, []byte("abcdef")) {
		t.Fatalf("unexpected backlog: %q", backlog)
	}
}

func TestSubscribeFromPastEnd(t *testing.T) {
	b := New(16)
	b.Write([]byte("abc"))
	var from, lost int64
	b.Subscribe(100, func(Chunk) {}, func(f, l int64) { from, lost = f, l })
	if from != 3 || lost != 0 {
		t.Fatalf("from,lost = %d,%d, want 3,0", from, lost)
	}
}

func TestLargeWriteIsChunked(t *testing.T) {
	b := New(200 << 10)
	data := bytes.Repeat([]byte("x"), 150<<10)
	b.Write(data)

	var total int
	var lastOffset int64 = -1
	var from, lost int64
	b.Subscribe(0, func(chunk Chunk) {
		if len(chunk.Data) > MaxChunkBytes {
			t.Fatalf("chunk of %d bytes is too large", len(chunk.Data))
		}
		if lastOffset >= 0 && chunk.Offset != lastOffset {
			t.Fatalf("gap between %d and %d", lastOffset, chunk.Offset)
		}
		lastOffset = chunk.Offset + int64(len(chunk.Data))
		total += len(chunk.Data)
	}, func(f, l int64) { from, lost = f, l })
	if from != 0 || lost != 0 {
		t.Fatalf("from,lost = %d,%d, want 0,0", from, lost)
	}
	if total != len(data) {
		t.Fatalf("delivered %d bytes, want %d", total, len(data))
	}
}
