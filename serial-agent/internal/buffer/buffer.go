// Package buffer keeps the recent output of one serial port with absolute
// byte offsets.
package buffer

import "sync"

// MaxChunkBytes is the largest data event payload.
const MaxChunkBytes = 64 << 10

// Chunk is a copy of bytes that starts at Offset.
type Chunk struct {
	Offset int64
	Data   []byte
}

// Buffer is a thread-safe ring of the last capacity bytes written to it.
type Buffer struct {
	mu    sync.Mutex
	data  []byte
	start int64
	end   int64
	subs  map[uint64]func(Chunk)
	next  uint64
}

// New returns a buffer that keeps the last capacity bytes.
func New(capacity int) *Buffer {
	if capacity <= 0 {
		panic("buffer: capacity must be positive")
	}
	return &Buffer{data: make([]byte, capacity), subs: make(map[uint64]func(Chunk))}
}

// Write appends p and passes it to the current subscribers. The sink runs with
// the buffer lock held so that a subscription cannot miss or repeat bytes; it
// must not call back into the buffer.
func (b *Buffer) Write(p []byte) {
	if len(p) == 0 {
		return
	}

	b.mu.Lock()
	defer b.mu.Unlock()

	oldEnd := b.end
	newEnd := oldEnd + int64(len(p))
	capacity := int64(len(b.data))

	if int64(len(p)) >= capacity {
		keep := p[int64(len(p))-capacity:]
		b.start = newEnd - capacity
		b.store(b.start, keep)
	} else {
		if newEnd-b.start > capacity {
			b.start = newEnd - capacity
		}
		b.store(oldEnd, p)
	}
	b.end = newEnd

	for _, sink := range b.subs {
		for offset := oldEnd; offset < newEnd; offset += MaxChunkBytes {
			n := newEnd - offset
			if n > MaxChunkBytes {
				n = MaxChunkBytes
			}
			chunk := make([]byte, n)
			copy(chunk, p[offset-oldEnd:offset-oldEnd+n])
			sink(Chunk{Offset: offset, Data: chunk})
		}
	}
}

// Bounds returns the oldest kept offset and one past the newest offset.
func (b *Buffer) Bounds() (start, end int64) {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.start, b.end
}

// Subscribe starts a subscription at from. Buffered bytes are delivered
// before Subscribe returns. ready runs while the buffer is still locked, after
// the backlog, so a caller can send its acknowledgement before any live byte.
// Both callbacks must not call back into the buffer.
func (b *Buffer) Subscribe(from int64, sink func(Chunk), ready func(from, lost int64)) *Subscription {
	b.mu.Lock()
	defer b.mu.Unlock()

	var lost int64
	if from < b.start {
		lost = b.start - from
		from = b.start
	}
	if from > b.end {
		from = b.end
	}
	start := from
	for from < b.end {
		n := b.end - from
		if n > MaxChunkBytes {
			n = MaxChunkBytes
		}
		sink(Chunk{Offset: from, Data: b.snapshot(from, int(n))})
		from += n
	}

	b.next++
	id := b.next
	b.subs[id] = sink
	ready(start, lost)
	return &Subscription{buffer: b, id: id}
}

// Subscription is one live stream of a buffer.
type Subscription struct {
	buffer *Buffer
	id     uint64
}

// Cancel stops the subscription. It is safe to call more than once.
func (s *Subscription) Cancel() {
	s.buffer.mu.Lock()
	defer s.buffer.mu.Unlock()
	delete(s.buffer.subs, s.id)
}

func (b *Buffer) store(offset int64, p []byte) {
	index := int(offset % int64(len(b.data)))
	n := copy(b.data[index:], p)
	copy(b.data, p[n:])
}

func (b *Buffer) snapshot(offset int64, n int) []byte {
	out := make([]byte, n)
	index := int(offset % int64(len(b.data)))
	copied := copy(out, b.data[index:])
	copy(out[copied:], b.data[:])
	return out
}
