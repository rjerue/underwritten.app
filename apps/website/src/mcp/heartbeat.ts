export type HeartbeatCallback = () => void;

/**
 * A throttled-resistant timer that uses a Web Worker to fire callbacks even when
 * the app is in the background.
 */
export class Heartbeat {
  private worker: Worker | null = null;
  private readonly callbacks = new Map<number, HeartbeatCallback>();
  private nextId = 1;
  private readonly intervalMs: number;

  constructor(intervalMs: number) {
    this.intervalMs = intervalMs;
  }

  start() {
    if (this.worker) return;

    const code = `
      let intervalId = null;
      self.onmessage = (e) => {
        if (e.data.type === 'start') {
          intervalId = setInterval(() => self.postMessage('tick'), e.data.intervalMs);
        } else if (e.data.type === 'stop') {
          clearInterval(intervalId);
        }
      };
    `;

    const blob = new Blob([code], { type: "application/javascript" });
    this.worker = new Worker(URL.createObjectURL(blob));
    this.worker.onmessage = () => {
      for (const callback of this.callbacks.values()) {
        callback();
      }
    };

    this.worker.postMessage({ type: "start", intervalMs: this.intervalMs });
  }

  stop() {
    if (!this.worker) return;
    this.worker.postMessage({ type: "stop" });
    this.worker.terminate();
    this.worker = null;
  }

  addCallback(callback: HeartbeatCallback): number {
    const id = this.nextId++;
    this.callbacks.set(id, callback);
    return id;
  }

  removeCallback(id: number) {
    this.callbacks.delete(id);
  }
}
