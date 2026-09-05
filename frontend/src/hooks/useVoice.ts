import { useCallback, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';

/**
 * Auto-plays the last assistant message using ElevenLabs TTS.
 * Call `speak(text)` to play audio.
 */
export function useVoice() {
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const speak = useCallback(async (text: string) => {
    try {
      // Stop any currently playing audio
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }

      // Strip markdown for cleaner speech
      const cleanText = text
        .replace(/[*_~`#\[\]()>]/g, '')
        .replace(/\n{2,}/g, '. ')
        .replace(/\n/g, ' ')
        .trim();

      if (cleanText.length < 2) return;

      const audioBytes: number[] = await invoke('hermes_speak', { text: cleanText });
      const blob = new Blob([new Uint8Array(audioBytes)], { type: 'audio/mpeg' });
      const url = URL.createObjectURL(blob);

      const audio = new Audio(url);
      audioRef.current = audio;
      audio.play();

      audio.addEventListener('ended', () => {
        URL.revokeObjectURL(url);
        audioRef.current = null;
      });
    } catch (err) {
      // Silently fail — voice is optional
      console.error('TTS failed:', err);
    }
  }, []);

  const stop = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
  }, []);

  return { speak, stop };
}