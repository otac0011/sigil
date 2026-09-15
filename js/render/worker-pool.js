// Priority worker pool for generation tasks. Falls back to running the same task handler on the
// main thread (one task per macrotask) when module workers are unavailable or fail to start.

const INIT_TIMEOUT_MS = 10000;

export class WorkerPool {
  constructor(size, initMsg) {
    this.queue = [];
    this.pending = new Map();
    this.nextId = 1;
    this.seq = 0;
    this.idle = [];
    this.workers = [];
    this.mode = 'starting';
    this.ready = this._start(Math.max(1, size), initMsg);
  }

  async _start(size, initMsg) {
    try {
      if (typeof Worker === 'undefined') throw new Error('no Worker');
      const url = new URL('../gen/worker.js', import.meta.url);
      for (let i = 0; i < size; i++) {
        const w = new Worker(url, { type: 'module' });
        w.onmessage = (e) => this._onMessage(e.data);
        this.workers.push(w);
      }
      await Promise.all(this.workers.map((w) => new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('worker init timeout')), INIT_TIMEOUT_MS);
        w.onerror = (e) => { clearTimeout(timer); reject(new Error(e.message || 'worker error')); };
        this._send(w, initMsg).then((r) => { clearTimeout(timer); resolve(r); }, reject);
      })));
      this.idle = [...this.workers];
      this.mode = 'workers';
    } catch (err) {
      console.warn('Sigil: module workers unavailable, generating on the main thread.', err);
      for (const w of this.workers) w.terminate();
      this.workers = [];
      this.pending.clear();
      const { createTaskHandler } = await import('../gen/tasks.js');
      this.inline = createTaskHandler();
      this.inline(initMsg);
      this.mode = 'inline';
    }
    this._pump();
    return this.mode;
  }

  _send(w, msg) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      w.postMessage({ id, msg });
    });
  }

  _onMessage(data) {
    const p = this.pending.get(data.id);
    if (!p) return;
    this.pending.delete(data.id);
    if (data.error) p.reject(new Error(data.error));
    else p.resolve(data.result);
  }

  /** Queue a task; lower priority numbers run first. */
  run(msg, priority = 0) {
    return new Promise((resolve, reject) => {
      this.queue.push({ msg, priority, seq: this.seq++, resolve, reject });
      this._pump();
    });
  }

  /** Drop queued (not yet started) tasks matching the predicate. */
  cancel(predicate) {
    this.queue = this.queue.filter((job) => {
      if (!predicate(job.msg)) return true;
      job.reject(Object.assign(new Error('cancelled'), { cancelled: true }));
      return false;
    });
  }

  _next() {
    let best = 0;
    for (let i = 1; i < this.queue.length; i++) {
      const a = this.queue[i], b = this.queue[best];
      if (a.priority < b.priority || (a.priority === b.priority && a.seq < b.seq)) best = i;
    }
    return this.queue.splice(best, 1)[0];
  }

  _pump() {
    if (this.mode === 'workers') {
      while (this.idle.length && this.queue.length) {
        const job = this._next(), w = this.idle.pop();
        this._send(w, job.msg).then(job.resolve, job.reject).finally(() => { this.idle.push(w); this._pump(); });
      }
    } else if (this.mode === 'inline' && !this.inlineBusy && this.queue.length) {
      this.inlineBusy = true;
      setTimeout(() => {
        const job = this._next();
        try { job.resolve(this.inline(job.msg).result); } catch (e) { job.reject(e); }
        this.inlineBusy = false;
        this._pump();
      }, 0);
    }
  }

  get busy() { return this.queue.length + this.pending.size; }
}
