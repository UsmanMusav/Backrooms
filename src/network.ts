import { PROTOCOL } from '../shared/protocol';
import type { ChatLine, ClientMessage, RoomView, ServerMessage } from '../shared/protocol';

export function serverURL(address: string): URL {
  const value = address.trim();
  const url = value ? new URL(/^(https?|wss?):\/\//i.test(value) ? value : `http://${value}`) : new URL(location.origin);
  if (!['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol) || url.username || url.password) throw new Error('Нужен адрес http(s) или ws(s) без логина и пароля.');
  url.protocol = url.protocol === 'https:' || url.protocol === 'wss:' ? 'wss:' : 'ws:';
  url.pathname = '/ws'; url.search = ''; url.hash = '';
  if (location.protocol === 'https:' && url.protocol === 'ws:') throw new Error('На HTTPS-странице нужен защищённый wss:// сервер. Для LAN откройте HTTP-адрес ведущего или EXE.');
  return url;
}

export class CoopClient {
  id = '';
  room: RoomView | null = null;
  latency = 0;
  private socket?: WebSocket;
  private heartbeat = 0;
  private timeout = 0;
  private generation = 0;
  private intentionalClose = false;
  private sequence = 0;
  onRoom: (room: RoomView) => void = () => {};
  onChat: (line: ChatLine) => void = () => {};
  onError: (message: string) => void = () => {};
  onDisconnect: () => void = () => {};

  connect(address: string, request: Extract<ClientMessage, { t: 'create' | 'join' }>): Promise<void> {
    this.disconnect();
    const url = serverURL(address);
    this.intentionalClose = false;
    const generation = ++this.generation;
    return new Promise((resolve, reject) => {
      let settled = false;
      let established = false;
      const fail = (message: string) => { if (!settled) { settled = true; reject(new Error(message)); } };
      const socket = this.socket = new WebSocket(url, PROTOCOL);
      this.timeout = window.setTimeout(() => { fail('Сервер не ответил за 12 секунд. Проверьте адрес и доступность сети.'); socket.close(); }, 12000);
      socket.onopen = () => { if (generation === this.generation) socket.send(JSON.stringify(request)); };
      socket.onmessage = event => {
        if (generation !== this.generation) return;
        let message: ServerMessage;
        try { message = JSON.parse(event.data) as ServerMessage; } catch { return; }
        if (message.t === 'welcome') {
          clearTimeout(this.timeout);
          established = true;
          this.id = message.id;
          this.room = message.room;
          if (!settled) { settled = true; resolve(); }
          this.onRoom(message.room);
          this.heartbeat = window.setInterval(() => this.send({ t: 'ping', at: Date.now() }), 4000);
        } else if (message.t === 'state') {
          this.room = message.room; this.onRoom(message.room);
        } else if (message.t === 'chat') this.onChat(message.line);
        else if (message.t === 'error') {
          if (!settled) { clearTimeout(this.timeout); fail(message.message); this.intentionalClose = true; socket.close(); }
          else this.onError(message.message);
        } else if (message.t === 'pong') this.latency = Math.max(0, Date.now() - message.at);
      };
      socket.onerror = () => fail('Не удалось подключиться. Проверьте адрес сервера, WebSocket и брандмауэр.');
      socket.onclose = () => {
        if (generation !== this.generation) return;
        clearTimeout(this.timeout); clearInterval(this.heartbeat);
        fail('Соединение закрыто сервером.');
        if (!this.intentionalClose && established) this.onDisconnect();
      };
    });
  }

  send(message: ClientMessage) { if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message)); }
  sendPose(pose: Extract<ClientMessage, { t: 'pose' }>['pose']) { this.send({ t: 'pose', pose, seq: ++this.sequence }); }
  disconnect() {
    this.intentionalClose = true;
    this.generation++;
    clearInterval(this.heartbeat); clearTimeout(this.timeout);
    this.socket?.close();
    this.socket = undefined; this.room = null; this.id = ''; this.sequence = 0;
  }
}
