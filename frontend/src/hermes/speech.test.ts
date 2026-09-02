import { describe, expect, it } from 'vitest';
import { microphoneErrorMessage, mergeTranscript } from '../hermes/speech';

describe('microphoneErrorMessage', () => {
  it('maps NotAllowedError to a permission message', () => {
    const msg = microphoneErrorMessage(new DOMException('denied', 'NotAllowedError'));
    expect(msg).toContain('Microphone permission was denied');
    expect(msg).toContain('Windows privacy settings');
  });

  it('maps SecurityError to a permission message', () => {
    const msg = microphoneErrorMessage(new DOMException('blocked', 'SecurityError'));
    expect(msg).toContain('Microphone permission was denied');
  });

  it('maps NotFoundError to a missing-device message', () => {
    const msg = microphoneErrorMessage(new DOMException('not found', 'NotFoundError'));
    expect(msg).toContain('No microphone was found');
  });

  it('maps NotReadableError to a busy-device message', () => {
    const msg = microphoneErrorMessage(new DOMException('not readable', 'NotReadableError'));
    expect(msg).toContain('The microphone is busy');
  });

  it('provides a generic fallback for unknown errors', () => {
    const msg = microphoneErrorMessage(new Error('unknown'));
    expect(msg).toContain('Could not start the microphone');
  });

  it('handles non-Error values gracefully', () => {
    const msg = microphoneErrorMessage('just a string');
    expect(msg).toContain('Could not start the microphone');
  });
});

describe('mergeTranscript', () => {
  it('appends a new transcript to existing text', () => {
    expect(mergeTranscript('hello', 'world')).toBe('hello world');
  });

  it('returns the transcript when current is empty', () => {
    expect(mergeTranscript('', 'hello')).toBe('hello');
  });

  it('returns current when transcript is empty', () => {
    expect(mergeTranscript('hello', '')).toBe('hello');
  });

  it('trims whitespace from the transcript', () => {
    expect(mergeTranscript('hello', '  world  ')).toBe('hello world');
  });

  it('does not add extra space when current already ends with space', () => {
    expect(mergeTranscript('hello ', 'world')).toBe('hello world');
  });
});