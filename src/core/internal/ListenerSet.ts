export class ListenerSet {
  private readonly listeners = new Set<() => void>();
  private emitting = false;
  private pending = false;

  get size() {
    return this.listeners.size;
  }

  add(listener: () => void) {
    this.listeners.add(listener);

    return () => {
      this.listeners.delete(listener);
    };
  }

  clear() {
    this.listeners.clear();
    this.pending = false;
  }

  emit() {
    if (this.emitting) {
      this.pending = true;
      return;
    }

    this.emitting = true;

    try {
      do {
        this.pending = false;
        const listeners = [...this.listeners];

        listeners.forEach((listener) => {
          if (this.listeners.has(listener)) {
            listener();
          }
        });
      } while (this.pending);
    } finally {
      this.emitting = false;
    }
  }
}
