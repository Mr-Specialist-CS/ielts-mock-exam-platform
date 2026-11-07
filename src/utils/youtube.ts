/**
 * YouTube URL helpers for Listening audio.
 * Accepts watch?v=, youtu.be/, /embed/, /shorts/, /live/ forms.
 */

export function parseYoutubeId(url: string | undefined | null): string | null {
  if (!url || typeof url !== 'string') return null;
  const v = url.trim();
  if (!v) return null;
  // Bare 11-char video id
  if (/^[A-Za-z0-9_-]{11}$/.test(v)) return v;
  try {
    const u = new URL(v);
    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    if (host === 'youtu.be') {
      const id = u.pathname.split('/').filter(Boolean)[0];
      return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
    }
    if (
      host === 'youtube.com' ||
      host === 'm.youtube.com' ||
      host === 'music.youtube.com' ||
      host === 'youtube-nocookie.com' ||
      host === 'www.youtube-nocookie.com'
    ) {
      const param = u.searchParams.get('v');
      if (param && /^[A-Za-z0-9_-]{11}$/.test(param)) return param;
      const parts = u.pathname.split('/').filter(Boolean);
      // /embed/ID, /shorts/ID, /live/ID
      if (parts.length >= 2 && ['embed', 'shorts', 'live'].includes(parts[0])) {
        const id = parts[1];
        return /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
      }
    }
    return null;
  } catch {
    return null;
  }
}

export function isYoutubeUrl(url: string | undefined | null): boolean {
  return parseYoutubeId(url) !== null;
}

/** Privacy-enhanced embed URL (audio-only callers hide it with CSS). */
export function youtubeEmbedUrl(videoId: string): string {
  return `https://www.youtube-nocookie.com/embed/${videoId}?rel=0&modestbranding=1&iv_load_policy=3&disablekb=1&fs=0&cc_load_policy=0&playsinline=1&enablejsapi=1`;
}

export function youtubeWatchUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

declare global {
  interface Window {
    YT?: any;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let ytApiPromise: Promise<any> | null = null;

/** Load the YouTube IFrame API once (shared with the playback engine). */
export function loadYoutubeApi(): Promise<any> {
  if (typeof window === 'undefined') return Promise.reject(new Error('no window'));
  if (window.YT && window.YT.Player) return Promise.resolve(window.YT);
  if (ytApiPromise) return ytApiPromise;
  ytApiPromise = new Promise((resolve, reject) => {
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
    setTimeout(() => {
      if (!(window.YT && window.YT.Player)) reject(new Error('YouTube API timeout'));
    }, 12000);
  });
  return ytApiPromise;
}

/**
 * Best-effort real duration of a YouTube video (seconds) via a hidden cued
 * player. Resolves null when the video is restricted, the API is blocked,
 * or no duration is exposed — callers keep the admin estimate then.
 */
export function probeYoutubeDuration(videoId: string): Promise<number | null> {
  return loadYoutubeApi().then(
    YT =>
      new Promise<number | null>(resolve => {
        if (typeof document === 'undefined') {
          resolve(null);
          return;
        }
        const mount = document.createElement('div');
        mount.style.cssText = 'position:fixed;width:2px;height:2px;left:-9999px;top:-9999px;';
        document.body.appendChild(mount);
        let player: any = null;
        const done = (v: number | null) => {
          clearTimeout(timer);
          try {
            player?.destroy();
          } catch (_) {}
          mount.remove();
          resolve(v);
        };
        const timer = setTimeout(() => done(null), 15000);
        try {
          player = new YT.Player(mount, {
            height: '2',
            width: '2',
            videoId,
            host: 'https://www.youtube-nocookie.com',
            playerVars: { rel: 0 },
            events: {
              onReady: (e: any) => {
                try {
                  const d = Math.ceil(Number(e.target.getDuration?.()) || 0);
                  done(d > 0 && isFinite(d) ? d : null);
                } catch (_) {
                  done(null);
                }
              },
              onError: () => done(null)
            }
          });
        } catch (_) {
          done(null);
        }
      }),
    () => null
  );
}
