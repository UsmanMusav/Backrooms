import { version as APP_VERSION } from '../package.json';
import './style.css';
import './coop.css';
import './refinement.css';
import { loadExplorerAssets } from './avatar';
import { CoopUI } from './coop-ui';
import './native';
import { BackroomsGame, MIN_ZOOM, MAX_ZOOM } from './game';
import type { GameState, Snapshot } from './game';
import type { IntroFrame } from './intro';
import { DEFAULT_SETTINGS, loadSettings, saveSettings } from './settings';

const paths: Record<string, string> = {
  logo: '<path d="M4 4h16v5H9v15H4zM16 13h10v15H15v-5h6v-5h-5z"/><path d="M4 28h5M26 4v4"/>',
  arrow: '<path d="M4 12h15M13 5l7 7-7 7"/>',
  play: '<path d="m7 3 14 9-14 9z"/>',
  sound: '<path d="m11 5-6 4H2v6h3l6 4zM15 8a6 6 0 0 1 0 8M18 5a10 10 0 0 1 0 14"/>',
  mute: '<path d="m11 5-6 4H2v6h3l6 4zM16 9l6 6m0-6-6 6"/>',
  sliders: '<path d="M5 3v7m0 4v7M12 3v12m0 4v2M19 3v2m0 4v12M2 10h6m1 5h6m1-10h6"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 8.5a2.5 2.5 0 1 1 3.6 2.3c-1.1.5-1.1 1.2-1.1 2.2M12 16v1"/>',
  headphones: '<path d="M3 13v-2a9 9 0 0 1 18 0v2M3 12h4v8H4a1 1 0 0 1-1-1zm18 0h-4v8h3a1 1 0 0 0 1-1z"/>',
  mouse: '<rect x="6" y="2" width="12" height="20" rx="6"/><path d="M12 3v6M6 10h12"/>',
  warning: '<path d="m12 3 10 18H2zM12 9v5m0 3v1"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  pause: '<path d="M8 4v16M16 4v16"/>',
  fuse: '<path d="M8 5h8v14H8zM10 2h4v3m-4 14v3h4v-3M12 8v3l-2 2h4l-2 2v1"/>',
  flashlight: '<path d="M8 13h8v8H8zM5 3h14v5l-3 5H8L5 8zM5 7h14M10 17h4"/>',
  run: '<circle cx="15" cy="4" r="2"/><path d="m12 8 4 4h5M5 9l5-2 3 6-5 3-4 6m9-9 3 4v5M7 5H3M5 14H1"/>',
  hand: '<path d="M8 13V6a1.5 1.5 0 0 1 3 0v5-7a1.5 1.5 0 0 1 3 0v7-5a1.5 1.5 0 0 1 3 0v7-3a1.5 1.5 0 0 1 3 0v6c0 4-3 6-6 6h-1c-2 0-3-1-5-3l-4-5a1.5 1.5 0 0 1 2-2l2 2"/>',
  door: '<path d="M4 22V2h12v20M2 22h20M16 4h4v18M12 12v2"/>',
  people: '<circle cx="9" cy="7" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3M16 4a3 3 0 0 1 0 6M18 13a5 5 0 0 1 3 5v3"/>',
  copy: '<rect x="8" y="8" width="12" height="13"/><path d="M16 8V3H3v13h5"/>',
  check: '<path d="m5 12 4 4L20 5"/>',
};
function icon(name: string, className = '') {
  return `<svg class="icon ${className}" viewBox="0 0 ${name === 'logo' ? '32 32' : '24 24'}" aria-hidden="true">${paths[name] || paths.help}</svg>`;
}
const app = document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML = `
  <main id="world" aria-label="Backrooms: Потерянный сигнал"></main>
  <div id="screen"></div>
  <section id="hud" aria-label="Интерфейс игры" hidden>
    <div id="danger-vignette"></div>
    <div class="hud-objective">
      <div class="objective-mark">${icon('fuse')}</div>
      <div class="objective-copy"><small>УРОВЕНЬ 0 / ТЕКУЩАЯ ЦЕЛЬ</small><h2 id="objective-title">Найдите предохранители</h2>
        <div class="objective-progress"><i class="fuse-progress"></i><i class="fuse-progress"></i><i class="fuse-progress"></i><span class="progress-count">0 / 3</span></div>
      </div>
    </div>
    <div class="hud-record"><div class="hud-record-top"><span class="record-dot"></span>REC <span id="game-time">00:00:00</span></div><small>CAM 01 · SIGNAL UNSTABLE</small><small class="coop-status" id="coop-status"></small></div>
    <button class="pause-button" id="pause-button" aria-label="Пауза">${icon('pause')}</button>
    <div class="camcorder" id="camcorder" aria-hidden="true">
      <i class="cam-corner tl"></i><i class="cam-corner tr"></i><i class="cam-corner bl"></i><i class="cam-corner br"></i>
      <div class="cam-meta"><span class="cam-mode">▶ SP</span><span class="cam-battery" id="cam-battery"><i></i><i></i><i></i><i></i></span></div>
      <div class="cam-zoom" id="cam-zoom"><span>W</span><div class="cam-zoom-track"><i id="cam-zoom-fill"></i></div><span>T</span><b id="cam-zoom-value">1.0×</b></div>
      <div class="cam-stamp"><span>НОЯ.16 1998</span><span id="cam-clock">AM 3:14:00</span></div>
    </div>
    <div class="crosshair" id="crosshair"></div>
    <div id="interaction" hidden><small id="interaction-label"></small><div class="interaction-action"><kbd>E</kbd><span id="interaction-action"></span></div></div>
    <div id="waypoint" hidden><div class="waypoint-diamond"></div><small id="waypoint-distance"></small><span class="waypoint-direction"></span></div>
    <div class="stamina" id="stamina"><div class="stamina-label"><span>ВЫНОСЛИВОСТЬ</span><span>SHIFT</span></div><div class="stamina-track"><div class="stamina-fill" id="stamina-fill"></div></div></div>
    <div class="hud-bottom"><div class="hud-shortcuts"><span><kbd>W A S D</kbd> ДВИЖЕНИЕ</span><span><kbd>F</kbd> ФОНАРЬ</span><span><kbd>H</kbd> ОРИЕНТИР</span><span><kbd>C</kbd>+<kbd>КОЛЕСО</kbd> ЗУМ</span><span><kbd>ESC</kbd> ПАУЗА</span></div><div class="flashlight-status">${icon('flashlight')}<span id="flashlight-text">ФОНАРЬ ВКЛ.</span></div></div>
  </section>
  <div id="touch-controls" hidden>
    <div id="look-zone" aria-label="Проведите пальцем для осмотра"></div>
    <div id="joystick" role="group" aria-label="Джойстик перемещения"><div class="joystick-ring"></div><div id="joystick-thumb"></div></div>
    <div class="touch-actions"><button class="touch-button" id="touch-sprint" aria-label="Бег">${icon('run')}</button><button class="touch-button" id="touch-light" aria-label="Фонарик">${icon('flashlight')}</button><button class="touch-button zoom-button" id="touch-zoom" aria-label="Зум камеры" aria-pressed="false">1×</button><button class="touch-button interact-button" id="touch-interact" aria-label="Взаимодействовать">${icon('hand')}</button></div>
    <button class="touch-hint" id="touch-hint" aria-label="Показать ориентир">H</button>
  </div>
  <section id="intro-overlay" class="intro-overlay" aria-label="Вступительная запись" hidden>
    <div class="intro-card" id="intro-card"><small>NOCLIP ARCHIVE · КАССЕТА 001</small><p>Кассета обнаружена в 1998 году на газоне жилого дома, в трёх километрах от места съёмки.</p><p>Изображение и звук восстановлены. Монтаж не производился.</p></div>
    <div class="intro-play" id="intro-play"><b>PLAY ▶</b><span>SP</span></div>
    <div class="intro-viewfinder" id="intro-viewfinder"><span class="intro-rec"><i></i>REC</span><span class="intro-sp">SP</span>
      <div class="intro-stamp"><span id="intro-date">ИЮЛ. 4 1991</span><span id="intro-clock">PM 6:47:12</span></div></div>
    <p class="intro-subtitle" id="intro-subtitle" aria-live="polite"></p>
    <p class="intro-prompt" id="intro-prompt"></p>
    <button class="intro-back" id="intro-back" hidden>НАЗАД</button>
    <button class="intro-skip" id="intro-skip">ПРОПУСТИТЬ <kbd>ПРОБЕЛ</kbd></button>
  </section>
  <div id="notification" role="status" aria-live="polite"><div class="notification-inner"><small id="notification-title"></small><p id="notification-text"></p></div></div>
  <dialog class="dialog" id="dialog" aria-labelledby="dialog-title"></dialog>
  <div id="boot"><div class="boot-content">${icon('logo')}<p>ВОССТАНОВЛЕНИЕ ЗАПИСИ</p><div class="boot-track"></div><small>NOCLIP ARCHIVE / TAPE 001</small></div></div>
`;

const $ = (selector: string) => document.querySelector<HTMLElement>(selector)!;
const screen = $('#screen');
const hud = $('#hud');
const touchControls = $('#touch-controls');
const dialog = document.querySelector<HTMLDialogElement>('#dialog')!;
let settings = loadSettings();
if (matchMedia('(prefers-reduced-motion: reduce)').matches) settings.headBob = false;
document.body.classList.toggle('camcorder-off', !settings.camcorder);
let game: BackroomsGame;
let coopUI: CoopUI;
let toastTimeout = 0;
let introTimeout = 0;

function formatTime(seconds: number) {
  const s = Math.floor(seconds);
  return `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

function menuMarkup() {
  return `<section class="menu menu-clean" aria-label="Главное меню">
    <header class="clean-header"><span>ПОТЕРЯННЫЙ СИГНАЛ</span><button class="sound-button ${settings.muted ? 'is-muted' : ''}" id="sound-button" aria-label="${settings.muted ? 'Включить' : 'Выключить'} звук">${icon(settings.muted ? 'mute' : 'sound')}<span>ЗВУК ${settings.muted ? 'ВЫКЛ.' : 'ВКЛ.'}</span></button></header>
    <div class="clean-content"><p class="clean-kicker">MIMIC</p><h1 class="clean-title">BACKROOMS</h1><p class="clean-description">Не каждый, кто идёт рядом, — человек.</p>
      <nav class="clean-actions" aria-label="Режим игры"><button class="primary-button" id="start-button"><span>ВОЙТИ В ЗАКУЛИСЬЕ</span>${icon('arrow')}</button><button class="clean-coop" id="coop-button"><span>КООПЕРАТИВ</span><small>1–4 игрока</small></button></nav>
      <div class="clean-secondary"><button id="settings-button">НАСТРОЙКИ</button><button id="controls-button">КАК ИГРАТЬ</button></div>
    </div>
    <footer class="clean-footer"><span>${icon('headphones')}Лучше в наушниках</span><small>v${APP_VERSION} · Содержит мерцание</small></footer>
  </section>`;
}

function renderMenu() {
  screen.innerHTML = menuMarkup();
  $('#start-button').addEventListener('click', beginGame);
  $('#coop-button').addEventListener('click', () => coopUI.showConnect());
  $('#settings-button').addEventListener('click', showSettings);
  $('#controls-button').addEventListener('click', showControls);
  $('#sound-button').addEventListener('click', toggleSound);
}

function beginGame() {
  if (coopUI?.room) coopUI.leave(false);
  else game.leaveCoop();
  closeModal();
  game.audio.click();
  if (settings.intro) { game.playIntro(); void game.capturePointer(); return; }
  game.start();
  void game.capturePointer();
  showChapter();
}

function showChapter(afterTape = false) {
  document.querySelector('.chapter-intro')?.remove();
  const intro = document.createElement('div');
  intro.className = afterTape ? 'chapter-intro after-tape' : 'chapter-intro';
  intro.innerHTML = '<small>NOCLIP ARCHIVE / ЗАПИСЬ 001</small><strong>УРОВЕНЬ 0</strong><span>Бесконечные офисы</span>';
  app.appendChild(intro);
  clearTimeout(introTimeout);
  introTimeout = window.setTimeout(() => intro.remove(), 3100);
}

let previousState: GameState = 'menu';
function onState(state: GameState) {
  document.body.dataset.state = state;
  const overlay = $('#intro-overlay');
  overlay.hidden = state !== 'intro';
  if (state === 'intro') { lastIntro = ''; $('#intro-back').hidden = !game?.isTouch; }
  if (previousState === 'intro' && state === 'playing') showChapter(true);
  previousState = state;
  hud.hidden = state !== 'playing';
  hud.dispatchEvent(new Event('zoomreset'));
  touchControls.hidden = state !== 'playing' || !game?.isTouch;
  $('#notification').classList.remove('visible');
  if (dialog.open) closeModal();
  coopUI?.onGameState(state);
  if (state === 'menu') renderMenu();
  else if (state === 'playing' || state === 'intro') screen.innerHTML = '';
  else renderState(state);
}

function renderState(state: GameState) {
  const paused = state === 'paused';
  const won = state === 'won';
  const network = game.coop && !!coopUI?.room;
  const roundOver = network && ['won', 'lost'].includes(coopUI.room!.phase);
  const host = network && coopUI.room!.hostId === coopUI.client.id;
  screen.innerHTML = `<section class="state-screen ${state}" aria-label="${paused ? 'Пауза' : won ? 'Вы вышли' : 'Игра окончена'}">
    <div class="state-content">
      <div class="eyebrow">${paused ? 'CAM 01 / РЕЖИМ ОЖИДАНИЯ' : won ? 'ЗАПИСЬ УСПЕШНО ВОССТАНОВЛЕНА' : 'CAM 01 / СИГНАЛ ПОТЕРЯН'}</div>
      <h1 class="state-title">${paused ? 'ЗАПИСЬ<br>ПРИОСТАНОВЛЕНА' : won ? 'ВЫХОД<br>СУЩЕСТВУЕТ' : 'ЗАПИСЬ<br>ОБОРВАНА'}</h1>
      <p class="state-description">${paused ? (network ? 'Сеанс продолжается. Пауза не останавливает сервер.<br>Не задерживайтесь — Mimic не ждёт.' : 'Здесь время ничего не значит.<br>Переведите дыхание.') : won ? 'Вы выбрались. Но гул ламп<br>почему-то всё ещё с вами.' : (network && !roundOver ? 'Ваш биосигнал потерян. Напарники ещё идут.<br>Рация остаётся на связи.' : 'Вы слышали шаги слишком поздно.<br>В следующий раз — тише.')}</p>
      ${!paused ? `<div class="state-stats"><div><strong>${formatTime(game.elapsed)}</strong><small>ВРЕМЯ В ЗАКУЛИСЬЕ</small></div><div><strong>${game.fuses} / 3</strong><small>ПРЕДОХРАНИТЕЛИ</small></div></div>` : ''}
      <div class="state-buttons"><button class="primary-button" id="resume-or-retry"><span>${paused ? 'ПРОДОЛЖИТЬ ЗАПИСЬ' : network ? roundOver && host ? 'ВЕРНУТЬ КОМАНДУ В ЛОББИ' : 'ОТКРЫТЬ РАЦИЮ' : 'ПОПРОБОВАТЬ СНОВА'}</span>${icon('arrow')}</button>${paused ? '<button class="outline-button" id="pause-settings">НАСТРОЙКИ</button>' : ''}<button class="outline-button" id="return-menu">В ГЛАВНОЕ МЕНЮ</button></div>
      <div class="state-footer">${paused ? 'WASD — ИДТИ &nbsp; / &nbsp; SHIFT — БЕЖАТЬ &nbsp; / &nbsp; H — ОРИЕНТИР' : 'NOCLIP ARCHIVE · TAPE 001'}</div>
    </div>
  </section>`;
  $('#resume-or-retry').addEventListener('click', () => { if (paused) { game.audio.click(); game.resume(); } else if (network) { if (roundOver && host) coopUI.returnToLobby(); else coopUI.toggleRadio(true); } else beginGame(); });
  if (paused) $('#pause-settings').addEventListener('click', showSettings);
  $('#return-menu').addEventListener('click', () => {
    game.audio.click();
    if (paused) showExitConfirmation();
    else if (network) coopUI.leave();
    else game.menu();
  });
}

function onUpdate(snapshot: Snapshot) {
  $('#game-time').textContent = formatTime(snapshot.elapsed);
  const clock = 3 * 3600 + 14 * 60 + Math.floor(snapshot.elapsed);
  $('#cam-clock').textContent = `AM ${Math.floor(clock / 3600) % 12 || 12}:${String(Math.floor(clock / 60) % 60).padStart(2, '0')}:${String(clock % 60).padStart(2, '0')}`;
  // Tape battery drains one bar every four minutes, purely as a diegetic clock.
  const bars = Math.max(1, 4 - Math.floor(snapshot.elapsed / 240));
  document.querySelectorAll('#cam-battery i').forEach((bar, index) => bar.classList.toggle('empty', index >= bars));
  const zoomRatio = (snapshot.zoom - MIN_ZOOM) / (MAX_ZOOM - MIN_ZOOM);
  $('#cam-zoom').classList.toggle('active', snapshot.zooming || snapshot.zoom > 1.03);
  $('#cam-zoom-fill').style.transform = `scaleX(${Math.max(0, Math.min(1, zoomRatio))})`;
  $('#cam-zoom-value').textContent = `${snapshot.zoom.toFixed(1)}×`;
  $('#objective-title').textContent = snapshot.powered ? 'Откройте дверь у входа' : snapshot.fuses === 3 ? 'Восстановите питание у входа' : 'Найдите предохранители';
  $('.progress-count').textContent = `${snapshot.fuses} / 3`;
  document.querySelectorAll('.fuse-progress').forEach((element, index) => element.classList.toggle('filled', index < snapshot.fuses));
  const stamina = $('#stamina');
  stamina.classList.toggle('visible', snapshot.stamina < 0.99);
  stamina.classList.toggle('low', snapshot.stamina < 0.25);
  $('#stamina-fill').style.transform = `scaleX(${snapshot.stamina})`;
  $('#flashlight-text').textContent = `ФОНАРЬ ${snapshot.flashlight ? 'ВКЛ.' : 'ВЫКЛ.'}`;
  $('#danger-vignette').style.opacity = `${snapshot.danger * 0.7}`;
  $('#interaction').hidden = !snapshot.interaction;
  $('#crosshair').classList.toggle('interactive', !!snapshot.interaction);
  if (snapshot.interaction) {
    $('#interaction-label').textContent = snapshot.interaction.label;
    $('#interaction-action').textContent = snapshot.interaction.action;
  }
  $('#touch-interact').classList.toggle('active', !!snapshot.interaction);
  const waypoint = $('#waypoint');
  waypoint.hidden = !snapshot.hint;
  if (snapshot.hint) {
    waypoint.style.left = `${snapshot.hint.x * 100}%`;
    waypoint.style.top = `${snapshot.hint.y * 100}%`;
    $('#waypoint-distance').textContent = `${snapshot.hint.distance} м`;
    $('.waypoint-direction').textContent = snapshot.hint.behind ? 'ПОЗАДИ ВАС' : 'СЛАБЫЙ СИГНАЛ';
  }
}

let lastIntro = '';
const SCRAMBLE = '0123456789:.-/#?';
function scramble(text: string) { return [...text].map(c => c === ' ' ? ' ' : Math.random() < .55 ? SCRAMBLE[Math.floor(Math.random() * SCRAMBLE.length)] : c).join(''); }
/** Mirror the prologue timeline into the DOM viewfinder, subtitles and prompts. */
function onIntro(frame: IntroFrame) {
  const overlay = $('#intro-overlay');
  overlay.dataset.phase = frame.phase;
  $('#intro-date').textContent = frame.scramble ? scramble(frame.stamp) : frame.stamp;
  $('#intro-clock').textContent = frame.scramble ? scramble(frame.clock) : frame.clock;
  const key = `${frame.subtitle?.text ?? ''}|${frame.prompt ?? ''}`;
  if (key === lastIntro) return;
  lastIntro = key;
  const subtitle = $('#intro-subtitle');
  subtitle.innerHTML = frame.subtitle ? `<b>${frame.subtitle.speaker}:</b> ${frame.subtitle.text}` : '';
  subtitle.classList.toggle('visible', !!frame.subtitle);
  $('#intro-prompt').textContent = frame.prompt ?? '';
  $('#intro-prompt').classList.toggle('visible', !!frame.prompt);
}

function notify(text: string, title = 'ЗАПИСЬ 001') {
  clearTimeout(toastTimeout);
  $('#notification-title').textContent = title;
  $('#notification-text').textContent = text;
  $('#notification').classList.add('visible');
  toastTimeout = window.setTimeout(() => $('#notification').classList.remove('visible'), title.startsWith('ЗАПИСЬ 0') ? 11000 : 6500);
}

function openModal(title: string, content: string, overline = 'NOCLIP / ПАРАМЕТРЫ ЗАПИСИ') {
  game.audio.click(); game.setMenuAnimation(false);
  dialog.innerHTML = `<div class="dialog-inner"><div class="dialog-header"><div><div class="dialog-overline">${overline}</div><h2 class="dialog-title" id="dialog-title">${title}</h2></div><button class="dialog-close" id="dialog-close" aria-label="Закрыть">${icon('close')}</button></div>${content}</div>`;
  $('#dialog-close').addEventListener('click', closeModal);
  if (!dialog.open) dialog.showModal();
}
function closeModal() { if (dialog.open) dialog.close(); if (game?.state === 'menu' && !coopUI?.room) game.setMenuAnimation(true); }
dialog.addEventListener('close', () => { if (game?.state === 'menu' && !coopUI?.room) game.setMenuAnimation(true); });
dialog.addEventListener('click', event => {
  const rect = dialog.getBoundingClientRect();
  if (event.target === dialog && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)) closeModal();
});

function updateSettings() {
  document.body.classList.toggle('camcorder-off', !settings.camcorder);
  saveSettings(settings);
  game.applySettings(settings);
  updateSoundButton();
}
function updateSoundButton() {
  const button = document.querySelector<HTMLButtonElement>('#sound-button');
  if (!button) return;
  button.innerHTML = `${icon(settings.muted ? 'mute' : 'sound')}<span>ЗВУК ${settings.muted ? 'ВЫКЛ.' : 'ВКЛ.'}</span><i class="sound-status"></i>`;
  button.classList.toggle('is-muted', settings.muted);
  button.setAttribute('aria-label', `${settings.muted ? 'Включить' : 'Выключить'} звук`);
}
function toggleSound() {
  settings.muted = !settings.muted;
  updateSettings();
  void game.audio.unlock().then(() => {
    if (game.state === 'menu') game.audio.setActive(!settings.muted);
    game.audio.click();
  });
}

function showSettings() {
  openModal('НАСТРОЙКИ', `
    <div class="settings-row"><label class="setting-label" for="volume-input"><span>Громкость звука</span><output class="setting-value" id="volume-output">${Math.round(settings.volume * 100)}%</output></label><input class="range-input" id="volume-input" type="range" min="0" max="100" value="${settings.volume * 100}"/><p>Шаги, гул электричества и то, что за стеной.</p></div>
    <div class="settings-row"><label class="setting-label" for="sensitivity-input"><span>Чувствительность мыши</span><output class="setting-value" id="sensitivity-output">${Math.round(settings.sensitivity * 100)}%</output></label><input class="range-input" id="sensitivity-input" type="range" min="10" max="100" value="${settings.sensitivity * 100}"/></div>
    <div class="settings-row"><div class="setting-label">Качество изображения</div><div class="quality-options" role="group" aria-label="Качество изображения">${[['low', 'НИЗКОЕ'], ['medium', 'СРЕДНЕЕ'], ['high', 'ВЫСОКОЕ']].map(([value, label]) => `<button class="quality-option ${settings.quality === value ? 'active' : ''}" data-quality="${value}" aria-pressed="${settings.quality === value}">${label}</button>`).join('')}</div></div>
    <div class="settings-row toggle-row"><div><span class="toggle-title">Плёночное зерно</span><p>Аналоговый шум в духе хорроров эпохи PS3.</p></div><label class="toggle"><input type="checkbox" id="grain-input" aria-label="Плёночное зерно" ${settings.grain ? 'checked' : ''}/><span class="toggle-track"></span></label></div>
    <div class="settings-row toggle-row"><div><span class="toggle-title">Эффект видеокамеры</span><p>Плёнка VHS, видоискатель, дата записи и дрожание трекинга.</p></div><label class="toggle"><input type="checkbox" id="camcorder-input" aria-label="Эффект видеокамеры" ${settings.camcorder ? 'checked' : ''}/><span class="toggle-track"></span></label></div>
    <div class="settings-row toggle-row"><div><span class="toggle-title">Вступительная запись</span><p>Кассета со съёмок на улице перед одиночной игрой. Пропуск — пробел.</p></div><label class="toggle"><input type="checkbox" id="intro-input" aria-label="Вступительная запись" ${settings.intro ? 'checked' : ''}/><span class="toggle-track"></span></label></div>
    <div class="settings-row toggle-row"><div><span class="toggle-title">Покачивание камеры</span><p>Плавный шаг, наклон и инерция рук. Отключите при дискомфорте.</p></div><label class="toggle"><input type="checkbox" id="bob-input" aria-label="Покачивание камеры" ${settings.headBob ? 'checked' : ''}/><span class="toggle-track"></span></label></div>
    <div class="dialog-footer"><button class="reset-settings" id="reset-settings">Сбросить настройки</button><button class="primary-button" id="settings-done"><span>ГОТОВО</span>${icon('check')}</button></div>
  `);
  $('#volume-input').addEventListener('input', event => {
    settings.volume = Number((event.target as HTMLInputElement).value) / 100;
    settings.muted = settings.volume === 0;
    $('#volume-output').textContent = `${Math.round(settings.volume * 100)}%`;
    updateSettings();
    void game.audio.unlock().then(() => { if (game.state === 'menu') game.audio.setActive(true); });
  });
  $('#sensitivity-input').addEventListener('input', event => {
    settings.sensitivity = Number((event.target as HTMLInputElement).value) / 100;
    $('#sensitivity-output').textContent = `${Math.round(settings.sensitivity * 100)}%`;
    updateSettings();
  });
  document.querySelectorAll<HTMLButtonElement>('[data-quality]').forEach(button => button.addEventListener('click', () => {
    settings.quality = button.dataset.quality as typeof settings.quality;
    document.querySelectorAll<HTMLButtonElement>('[data-quality]').forEach(option => {
      const active = option.dataset.quality === settings.quality;
      option.classList.toggle('active', active);
      option.setAttribute('aria-pressed', String(active));
    });
    game.audio.click();
    updateSettings();
  }));
  $('#grain-input').addEventListener('change', event => { settings.grain = (event.target as HTMLInputElement).checked; updateSettings(); });
  $('#bob-input').addEventListener('change', event => { settings.headBob = (event.target as HTMLInputElement).checked; updateSettings(); });
  $('#intro-input').addEventListener('change', event => { settings.intro = (event.target as HTMLInputElement).checked; updateSettings(); });
  $('#camcorder-input').addEventListener('change', event => { settings.camcorder = (event.target as HTMLInputElement).checked; updateSettings(); });
  $('#settings-done').addEventListener('click', () => { game.audio.click(); closeModal(); });
  $('#reset-settings').addEventListener('click', () => { settings = { ...DEFAULT_SETTINGS }; updateSettings(); showSettings(); });
}

function showControls() {
  const mobile = game.isTouch;
  openModal('КАК ИГРАТЬ', `
    <p class="controls-intro">Одни и те же комнаты. Один и тот же гул.<br>Найдите <strong>3 предохранителя</strong>, вернитесь к щитку у входа и откройте дверь рядом с ним.</p>
    <div class="control-row"><span>Перемещение</span><span class="key-group">${mobile ? 'Левый джойстик' : '<kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd>'}</span></div>
    <div class="control-row"><span>Осмотр</span><span class="key-group">${mobile ? 'Проведите справа' : `${icon('mouse')}<span>Мышь</span>`}</span></div>
    <div class="control-row"><span>Бег / выносливость</span><span class="key-group">${mobile ? icon('run') : '<kbd>SHIFT</kbd>'}</span></div>
    <div class="control-row"><span>Забрать / взаимодействовать</span><span class="key-group">${mobile ? icon('hand') : '<kbd>E</kbd>'}</span></div>
    <div class="control-row"><span>Включить / выключить фонарь</span><span class="key-group">${mobile ? icon('flashlight') : '<kbd>F</kbd>'}</span></div>
    <div class="control-row"><span>Показать ориентир на 12 секунд</span><kbd>H</kbd></div>
    <div class="control-row"><span>Пауза</span>${mobile ? icon('pause') : '<span class="key-group"><kbd>ESC</kbd><span>или</span><kbd>P</kbd></span>'}</div>
    <div class="control-row"><span>Чат экспедиции / короткий сигнал</span><span class="key-group"><kbd>ENTER</kbd><kbd>T</kbd><kbd>Q</kbd></span></div>
    <div class="control-warning">${icon('headphones')}<p>Прислушивайтесь. Бег слышно издалека. Если шаги продолжаются, когда вы остановились, — они не ваши.</p></div>
    <div class="dialog-footer"><span></span><button class="primary-button" id="controls-done"><span>ПОНЯТНО</span>${icon('arrow')}</button></div>
  `, 'NOCLIP / ПРОТОКОЛ ВЫЖИВАНИЯ');
  $('#controls-done').addEventListener('click', closeModal);
}


function showExitConfirmation() {
  openModal('ПОКИНУТЬ ЗАПИСЬ?', '<p class="confirm-message">' + (game.coop ? 'Вы отключитесь от комнаты. Оставшиеся игроки продолжат экспедицию; роль ведущего будет передана автоматически.' : 'Текущий прогресс не сохраняется. Когда вы вернётесь, лабиринт начнётся сначала.') + '</p><div class="dialog-footer"><button class="reset-settings" id="stay-button">Остаться</button><button class="primary-button" id="leave-button"><span>ВЫЙТИ В МЕНЮ</span>' + icon('arrow') + '</button></div>', 'NOCLIP / ЗАВЕРШЕНИЕ СЕАНСА');
  $('#stay-button').addEventListener('click', closeModal);
  $('#leave-button').addEventListener('click', () => { closeModal(); if (game.coop) coopUI.leave(); else game.menu(); });
}

function bindTouchControls() {
  const joystick = $('#joystick');
  const thumb = $('#joystick-thumb');
  let joystickId: number | null = null;
  function updateJoystick(event: PointerEvent) {
    const rect = joystick.getBoundingClientRect();
    let x = event.clientX - rect.left - rect.width / 2;
    let y = event.clientY - rect.top - rect.height / 2;
    const length = Math.hypot(x, y);
    if (length > 35) { x *= 35 / length; y *= 35 / length; }
    thumb.style.transform = `translate(${x}px, ${y}px)`;
    game.setVirtualMovement(x / 35, y / 35);
  }
  joystick.addEventListener('pointerdown', event => {
    event.preventDefault();
    joystickId = event.pointerId;
    joystick.setPointerCapture(event.pointerId);
    updateJoystick(event);
  });
  joystick.addEventListener('pointermove', event => { if (event.pointerId === joystickId) updateJoystick(event); });
  const releaseJoystick = () => { joystickId = null; thumb.style.transform = ''; game.setVirtualMovement(0, 0); };
  joystick.addEventListener('pointerup', releaseJoystick);
  joystick.addEventListener('pointercancel', releaseJoystick);
  const lookZone = $('#look-zone');
  let lookPointer: number | null = null;
  let lastX = 0;
  let lastY = 0;
  lookZone.addEventListener('pointerdown', event => {
    lookPointer = event.pointerId;
    lastX = event.clientX;
    lastY = event.clientY;
    lookZone.setPointerCapture(event.pointerId);
  });
  lookZone.addEventListener('pointermove', event => {
    if (event.pointerId !== lookPointer) return;
    game.look((event.clientX - lastX) * 1.8, (event.clientY - lastY) * 1.8);
    lastX = event.clientX;
    lastY = event.clientY;
  });
  lookZone.addEventListener('pointerup', () => { lookPointer = null; });
  lookZone.addEventListener('pointercancel', () => { lookPointer = null; });
  $('#touch-interact').addEventListener('click', () => game.interact());
  $('#touch-light').addEventListener('click', () => game.toggleFlashlight());
  $('#touch-hint').addEventListener('click', () => game.showHint());
  // Tap cycles the optical zoom: off → 2.5× → 5× → off.
  const zoomButton = $('#touch-zoom'), zoomSteps = [0, 2.5, 5]; let zoomStep = 0;
  zoomButton.addEventListener('click', () => {
    zoomStep = (zoomStep + 1) % zoomSteps.length;
    if (zoomSteps[zoomStep]) game.setZoomPreset(zoomSteps[zoomStep]);
    game.setTouchZoom(zoomStep > 0);
    zoomButton.textContent = zoomStep ? `${zoomSteps[zoomStep]}×` : '1×';
    zoomButton.setAttribute('aria-pressed', String(zoomStep > 0)); zoomButton.classList.toggle('active', zoomStep > 0);
  });
  hud.addEventListener('zoomreset', () => { zoomStep = 0; zoomButton.textContent = '1×'; zoomButton.setAttribute('aria-pressed', 'false'); zoomButton.classList.remove('active'); });
  const sprint = $('#touch-sprint');
  sprint.addEventListener('pointerdown', event => { sprint.setPointerCapture(event.pointerId); game.setVirtualSprint(true); sprint.classList.add('active'); });
  const releaseSprint = () => { game.setVirtualSprint(false); sprint.classList.remove('active'); };
  sprint.addEventListener('pointerup', releaseSprint);
  sprint.addEventListener('pointercancel', releaseSprint);
}

$('#pause-button').addEventListener('click', () => game.pause());
$('#intro-skip').addEventListener('click', () => game.skipIntro());
{
  const back = $('#intro-back');
  back.addEventListener('pointerdown', event => { event.preventDefault(); back.setPointerCapture(event.pointerId); game.setIntroBack(true); back.classList.add('active'); });
  const release = () => { game.setIntroBack(false); back.classList.remove('active'); };
  back.addEventListener('pointerup', release); back.addEventListener('pointercancel', release);
}
window.addEventListener('keydown', event => {
  if (event.code === 'Escape' && game?.state === 'paused' && !dialog.open) {
    // Pointer-lock Escape pauses only; resuming always requires a deliberate click.
    event.preventDefault();
  }
});

renderMenu();
async function initialize() {
let assetsReady = false;
try {
  await loadExplorerAssets(); assetsReady = true;
  game = new BackroomsGame($('#world'), settings, { onState, onUpdate, onMessage: notify, onIntro });
  coopUI = new CoopUI({ game, screen, icon, openModal, closeModal, notify, refreshEnd: renderState });
  bindTouchControls();
  window.setTimeout(() => {
    $('#boot').classList.add('finished');
    window.setTimeout(() => $('#boot')?.remove(), 900);
  }, 700);
} catch (error) {
  console.error('Unable to initialize the game:', error);
  app.innerHTML = `<div class="webgl-error"><div><div class="eyebrow">СИГНАЛ НЕ ОБНАРУЖЕН</div><h1>${assetsReady ? 'НУЖЕН WEBGL 2' : 'МОДЕЛЬ НЕ ЗАГРУЖЕНА'}</h1><p>${assetsReady ? 'Включите аппаратное ускорение или откройте игру в актуальном браузере.' : 'Не удалось прочитать локальные файлы персонажа. Перезагрузите страницу или проверьте целостность сборки.'}</p><button class="primary-button" id="reload-button">ПОПРОБОВАТЬ СНОВА ${icon('arrow')}</button></div></div>`;
  $('#reload-button').addEventListener('click', () => location.reload());
}

}
void initialize();
