export class AsyncQueue<T> implements AsyncIterable<T> {
  private readonly items: T[] = [];
  private itemOffset = 0;
  private readonly waiters: Array<{
    resolve: (result: IteratorResult<T>) => void;
    reject: (error: unknown) => void;
  }> = [];
  private closed = false;
  private failed = false;
  private error: unknown;

  push(item: T) {
    if (this.closed) return;

    const waiter = this.waiters.shift();
    if (waiter) {
      waiter.resolve({ done: false, value: item });
      return;
    }

    this.items.push(item);
  }

  close() {
    if (this.closed) return;

    this.closed = true;
    while (this.waiters.length > 0) {
      this.waiters.shift()?.resolve({ done: true, value: undefined });
    }
  }

  fail(error: unknown) {
    if (this.closed) return;

    this.error = error;
    this.failed = true;
    this.closed = true;
    while (this.waiters.length > 0) {
      this.waiters.shift()?.reject(error);
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => this.next(),
    };
  }

  private next(): Promise<IteratorResult<T>> {
    if (this.itemOffset < this.items.length) {
      const value = this.items[this.itemOffset++];

      if (
        this.itemOffset >= 64 &&
        this.itemOffset * 2 >= this.items.length
      ) {
        this.items.splice(0, this.itemOffset);
        this.itemOffset = 0;
      }

      return Promise.resolve({
        done: false,
        value,
      });
    }

    if (this.failed) {
      return Promise.reject(this.error);
    }

    if (this.closed) {
      return Promise.resolve({ done: true, value: undefined });
    }

    return new Promise<IteratorResult<T>>((resolve, reject) => {
      this.waiters.push({ resolve, reject });
    });
  }
}
