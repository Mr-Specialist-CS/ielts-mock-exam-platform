/**
 * Realistic Audio Simulation & Web Audio synthesis for IELTS Listening.
 * Supports: uploaded files (HTMLAudio), YouTube links (IFrame API,
 * audio-only hidden player), and TTS script fallback.
 */
import { parseYoutubeId } from './youtube';

/** Why a YouTube track failed: embed/restriction error, browser autoplay
 *  block (needs a real tap), or the YouTube API itself unreachable. */
export type YoutubeFailureReason = 'youtube-error' | 'youtube-blocked' | 'youtube-api';

declare global {
  interface Window {
    YT?: any;
    onYouTubeIframeAPIReady?: () => void;
  }
}

class MockIeltsAudioEngine {
  private audioCtx: AudioContext | null = null;
  private isPlaying = false;
  private timer: any = null;
  private htmlAudio: HTMLAudioElement | null = null;
  private ytPlayer: any = null;
  private ytTimer: any = null;
  private ytApiPromise: Promise<any> | null = null;
  private ytWatchdog: any = null;
  private ytPlaying = false;
  private onFatalErrorCb: ((reason: YoutubeFailureReason) => void) | null = null;
  private onProgressCb: ((percent: number, currentTime: number, totalDuration?: number) => void) | null = null;
  private onEndedCb: (() => void) | null = null;
  private duration = 40; // seconds
  private currentTime = 0;
  private lastScript = '';
  private usingHtmlAudio = false;
  private usingYoutube = false;

  private initCtx() {
    if (!this.audioCtx && typeof window !== 'undefined') {
      const AudioCtxClass = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioCtxClass) {
        this.audioCtx = new AudioCtxClass();
      }
    }
  }

  // Play official IELTS chime
  playChime() {
    this.initCtx();
    if (!this.audioCtx) return;

    try {
      const ctx = this.audioCtx;
      if (ctx.state === 'suspended') {
        ctx.resume();
      }

      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      const gain = ctx.createGain();

      osc1.type = 'sine';
      osc2.type = 'triangle';

      osc1.frequency.setValueAtTime(587.33, ctx.currentTime); // D5
      osc2.frequency.setValueAtTime(880.00, ctx.currentTime + 0.15); // A5

      gain.gain.setValueAtTime(0.2, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.8);

      osc1.connect(gain);
      osc2.connect(gain);
      gain.connect(ctx.destination);

      osc1.start(ctx.currentTime);
      osc1.stop(ctx.currentTime + 0.3);
      osc2.start(ctx.currentTime + 0.15);
      osc2.stop(ctx.currentTime + 0.8);
    } catch (e) {
      console.warn('Audio chime error:', e);
    }
  }

  // Speak voice script using SpeechSynthesis if available
  speakText(text: string, onSpeechEnd?: () => void) {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 0.95; // realistic IELTS cadence
      utterance.pitch = 1.0;
      utterance.lang = 'en-GB'; // British English for authentic IELTS

      const voices = window.speechSynthesis.getVoices();
      const britishVoice = voices.find(v => v.lang.includes('GB') || v.lang.includes('en-GB') || v.name.includes('British') || v.name.includes('UK'));
      if (britishVoice) {
        utterance.voice = britishVoice;
      }

      utterance.onend = () => {
        if (onSpeechEnd) onSpeechEnd();
      };

      utterance.onerror = () => {
        if (onSpeechEnd) onSpeechEnd();
      };

      window.speechSynthesis.speak(utterance);
    } else {
      if (onSpeechEnd) onSpeechEnd();
    }
  }

  /** Portion of the script not yet heard, estimated from elapsed seconds. */
  private remainingScriptText(): string {
    const words = (this.lastScript || '').split(/\s+/).filter(Boolean);
    if (words.length === 0) return '';
    if (this.currentTime <= 0 || this.duration <= 0) return words.join(' ');
    const startIdx = Math.min(
      words.length - 1,
      Math.floor((this.currentTime / this.duration) * words.length)
    );
    return words.slice(Math.max(0, startIdx)).join(' ');
  }

  private speakRemaining(fromResume: boolean) {
    const remaining = this.remainingScriptText();
    // No script authored → silence. The generic default announcements
    // ("You will hear a conversation…", "Resuming listening test.") are
    // removed: no robot voice when the exam has no listening.
    if (!remaining) return;
    if (fromResume) {
      this.speakText(`Resuming listening test. ${remaining}`);
    } else {
      this.speakText(
        `You will hear a conversation. First you have some time to look at questions. Now listen carefully and answer. ${remaining}`
      );
    }
  }

  startAudio(
    durationSeconds: number,
    scriptSnippet: string,
    onProgress: (percent: number, currentTime: number, totalDuration?: number) => void,
    onEnded: () => void,
    audioUrl?: string,
    startAtSeconds?: number,
    onFatalError?: (reason: YoutubeFailureReason) => void
  ) {
    this.stop();
    this.duration = durationSeconds || 40;
    const startAt = Math.max(0, Math.floor(startAtSeconds || 0));
    this.currentTime = Math.min(startAt, Math.max(0, this.duration - 1));
    this.isPlaying = true;
    this.onProgressCb = onProgress;
    this.onEndedCb = onEnded;
    this.onFatalErrorCb = onFatalError || null;
    this.ytPlaying = false;
    this.lastScript = scriptSnippet || '';
    this.usingHtmlAudio = false;
    this.usingYoutube = false;

    const isResume = this.currentTime > 0;
    if (!isResume) {
      this.playChime();
    }
    // Emit the resumed position immediately so the UI never flashes 0%.
    if (isResume && this.onProgressCb) {
      const pct = Math.min(99, Math.round((this.currentTime / this.duration) * 100));
      this.onProgressCb(pct, this.currentTime, this.duration);
    }

    // YouTube link: hidden IFrame player (audio-only), with progress polling.
    const ytId = audioUrl ? parseYoutubeId(audioUrl) : null;
    if (ytId) {
      this.startYoutube(ytId, this.currentTime);
      return;
    }

    // If real audio file / recording is uploaded, play via HTMLAudioElement
    if (audioUrl && audioUrl.trim().length > 0) {
      try {
        const audio = new Audio(audioUrl);
        this.htmlAudio = audio;
        this.usingHtmlAudio = true;

        audio.addEventListener('loadedmetadata', () => {
          if (audio.duration && !isNaN(audio.duration) && isFinite(audio.duration)) {
            this.duration = Math.ceil(audio.duration);
          }
          // Resume from saved position for real audio files.
          if (this.currentTime > 0) {
            try {
              audio.currentTime = Math.min(this.currentTime, Math.max(0, (audio.duration || this.duration) - 0.5));
            } catch (_) {}
          }
        });

        audio.addEventListener('timeupdate', () => {
          if (!this.isPlaying) return;
          const curr = Math.floor(audio.currentTime);
          this.currentTime = curr;
          const total = this.duration > 0 ? this.duration : (audio.duration || 1);
          const pct = Math.min(100, Math.round((audio.currentTime / total) * 100));
          if (this.onProgressCb) {
            this.onProgressCb(pct, curr, total);
          }
        });

        audio.addEventListener('ended', () => {
          this.stop();
          if (this.onEndedCb) {
            this.onEndedCb();
          }
        });

        audio.addEventListener('error', (e) => {
          console.warn('Uploaded audio playback failed, falling back to script synthesis:', e);
          this.usingHtmlAudio = false;
          this.htmlAudio = null;
          this.fallbackSynthesis();
        });

        setTimeout(() => {
          if (this.isPlaying && this.htmlAudio) {
            // Ensure seek is applied even if metadata arrived before play().
            if (this.currentTime > 0) {
              try {
                audio.currentTime = Math.min(this.currentTime, Math.max(0, (audio.duration || this.duration) - 0.5));
              } catch (_) {}
            }
            this.htmlAudio.play().catch(err => {
              console.warn('HTML5 Audio autoplay restricted, falling back to synthesis:', err);
              this.usingHtmlAudio = false;
              this.htmlAudio = null;
              this.fallbackSynthesis();
            });
          }
        }, 500);

        return;
      } catch (err) {
        console.warn('Error instantiating audio, fallback to synthesis:', err);
      }
    }

    // Default Voice Script Synthesis fallback
    this.fallbackSynthesis();
  }

  private loadYoutubeApi(): Promise<any> {
    if (typeof window === 'undefined') return Promise.reject(new Error('no window'));
    if (window.YT && window.YT.Player) return Promise.resolve(window.YT);
    if (this.ytApiPromise) return this.ytApiPromise;
    this.ytApiPromise = new Promise((resolve, reject) => {
      const prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => {
        try {
          if (typeof prev === 'function') prev();
        } catch (_) {}
        resolve(window.YT);
      };
      const tag = document.createElement('script');
      tag.src = 'https://www.youtube.com/iframe_api';
      tag.async = true;
      tag.onerror = () => reject(new Error('YouTube API failed to load'));
      document.head.appendChild(tag);
      // Safety timeout: don't hang the exam if Google is blocked.
      setTimeout(() => {
        if (!(window.YT && window.YT.Player)) reject(new Error('YouTube API timeout'));
      }, 12000);
    });
    return this.ytApiPromise;
  }

  private ensureYtContainer(): HTMLElement {
    let el = document.getElementById('ielts-yt-audio');
    if (!el) {
      el = document.createElement('div');
      el.id = 'ielts-yt-audio';
      // Audio-only: 1px offscreen, never display:none (API requires layout).
      el.style.cssText =
        'position:fixed;width:2px;height:2px;left:-10px;bottom:-10px;opacity:0.01;pointer-events:none;z-index:-1;';
      document.body.appendChild(el);
    }
    // Fresh mount node per track so replays don't reuse a destroyed iframe.
    el.innerHTML = '';
    const mount = document.createElement('div');
    mount.id = 'ielts-yt-audio-mount';
    el.appendChild(mount);
    return mount;
  }

  private destroyYoutube(playerOnly = false) {
    if (this.ytTimer) {
      clearInterval(this.ytTimer);
      this.ytTimer = null;
    }
    if (this.ytWatchdog) {
      clearTimeout(this.ytWatchdog);
      this.ytWatchdog = null;
    }
    this.ytPlaying = false;
    if (this.ytPlayer) {
      try {
        this.ytPlayer.destroy();
      } catch (_) {
        try {
          this.ytPlayer.stopVideo();
        } catch (_) {}
      }
      this.ytPlayer = null;
    }
    if (!playerOnly) this.usingYoutube = false;
  }

  private reportYoutubeFailure(reason: YoutubeFailureReason) {
    if (this.ytWatchdog) {
      clearTimeout(this.ytWatchdog);
      this.ytWatchdog = null;
    }
    if (reason === 'youtube-blocked') {
      // Keep the player alive: the student's tap will play it with sound.
      // Only stop polling; the tap restarts it.
      if (this.ytTimer) {
        clearInterval(this.ytTimer);
        this.ytTimer = null;
      }
      this.isPlaying = false;
    } else {
      this.destroyYoutube();
      this.isPlaying = false;
    }
    if (this.onFatalErrorCb) {
      try {
        this.onFatalErrorCb(reason);
      } catch (_) {}
    } else {
      // No listener (legacy caller): fall back to silent timing only.
      this.isPlaying = true;
      this.fallbackSynthesis();
    }
  }

  /** Real user-tap retry for blocked YouTube autoplay. Must be called from
   *  a click handler so the browser grants playback with sound. */
  tapToPlayYoutube(): boolean {
    if (!this.ytPlayer || !this.usingYoutube) return false;
    this.isPlaying = true;
    try {
      this.ytPlayer.playVideo();
    } catch (_) {
      return false;
    }
    if (!this.ytTimer) {
      this.ytTimer = setInterval(() => {
        if (!this.isPlaying || !this.usingYoutube || !this.ytPlayer) return;
        try {
          const t = Math.floor(this.ytPlayer.getCurrentTime?.() || this.currentTime);
          const d = Math.floor(this.ytPlayer.getDuration?.() || this.duration);
          if (d && isFinite(d) && d > 0) this.duration = d;
          this.currentTime = t;
          const pct = Math.min(100, Math.round((t / Math.max(1, this.duration)) * 100));
          if (this.onProgressCb) this.onProgressCb(pct, t, this.duration);
        } catch (_) {}
      }, 500);
    }
    // If the tap still didn't unlock playback, say so instead of hanging.
    if (this.ytWatchdog) clearTimeout(this.ytWatchdog);
    this.ytWatchdog = setTimeout(() => {
      if (this.usingYoutube && this.isPlaying && !this.ytPlaying) {
        this.reportYoutubeFailure('youtube-blocked');
      }
    }, 6000);
    return true;
  }

  private startYoutube(videoId: string, startAt: number) {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      this.fallbackSynthesis();
      return;
    }
    this.usingYoutube = true;
    const mount = this.ensureYtContainer();
    const poll = () => {
      if (!this.isPlaying || !this.usingYoutube || !this.ytPlayer) return;
      try {
        const t = Math.floor(this.ytPlayer.getCurrentTime?.() || 0);
        const d = Math.floor(this.ytPlayer.getDuration?.() || 0);
        if (d && isFinite(d) && d > 0) this.duration = d;
        this.currentTime = t;
        const total = this.duration > 0 ? this.duration : 1;
        const pct = Math.min(100, Math.round((t / total) * 100));
        if (this.onProgressCb) this.onProgressCb(pct, t, this.duration);
      } catch (_) {}
    };
    this.loadYoutubeApi()
      .then(YT => {
        if (!this.usingYoutube) return;
        this.destroyYoutube(true);
        this.ytPlayer = new YT.Player(mount, {
          height: '2',
          width: '2',
          videoId,
          host: 'https://www.youtube-nocookie.com',
          playerVars: {
            autoplay: 1,
            rel: 0,
            modestbranding: 1,
            iv_load_policy: 3,
            disablekb: 1,
            fs: 0,
            cc_load_policy: 0,
            playsinline: 1
          },
          events: {
            onReady: (e: any) => {
              try {
                if (startAt > 0) e.target.seekTo(Math.max(0, startAt), true);
                e.target.playVideo();
              } catch (_) {}
            },
            onStateChange: (e: any) => {
              const S = YT.PlayerState;
              if (e.data === S.PLAYING) {
                this.isPlaying = true;
                this.ytPlaying = true;
                if (this.ytWatchdog) {
                  clearTimeout(this.ytWatchdog);
                  this.ytWatchdog = null;
                }
                if (!this.ytTimer) this.ytTimer = setInterval(poll, 500);
                poll();
              } else if (e.data === S.ENDED) {
                const cb = this.onEndedCb;
                this.stop();
                if (cb) cb();
              } else if (e.data === S.PAUSED) {
                // Keep isPlaying true when WE paused via pause() — the exam
                // freeze path sets it false explicitly. YT auto-pauses
                // (buffering) shouldn't flip the UI to "Paused".
              }
            },
            onError: (e: any) => {
              console.warn('YouTube playback failed (code %s) — reporting to UI, no robot voice', e?.data);
              this.reportYoutubeFailure('youtube-error');
            }
          }
        });
        if (!this.ytTimer) this.ytTimer = setInterval(poll, 500);
        // Autoplay with sound from an async callback can be blocked even
        // after a real click (slow API load kills the gesture). Surface it
        // instead of hanging on "Playing…" forever.
        if (this.ytWatchdog) clearTimeout(this.ytWatchdog);
        this.ytWatchdog = setTimeout(() => {
          if (this.usingYoutube && this.isPlaying && !this.ytPlaying) {
            console.warn('YouTube autoplay looks blocked — asking the student to tap play');
            this.reportYoutubeFailure('youtube-blocked');
          }
        }, 8000);
      })
      .catch(err => {
        console.warn('YouTube API unavailable:', err);
        this.reportYoutubeFailure('youtube-api');
      });
  }

  private fallbackSynthesis() {
    const isResume = this.currentTime > 0;
    // Speak ONLY an admin-authored script. No script = silence: the old
    // generic "You will hear a conversation…" default robot voice is gone.
    setTimeout(() => {
      if (!this.isPlaying || this.usingHtmlAudio || this.usingYoutube) return;
      if ((this.lastScript || '').trim().length === 0) return;
      this.speakRemaining(isResume);
    }, 600);

    clearInterval(this.timer);
    this.timer = setInterval(() => {
      if (!this.isPlaying) return;
      this.currentTime += 1;
      const pct = Math.min(100, Math.round((this.currentTime / this.duration) * 100));

      if (this.onProgressCb) {
        this.onProgressCb(pct, this.currentTime, this.duration);
      }

      if (this.currentTime >= this.duration) {
        this.stop();
        if (this.onEndedCb) {
          this.onEndedCb();
        }
      }
    }, 1000);
  }

  /** Freeze playback in place (keeps position) so a lockdown stops the exam. */
  pause() {
    this.isPlaying = false;
    clearInterval(this.timer);
    this.timer = null;
    if (this.ytTimer) {
      clearInterval(this.ytTimer);
      this.ytTimer = null;
    }
    if (this.htmlAudio) {
      try {
        this.htmlAudio.pause();
      } catch (_) {}
    }
    if (this.ytPlayer) {
      try {
        // Snapshot position before pausing so resume() is exact.
        const t = Math.floor(this.ytPlayer.getCurrentTime?.() || this.currentTime);
        if (isFinite(t) && t >= 0) this.currentTime = t;
        this.ytPlayer.pauseVideo();
      } catch (_) {}
    }
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try {
        window.speechSynthesis.cancel();
      } catch (_) {}
    }
  }

  /** Resume playback from the frozen position after an admin reset. */
  resume() {
    if (this.isPlaying) return;
    // YouTube: resume hidden player from snapshot + restart polling.
    if (this.ytPlayer && this.usingYoutube) {
      this.isPlaying = true;
      try {
        try {
          this.ytPlayer.seekTo(Math.max(0, this.currentTime), true);
        } catch (_) {}
        this.ytPlayer.playVideo();
      } catch (_) {
        this.isPlaying = false;
        return;
      }
      if (!this.ytTimer) {
        this.ytTimer = setInterval(() => {
          if (!this.isPlaying || !this.ytPlayer) return;
          try {
            const t = Math.floor(this.ytPlayer.getCurrentTime?.() || this.currentTime);
            const d = Math.floor(this.ytPlayer.getDuration?.() || this.duration);
            if (d && isFinite(d) && d > 0) this.duration = d;
            this.currentTime = t;
            const pct = Math.min(100, Math.round((t / Math.max(1, this.duration)) * 100));
            if (this.onProgressCb) this.onProgressCb(pct, t, this.duration);
          } catch (_) {}
        }, 500);
      }
      return;
    }
    // Real uploaded audio: resume the same element from its paused position.
    if (this.htmlAudio) {
      this.isPlaying = true;
      try {
        const p = this.htmlAudio.play();
        if (p && typeof (p as Promise<void>).catch === 'function') {
          (p as Promise<void>).catch(() => {
            this.isPlaying = false;
          });
        }
      } catch (_) {
        this.isPlaying = false;
      }
      return;
    }
    // Synthesized fallback: re-speak the unheard portion and continue the
    // ticker from the preserved currentTime.
    this.isPlaying = true;
    this.speakRemaining(true);
    clearInterval(this.timer);
    this.timer = setInterval(() => {
      if (!this.isPlaying) return;
      this.currentTime += 1;
      const pct = Math.min(100, Math.round((this.currentTime / this.duration) * 100));

      if (this.onProgressCb) {
        this.onProgressCb(pct, this.currentTime, this.duration);
      }

      if (this.currentTime >= this.duration) {
        this.stop();
        if (this.onEndedCb) {
          this.onEndedCb();
        }
      }
    }, 1000);
  }

  get playing(): boolean {
    return this.isPlaying;
  }

  stop() {
    this.isPlaying = false;
    clearInterval(this.timer);
    this.timer = null;
    this.usingHtmlAudio = false;
    this.destroyYoutube();
    if (this.htmlAudio) {
      try {
        this.htmlAudio.pause();
        this.htmlAudio.currentTime = 0;
      } catch (_) {}
      this.htmlAudio = null;
    }
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
  }
}

export const audioEngine = new MockIeltsAudioEngine();
