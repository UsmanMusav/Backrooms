import { version as APP_VERSION } from '../package.json';
import { CoopClient, serverURL } from './network';
import { desktopInfo } from './native';
import type { BackroomsGame, GameState } from './game';
import type { ChatLine, RoomView } from '../shared/protocol';

type UI = {
  game: BackroomsGame;
  screen: HTMLElement;
  icon: (name: string, className?: string) => string;
  openModal: (title: string, content: string, overline?: string) => void;
  closeModal: () => void;
  notify: (text: string, title?: string) => void;
  refreshEnd: (state: GameState) => void;
};
export const escapeHTML = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const $ = (s: string) => document.querySelector<HTMLElement>(s)!;
const read = (key: string, fallback: string) => { try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; } };
const store = (key: string, value: string) => { try { localStorage.setItem(key, value); } catch { /* optional */ } };

export class CoopUI {
  readonly client = new CoopClient();
  room: RoomView | null = null;
  private ui: UI;
  private address = '';
  private lines: ChatLine[] = [];
  private roster = '';
  private radioOpen = false;
  private chatTimer = 0;
  private connecting = false;
  private lobbyShown = false;
  private localAddresses: string[] = [];

  constructor(ui: UI) {
    this.ui = ui;
    const radio = document.createElement('aside');
    radio.id = 'radio'; radio.hidden = true;
    radio.setAttribute('aria-label', 'Текстовая рация');
    radio.innerHTML = `<button class="radio-toggle" id="radio-toggle"><span class="radio-pulse"></span>РАЦИЯ <kbd>T</kbd></button><div class="radio-lines" id="radio-lines" role="log" aria-live="polite"></div><form id="radio-composer" hidden><input id="radio-input" aria-label="Сообщение в рацию" maxlength="160" placeholder="Говорите. Кто-то слушает…" autocomplete="off"/><button aria-label="Передать сообщение">${ui.icon('arrow')}</button></form><small class="radio-help" id="radio-help" hidden>ENTER — передать · ESC — закрыть</small>`;
    document.querySelector('#app')!.appendChild(radio);
    $('#radio-toggle').addEventListener('click', () => this.toggleRadio());
    $('#radio-composer').addEventListener('submit', event => { event.preventDefault(); this.sendRadio(); });
    $('#radio-input').addEventListener('keydown', event => {
      event.stopPropagation();
      if (event.key === 'Escape') { event.preventDefault(); this.toggleRadio(false); }
    });
    window.addEventListener('keydown', event => {
      if (event.target instanceof HTMLElement && event.target.closest('input, textarea, select, dialog')) return;
      if (!this.room || this.room.phase === 'lobby') return;
      if (event.code === 'KeyT') { event.preventDefault(); this.toggleRadio(); }
      if (event.code === 'KeyQ' && ui.game.state === 'playing' && !this.radioOpen) this.client.send({ t: 'say', text: 'Держимся вместе.' });
    });
    this.client.onRoom = room => this.onRoom(room);
    this.client.onChat = line => {
      this.lines.push(line);
      this.lines = this.lines.slice(-40);
      this.renderChat();
      $('#radio').classList.add('has-message');
      clearTimeout(this.chatTimer);
      this.chatTimer = window.setTimeout(() => $('#radio').classList.remove('has-message'), 9000);
    };
    this.client.onError = message => {
      const status = document.querySelector('#lobby-status');
      if (status && this.room?.phase === 'lobby') status.textContent = message;
      else ui.notify(message, 'РАЦИЯ / ОШИБКА');
    };
    this.client.onDisconnect = () => {
      if (!this.room) return;
      this.leave();
      ui.openModal('СОЕДИНЕНИЕ ПОТЕРЯНО', '<p class="confirm-message">Сервер не отвечает. Прогресс отключённого игрока не восстанавливается автоматически. Если ведущий вышел, проверьте доступность сервера у команды.</p><div class="dialog-footer"><span></span><button class="primary-button" id="reconnect-menu"><span>К СЕТЕВОМУ МЕНЮ</span>' + ui.icon('arrow') + '</button></div>', 'NOCLIP / ОБРЫВ РАДИОКАНАЛА');
      $('#reconnect-menu').addEventListener('click', () => this.showConnect());
    };
  }

  showConnect() {
    if (this.room) { this.renderLobby(); return; }
    this.address = read('backrooms-server', '');
    let joining = false;
    const ui = this.ui;
    const draw = () => {
      ui.openModal('СОВМЕСТНАЯ ЭКСПЕДИЦИЯ', `
        <div class="coop-tabs" role="tablist" aria-label="Сетевая игра"><button class="coop-tab ${joining ? '' : 'active'}" role="tab" aria-selected="${!joining}" id="create-tab">СОЗДАТЬ КОМНАТУ</button><button class="coop-tab ${joining ? 'active' : ''}" role="tab" aria-selected="${joining}" id="join-tab">ПРИСОЕДИНИТЬСЯ</button></div>
        <form id="connect-form">
          <label class="field-label" for="nickname-input">ВАШ ПОЗЫВНОЙ</label><input class="text-input" id="nickname-input" autocomplete="nickname" maxlength="18" value="${escapeHTML(read('backrooms-name', 'Исследователь'))}" required placeholder="Как вас называть?"/>
          <label class="field-label" for="server-input">АДРЕС ОБЩЕГО СЕРВЕРА</label><input class="text-input mono-input" id="server-input" maxlength="240" value="${escapeHTML(this.address)}" placeholder="Пусто — сервер этой игры" autocomplete="off" spellcheck="false"/><p class="field-help">Все участники должны указать один и тот же сервер. Для LAN — адрес компьютера ведущего, для интернета — доступный HTTPS/WSS-сервер.</p>
          ${joining ? '<label class="field-label" for="room-code-input">КОД КОМНАТЫ</label><input class="text-input room-code-input" id="room-code-input" maxlength="6" minlength="6" placeholder="ABC234" autocomplete="off" required spellcheck="false"/>' : ''}
          <div class="connect-info"><span class="room-live-dot"></span><span>1–4 ИГРОКА · ОБЩИЙ ПРОГРЕСС · MIMIC</span></div>
          <p class="form-error" id="connect-error" role="alert"></p>
          <button class="primary-button" id="connect-submit" type="submit"><span>${joining ? 'ПОДКЛЮЧИТЬСЯ' : 'СОЗДАТЬ ЭКСПЕДИЦИЮ'}</span>${ui.icon('arrow')}</button>
        </form><p class="connect-footnote">Код комнаты не пробрасывает NAT автоматически. В EXE локальный сервер уже встроен.</p>`, 'NOCLIP / КООПЕРАТИВНЫЙ ПРОТОКОЛ');
      $('#create-tab').addEventListener('click', () => { remember(); joining = false; draw(); });
      $('#join-tab').addEventListener('click', () => { remember(); joining = true; draw(); });
      const remember = () => {
        this.address = (document.querySelector('#server-input') as HTMLInputElement).value;
        store('backrooms-name', (document.querySelector('#nickname-input') as HTMLInputElement).value);
      };
      $('#connect-form').addEventListener('submit', async event => {
        event.preventDefault();
        if (this.connecting) return;
        const name = (document.querySelector('#nickname-input') as HTMLInputElement).value.trim();
        const address = (document.querySelector('#server-input') as HTMLInputElement).value.trim();
        const code = (document.querySelector('#room-code-input') as HTMLInputElement | null)?.value.trim().toUpperCase() ?? '';
        const button = document.querySelector<HTMLButtonElement>('#connect-submit')!;
        const error = $('#connect-error');
        this.connecting = true; button.disabled = true; error.textContent = '';
        this.address = address;
        try {
          store('backrooms-name', name); store('backrooms-server', address);
          await this.client.connect(address, joining ? { t: 'join', name, code } : { t: 'create', name });
          ui.closeModal();
        } catch (e) {
          error.textContent = e instanceof Error ? e.message : 'Не удалось установить соединение.';
        } finally { this.connecting = false; button.disabled = false; }
      });
    };
    draw();
  }

  private onRoom(room: RoomView) {
    const previous = this.room;
    this.room = room;
    if (!this.ui.game.coop) this.ui.game.enableCoop(this.client.id, message => this.client.send(message));
    if (room.phase === 'lobby') {
      if (!this.lobbyShown) {
        this.ui.closeModal();
        this.ui.game.menu();
        this.renderLobby();
      } else this.updateLobby();
    } else {
      this.lobbyShown = false;
      const newRound = !previous || previous.phase === 'lobby' || previous.round !== room.round;
      if (newRound) this.ui.closeModal();
      this.ui.game.applyRoom(room);
      $('#radio').hidden = false;
      this.renderChat();
      const status = document.querySelector('#coop-status');
      if (status) status.textContent = `${room.code} · ${room.players.filter(p => p.alive).length}/${room.players.length} В СЕТИ · ${this.client.latency} MS`;
      if (newRound) void this.ui.game.capturePointer();
      if ((previous?.phase !== room.phase || previous?.hostId !== room.hostId) && ['dead', 'won'].includes(this.ui.game.state)) this.ui.refreshEnd(this.ui.game.state);
    }
  }

  renderLobby() {
    const room = this.room;
    if (!room) return;
    this.lobbyShown = true;
    $('#radio').hidden = true;
    this.roster = '';
    const ui = this.ui;
    ui.screen.innerHTML = `<section class="lobby-screen" aria-label="Лобби экспедиции">
      <header class="lobby-header"><div class="brand">${ui.icon('logo', 'brand-symbol')}<span class="brand-text"><strong>NOCLIP</strong><small>MIMIC PROTOCOL / CO-OP</small></span></div><button class="text-button" id="lobby-leave">${ui.icon('close')}ПОКИНУТЬ КОМНАТУ</button></header>
      <div class="lobby-layout"><div class="lobby-narrative"><div class="eyebrow">СОВМЕСТНАЯ ЭКСПЕДИЦИЯ / УРОВЕНЬ 0</div><h1>НЕ ВСЕМ<br> МОЖНО<br><span>ДОВЕРЯТЬ.</span></h1><p>Четыре места. Один выход.<br>Убедитесь, что за вами идут ваши.</p><div class="lobby-warning">${ui.icon('warning')}<span>Mimic слышит вашу рацию.<br>И учится быть одним из вас.</span></div><div class="lobby-chat"><div class="section-caption">${ui.icon('sound')}ТЕКСТОВАЯ РАЦИЯ</div><div id="lobby-chat-lines" role="log" aria-live="polite"></div><form id="lobby-chat-form"><input id="lobby-chat-input" maxlength="160" aria-label="Сообщение команде" placeholder="Связь с командой…" autocomplete="off"/><button aria-label="Отправить сообщение">${ui.icon('arrow')}</button></form></div></div>
      <div class="lobby-panel"><div class="section-caption"><span class="room-live-dot"></span>ЗАЩИЩЁННЫЙ КАНАЛ НЕ ГАРАНТИРОВАН</div><div class="invite-block"><div><small>КОД КОМНАТЫ</small><strong id="lobby-code">${room.code}</strong></div><button class="copy-button" id="copy-code" aria-label="Скопировать код комнаты">${ui.icon('copy')}</button></div><div class="server-address"><span>СЕРВЕР</span><code id="lobby-server"></code><button class="copy-button" id="copy-server" aria-label="Скопировать адрес сервера">${ui.icon('copy')}</button></div><p class="lan-help" id="lan-help">Передайте команде адрес сервера и код комнаты.</p><div class="roster-header"><span>УЧАСТНИКИ</span><span id="lobby-count">1 / 4</span></div><div id="lobby-roster"></div><p id="lobby-status" role="status"></p><button class="primary-button" id="lobby-start"><span>НАЧАТЬ ЭКСПЕДИЦИЮ</span>${ui.icon('arrow')}</button><p class="lobby-ready-hint" id="lobby-ready-hint"></p></div></div><footer class="lobby-footer"><span>СЕРВЕР СИНХРОНИЗИРУЕТ МИР · ПАУЗА НЕ ОСТАНАВЛИВАЕТ СЕАНС</span><span>MIMIC PROTOCOL / ${APP_VERSION}</span></footer></section>`;
    $('#lobby-leave').addEventListener('click', () => this.leave());
    $('#copy-code').addEventListener('click', () => { void this.copy(room.code); });
    $('#copy-server').addEventListener('click', () => { void this.copy(this.displayAddress()); });
    $('#lobby-start').addEventListener('click', () => {
      if (!this.room) return;
      const own = this.room.players.find(p => p.id === this.client.id);
      this.client.send(this.room.hostId === this.client.id ? { t: 'start' } : { t: 'ready', ready: !own?.ready });
    });
    $('#lobby-chat-form').addEventListener('submit', event => {
      event.preventDefault();
      const input = document.querySelector<HTMLInputElement>('#lobby-chat-input')!;
      if (input.value.trim()) this.client.send({ t: 'say', text: input.value });
      input.value = '';
    });
    void desktopInfo().then(info => {
      this.localAddresses = info?.addresses ?? [];
      if (this.lobbyShown) this.updateAddress();
    });
    this.updateLobby(); this.renderChat();
  }

  private displayAddress() {
    if (!this.address && this.localAddresses.length) return this.localAddresses[0];
    try { const url = serverURL(this.address); url.protocol = url.protocol === 'wss:' ? 'https:' : 'http:'; url.pathname = ''; return url.origin; }
    catch { return location.origin; }
  }

  private updateAddress() {
    if (!this.lobbyShown) return;
    $('#lobby-server').textContent = this.displayAddress();
    const local = this.localAddresses.length && !this.address;
    $('#lan-help').textContent = local ? 'Адрес для вашей локальной сети. В Windows разрешите входящие соединения только для частной сети. Для интернета нужен доступный внешний сервер.' : 'Передайте команде этот адрес и код. Все участники должны использовать один сервер.';
  }

  private updateLobby() {
    const room = this.room;
    if (!room || !this.lobbyShown) return;
    const markup = Array.from({ length: 4 }, (_, i) => {
      const player = room.players[i];
      return player ? `<div class="roster-player"><span class="player-number">0${i + 1}</span><i class="player-color skin-${player.skin}"></i><div class="player-identity"><strong>${escapeHTML(player.name)}${player.id === this.client.id ? ' <small>ВЫ</small>' : ''}</strong><span>${player.id === room.hostId ? 'ВЕДУЩИЙ ЭКСПЕДИЦИИ' : 'РАДИОКАНАЛ ПОДКЛЮЧЁН'}</span></div><span class="ready-tag ${player.ready ? 'is-ready' : ''}">${player.ready ? 'ГОТОВ' : 'ОЖИДАНИЕ'}</span></div>` : `<div class="roster-player empty"><span class="player-number">0${i + 1}</span><span class="empty-slot">ОЖИДАНИЕ СИГНАЛА…</span><span class="empty-cross">+</span></div>`;
    }).join('');
    if (markup !== this.roster) { $('#lobby-roster').innerHTML = markup; this.roster = markup; }
    $('#lobby-count').textContent = `${room.players.length} / 4`;
    const host = room.hostId === this.client.id;
    const own = room.players.find(p => p.id === this.client.id);
    const ready = room.players.every(p => p.ready);
    const button = document.querySelector<HTMLButtonElement>('#lobby-start')!;
    button.disabled = host && !ready;
    button.querySelector('span')!.textContent = host ? 'НАЧАТЬ ЭКСПЕДИЦИЮ' : own?.ready ? 'ОТМЕНИТЬ ГОТОВНОСТЬ' : 'Я ГОТОВ';
    $('#lobby-ready-hint').textContent = host ? ready ? 'Все на связи. Можно начинать.' : 'Дождитесь готовности всей команды.' : own?.ready ? 'Ожидание начала экспедиции ведущим…' : 'Подтвердите готовность, когда будете на связи.';
    this.updateAddress();
  }

  onGameState(state: GameState) {
    const radio = document.querySelector<HTMLElement>('#radio');
    if (!radio) return;
    radio.hidden = !this.room || this.room.phase === 'lobby' || state === 'menu';
    if (state !== 'playing' && this.radioOpen) {
      this.radioOpen = false;
      this.ui.game.chatFocused = false;
      $('#radio-composer').hidden = true; $('#radio-help').hidden = true;
      radio.classList.remove('is-open');
    }
  }

  toggleRadio(open = !this.radioOpen) {
    if (!this.room || this.room.phase === 'lobby') return;
    this.radioOpen = open;
    $('#radio').classList.toggle('is-open', open);
    $('#radio-composer').hidden = !open; $('#radio-help').hidden = !open;
    this.ui.game.setChatFocus(open);
    if (open) document.querySelector<HTMLInputElement>('#radio-input')!.focus();
    else document.querySelector<HTMLInputElement>('#radio-input')!.blur();
  }

  private sendRadio() {
    const input = document.querySelector<HTMLInputElement>('#radio-input')!;
    if (input.value.trim()) this.client.send({ t: 'say', text: input.value });
    input.value = '';
    this.toggleRadio(false);
  }

  private renderChat() {
    const markup = (lines: ChatLine[]) => lines.map(line => `<div class="chat-line ${line.system ? 'system' : ''}"><span>${escapeHTML(line.name)}</span><p>${escapeHTML(line.text)}</p></div>`).join('');
    const lobby = document.querySelector('#lobby-chat-lines');
    if (lobby) { lobby.innerHTML = markup(this.lines.slice(-12)); lobby.scrollTop = lobby.scrollHeight; }
    $('#radio-lines').innerHTML = markup(this.lines.slice(-4));
    $('#radio-lines').scrollTop = $('#radio-lines').scrollHeight;
  }

  async copy(text: string) {
    try {
      if (navigator.clipboard) await navigator.clipboard.writeText(text);
      else {
        const input = document.createElement('textarea'); input.value = text; input.style.position = 'fixed'; input.style.opacity = '0'; document.body.appendChild(input); input.select();
        const copied = document.execCommand('copy'); input.remove(); if (!copied) throw new Error('Clipboard denied');
      }
      this.ui.notify(text, 'СКОПИРОВАНО');
    } catch { this.ui.notify(text, 'СКОПИРУЙТЕ АДРЕС ИЛИ КОД ВРУЧНУЮ'); }
  }

  returnToLobby() { this.client.send({ t: 'lobby' }); }

  leave(showMenu = true) {
    this.client.disconnect(); this.room = null; this.lines = []; this.lobbyShown = false; this.radioOpen = false;
    this.ui.game.leaveCoop();
    $('#radio').hidden = true; $('#radio-composer').hidden = true; $('#radio-help').hidden = true;
    $('#radio').classList.remove('is-open');
    if (showMenu) this.ui.game.menu();
  }
}
