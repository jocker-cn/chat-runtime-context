export class FakeSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static instances: FakeSocket[] = [];
  readyState = FakeSocket.CONNECTING;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: ((event: { code: number; reason: string; wasClean: boolean }) => void) | null = null;
  constructor(_url: string) { FakeSocket.instances.push(this); }
  send(payload: string) { this.sent.push(payload); }
  close() { this.readyState = FakeSocket.CLOSING; }
  open() { this.readyState = FakeSocket.OPEN; this.onopen?.(); }
  message(message: unknown) { this.onmessage?.({ data: JSON.stringify(message) }); }
  end() { this.readyState = FakeSocket.CLOSED; this.onclose?.({ code: 1006, reason: "Lost", wasClean: false }); }
}
