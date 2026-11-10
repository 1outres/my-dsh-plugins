package client

import (
	"sync"
	"testing"
	"time"
)

func TestKeyedQueueKeepsArrivalOrder(t *testing.T) {
	queue := newKeyedQueue()
	var mu sync.Mutex
	var order []int
	var workers sync.WaitGroup

	for index := 0; index < 8; index++ {
		previous, release := queue.enqueue("p1")
		workers.Add(1)
		go func(index int, previous chan struct{}, release func()) {
			defer workers.Done()
			if previous != nil {
				<-previous
			}
			defer release()
			mu.Lock()
			order = append(order, index)
			mu.Unlock()
		}(index, previous, release)
	}
	workers.Wait()

	if len(order) != 8 {
		t.Fatalf("order = %v", order)
	}
	for index, value := range order {
		if value != index {
			t.Fatalf("order = %v", order)
		}
	}
}

func TestKeyedQueueSeparatesHandles(t *testing.T) {
	queue := newKeyedQueue()
	blockedPrevious, blockedRelease := queue.enqueue("p1")
	otherPrevious, otherRelease := queue.enqueue("p2")

	released := make(chan struct{})
	go func() {
		if blockedPrevious != nil {
			<-blockedPrevious
		}
		<-released
		blockedRelease()
	}()

	done := make(chan struct{})
	go func() {
		if otherPrevious != nil {
			<-otherPrevious
		}
		close(done)
		otherRelease()
	}()

	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("a request for another handle was blocked")
	}
	close(released)
}
