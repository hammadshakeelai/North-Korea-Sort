const canvas = document.getElementById("sort-canvas");
const ctx = canvas.getContext("2d");
const statusText = document.getElementById("status-text");
const detailText = document.getElementById("detail-text");
const victoryPanel = document.getElementById("victory-panel");
const overlayTag = document.getElementById("overlay-tag");
const overlayTitle = document.getElementById("overlay-title");
const overlayCopy = document.getElementById("overlay-copy");
const restartBtn = document.getElementById("restart-btn");
const resetBtn = document.getElementById("reset-btn");
const soundBtn = document.getElementById("sound-btn");
const superNukeBtn = document.getElementById("super-nuke-btn");
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
const SUPER_KEEP_RATIO = 0.1;
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
const requestedSeed = Number(urlParams.get("seed"));
const baseRandomSeed = Number.isFinite(requestedSeed) ? (requestedSeed >>> 0) || 1 : null;
const debugStateNode =
  urlParams.get("dump_text") === "1"
    ? (() => {
        const node = document.createElement("pre");
        node.id = "debug-game-state";
        node.hidden = true;
        document.body.appendChild(node);
        return node;
      })()
    : null;

let nextBarId = 1;
let lastTimestamp = performance.now();
let randomState = baseRandomSeed;

const state = {
  mode: "running",
  phase: "intro",
  runVariant: "normal",
  endingVariant: "normal",
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
  wasteCloud: null,
  audioContext: null,
};

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function randomInt(min, max) {
  return Math.floor(random() * (max - min + 1)) + min;
}

function random() {
  if (randomState === null) {
    return Math.random();
  }
  randomState = (1664525 * randomState + 1013904223) >>> 0;
  return randomState / 4294967296;
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

function setVictoryContent(endingVariant) {
  if (endingVariant === "super") {
    overlayTag.textContent = "Super nuke complete";
    overlayTitle.textContent = "SORT-NUKE-ED";
    overlayCopy.textContent = "One giant blast erased almost everything, and only a tiny ordered survivor line is left.";
    return;
  }

  overlayTag.textContent = "Zero swaps completed";
  overlayTitle.textContent = "YEEEAAAH!";
  overlayCopy.textContent = "The remaining bars are in order, and no swaps were ever used.";
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
    data[index] = (random() * 2 - 1) * (1 - index / data.length);
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
    id: nextBarId++,
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

function longestNonDecreasingSubsequenceIndices(values) {
  const length = values.length;
  const dp = new Array(length).fill(1);
  const previous = new Array(length).fill(-1);
  let bestIndex = 0;

  for (let index = 0; index < length; index += 1) {
    for (let inner = 0; inner < index; inner += 1) {
      if (values[inner] <= values[index] && dp[inner] + 1 > dp[index]) {
        dp[index] = dp[inner] + 1;
        previous[index] = inner;
      }
    }

    if (dp[index] > dp[bestIndex]) {
      bestIndex = index;
    }
  }

  const indices = [];
  for (let cursor = bestIndex; cursor !== -1; cursor = previous[cursor]) {
    indices.push(cursor);
  }

  return indices.reverse();
}

function pickSuperSurvivorIndices() {
  const values = state.activeBars.map((bar) => bar.value);
  const orderedChain = longestNonDecreasingSubsequenceIndices(values);
  const keepTarget = Math.max(1, Math.round(values.length * SUPER_KEEP_RATIO));
  return orderedChain.slice(0, Math.max(1, Math.min(keepTarget, orderedChain.length)));
}

function startSuperStrike() {
  const survivorSet = new Set(pickSuperSurvivorIndices());

  state.phase = "targeting";
  state.timer = 0;
  state.stablePrefixLength = 0;
  state.scanIndex = 0;
  state.thresholdValue = null;
  state.targetIndices = state.activeBars
    .map((_, index) => index)
    .filter((index) => !survivorSet.has(index));
  state.blastYield = state.targetIndices.length;
  state.impactPoint = getImpactPoint(state.targetIndices);
  setStatus("The super nuke locks onto nearly the whole queue in one radioactive pass.");
  refreshDetail(`Super delete ${state.targetIndices.length}`);
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
  const displayYield = Math.min(state.blastYield, state.runVariant === "super" ? 8 : state.blastYield);
  const control = {
    x: lerp(start.x, target.x, 0.42),
    y: Math.min(start.y, target.y) - 170 - displayYield * 24,
  };
  return { start, control, target, progress: 0 };
}

function launchMissile() {
  state.phase = "missile";
  state.timer = 0;
  state.missile = createMissile();
  playLaunchSound(state.blastYield);
  if (state.runVariant === "super") {
    setStatus("The super nuke rips in from the right with a city-level payload.");
    refreshDetail(`Super delete ${state.targetIndices.length}`);
    return;
  }
  setStatus("A missile streaks in from the right toward the marked bars.");
  refreshDetail(`Delete zone ${state.targetIndices.length}`);
}

function spawnImpactEffects(point, yieldSize) {
  const particleCount = 28 + yieldSize * 12;
  for (let index = 0; index < particleCount; index += 1) {
    const angle = random() * Math.PI * 2;
    const speed = 110 + random() * (150 + yieldSize * 28);
    state.particles.push({
      x: point.x,
      y: point.y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 60,
      life: 0.55 + random() * 0.55,
      size: 7 + random() * (16 + yieldSize * 2),
      color: index % 3 === 0 ? "#ffe17f" : index % 3 === 1 ? "#ff715f" : "#ffffff",
    });
  }

  for (let index = 0; index < 6 + yieldSize; index += 1) {
    state.smoke.push({
      x: point.x + randomInt(-50, 50),
      y: point.y + randomInt(-30, 30),
      vx: randomInt(-30, 30),
      vy: -18 - random() * 34,
      life: 1.1 + random() * 0.7,
      radius: 24 + random() * (18 + yieldSize * 3),
      alpha: 0.4 + random() * 0.18,
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
  if (state.runVariant === "super") {
    state.wasteCloud = {
      x: state.impactPoint.x,
      y: state.impactPoint.y + 28,
      life: 3.2,
      maxLife: 3.2,
    };
    setStatus("The super blast turns the kill zone into a mushroom cloud of nuclear waste.");
    refreshDetail(`Deleting ${state.targetIndices.length}`);
    return;
  }
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
      driftX: -20 + random() * 40,
      driftY: -36 - random() * 72,
      rotation: -0.35 + random() * 0.7,
    })),
  };

  state.activeBars = newBars;
  state.phase = "collapse";
  state.timer = 0;
  state.stablePrefixLength = 0;
  if (state.runVariant === "super") {
    setStatus("The super blast strips out almost the whole queue and leaves only a tiny survivor line.");
    refreshDetail(`Deleted ${removed.length} bars`);
    return;
  }
  setStatus("The hit bars vanish and the survivors slide left with zero swaps.");
  refreshDetail(`Deleted ${removed.length} bars`);
}

function spawnConfettiBurst() {
  for (let index = 0; index < 8; index += 1) {
    state.confetti.push({
      x: randomInt(430, 1280),
      y: -20 - random() * 80,
      vx: -60 + random() * 120,
      vy: 90 + random() * 120,
      spin: random() * Math.PI,
      spinVelocity: -5 + random() * 10,
      life: 2 + random() * 1.2,
      size: 10 + random() * 14,
      color: ["#42d77c", "#ffe17f", "#ff5d55", "#8de8ff"][index % 4],
    });
  }
}

function completeSort(endingVariant = state.runVariant === "super" ? "super" : "normal") {
  state.mode = "celebration";
  state.phase = "celebration";
  state.endingVariant = endingVariant;
  state.timer = 0;
  state.stablePrefixLength = state.activeBars.length;
  state.targetIndices = [];
  state.blastYield = 0;
  state.missile = null;
  state.transition = null;
  setVictoryContent(endingVariant);
  victoryPanel.classList.remove("hidden");
  if (endingVariant === "super") {
    state.confetti = [];
    playTone({
      frequency: 140,
      endFrequency: 90,
      duration: 0.5,
      volume: 0.06,
      type: "sawtooth",
    });
    setStatus("Sort-nuke-ed. A tiny ordered survivor line remains after the super blast.");
    refreshDetail("Sort-nuke-ed");
    return;
  }
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
  if (state.runVariant === "super") {
    completeSort("super");
    return;
  }
  startScanPhase();
}

function initializeSimulation(runVariant = "normal") {
  randomState = baseRandomSeed;
  state.runVariant = runVariant;
  state.endingVariant = "normal";
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
  state.wasteCloud = null;
  setVictoryContent("normal");
  victoryPanel.classList.add("hidden");
  if (runVariant === "super") {
    setStatus("A fresh queue is being lined up for the super nuke.");
    refreshDetail("Super mode armed");
    return;
  }
  setStatus("Kim Jong Un lines up a new queue while the checker waits on the left.");
  refreshDetail();
}

function updateParticles(collection, dt, gravity = 0) {
  for (let index = collection.length - 1; index >= 0; index -= 1) {
    const particle = collection[index];
    particle.life -= dt;

    if (particle.life <= 0) {
      collection.splice(index, 1);
      continue;
    }

    particle.x += particle.vx * dt;
    particle.y += particle.vy * dt;
    particle.vy += gravity * dt;
  }
}

function updateSmoke(dt) {
  for (let index = state.smoke.length - 1; index >= 0; index -= 1) {
    const puff = state.smoke[index];
    puff.life -= dt;

    if (puff.life <= 0) {
      state.smoke.splice(index, 1);
      continue;
    }

    puff.x += puff.vx * dt;
    puff.y += puff.vy * dt;
    puff.radius += 16 * dt;
  }
}

function updateWasteCloud(dt) {
  if (!state.wasteCloud) {
    return;
  }

  state.wasteCloud.life -= dt;
  if (state.wasteCloud.life <= 0) {
    state.wasteCloud = null;
  }
}

function updateConfetti(dt) {
  state.celebrationPulse += dt;
  if (state.celebrationPulse >= 0.12) {
    state.celebrationPulse = 0;
    spawnConfettiBurst();
  }

  for (let index = state.confetti.length - 1; index >= 0; index -= 1) {
    const piece = state.confetti[index];
    piece.life -= dt;

    if (piece.life <= 0 || piece.y > HEIGHT + 80) {
      state.confetti.splice(index, 1);
      continue;
    }

    piece.x += piece.vx * dt;
    piece.y += piece.vy * dt;
    piece.spin += piece.spinVelocity * dt;
    piece.vy += 20 * dt;
  }
}

function updateAlgorithm(dt) {
  state.timer += dt;
  state.explosionFlash = Math.max(0, state.explosionFlash - dt * 2.3);

  if (state.phase === "intro") {
    if (state.runVariant === "super") {
      setStatus("The super nuke is charging while a fresh queue waits in the blast zone.");
      refreshDetail("Super mode armed");
    } else {
      setStatus("The left-side inspection is about to begin.");
      refreshDetail();
    }
    if (state.timer >= TIMINGS.intro) {
      if (state.runVariant === "super") {
        startSuperStrike();
      } else {
        startScanPhase();
      }
    }
    return;
  }

  if (state.phase === "scan") {
    while (state.timer >= TIMINGS.scanStep) {
      state.timer -= TIMINGS.scanStep;
      scanOneBar();
      if (state.phase !== "scan") {
        break;
      }
    }
    return;
  }

  if (state.phase === "targeting") {
    if (state.timer >= TIMINGS.targeting) {
      launchMissile();
    }
    return;
  }

  if (state.phase === "missile") {
    if (state.missile) {
      state.missile.progress = clamp(state.timer / TIMINGS.launch, 0, 1);
    }
    if (state.timer >= TIMINGS.launch) {
      enterImpactPhase();
    }
    return;
  }

  if (state.phase === "impact") {
    if (state.timer >= TIMINGS.impact) {
      beginCollapseTransition();
    }
    return;
  }

  if (state.phase === "collapse") {
    if (state.transition) {
      state.transition.progress = clamp(state.timer / TIMINGS.collapse, 0, 1);
    }
    if (state.timer >= TIMINGS.collapse) {
      finalizeCollapse();
    }
  }
}

function update(dt) {
  const scaledDt = dt * state.speed;

  updateParticles(state.particles, scaledDt, 180);
  updateSmoke(scaledDt);
  updateWasteCloud(scaledDt);

  if (state.mode === "celebration") {
    if (state.endingVariant !== "super") {
      updateConfetti(scaledDt);
    }
    return;
  }

  updateAlgorithm(scaledDt);
}

function roundedRect(x, y, width, height, radius) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

function interpolateRect(fromRect, toRect, amount) {
  return {
    x: lerp(fromRect.x, toRect.x, amount),
    y: lerp(fromRect.y, toRect.y, amount),
    width: lerp(fromRect.width, toRect.width, amount),
    height: lerp(fromRect.height, toRect.height, amount),
  };
}

function drawBackground() {
  const sky = ctx.createLinearGradient(0, 0, 0, HEIGHT);
  sky.addColorStop(0, "#5e1211");
  sky.addColorStop(0.45, "#2c0d0d");
  sky.addColorStop(1, "#140707");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  const glow = ctx.createRadialGradient(980, 140, 40, 980, 140, 360);
  glow.addColorStop(0, "rgba(255, 180, 70, 0.42)");
  glow.addColorStop(1, "rgba(255, 180, 70, 0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  for (let index = 0; index < 24; index += 1) {
    const x = 540 + index * 32;
    const alpha = index % 3 === 0 ? 0.08 : 0.04;
    ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`;
    ctx.fillRect(x, 68, 3, 460);
  }

  ctx.fillStyle = "#20110c";
  ctx.fillRect(0, 720, WIDTH, 180);
  ctx.fillStyle = "rgba(0, 0, 0, 0.18)";
  ctx.fillRect(0, 700, WIDTH, 20);
}

function drawStageFrame() {
  ctx.save();
  ctx.fillStyle = "rgba(255, 255, 255, 0.04)";
  roundedRect(34, 32, WIDTH - 68, HEIGHT - 64, 28);
  ctx.fill();
  ctx.strokeStyle = "rgba(255, 196, 104, 0.22)";
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();
}

function drawKim() {
  const pressed = ["targeting", "missile", "impact"].includes(state.phase);
  const bodyLean = pressed ? 12 : 0;
  const shoulderX = 84;
  const shoulderY = 100;
  const buttonTargetX = BUTTON_POINT.x - (140 + bodyLean);
  const buttonTargetY = BUTTON_POINT.y - 520;
  const touchAngle = Math.atan2(buttonTargetY - shoulderY, buttonTargetX - shoulderX);
  const restAngle = -12 * (Math.PI / 180);
  const armAngle = pressed ? touchAngle : restAngle;
  const armLength = pressed
    ? Math.max(108, Math.hypot(buttonTargetX - shoulderX, buttonTargetY - shoulderY) - 12)
    : 132;

  ctx.save();
  ctx.translate(140 + bodyLean, 520);

  ctx.fillStyle = "rgba(0, 0, 0, 0.22)";
  ctx.beginPath();
  ctx.ellipse(24, 224, 128, 28, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#101720";
  roundedRect(-14, 60, 126, 172, 30);
  ctx.fill();

  ctx.fillStyle = "#f2c49e";
  ctx.beginPath();
  ctx.arc(36, 18, 48, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#0b0b0e";
  ctx.beginPath();
  ctx.moveTo(-6, 2);
  ctx.quadraticCurveTo(0, -42, 50, -40);
  ctx.quadraticCurveTo(94, -36, 86, 10);
  ctx.quadraticCurveTo(36, 4, -6, 2);
  ctx.fill();

  ctx.strokeStyle = "#44261a";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(60, 20);
  ctx.lineTo(70, 22);
  ctx.stroke();

  ctx.strokeStyle = "#23130b";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(44, 34);
  ctx.lineTo(78, 32);
  ctx.stroke();

  ctx.fillStyle = "#1d2530";
  roundedRect(-20, 110, 58, 86, 24);
  ctx.fill();
  roundedRect(74, 110, 58, 86, 24);
  ctx.fill();

  ctx.save();
  ctx.translate(shoulderX, shoulderY);
  ctx.rotate(armAngle);
  ctx.fillStyle = "#101720";
  roundedRect(0, 0, armLength, 26, 13);
  ctx.fill();
  ctx.fillStyle = "#f2c49e";
  ctx.beginPath();
  ctx.ellipse(armLength + 4, 12, pressed ? 22 : 18, pressed ? 14 : 12, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.fillStyle = "#101720";
  roundedRect(8, 220, 40, 118, 18);
  ctx.fill();
  roundedRect(64, 220, 40, 118, 18);
  ctx.fill();

  ctx.fillStyle = "#0c1016";
  roundedRect(-8, 326, 58, 22, 12);
  ctx.fill();
  roundedRect(56, 326, 58, 22, 12);
  ctx.fill();

  ctx.fillStyle = "#fff1dc";
  ctx.font = "600 24px Trebuchet MS";
  ctx.textAlign = "left";
  ctx.fillText("Kim Jong Un", -36, 244);
  ctx.fillStyle = "rgba(255, 255, 255, 0.7)";
  ctx.font = "500 18px Trebuchet MS";
  ctx.fillText("zero-swap sorter", -24, 268);
  ctx.restore();
}

function drawButton() {
  const pressed = ["targeting", "missile", "impact"].includes(state.phase);
  const pulse = pressed ? 0.95 : 1 + Math.sin(performance.now() / 320) * 0.02;

  ctx.save();
  ctx.translate(BUTTON_POINT.x, BUTTON_POINT.y);

  ctx.fillStyle = "rgba(0, 0, 0, 0.3)";
  ctx.beginPath();
  ctx.ellipse(0, 26, 98, 20, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#4d4d52";
  roundedRect(-82, -6, 160, 54, 20);
  ctx.fill();

  ctx.scale(pulse, pressed ? 0.9 : 1);
  const glow = ctx.createRadialGradient(0, 2, 0, 0, 2, 74);
  glow.addColorStop(0, pressed ? "rgba(255, 245, 150, 0.65)" : "rgba(255, 119, 103, 0.26)");
  glow.addColorStop(1, "rgba(255, 80, 56, 0)");
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(0, 2, 74, 0, Math.PI * 2);
  ctx.fill();

  const buttonGradient = ctx.createLinearGradient(0, -30, 0, 30);
  buttonGradient.addColorStop(0, "#ff8c79");
  buttonGradient.addColorStop(1, "#b1120e");
  ctx.fillStyle = buttonGradient;
  ctx.beginPath();
  ctx.ellipse(0, 0, 62, 34, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = "rgba(255, 255, 255, 0.28)";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.ellipse(0, 0, 62, 34, 0, 0, Math.PI * 2);
  ctx.stroke();

  ctx.fillStyle = "#fff5ea";
  ctx.font = "800 22px Trebuchet MS";
  ctx.textAlign = "center";
  ctx.fillText("NUKE", 0, 8);
  ctx.restore();
}

function getBarStatus(index) {
  if (state.mode === "celebration") {
    return "sorted";
  }

  if (state.targetIndices.includes(index)) {
    return "target";
  }

  if (index < state.stablePrefixLength) {
    return "sorted";
  }

  if (state.phase === "scan" && index === state.scanIndex) {
    return "scan";
  }

  return "idle";
}

function drawSingleBar(rect, value, status, options = {}) {
  const palette = BAR_PALETTES[status] || BAR_PALETTES.idle;
  const alpha = options.alpha ?? 1;
  const rotation = options.rotation ?? 0;
  const centerX = rect.x + rect.width / 2 + (options.offsetX ?? 0);
  const centerY = rect.y + rect.height / 2 + (options.offsetY ?? 0);

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(centerX, centerY);
  ctx.rotate(rotation);
  ctx.translate(-rect.width / 2, -rect.height / 2);

  const gradient = ctx.createLinearGradient(0, 0, 0, rect.height);
  gradient.addColorStop(0, palette[0]);
  gradient.addColorStop(1, palette[1]);

  ctx.fillStyle = "rgba(0, 0, 0, 0.22)";
  ctx.fillRect(8, rect.height, Math.max(0, rect.width - 2), 10);

  roundedRect(0, 0, rect.width, rect.height, Math.min(14, rect.width * 0.3));
  ctx.fillStyle = gradient;
  ctx.fill();
  ctx.strokeStyle = palette[2];
  ctx.lineWidth = 2.2;
  ctx.stroke();

  if (status === "target" || status === "sorted") {
    ctx.strokeStyle = status === "target" ? "rgba(255, 245, 225, 0.28)" : "rgba(235, 255, 240, 0.2)";
    ctx.lineWidth = 4;
    ctx.stroke();
  }

  const fontSize = Math.max(11, Math.min(24, rect.width * 0.44));
  ctx.fillStyle = "rgba(32, 12, 6, 0.68)";
  ctx.font = `700 ${fontSize}px Trebuchet MS`;
  ctx.textAlign = "center";
  const labelY = Math.max(fontSize + 6, Math.min(rect.height - 8, fontSize + 12));
  ctx.fillText(String(value), rect.width / 2, labelY);
  ctx.restore();
}

function drawNormalBars() {
  const { bars } = getSceneBars();
  bars.forEach((entry) => {
    drawSingleBar(entry.rect, entry.bar.value, getBarStatus(entry.index));
  });
}

function drawTransitionBars() {
  const transition = state.transition;
  const amount = easeInOutCubic(transition.progress);

  transition.survivorMoves.forEach((move) => {
    drawSingleBar(interpolateRect(move.fromRect, move.toRect, amount), move.bar.value, "idle");
  });

  transition.removedMoves.forEach((move) => {
    const fade = 1 - amount;
    drawSingleBar(
      {
        x: move.fromRect.x + move.driftX * amount,
        y: move.fromRect.y + move.driftY * amount + amount * 90,
        width: move.fromRect.width,
        height: Math.max(16, move.fromRect.height * (1 - amount * 0.5)),
      },
      move.bar.value,
      "target",
      {
        alpha: fade,
        rotation: move.rotation * amount,
      },
    );
  });
}

function drawScannerBeam() {
  if (state.mode === "celebration" || state.phase === "collapse") {
    return;
  }

  let focusPoint = null;
  let beamWidth = 42;

  if (state.phase === "intro") {
    const { bars } = getSceneBars();
    if (bars.length) {
      const firstRect = bars[0].rect;
      focusPoint = {
        x: firstRect.x + firstRect.width / 2,
        y: 180,
      };
    }
  } else if (state.phase === "scan") {
    const { bars } = getSceneBars();
    const focusIndex = Math.min(state.scanIndex, Math.max(0, bars.length - 1));
    if (bars[focusIndex]) {
      focusPoint = {
        x: bars[focusIndex].rect.x + bars[focusIndex].rect.width / 2,
        y: 180,
      };
      beamWidth = bars[focusIndex].rect.width * 0.8;
    }
  } else if (state.impactPoint) {
    const displayYield = Math.min(state.blastYield, state.runVariant === "super" ? 8 : state.blastYield);
    focusPoint = {
      x: state.impactPoint.x,
      y: 180,
    };
    beamWidth = 58 + displayYield * 16;
  }

  if (!focusPoint) {
    return;
  }

  const beam = ctx.createLinearGradient(0, 170, 0, 720);
  beam.addColorStop(0, "rgba(255, 255, 255, 0)");
  beam.addColorStop(0.18, "rgba(255, 235, 170, 0.22)");
  beam.addColorStop(1, "rgba(255, 235, 170, 0)");

  ctx.save();
  ctx.globalAlpha = 0.78;
  ctx.fillStyle = beam;
  ctx.beginPath();
  ctx.moveTo(focusPoint.x - beamWidth, 170);
  ctx.lineTo(focusPoint.x + beamWidth, 170);
  ctx.lineTo(focusPoint.x + 54, 720);
  ctx.lineTo(focusPoint.x - 54, 720);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = "rgba(255, 240, 186, 0.95)";
  ctx.beginPath();
  ctx.arc(focusPoint.x, focusPoint.y, 18, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawTargetReticle() {
  if (!state.targetIndices.length || !["targeting", "missile", "impact"].includes(state.phase)) {
    return;
  }

  const { bars } = getSceneBars();
  ctx.save();
  ctx.strokeStyle = "rgba(255, 132, 91, 0.85)";
  ctx.lineWidth = 3;
  ctx.setLineDash([10, 8]);

  state.targetIndices.forEach((index) => {
    const entry = bars[index];
    if (!entry) {
      return;
    }
    const radius = Math.max(entry.rect.width * 0.75, 26);
    ctx.beginPath();
    ctx.arc(entry.rect.x + entry.rect.width / 2, entry.rect.y + 42, radius, 0, Math.PI * 2);
    ctx.stroke();
  });

  ctx.setLineDash([]);
  ctx.fillStyle = "rgba(255, 225, 192, 0.95)";
  ctx.font = "700 20px Trebuchet MS";
  ctx.textAlign = "center";
  ctx.fillText(
    state.runVariant === "super" ? "SUPER NUKE" : `DELETE x${state.targetIndices.length}`,
    state.impactPoint.x,
    state.impactPoint.y - 86,
  );
  ctx.restore();
}

function quadraticPoint(start, control, end, amount) {
  const first = {
    x: lerp(start.x, control.x, amount),
    y: lerp(start.y, control.y, amount),
  };
  const second = {
    x: lerp(control.x, end.x, amount),
    y: lerp(control.y, end.y, amount),
  };
  return {
    x: lerp(first.x, second.x, amount),
    y: lerp(first.y, second.y, amount),
  };
}

function quadraticTangent(start, control, end, amount) {
  return {
    x: 2 * (1 - amount) * (control.x - start.x) + 2 * amount * (end.x - control.x),
    y: 2 * (1 - amount) * (control.y - start.y) + 2 * amount * (end.y - control.y),
  };
}

function drawMissile() {
  if (!state.missile) {
    return;
  }

  const steps = 28;
  ctx.save();
  ctx.strokeStyle = "rgba(255, 214, 124, 0.52)";
  ctx.lineWidth = 4;
  ctx.beginPath();
  for (let index = 0; index <= Math.floor(steps * state.missile.progress); index += 1) {
    const point = quadraticPoint(
      state.missile.start,
      state.missile.control,
      state.missile.target,
      index / steps,
    );
    if (index === 0) {
      ctx.moveTo(point.x, point.y);
    } else {
      ctx.lineTo(point.x, point.y);
    }
  }
  ctx.stroke();

  const point = quadraticPoint(state.missile.start, state.missile.control, state.missile.target, state.missile.progress);
  const tangent = quadraticTangent(
    state.missile.start,
    state.missile.control,
    state.missile.target,
    clamp(state.missile.progress, 0.02, 1),
  );
  const angle = Math.atan2(tangent.y, tangent.x);

  ctx.translate(point.x, point.y);
  ctx.rotate(angle);

  ctx.fillStyle = "rgba(255, 200, 82, 0.85)";
  ctx.beginPath();
  ctx.arc(20, 0, 12, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#ddd7cf";
  roundedRect(-26, -8, 36, 16, 6);
  ctx.fill();
  ctx.fillStyle = "#d04a2b";
  ctx.beginPath();
  ctx.moveTo(-26, 0);
  ctx.lineTo(-40, -8);
  ctx.lineTo(-40, 8);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawImpactEffects() {
  if (state.impactPoint && state.explosionFlash > 0) {
    const displayYield = Math.min(state.blastYield, state.runVariant === "super" ? 8 : state.blastYield);
    const radius = 58 + displayYield * 28;
    const flash = ctx.createRadialGradient(
      state.impactPoint.x,
      state.impactPoint.y,
      0,
      state.impactPoint.x,
      state.impactPoint.y,
      radius,
    );
    flash.addColorStop(0, `rgba(255, 255, 255, ${0.88 * state.explosionFlash})`);
    flash.addColorStop(0.3, `rgba(255, 210, 108, ${0.72 * state.explosionFlash})`);
    flash.addColorStop(1, "rgba(255, 80, 50, 0)");
    ctx.fillStyle = flash;
    ctx.beginPath();
    ctx.arc(state.impactPoint.x, state.impactPoint.y, radius, 0, Math.PI * 2);
    ctx.fill();
  }

  state.particles.forEach((particle) => {
    ctx.globalAlpha = Math.max(0, particle.life);
    ctx.fillStyle = particle.color;
    ctx.beginPath();
    ctx.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.globalAlpha = 1;

  state.smoke.forEach((puff) => {
    ctx.globalAlpha = Math.max(0, Math.min(1, puff.life / 2)) * puff.alpha;
    ctx.fillStyle = "#4f4f58";
    ctx.beginPath();
    ctx.arc(puff.x, puff.y, puff.radius, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.globalAlpha = 1;
}

function drawWasteCloud() {
  if (!state.wasteCloud) {
    return;
  }

  const amount = 1 - state.wasteCloud.life / state.wasteCloud.maxLife;
  const alpha = Math.min(0.9, state.wasteCloud.life / state.wasteCloud.maxLife + 0.18);
  const capRadius = 90 + amount * 160;
  const stemHeight = 50 + amount * 170;
  const toxicWidth = 70 + amount * 120;

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(state.wasteCloud.x, state.wasteCloud.y);

  const stem = ctx.createLinearGradient(0, -stemHeight, 0, stemHeight);
  stem.addColorStop(0, "rgba(171, 255, 132, 0.86)");
  stem.addColorStop(1, "rgba(84, 70, 31, 0.82)");
  ctx.fillStyle = stem;
  roundedRect(-28, -stemHeight, 56, stemHeight + 62, 22);
  ctx.fill();

  const cap = ctx.createRadialGradient(0, -stemHeight, 30, 0, -stemHeight, capRadius);
  cap.addColorStop(0, "rgba(218, 255, 181, 0.95)");
  cap.addColorStop(0.45, "rgba(131, 208, 89, 0.9)");
  cap.addColorStop(1, "rgba(74, 95, 33, 0)");
  ctx.fillStyle = cap;

  [
    { x: 0, y: -stemHeight, r: capRadius },
    { x: -capRadius * 0.42, y: -stemHeight + 24, r: capRadius * 0.62 },
    { x: capRadius * 0.45, y: -stemHeight + 22, r: capRadius * 0.58 },
    { x: 0, y: -stemHeight - capRadius * 0.26, r: capRadius * 0.5 },
  ].forEach((puff) => {
    ctx.beginPath();
    ctx.arc(puff.x, puff.y, puff.r, 0, Math.PI * 2);
    ctx.fill();
  });

  ctx.fillStyle = "rgba(128, 255, 142, 0.26)";
  ctx.beginPath();
  ctx.ellipse(0, 148, toxicWidth, 24 + amount * 12, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

function drawConfetti() {
  state.confetti.forEach((piece) => {
    ctx.save();
    ctx.translate(piece.x, piece.y);
    ctx.rotate(piece.spin);
    ctx.fillStyle = piece.color;
    ctx.fillRect(-piece.size / 2, -piece.size / 2, piece.size, piece.size * 0.55);
    ctx.restore();
  });
}

function drawLabels() {
  ctx.fillStyle = "#fff0d4";
  ctx.font = "900 48px Impact";
  ctx.textAlign = "left";
  ctx.fillText("North Korea Sort", 64, 96);

  ctx.font = "600 22px Trebuchet MS";
  ctx.fillStyle = "rgba(255, 239, 208, 0.8)";
  ctx.fillText(
    state.runVariant === "super"
      ? "Super nuke mode: one giant strike, mushroom waste, then back to normal"
      : "Left-side checks, right-side missiles, and zero swaps",
    66,
    130,
  );

  ctx.fillStyle = "rgba(255, 245, 219, 0.92)";
  ctx.font = "700 24px Trebuchet MS";
  ctx.fillText("Kill zone", 505, 172);

  const phaseLabel =
    state.mode === "celebration"
      ? "Celebration"
      : state.phase === "intro"
        ? "Preparing"
        : state.phase === "scan"
          ? "Left scan"
          : state.phase === "targeting"
            ? "Target lock"
            : state.phase === "missile"
              ? "Missile flight"
              : state.phase === "impact"
                ? "Detonation"
                : "Collapse";

  ctx.fillStyle = "rgba(255, 214, 124, 0.94)";
  ctx.font = "700 28px Trebuchet MS";
  ctx.textAlign = "right";
  ctx.fillText(phaseLabel, WIDTH - 70, 104);
}

function render() {
  ctx.clearRect(0, 0, WIDTH, HEIGHT);
  drawBackground();
  drawStageFrame();
  drawScannerBeam();
  drawTargetReticle();

  if (state.phase === "collapse" && state.transition) {
    drawTransitionBars();
  } else {
    drawNormalBars();
  }

  drawImpactEffects();
  drawWasteCloud();
  drawMissile();
  drawKim();
  drawButton();
  drawLabels();

  if (state.mode === "celebration") {
    drawConfetti();
  }

  if (debugStateNode) {
    debugStateNode.textContent = renderGameToText();
  }
}

function renderGameToText() {
  const { bars } = getSceneBars();
  const payload = {
    coordinate_system: "Origin is top-left of a 1400x900 canvas, x grows right and y grows down.",
    mode: state.mode,
    phase: state.phase,
    run_variant: state.runVariant,
    ending_variant: state.endingVariant,
    speed: state.speed,
    sound_enabled: state.soundEnabled,
    zero_swaps: true,
    initial_bar_count: state.initialBarCount,
    active_count: state.activeBars.length,
    destroyed_count: destroyedCount(),
    stable_prefix_length: state.stablePrefixLength,
    scan_index: state.scanIndex,
    threshold_value: state.thresholdValue,
    target_indices: [...state.targetIndices],
    blast_yield: state.blastYield,
    missile: state.missile
      ? {
          progress: Number(state.missile.progress.toFixed(3)),
          target_x: Math.round(state.missile.target.x),
          target_y: Math.round(state.missile.target.y),
          origin: "right",
        }
      : null,
    waste_cloud: state.wasteCloud
      ? {
          x: Math.round(state.wasteCloud.x),
          y: Math.round(state.wasteCloud.y),
          life: Number(state.wasteCloud.life.toFixed(2)),
        }
      : null,
    active_bars: bars.map((entry) => ({
      index: entry.index,
      value: entry.bar.value,
      x: Math.round(entry.rect.x),
      y: Math.round(entry.rect.y),
      width: Math.round(entry.rect.width),
      height: Math.round(entry.rect.height),
      status: getBarStatus(entry.index),
    })),
  };

  return JSON.stringify(payload);
}

function animate(timestamp) {
  const dt = Math.min(0.05, (timestamp - lastTimestamp) / 1000);
  lastTimestamp = timestamp;
  update(dt);
  render();
  requestAnimationFrame(animate);
}

window.render_game_to_text = renderGameToText;
window.advanceTime = (ms) => {
  const steps = Math.max(1, Math.round(ms / (1000 / 60)));
  for (let index = 0; index < steps; index += 1) {
    update(1 / 60);
  }
  lastTimestamp = performance.now();
  render();
};

barCountInput.value = String(clamp(Math.round(Number(urlParams.get("bars")) || DEFAULT_BAR_COUNT), MIN_BAR_COUNT, MAX_BAR_COUNT));
speedInput.value = String(clamp(Number(urlParams.get("speed")) || 1, 0.5, 3));
state.speed = clamp(Number(speedInput.value), 0.5, 3);
state.soundEnabled = urlParams.get("sound") !== "0";

speedInput.addEventListener("input", () => {
  state.speed = clamp(Number(speedInput.value) || 1, 0.5, 3);
  updateSpeedLabel();
  refreshDetail();
});

barCountInput.addEventListener("change", () => {
  unlockAudio();
  initializeSimulation();
});

resetBtn.addEventListener("click", () => {
  unlockAudio();
  initializeSimulation();
});

superNukeBtn.addEventListener("click", () => {
  unlockAudio();
  initializeSimulation("super");
});

restartBtn.addEventListener("click", () => {
  unlockAudio();
  initializeSimulation();
});

soundBtn.addEventListener("click", () => {
  state.soundEnabled = !state.soundEnabled;
  if (state.soundEnabled) {
    unlockAudio();
  } else if (state.audioContext && state.audioContext.state === "running") {
    state.audioContext.suspend().catch(() => {});
    updateSoundButton();
  } else {
    updateSoundButton();
  }
});

document.addEventListener(
  "pointerdown",
  () => {
    unlockAudio();
  },
  { passive: true },
);

updateSpeedLabel();
updateSoundButton();
initializeSimulation(urlParams.get("variant") === "super" ? "super" : "normal");
render();
requestAnimationFrame(animate);

if (Number.isFinite(requestedAdvance) && requestedAdvance > 0) {
  window.setTimeout(() => {
    window.advanceTime(requestedAdvance);
  }, 0);
}
