import { useCallback, useEffect, useRef, useState } from 'react';
import { checkSpeech, microphoneErrorMessage, transcribeHermesAudio, type SpeechAvailability } from '../hermes/speech';
import type { HermesConnectionProfile } from '../hermes/types';

export type SpeechState = 'idle' | 'recording' | 'transcribing';

export function useSpeech(profile: HermesConnectionProfile | null) {
  const [state, setState] = useState<SpeechState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [availability, setAvailability] = useState<SpeechAvailability>('checking');
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);

  const refreshAvailability = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setAvailability('unsupported');
      return;
    }
    if (!profile) { setAvailability('unavailable'); return; }
    setAvailability('checking');
    setAvailability(await checkSpeech(profile) ? 'available' : 'unavailable');
  }, [profile]);

  useEffect(() => { void refreshAvailability(); }, [refreshAvailability]);
  useEffect(() => () => streamRef.current?.getTracks().forEach((track) => track.stop()), []);

  const startRecording = useCallback(async () => {
    setError(null);
    if (availability !== 'available') return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      streamRef.current = stream; chunksRef.current = [];
      recorder.ondataavailable = (event) => { if (event.data.size > 0) chunksRef.current.push(event.data); };
      recorder.start(); mediaRecorderRef.current = recorder; setState('recording');
    } catch (cause) { setError(microphoneErrorMessage(cause)); setState('idle'); }
  }, [availability]);

  const stopRecording = useCallback((): Promise<string> => new Promise((resolve, reject) => {
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state !== 'recording' || !profile) { reject(new Error('No active voice recording')); return; }
    recorder.onstop = async () => {
      setState('transcribing');
      streamRef.current?.getTracks().forEach((track) => track.stop()); streamRef.current = null;
      const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' }); chunksRef.current = [];
      try { const text = await transcribeHermesAudio(profile, blob); setState('idle'); resolve(text); }
      catch (cause) { const message = cause instanceof Error ? cause.message : 'Transcription failed'; setError(message); setState('idle'); reject(cause); }
    };
    recorder.stop();
  }), [profile]);

  return { state, error, availability, startRecording, stopRecording, refreshAvailability, clearError: () => setError(null) };
}
