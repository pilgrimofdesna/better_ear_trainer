import { afterEach, describe, expect, it, vi } from 'vitest';

// Just enough of an AudioContext for audio() and wallClock().
class FakeNode {
  gain = { value: 1, setTargetAtTime() {} };
  threshold = { value: 0 };
  ratio = { value: 1 };
  buffer: unknown = null;
  connect<T>(n: T) {
    return n;
  }
  disconnect() {}
}
const clock = { currentTime: 10, out: { contextTime: 10, performanceTime: 0 } };
class FakeContext {
  state = 'running';
  sampleRate = 100;
  destination = new FakeNode();
  get currentTime() {
    return clock.currentTime;
  }
  createGain = () => new FakeNode();
  createDynamicsCompressor = () => new FakeNode();
  createConvolver = () => new FakeNode();
  createBuffer = (_ch: number, len: number) => ({ getChannelData: () => new Float32Array(len) });
  getOutputTimestamp = () => ({ ...clock.out });
  resume = async () => {};
}
vi.stubGlobal('AudioContext', FakeContext);

const { wallClock } = await import('./engine');

afterEach(() => vi.restoreAllMocks());

describe('wallClock', () => {
  it('stays on the Date.now() clock when the performance clock fell behind (phone slept)', () => {
    const epoch = 1_800_000_000_000;
    vi.spyOn(Date, 'now').mockReturnValue(epoch);
    // performance.now() did not advance during a 19 h suspend, so timeOrigin + now() lags
    vi.spyOn(performance, 'now').mockReturnValue(5_000);
    clock.out = { contextTime: 10, performanceTime: 4_990 }; // context time 10 s reached the speaker 10 ms ago
    expect(wallClock(10.5)).toBe(epoch - 10 + 500);
  });

  it('falls back to Date.now() and the context time when there is no output timestamp', () => {
    const epoch = 1_800_000_000_000;
    vi.spyOn(Date, 'now').mockReturnValue(epoch);
    clock.out = { contextTime: 10, performanceTime: 0 };
    clock.currentTime = 12;
    expect(wallClock(13)).toBe(epoch + 1000);
  });
});
