// Web Audio API Sound Controller for seamless multi-firework playback

class SoundManager {
  constructor() {
    this.audioCtx = null;
    this.audioBuffer = null;
    this.fallbackAudio = null;
    this.isMuted = false;
    this.isLoaded = false;
    this.hasUnlocked = false;
  }

  init() {
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (AudioContext) {
        this.audioCtx = new AudioContext();
      }
    } catch (e) {
      console.warn('Web Audio API not supported, falling back to HTML5 audio', e);
    }

    // Preload audio buffer
    fetch('/firework.mp3')
      .then((res) => {
        if (!res.ok) throw new Error('Audio fetch failed');
        return res.arrayBuffer();
      })
      .then((arrayBuffer) => {
        if (this.audioCtx) {
          return this.audioCtx.decodeAudioData(arrayBuffer);
        }
      })
      .then((decodedBuffer) => {
        if (decodedBuffer) {
          this.audioBuffer = decodedBuffer;
          this.isLoaded = true;
        }
      })
      .catch((err) => {
        console.warn('Web Audio preloading error, using fallback audio element', err);
        this.fallbackAudio = new Audio('/firework.mp3');
        this.fallbackAudio.preload = 'auto';
      });
  }

  unlock() {
    if (this.hasUnlocked) return;
    if (this.audioCtx && this.audioCtx.state === 'suspended') {
      this.audioCtx.resume();
    }
    // Also warm up fallback audio if needed
    if (this.fallbackAudio) {
      this.fallbackAudio.load();
    }
    this.hasUnlocked = true;
  }

  toggleMute() {
    this.isMuted = !this.isMuted;
    return !this.isMuted;
  }

  playFirework(volume = 0.8) {
    if (this.isMuted) return;
    this.unlock();

    // High performance Web Audio API path (allows unlimited overlapping sounds)
    if (this.audioCtx && this.audioBuffer) {
      try {
        const source = this.audioCtx.createBufferSource();
        source.buffer = this.audioBuffer;

        // Subtle realistic pitch variation for each firework
        const pitchJitter = 0.94 + Math.random() * 0.14;
        source.playbackRate.value = pitchJitter;

        const gainNode = this.audioCtx.createGain();
        gainNode.gain.value = Math.min(1.0, Math.max(0.2, volume * (0.8 + Math.random() * 0.3)));

        source.connect(gainNode);
        gainNode.connect(this.audioCtx.destination);

        source.start(0);
        return;
      } catch (e) {
        console.warn('Error playing via AudioContext', e);
      }
    }

    // Fallback path
    try {
      const audio = new Audio('/firework.mp3');
      audio.volume = Math.min(1, Math.max(0.1, volume));
      audio.play().catch(() => {});
      setTimeout(() => {
        audio.remove();
      }, 5000);
    } catch (e) {
      // Ignored
    }
  }
}

export const soundManager = new SoundManager();
