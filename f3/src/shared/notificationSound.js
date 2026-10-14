let ctx = null;

function getCtx() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  return ctx;
}

// PaVa signature tone — two-note crystal chime (Pa · Va)
// 440 Hz "Pa" followed 80ms later by 660 Hz "Va"
// Pure sine + one overtone for a bell-like quality, not used by any known app
export function playMessageTone() {
  try {
    const ac = getCtx();
    if (ac.state === 'suspended') ac.resume();

    const now = ac.currentTime;

    function playNote(freq, startOffset, peakGain, duration) {
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      const overtone = ac.createOscillator();
      const overtoneGain = ac.createGain();

      // Primary sine tone
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + startOffset);

      // Subtle overtone at 2x freq for bell quality
      overtone.type = 'sine';
      overtone.frequency.setValueAtTime(freq * 2, now + startOffset);
      overtoneGain.gain.setValueAtTime(peakGain * 0.18, now + startOffset);
      overtoneGain.gain.exponentialRampToValueAtTime(0.0001, now + startOffset + duration);

      // Envelope: instant attack, exponential decay
      gain.gain.setValueAtTime(0.0001, now + startOffset);
      gain.gain.linearRampToValueAtTime(peakGain, now + startOffset + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + startOffset + duration);

      osc.connect(gain);
      gain.connect(ac.destination);
      overtone.connect(overtoneGain);
      overtoneGain.connect(ac.destination);

      osc.start(now + startOffset);
      osc.stop(now + startOffset + duration);
      overtone.start(now + startOffset);
      overtone.stop(now + startOffset + duration);
    }

    playNote(440, 0,     0.28, 0.38); // "Pa" — A4
    playNote(660, 0.085, 0.22, 0.42); // "Va" — E5 (perfect fifth)
  } catch {
    // Audio not available — silently skip
  }
}
