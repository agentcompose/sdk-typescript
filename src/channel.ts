// A minimal async channel: push values, close, iterate. Buffers until consumed,
// so events emitted before a subscriber attaches are not lost.
export class Channel<T> {
  #buf: T[] = [];
  #waiters: ((r: IteratorResult<T>) => void)[] = [];
  #closed = false;

  push(value: T): void {
    if (this.#closed) return;
    const w = this.#waiters.shift();
    if (w) w({ value, done: false });
    else this.#buf.push(value);
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    let w: ((r: IteratorResult<T>) => void) | undefined;
    while ((w = this.#waiters.shift())) w({ value: undefined as never, done: true });
  }

  async *[Symbol.asyncIterator](): AsyncIterator<T> {
    while (true) {
      if (this.#buf.length > 0) {
        yield this.#buf.shift() as T;
        continue;
      }
      if (this.#closed) return;
      const r = await new Promise<IteratorResult<T>>((resolve) => this.#waiters.push(resolve));
      if (r.done) return;
      yield r.value;
    }
  }
}
