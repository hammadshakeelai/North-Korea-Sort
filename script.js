const canvas = document.getElementById("sort-canvas");
const ctx = canvas.getContext("2d");
const statusText = document.getElementById("status-text");
const detailText = document.getElementById("detail-text");
const victoryPanel = document.getElementById("victory-panel");
const restartBtn = document.getElementById("restart-btn");
const resetBtn = document.getElementById("reset-btn");
const soundBtn = document.getElementById("sound-btn");
const barCountInput = document.getElementById("bar-count-input");
const speedInput = document.getElementById("speed-input");
const speedReadout = document.getElementById("speed-readout");

const WIDTH = 1400;
const HEIGHT = 900;
const DEFAULT_BAR_COUNT = 14;
const MIN_BAR_COUNT = 6;
const MAX_BAR_COUNT = 24;
const BAR_MIN = 18;
const BAR_MAX = 100;
const MAX_YIELD = 4;
const BUTTON_POINT = { x: 346, y: 566 };
const MISSILE_ORIGIN = { x: WIDTH + 70, y: 190 };
const TIMINGS = {
  intro: 0.8,
  scanStep: 0.2,
  targeting: 0.75,
  launch: 0.95,
  impact: 0.38,
  collapse: 0.9,
};

const BAR_PALETTES = {
  idle: ["#f2e8cd", "#8f7d56", "rgba(255, 255, 255, 0.18)"],
  scan: ["#fff9c9", "#ffc445", "rgba(255, 248, 181, 0.85)"],
  target: ["#ff9d92", "#d31813", "rgba(255, 160, 147, 0.85)"],
  sorted: ["#98efb6", "#35c86b", "rgba(197, 255, 214, 0.55)"],
};

const urlParams = new URLSearchParams(window.location.search);
const requestedAdvance = Number(urlParams.get("advance"));

let nextBarId = 1;
let lastTimestamp = performance.now();

const state = {
  mode: "running",
  phase: "intro",
  initialBarCount: DEFAULT_BAR_COUNT,
  activeBars: [],
  stablePrefixLength: 0,
  scanIndex: 0,
  thresholdValue: null,
  targetIndices: [],
  blastYield: 0,
  timer: 0,
  speed: 1,
  soundEnabled: true,
  lastStatus: "",
  lastDetail: "",
  particles: [],
  smoke: [],
  confetti: [],
  celebrationPulse: 0,
  missile: null,
  impactPoint: null,
  transition: null,
  explosionFlash: 0,
  audioContext: null,
};

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function shuffle(items) {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = randomInt(0, index);
    [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
  }
  return copy;
}

function lerp(start, end, amount) {
  return start + (end - start) * amount;
}

function easeInOutCubic(amount) {
  if (amount < 0.5) {
    return 4 * amount * amount * amount;
  }
  return 1 - Math.pow(-2 * amount + 2, 3) / 2;
}

function readBarCount() {
  const nextValue = clamp(
    Math.round(Number(barCountInput.value) || DEFAULT_BAR_COUNT),
    MIN_BAR_COUNT,
    MAX_BAR_COUNT,
  );
  barCountInput.value = String(nextValue);
  return nextValue;
}

function setStatus(message) {
  if (message !== state.lastStatus) {
    state.lastStatus = message;
    statusText.textContent = message;
  }
}

function setDetail(message) {
  if (message !== state.lastDetail) {
    state.lastDetail = message;
    detailText.textContent = message;
  }
}

function destroyedCount() {
  return Math.max(0, state.initialBarCount - state.activeBars.length);
}

function refreshDetail(extra = "") {
  const yieldText = state.blastYield ? `Yield ${state.blastYield}` : "Yield standby";
  const stableText = `Stable-left ${state.stablePrefixLength}`;
  const base = `${yieldText} | Survivors ${state.activeBars.length} | Deleted ${destroyedCount()} | ${stableText}`;
  setDetail(extra ? `${base} | ${extra}` : base);
}

function updateSpeedLabel() {
  speedReadout.textContent = `${state.speed.toFixed(2)}x`;
}

function updateSoundButton() {
  if (!state.soundEnabled) {
    soundBtn.textContent = "Sound Off";
    return;
  }
  const audioReady = state.audioContext && state.audioContext.state === "running";
  soundBtn.textContent = audioReady ? "Sound On" : "Arm Sound";
}

function getAudioContext() {
  if (!state.soundEnabled) {
    return null;
  }
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) {
    return null;
  }
  if (!state.audioContext) {
    state.audioContext = new AudioContextClass();
  }
  return state.audioContext;
}

function unlockAudio() {
  const audioContext = getAudioContext();
  if (!audioContext || audioContext.state === "running") {
    updateSoundButton();
    return Promise.resolve();
  }
  return audioContext.resume().catch(() => {}).finally(() => {
    updateSoundButton();
  });
}

function playTone({
  frequency,
  endFrequency = frequency,
  duration = 0.15,
  volume = 0.04,
  type = "triangle",
  attack = 0.01,
  release = 0.04,
}) {
  const audioContext = getAudioContext();
  if (!audioContext || audioContext.state !== "running") {
    return;
  }

  const oscillator = audioContext.createOscillator();
  const gainNode = audioContext.createGain();
  const now = audioContext.currentTime;
  const endTime = now + duration;

  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, now);
  oscillator.frequency.linearRampToValueAtTime(endFrequency, endTime);

  gainNode.gain.setValueAtTime(0.0001, now);
  gainNode.gain.exponentialRampToValueAtTime(volume, now + attack);
  gainNode.gain.exponentialRampToValueAtTime(0.0001, Math.max(now + attack + 0.01, endTime - release));

  oscillator.connect(gainNode);
  gainNode.connect(audioContext.destination);
  oscillator.start(now);
  oscillator.stop(endTime);
}

function playNoise(duration = 0.2, volume = 0.05) {
  const audioContext = getAudioContext();
  if (!audioContext || audioContext.state !== "running") {
    return;
  }

  const buffer = audioContext.createBuffer(1, Math.floor(audioContext.sampleRate * duration), audioContext.sampleRate);
  const data = buffer.getChannelData(0);
  for (let index = 0; index < data.length; index += 1) {
    data[index] = (Math.random() * 2 - 1) * (1 - index / data.length);
  }

  const source = audioContext.createBufferSource();
  const gainNode = audioContext.createGain();
  const now = audioContext.currentTime;

  source.buffer = buffer;
  gainNode.gain.setValueAtTime(volume, now);
  gainNode.gain.exponentialRampToValueAtTime(0.0001, now + duration);

  source.connect(gainNode);
  gainNode.connect(audioContext.destination);
  source.start(now);
  source.stop(now + duration);
}

function playScanSound() {
  playTone({ frequency: 540, endFrequency: 420, duration: 0.09, volume: 0.025 });
}

function playLaunchSound(yieldSize) {
  playTone({
    frequency: 230 + yieldSize * 18,
    endFrequency: 620 + yieldSize * 34,
    duration: 0.36,
    volume: 0.05,
    type: "sawtooth",
  });
  playTone({
    frequency: 280 + yieldSize * 28,
    endFrequency: 760 + yieldSize * 36,
    duration: 0.3,
    volume: 0.03,
    type: "triangle",
  });
}

function playImpactSound(yieldSize) {
  playNoise(0.24 + yieldSize * 0.04, 0.05 + yieldSize * 0.01);
  playTone({
    frequency: 96 + yieldSize * 8,
    endFrequency: 40,
    duration: 0.42,
    volume: 0.07,
    type: "sine",
  });
}

function playVictoryFanfare() {
  [
    { frequency: 523, endFrequency: 523, duration: 0.14, volume: 0.05 },
    { frequency: 659, endFrequency: 659, duration: 0.14, volume: 0.05 },
    { frequency: 784, endFrequency: 784, duration: 0.22, volume: 0.06 },
  ].forEach((note, index) => {
    window.setTimeout(() => playTone(note), index * 110);
  });
}

function buildBars(count) {
  const values = shuffle(
    Array.from({ length: BAR_MAX - BAR_MIN + 1 }, (_, index) => BAR_MIN + index),
  ).slice(0, count);

  return values.map((value) => ({
    id: nextBarId += 1,
    value,
  }));
}

function createLayout(totalCount) {
  const count = Math.max(1, totalCount);
  const x = 505;
  const y = 735;
  const width = 765;
  const gap = count <= 10 ? 14 : count <= 16 ? 12 : 8;
  const barWidth = (width - gap * (count - 1)) / count;
  const maxHeight = 420;
  return { x, y, width, gap, barWidth, maxHeight };
}

function getBarRect(layout, slotIndex, value) {
  const height = (value / BAR_MAX) * layout.maxHeight;
  return {
    x: layout.x + slotIndex * (layout.barWidth + layout.gap),
    y: layout.y - height,
    width: layout.barWidth,
    height,
  };
}

function getSceneBars() {
  const layout = createLayout(state.activeBars.length);
  return {
    layout,
    bars: state.activeBars.map((bar, index) => ({
      bar,
      rect: getBarRect(layout, index, bar.value),
      index,
    })),
  };
}

function getImpactPoint(targetIndices) {
  const { bars } = getSceneBars();
  const targetRects = targetIndices
    .map((index) => bars[index])
    .filter(Boolean)
    .map((entry) => entry.rect);

  if (!targetRects.length) {
    return { x: WIDTH - 200, y: 250 };
  }

  const left = Math.min(...targetRects.map((rect) => rect.x));
  const right = Math.max(...targetRects.map((rect) => rect.x + rect.width));
  const top = Math.min(...targetRects.map((rect) => rect.y));
  const bottom = Math.max(...targetRects.map((rect) => rect.y + rect.height * 0.38));

  return {
    x: (left + right) * 0.5,
    y: (top + bottom) * 0.5,
  };
}

function collectBadIndices(startIndex, threshold) {
  const indices = [];
  for (let index = startIndex; index < state.activeBars.length; index += 1) {
    if (state.activeBars[index].value < threshold) {
      indices.push(index);
    }
  }
  return indices.length ? indices : [startIndex];
}

function startScanPhase() {
  if (!state.activeBars.length) {
    completeSort();
    return;
  }

  state.phase = "scan";
  state.timer = 0;
  state.stablePrefixLength = 0;
  state.scanIndex = 0;
  state.thresholdValue = null;
  state.targetIndices = [];
  state.blastYield = 0;
  state.missile = null;
  state.impactPoint = null;
  state.transition = null;
  setStatus("The checker restarts on the left and tests the line one bar at a time.");
  refreshDetail();
}

function scanOneBar() {
  if (state.scanIndex >= state.activeBars.length) {
    completeSort();
    return;
  }

  if (state.scanIndex === 0) {
    state.stablePrefixLength = 1;
    state.scanIndex = 1;
    playScanSound();
    setStatus("The left-most bar anchors the green prefix.");
    refreshDetail(`Anchor ${state.activeBars[0].value}`);
    if (state.scanIndex >= state.activeBars.length) {
      completeSort();
    }
    return;
  }

  const previousValue = state.activeBars[state.scanIndex - 1].value;
  const currentBar = state.activeBars[state.scanIndex];

  if (currentBar.value >= previousValue) {
    state.stablePrefixLength = state.scanIndex + 1;
    state.scanIndex += 1;
    playScanSound();
    setStatus("The green prefix keeps growing from the left.");
    refreshDetail(`Safe through ${currentBar.value}`);
    if (state.scanIndex >= state.activeBars.length) {
      completeSort();
    }
    return;
  }

  state.stablePrefixLength = state.scanIndex;
  state.thresholdValue = previousValue;
  lockTargets(previousValue);
}

function lockTargets(threshold) {
  const badIndices = collectBadIndices(state.scanIndex, threshold);

  state.phase = "targeting";
  state.timer = 0;
  state.blastYield = randomInt(1, Math.min(MAX_YIELD, badIndices.length));
  state.targetIndices = badIndices.slice(0, state.blastYield);
  state.impactPoint = getImpactPoint(state.targetIndices);
  setStatus(
    `Order broke after ${threshold}. The right-side missile locks onto ${state.targetIndices.length} badly placed bars.`,
  );
  refreshDetail(`Threshold ${threshold}`);
}

function createMissile() {
  const start = { ...MISSILE_ORIGIN };
  const target = { ...state.impactPoint };
  const control = {
    x: lerp(start.x, target.x, 0.42),
    y: Math.min(start.y, target.y) - 170 - state.blastYield * 24,
  };
  return { start, control, target, progress: 0 };
}

function launchMissile() {
  state.phase = "missile";
  state.timer = 0;
  state.missile = createMissile();
  playLaunchSound(state.blastYield);
  setStatus("A missile streaks in from the right toward the marked bars.");
  refreshDetail(`Delete zone ${state.targetIndices.length}`);
}

function spawnImpactEffects(point, yieldSize) {
  const particleCount = 28 + yieldSize * 12;
  for (let index = 0; index < particleCount; index += 1) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 110 + Math.random() * (150 + yieldSize * 28);
    state.particles.push({
      x: point.x,
      y: point.y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 60,
      life: 0.55 + Math.random() * 0.55,
      size: 7 + Math.random() * (16 + yieldSize * 2),
      color: index % 3 === 0 ? "#ffe17f" : index % 3 === 1 ? "#ff715f" : "#ffffff",
    });
  }

  for (let index = 0; index < 6 + yieldSize; index += 1) {
    state.smoke.push({
      x: point.x + randomInt(-50, 50),
      y: point.y + randomInt(-30, 30),
      vx: randomInt(-30, 30),
      vy: -18 - Math.random() * 34,
      life: 1.1 + Math.random() * 0.7,
      radius: 24 + Math.random() * (18 + yieldSize * 3),
      alpha: 0.4 + Math.random() * 0.18,
    });
  }
}

function enterImpactPhase() {
  state.phase = "impact";
  state.timer = 0;
  state.explosionFlash = 1;
  state.missile = null;
  spawnImpactEffects(state.impactPoint, state.blastYield);
  playImpactSound(state.blastYield);
  setStatus("Direct hit. The marked bars are erased instead of being swapped.");
  refreshDetail(`Deleting ${state.targetIndices.length}`);
}

function beginCollapseTransition() {
  const oldActive = state.activeBars;
  const oldLayout = createLayout(oldActive.length);
  const hitSet = new Set(state.targetIndices);
  const survivors = [];
  const removed = [];

  oldActive.forEach((bar, index) => {
    if (hitSet.has(index)) {
      removed.push({ bar, index });
      return;
    }
    survivors.push({ bar, index });
  });

  const newBars = survivors.map((entry) => entry.bar);
  const newLayout = createLayout(newBars.length);

  state.transition = {
    progress: 0,
    survivorMoves: survivors.map((entry, newIndex) => ({
      bar: entry.bar,
      fromRect: getBarRect(oldLayout, entry.index, entry.bar.value),
      toRect: getBarRect(newLayout, newIndex, entry.bar.value),
    })),
    removedMoves: removed.map((entry) => ({
      bar: entry.bar,
      fromRect: getBarRect(oldLayout, entry.index, entry.bar.value),
      driftX: -20 + Math.random() * 40,
      driftY: -36 - Math.random() * 72,
      rotation: -0.35 + Math.random() * 0.7,
    })),
  };

  state.activeBars = newBars;
  state.phase = "collapse";
  state.timer = 0;
  state.stablePrefixLength = 0;
  setStatus("The hit bars vanish and the survivors slide left with zero swaps.");
  refreshDetail(`Deleted ${removed.length} bars`);
}

function spawnConfettiBurst() {
  for (let index = 0; index < 8; index += 1) {
    state.confetti.push({
      x: randomInt(430, 1280),
      y: -20 - Math.random() * 80,
      vx: -60 + Math.random() * 120,
      vy: 90 + Math.random() * 120,
      spin: Math.random() * Math.PI,
      spinVelocity: -5 + Math.random() * 10,
      life: 2 + Math.random() * 1.2,
      size: 10 + Math.random() * 14,
      color: ["#42d77c", "#ffe17f", "#ff5d55", "#8de8ff"][index % 4],
    });
  }
}

function completeSort() {
  state.mode = "celebration";
  state.phase = "celebration";
  state.timer = 0;
  state.stablePrefixLength = state.activeBars.length;
  state.targetIndices = [];
  state.blastYield = 0;
  state.missile = null;
  state.transition = null;
  victoryPanel.classList.remove("hidden");
  spawnConfettiBurst();
  playVictoryFanfare();
  setStatus("Only an ordered survivor line remains, and it was finished with zero swaps.");
  refreshDetail("Celebration mode");
}

function finalizeCollapse() {
  state.transition = null;
  state.targetIndices = [];
  state.blastYield = 0;
  state.thresholdValue = null;
  state.impactPoint = null;
  state.explosionFlash = 0;
  startScanPhase();
}

function initializeSimulation() {
  state.initialBarCount = readBarCount();
  state.mode = "running";
  state.phase = "intro";
  state.timer = 0;
  state.activeBars = buildBars(state.initialBarCount);
  state.stablePrefixLength = 0;
  state.scanIndex = 0;
  state.thresholdValue = null;
  state.targetIndices = [];
  state.blastYield = 0;
  state.particles = [];
  state.smoke = [];
  state.confetti = [];
  state.celebrationPulse = 0;
  state.missile = null;
  state.impactPoint = null;
  state.transition = null;
  state.explosionFlash = 0;
  victoryPanel.classList.add("hidden");
  setStatus("Kim Jong Un lines up a new queue while the checker waits on the left.");
  refreshDetail();
}

// __APPEND__
