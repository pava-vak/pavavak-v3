const EMOJIS = [
  // Faces & emotions
  '😀','😂','😊','😍','🥰','😘','😎','🤩','😋','😜','🤪','😏','😒','🙃','😉',
  '😢','😭','😤','😡','🤬','😱','😰','🥺','😳','🤔','🤗','🙄','😴','🤐','😷',
  '🥴','🥳','😈','👻','💀','🤖','🎃','🙈','🙉','🙊',
  // Hearts & affection
  '❤️','🧡','💛','💚','💙','💜','🖤','💔','💕','💞','💝','💘','💯','✨','🔥','💫','⭐',
  // Hands & gestures
  '👍','👎','👋','✋','🤚','👌','✌️','🤞','🤝','🙏','👏','💪','🤜','🤛','☝️',
  // People
  '😺','🐱','🐶','🐼','🦊','🐸','🐨','🐯','🦁','🐮','🐷','🐧','🦋',
  // Nature
  '🌸','🌺','🌻','🌹','🍀','🌿','🌴','🌊','🌙','☀️','🌈','❄️','⭐','🌟',
  // Food
  '🍕','🍔','🌮','🍜','🍣','🍦','🎂','🍰','☕','🍺','🥂','🍷','🎉',
  // Activities & objects
  '⚽','🏀','🎮','🎵','🎶','📸','🏆','🎯','🚀','✈️','🌍','📱','💻','🔑','💡',
  // Symbols
  '✅','❌','⚠️','❓','❗','💬','👀','🎈','🎊','🚩','🏁','♻️','🔔','📢',
];

export function createEmojiPicker(onSelect) {
  const div = document.createElement('div');
  div.className = 'emoji-picker';
  div.setAttribute('role', 'dialog');
  div.setAttribute('aria-label', 'Emoji picker');
  div.innerHTML = `<div class="emoji-grid">${
    EMOJIS.map(e => `<button class="emoji-btn" type="button" title="${e}">${e}</button>`).join('')
  }</div>`;
  div.querySelectorAll('.emoji-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      onSelect(btn.textContent);
    });
  });
  return div;
}
