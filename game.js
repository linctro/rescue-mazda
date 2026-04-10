/* ============================================
   マツダ危機一髪！ - Game Logic
   ============================================ */

// --- Constants ---
const CANVAS_W = 960;
const CANVAS_H = 540;

// TODO: ここにGASでデプロイしたWebアプリのURLを貼り付けてください
const GAS_API_URL = "https://script.google.com/macros/s/AKfycbwf5SlVOCa24Sa2zS8o0b7VgxwDClnswfaQl9_QSDNnGCNvUxf71WASQNQeH_kpCt_6/exec";

const CONFIG = {
  stamina: {
    max: 100,
    pumpCost: 4.5,        // 1クリックで消費する体力
    recoveryRate: 0.2,    // 毎フレーム回復
  },
  carbonation: {
    max: 100,
    pumpGain: 2.7,        // 1クリックで増加する炭酸（クリアしやすく調整）
    decayRate: 0.1,      // 毎フレーム自然減少（緩和: 毎秒1.8程度）
  },
  barrel: {
    max: 100,
    rapidThreshold: 3,   // この回数/500ms以上で高速連打（緩和）
    rapidDamage: 2.5,     // 高速連打時のダメージ/frame（緩和）
    windowMs: 400,        // 連打検知ウィンドウ (ms)
  },
  score: {
    clearBonus: 100,
    staminaMultiplier: 0.5,
    barrelMultiplier: 0.5,
  }
};

// --- Game State ---
const GameState = {
  TITLE: 'title',
  PLAYING: 'playing',
  CLEAR: 'clear',
  GAMEOVER: 'gameover',
};

let state = GameState.TITLE;
let stamina = CONFIG.stamina.max;
let carbonation = 0;
let barrelHP = CONFIG.barrel.max;
let score = 0;
let clickTimestamps = [];
let gameoverReason = '';

let playFrames = 0;
let dangerFrames = 0;
let totalPumps = 0;
let totalCarbonation = 0;

// --- Animation State ---
let barrelShakeX = 0;
let barrelShakeIntensity = 0;
let bubbles = [];
let playerState = 'idle'; // idle, pump, down
let pumpAnimTimer = 0;
let _pumpPressedTimer = null; // ボタンpressedクラス解除タイマーID（重複防止用）
let clearAnimProgress = 0;
let isClearAnimating = false;

// プレイヤーアニメーション用タイマー
let idleAnimTimer = 0;       // idleフレーム切り替えカウンタ
let idleAnimFrame = 0;       // 0 or 1 (idle01 / idle02)
let pompAnimFrame = 0;       // 0,1,2 (pomping01~03)
const IDLE_FRAME_INTERVAL = 30; // 30フレームごとに切り替え
const POMP_FRAME_INTERVAL = 6;  // 6フレームごとに切り替え（ポンプ中は速め）

// ヤギアニメーション用タイマー
let goatAnimTimer = 0;       // ヤギフレーム切り替えカウンタ
let goatAnimFrame = 0;       // 0 or 1 (通常2フレーム切り替え)
const GOAT_IDLE_INTERVAL = 40;  // 40フレームごとに通常アニメ切り替え

// --- マツダ / 樽　アニメーション状態 ---
// worryShake: 耐久50以下でブルブル
let worriedShakeX = 0;
let worriedShakeTimer = 0;
const WORRIED_SHAKE_SPEED = 8; // フレーム周期
const WORRIED_SHAKE_AMP = 6; // ピクセル振幅（論理座標）

// 死亡アニメーションステート
// 'none' | 'barrel-shaking' | 'barrel-dead2' | 'mazda-fly' | 'mazda-dead3' | 'mazda-dead4' | 'done'
let deathAnimPhase = 'none';
let deathAnimTimer = 0; // 現フェーズ経過フレーム
let mazdaFlyX = 0;      // 飛び出し時のX座標（論理）
let mazdaFlyY = 0;      // 飛び出し時のY座標（論理）
let mazdaFlyVX = 0;     // X速度
let mazdaFlyVY = 0;     // Y速度
let mazdaDeadFrame = 1; // 1=dead / 2=dead02 / 3=dead03 / 4=dead04

// 樽揺れ用（死亡時）
let barrelDeadShakeX = 0;

// クリアアニメーションステート
let clearAnimPhase = 'none'; // 'jamp' | 'happy1' | 'happy2_drop' | 'happy3' | 'done'
let clearAnimTimer = 0;
let clearMazdaY = 0;       // 落下のY座標（論理）

// --- DOM Elements ---
const canvas = document.getElementById('game-canvas');
const ctx = canvas.getContext('2d');
const titleScreen = document.getElementById('title-screen');
const gameScreen = document.getElementById('game-screen');
const resultScreen = document.getElementById('result-screen');
const resultCard = document.getElementById('result-card');
const closeResultBtn = document.getElementById('close-result-btn');
const reopenResultBtn = document.getElementById('reopen-result-btn');
const startBtn = document.getElementById('start-btn');
const pumpBtn = document.getElementById('pump-btn');
const retryBtn = document.getElementById('retry-btn');
const shareBtn = document.getElementById('share-btn');

// --- Ranking DOM Elements ---
const titleRankingBtn = document.getElementById('title-ranking-btn');
const resultRankingBtn = document.getElementById('result-ranking-btn');
const rankingScreen = document.getElementById('ranking-screen');
const closeRankingBtn = document.getElementById('close-ranking-btn');
const rankingList = document.getElementById('ranking-list');
const scoreSubmitArea = document.getElementById('score-submit-area');
const playerNameInput = document.getElementById('player-name-input');
const submitScoreBtn = document.getElementById('submit-score-btn');
const submitMessage = document.getElementById('submit-message');

// --- Result Screen Toggle ---
closeResultBtn.addEventListener('click', () => {
  resultCard.style.display = 'none';
  reopenResultBtn.style.display = 'block';
});

reopenResultBtn.addEventListener('click', () => {
  resultCard.style.display = 'block';
  reopenResultBtn.style.display = 'none';
});

// --- Ranking Variables ---
let isPrefetching = false;
let prefetchPromise = null;

// --- Ranking Events & Logic ---
function openRanking() {
  rankingScreen.classList.add('active');
  fetchRanking();
}

titleRankingBtn.addEventListener('click', openRanking);
resultRankingBtn.addEventListener('click', openRanking);
closeRankingBtn.addEventListener('click', () => rankingScreen.classList.remove('active'));

function renderRanking(data) {
  rankingList.innerHTML = '';
  if (!data || data.length === 0) {
    rankingList.innerHTML = '<div class="ranking-loading">まだデータがありません</div>';
    return;
  }

  data.forEach((item, index) => {
    const dateStr = item.Date ? new Date(item.Date).toLocaleDateString() : '';
    const row = document.createElement('div');
    row.className = 'ranking-item';
    row.innerHTML = `
      <div class="rank-col">${index + 1}</div>
      <div class="name-col" title="${item.Name}">${item.Name}</div>
      <div class="score-col">${item.Score}</div>
      <div class="date-col">${dateStr}</div>
    `;
    rankingList.appendChild(row);
  });
}

// バックグラウンドでデータを事前取得
async function prefetchRankingData() {
  if (GAS_API_URL === "YOUR_WEB_APP_URL") return;
  if (isPrefetching) return prefetchPromise;

  isPrefetching = true;
  prefetchPromise = fetch(GAS_API_URL)
    .then(res => {
      if (!res.ok) throw new Error('Network response was not ok');
      return res.json();
    })
    .then(data => {
      // キャッシュを保存
      localStorage.setItem('mazdaCrisisRankingCache', JSON.stringify(data));
      isPrefetching = false;
      return data;
    })
    .catch(error => {
      console.error('Prefetch error:', error);
      isPrefetching = false;
      return null;
    });

  return prefetchPromise;
}

async function fetchRanking() {
  if (GAS_API_URL === "YOUR_WEB_APP_URL") {
    rankingList.innerHTML = '<div class="ranking-loading">URLが設定されていません。GAS_API_URLを確認してください。</div>';
    return;
  }

  // 1. まずローカルのキャッシュを表示 (Stale)
  const cachedDataStr = localStorage.getItem('mazdaCrisisRankingCache');
  let hasCache = false;
  if (cachedDataStr) {
    try {
      const cachedData = JSON.parse(cachedDataStr);
      renderRanking(cachedData);
      hasCache = true;
      // キャッシュがある場合でも、背後で最新状態か分かりやすいように少しローディング感は出す（任意）
      rankingList.innerHTML += '<div class="ranking-loading" style="font-size: 0.8em; margin-top: 10px; opacity: 0.7;">最新データを更新中...</div>';
    } catch (e) {
      console.error('Cache parse error:', e);
    }
  }

  if (!hasCache) {
    rankingList.innerHTML = '<div class="ranking-loading">読み込み中...</div>';
  }

  // 2. 最新データを取得して表示を更新 (Revalidate)
  try {
    // 既にプレフェッチ中の場合は待つ、そうでない場合は新しく取得
    const data = await (isPrefetching ? prefetchPromise : prefetchRankingData());
    if (data) {
      renderRanking(data);
    } else if (!hasCache) {
      rankingList.innerHTML = '<div class="ranking-loading">ランキングの取得に失敗しました</div>';
    }
  } catch (error) {
    console.error('Ranking fetch error:', error);
    if (!hasCache) {
      rankingList.innerHTML = '<div class="ranking-loading">ランキングの取得に失敗しました</div>';
    }
  }
}

/**
 * 文字数（書記素単位）をカウントする
 */
function getGraphemeLength(text) {
  if (typeof Intl.Segmenter === 'function') {
    const segmenter = new Intl.Segmenter('ja', { granularity: 'grapheme' });
    return [...segmenter.segment(text)].length;
  }
  return [...text].length; // サロゲートペア対応のフォールバック
}

/**
 * 指定した文字数（書記素）以内に切り取る
 */
function truncateToGraphemes(text, limit) {
  if (typeof Intl.Segmenter === 'function') {
    const segmenter = new Intl.Segmenter('ja', { granularity: 'grapheme' });
    const segments = [...segmenter.segment(text)];
    return segments.slice(0, limit).map(s => s.segment).join('');
  }
  return [...text].slice(0, limit).join('');
}

// 名前入力の制限（リアルタイム）
playerNameInput.addEventListener('input', () => {
  if (getGraphemeLength(playerNameInput.value) > 6) {
    playerNameInput.value = truncateToGraphemes(playerNameInput.value, 6);
  }
});

submitScoreBtn.addEventListener('click', async () => {
  const name = playerNameInput.value.trim();
  if (!name) {
    alert("名前を入力してください");
    return;
  }
  if (getGraphemeLength(name) > 6) {
    alert("名前は6文字以内で入力してください");
    return;
  }
  if (GAS_API_URL === "YOUR_WEB_APP_URL") {
    alert("GAS API URLが設定されていません。");
    return;
  }

  submitScoreBtn.disabled = true;
  submitScoreBtn.textContent = '送信中...';

  try {
    const response = await fetch(GAS_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain', // CORS回避のため text/plain を使用
      },
      body: JSON.stringify({
        name: name,
        score: score
      })
    });

    const result = await response.json();
    if (result.status === 'success') {
      scoreSubmitArea.style.display = 'none';
      submitMessage.textContent = 'スコアを登録しました！🏆';
      submitMessage.style.display = 'block';
    } else {
      throw new Error(result.message);
    }
  } catch (error) {
    console.error('Score submit error:', error);
    submitScoreBtn.disabled = false;
    submitScoreBtn.textContent = 'スコアを登録';
    alert("登録に失敗しました。もう一度お試しください。");
  }
});

// --- Intro Canvas ---
const introScreen = document.getElementById('intro-screen');
const introCanvas = document.getElementById('intro-canvas');
const introCtx = introCanvas.getContext('2d');
const introSkipBtn = document.getElementById('intro-skip-btn');
const titleBackBtn = document.getElementById('title-back-btn');

const staminaFill = document.getElementById('stamina-fill');
const carbonationFill = document.getElementById('carbonation-fill');
const barrelFill = document.getElementById('barrel-fill');
const staminaValue = document.getElementById('stamina-value');
const carbonationValue = document.getElementById('carbonation-value');
const barrelValue = document.getElementById('barrel-value');

// --- Image Loading ---
const images = {};
let imagesLoaded = 0;
const imageList = [
  { key: 'bg', src: 'assets/img/bg_brewery.png' },
  { key: 'barrel', src: 'assets/img/barrel.png' },
  { key: 'barrel02', src: 'assets/img/barrel02.png' },
  { key: 'barrel_dead01', src: 'assets/img/barrel-dead01.png' },
  { key: 'barrel_dead02', src: 'assets/img/barrel-dead02.png' },
  { key: 'barrel_happy01', src: 'assets/img/barrel-happy01.png' },
  { key: 'barrel_happy02', src: 'assets/img/barrel-happy02.png' },
  { key: 'mazda_idle01', src: 'assets/img/mazda-idle01.png' },
  { key: 'mazda_idle02', src: 'assets/img/mazda-idle02.png' },
  { key: 'mazda_worried', src: 'assets/img/mazda-worried.png' },
  { key: 'mazda_dead', src: 'assets/img/mazda-dead.png' },
  { key: 'mazda_dead02', src: 'assets/img/mazda-dead02.png' },
  { key: 'mazda_dead03', src: 'assets/img/mazda-dead03.png' },
  { key: 'mazda_dead04', src: 'assets/img/mazda-dead04.png' },
  { key: 'mazda_happy01', src: 'assets/img/mazda-happy01.png' },
  { key: 'mazda_happy02', src: 'assets/img/mazda-happy02.png' },
  { key: 'mazda_happy03', src: 'assets/img/mazda-happy03.png' },
  { key: 'mazda_jamp', src: 'assets/img/mazda-jamp.png' },
  { key: 'player_idle01', src: 'assets/img/player_idle01.png' },
  { key: 'player_idle02', src: 'assets/img/player_idle02.png' },
  { key: 'player_pomping01', src: 'assets/img/player_pomping01.png' },
  { key: 'player_pomping02', src: 'assets/img/player_pomping02.png' },
  { key: 'player_pomping03', src: 'assets/img/player_pomping03.png' },
  { key: 'player_fainted01', src: 'assets/img/player_fainted01.png' },
  { key: 'player_fainted02', src: 'assets/img/player_fainted02.png' },
  // ヤギ画像
  { key: 'goat_black01', src: 'assets/img/goat-black01.png' },
  { key: 'goat_black02', src: 'assets/img/goat-black02.png' },
  { key: 'goat_black03', src: 'assets/img/goat-black03.png' },
  { key: 'goat_black04', src: 'assets/img/goat-black04.png' },
  { key: 'goat_white01', src: 'assets/img/goat-white01.png' },
  { key: 'goat_white02', src: 'assets/img/goat-white02.png' },
  { key: 'goat_white03', src: 'assets/img/goat-white03.png' },
  { key: 'goat_white04', src: 'assets/img/goat-white04.png' },
  // 借金取り スプライトフレーム (enemy-01~07)
  { key: 'debtor01', src: 'assets/img/enemy-01.png' },
  { key: 'debtor02', src: 'assets/img/enemy-02.png' },
  { key: 'debtor03', src: 'assets/img/enemy-03.png' },
  { key: 'debtor04', src: 'assets/img/enemy-04.png' },
  { key: 'debtor05', src: 'assets/img/enemy-05.png' },
  { key: 'debtor06', src: 'assets/img/enemy-06.png' },
  { key: 'debtor07', src: 'assets/img/enemy-07.png' },
  // マツダ スプライトフレーム (mazda001-007)
  { key: 'mazda_tie01', src: 'assets/img/mazda001.png' },
  { key: 'mazda_tie02', src: 'assets/img/mazda002.png' },
  { key: 'mazda_tie03', src: 'assets/img/mazda003.png' },
  { key: 'mazda_tie04', src: 'assets/img/mazda004.png' },
  { key: 'mazda_tie05', src: 'assets/img/mazda005.png' },
  { key: 'mazda_tie06', src: 'assets/img/mazda006.png' },
  { key: 'mazda_tie07', src: 'assets/img/mazda007.png' },
];

function loadImages(callback) {
  if (imageList.length === 0) { callback(); return; }
  imageList.forEach(item => {
    const img = new Image();
    img.onload = () => {
      imagesLoaded++;
      if (imagesLoaded >= imageList.length) callback();
    };
    img.onerror = () => {
      console.warn(`Failed to load: ${item.src}`);
      imagesLoaded++;
      if (imagesLoaded >= imageList.length) callback();
    };
    img.src = item.src;
    images[item.key] = img;
  });
}

// --- Screen Management ---
function showScreen(screenId) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(screenId).classList.add('active');
}

// --- Game Init ---
function initGame() {
  stamina = CONFIG.stamina.max;
  carbonation = 0;
  barrelHP = CONFIG.barrel.max;
  score = 0;
  clickTimestamps = [];
  gameoverReason = '';

  playFrames = 0;
  dangerFrames = 0;
  totalPumps = 0;
  totalCarbonation = 0;

  playerState = 'idle';
  pumpAnimTimer = 0;
  barrelShakeIntensity = 0;
  bubbles = [];

  // クリアアニメーション初期化
  isClearAnimating = false;
  clearAnimProgress = 0;
  clearAnimPhase = 'none';
  clearAnimTimer = 0;
  clearMazdaY = 0;

  idleAnimTimer = 0;
  idleAnimFrame = 0;
  pompAnimFrame = 0;
  goatAnimTimer = 0;
  goatAnimFrame = 0;
  // マツダ・樽アニメーション初期化
  worriedShakeX = 0;
  worriedShakeTimer = 0;
  deathAnimPhase = 'none';
  deathAnimTimer = 0;
  mazdaFlyX = 0;
  mazdaFlyY = 0;
  mazdaFlyVX = 0;
  mazdaFlyVY = 0;
  mazdaDeadFrame = 1;
  barrelDeadShakeX = 0;
  state = GameState.PLAYING;
  updateGaugeUI();
}

// --- Resize Canvas ---
function resizeCanvas() {
  const wrapper = document.getElementById('game-wrapper');
  canvas.width = wrapper.clientWidth;
  canvas.height = wrapper.clientHeight;
}

// --- Pump Action ---
function onPump() {
  if (state !== GameState.PLAYING) return;

  const now = Date.now();
  clickTimestamps.push(now);

  // Remove old timestamps
  clickTimestamps = clickTimestamps.filter(t => now - t < CONFIG.barrel.windowMs);

  // Apply stamina cost
  stamina -= CONFIG.stamina.pumpCost;

  // Apply carbonation gain
  carbonation = Math.min(CONFIG.carbonation.max, carbonation + CONFIG.carbonation.pumpGain);
  totalCarbonation += CONFIG.carbonation.pumpGain;
  totalPumps++;

  // Barrel shake
  barrelShakeIntensity = Math.min(10, barrelShakeIntensity + 1.5);

  // Spawn bubbles
  spawnBubbles(2 + Math.floor(carbonation / 20));

  // Player pump animation
  playerState = 'pump';
  pumpAnimTimer = 8;

  // Button feedback: pressed
  pumpBtn.classList.add('pressed');
  if (_pumpPressedTimer !== null) {
    clearTimeout(_pumpPressedTimer);
  }
  _pumpPressedTimer = setTimeout(() => {
    pumpBtn.classList.remove('pressed');
    _pumpPressedTimer = null;
  }, 80);

  // Check rapid clicking for barrel damage
  if (clickTimestamps.length >= CONFIG.barrel.rapidThreshold) {
    barrelHP -= CONFIG.barrel.rapidDamage;
    // Screen flash when barrel is low (強制reflowなし版)
    if (barrelHP < 30) {
      triggerFlashRed();
    }
  }
}

// flash-red アニメ 強制reflowなし版
let _flashRedTimer = null;
function triggerFlashRed() {
  if (_flashRedTimer !== null) return; // 連打中は新規発火しない
  gameScreen.classList.add('flash-red');
  _flashRedTimer = setTimeout(() => {
    gameScreen.classList.remove('flash-red');
    _flashRedTimer = null;
  }, 300);
}

// --- Bubble System ---
const MAX_BUBBLES = 50; // バブル上限（パフォーマンス維持）

function spawnBubbles(count) {
  // 上限を超えたら生成しない
  if (bubbles.length >= MAX_BUBBLES) return;
  const allowed = Math.min(count, MAX_BUBBLES - bubbles.length);
  const safeY = canvas.height > 150 ? 70 : 0;
  const safeH = canvas.height > 150 ? canvas.height - 150 : canvas.height;
  let scaleX = canvas.width / CANVAS_W;
  let scaleY = safeH / CANVAS_H;
  if (canvas.height > canvas.width) {
    scaleX *= 0.8;
    scaleY *= 0.8;
  }
  for (let i = 0; i < allowed; i++) {
    bubbles.push({
      x: (CANVAS_W * 0.5 + (Math.random() - 0.5) * 160) * scaleX,
      y: safeY + (300 + Math.random() * 50) * scaleY,
      r: (3 + Math.random() * 8),
      speed: (0.5 + Math.random() * 2),
      alpha: 0.4 + Math.random() * 0.4,
      wobble: Math.random() * Math.PI * 2,
    });
  }
}

function updateBubbles() {
  for (let i = bubbles.length - 1; i >= 0; i--) {
    const b = bubbles[i];
    b.y -= b.speed;
    b.x += Math.sin(b.wobble) * 0.5;
    b.wobble += 0.05;
    b.alpha -= 0.008; // 減衰を速くして蓄積を抑制 (0.003 -> 0.008)
    if (b.alpha <= 0 || b.y < -20) {
      bubbles.splice(i, 1);
    }
  }
}

// --- Update Logic ---
function update() {
  if (state !== GameState.PLAYING) return;

  playFrames++;
  if (stamina <= 25 || barrelHP <= 30) {
    dangerFrames++;
  }

  // Stamina recovery
  stamina = Math.min(CONFIG.stamina.max, stamina + CONFIG.stamina.recoveryRate);

  // Win condition: 自然減少より先にチェック（減少で100未満にならないよう）
  // Math.roundで100と表示される値に達した時点でクリア（偽の100%を防止）
  if (carbonation >= CONFIG.carbonation.max - 0.5) {
    carbonation = CONFIG.carbonation.max; // 確実にMAXにしてUIを描画
    state = GameState.CLEAR;
    isClearAnimating = true;
    clearAnimProgress = 0; // 旧パーティクル用
    clearAnimPhase = 'jamp';
    clearAnimTimer = 0;
    clearMazdaY = 0;
    updateGaugeUI(); // クリア状態として一度描画
    return;
  }

  // Carbonation decay（クリア判定後に実施）
  carbonation = Math.max(0, carbonation - CONFIG.carbonation.decayRate);

  // Barrel shake decay
  barrelShakeIntensity = Math.max(0, barrelShakeIntensity - 0.3);
  barrelShakeX = (Math.random() - 0.5) * barrelShakeIntensity;

  // Player animation timer
  if (pumpAnimTimer > 0) {
    pumpAnimTimer--;
    if (pumpAnimTimer <= 0) {
      playerState = 'idle';
    }
  }

  // Idle animation timer（待機中のみカウント）
  if (playerState === 'idle') {
    idleAnimTimer++;
    if (idleAnimTimer >= IDLE_FRAME_INTERVAL) {
      idleAnimTimer = 0;
      idleAnimFrame = (idleAnimFrame + 1) % 2;
    }
  }

  // Pomping animation frame（ポンプ中はフレームを進める）
  if (playerState === 'pump') {
    pompAnimFrame = (pompAnimFrame + 1) % 3;
  }

  // Update bubbles
  updateBubbles();

  // worriedシェイク更新（耐久50以下）
  if (barrelHP <= 50 && barrelHP > 0) {
    worriedShakeTimer++;
    worriedShakeX = Math.sin(worriedShakeTimer * (Math.PI * 2 / WORRIED_SHAKE_SPEED)) * WORRIED_SHAKE_AMP;
  } else {
    worriedShakeX = 0;
    worriedShakeTimer = 0;
  }

  // Lose conditions
  if (stamina <= 0) {
    stamina = 0;
    state = GameState.GAMEOVER;
    gameoverReason = 'stamina';
    playerState = 'down';
    updateGaugeUI();
    showResult();
    return;
  }
  if (barrelHP <= 0) {
    barrelHP = 0;
    state = GameState.GAMEOVER;
    gameoverReason = 'barrel';
    mazdaDeadFrame = 1; // mazda-dead からスタート
    deathAnimPhase = 'barrel-shaking'; // 死亡アニメ開始
    deathAnimTimer = 0;
    updateGaugeUI();
    // showResult は死亡アニメ完了後に呼ぶ
    return;
  }

  // Update UI
  updateGaugeUI();
}

// --- Clear Animation ---
const CLEAR_JAMP_FRAMES = 50;
const CLEAR_HAPPY1_FRAMES = 40;
const CLEAR_HAPPY2_DROP_FRAMES = 30;
const CLEAR_HAPPY3_FRAMES = 60;

function updateClearAnim() {
  if (!isClearAnimating) return false;

  clearAnimProgress += 0.02; // 背景エフェクト等に使用
  if (clearAnimProgress > 1) clearAnimProgress = 1;

  clearAnimTimer++;

  if (clearAnimPhase === 'jamp') {
    if (clearAnimTimer >= CLEAR_JAMP_FRAMES) {
      clearAnimPhase = 'happy1';
      clearAnimTimer = 0;
    }
  } else if (clearAnimPhase === 'happy1') {
    if (clearAnimTimer >= CLEAR_HAPPY1_FRAMES) {
      clearAnimPhase = 'happy2_drop';
      clearAnimTimer = 0;
      clearMazdaY = 0; // 落下用
    }
  } else if (clearAnimPhase === 'happy2_drop') {
    clearMazdaY += 3; // 落下速度 (3px * 30f = 90px降下)
    if (clearAnimTimer >= CLEAR_HAPPY2_DROP_FRAMES) {
      clearAnimPhase = 'happy3';
      clearAnimTimer = 0;
    }
  } else if (clearAnimPhase === 'happy3') {
    if (clearAnimTimer >= CLEAR_HAPPY3_FRAMES) {
      clearAnimPhase = 'done';
      isClearAnimating = false;
      showResult();
    }
  }

  return true;
}

// --- Death Animation (barrel破壊時) ---
// フェーズ定数（フレーム数）
const DEATH_BARREL_SHAKE_FRAMES = 60;  // barrel-dead01でブルブル
const DEATH_BARREL2_FRAMES = 20;  // barrel-dead02に切り替わる停止時間
const DEATH_FLY_FRAMES = 50;  // mazda-dead02が飛んで落ちる
const DEATH_DEAD3_FRAMES = 40;  // mazda-dead03 表示
const DEATH_DEAD4_FRAMES = 60;  // mazda-dead04 表示してから結果へ

function updateDeathAnim() {
  if (deathAnimPhase === 'none' || deathAnimPhase === 'done') return;

  deathAnimTimer++;

  if (deathAnimPhase === 'barrel-shaking') {
    // barrel-dead01でブルブル
    barrelDeadShakeX = Math.sin(deathAnimTimer * Math.PI * 2 / 6) * 8;
    mazdaDeadFrame = 1; // mazda-dead

    if (deathAnimTimer >= DEATH_BARREL_SHAKE_FRAMES) {
      deathAnimPhase = 'barrel-dead2';
      deathAnimTimer = 0;
      barrelDeadShakeX = 0;
      // mazda-dead02が斜め45度に飛び出す初速設定（論理座標）
      mazdaFlyX = 0;
      mazdaFlyY = 0;
      mazdaFlyVX = 5;   // 右斜め
      mazdaFlyVY = -8;  // 上方向（45度より少し急角度）
      mazdaDeadFrame = 2; // mazda-dead02
    }

  } else if (deathAnimPhase === 'barrel-dead2') {
    // barrel-dead02に変わり、mazda-dead02が飛び出す
    mazdaFlyX += mazdaFlyVX;
    mazdaFlyY += mazdaFlyVY;
    mazdaFlyVY += 0.5; // 重力

    if (deathAnimTimer >= DEATH_FLY_FRAMES) {
      deathAnimPhase = 'mazda-dead3';
      deathAnimTimer = 0;
      mazdaDeadFrame = 3; // mazda-dead03
    }

  } else if (deathAnimPhase === 'mazda-dead3') {
    if (deathAnimTimer >= DEATH_DEAD3_FRAMES) {
      deathAnimPhase = 'mazda-dead4';
      deathAnimTimer = 0;
      mazdaDeadFrame = 4; // mazda-dead04
    }

  } else if (deathAnimPhase === 'mazda-dead4') {
    if (deathAnimTimer >= DEATH_DEAD4_FRAMES) {
      deathAnimPhase = 'done';
      showResult();
    }
  }
}

// --- Update Gauge UI ---
function updateGaugeUI() {
  const sp = (stamina / CONFIG.stamina.max) * 100;
  const cp = (carbonation / CONFIG.carbonation.max) * 100;
  const bp = (barrelHP / CONFIG.barrel.max) * 100;

  staminaFill.style.width = sp + '%';
  carbonationFill.style.width = cp + '%';
  barrelFill.style.width = bp + '%';

  // 100に満たないのに「100」と表示されるのを防ぐためMath.floorを使用
  // ただし0未満は0にする（Math.maxで対応済みだが念のため）
  staminaValue.textContent = Math.ceil(stamina); // 体力・耐久は切り上げて0の悲劇を防ぐ
  carbonationValue.textContent = Math.floor(carbonation); // 炭酸は完全に溜まるまで100を表示しない
  barrelValue.textContent = Math.ceil(barrelHP);

  // Color warnings
  if (stamina < 25) {
    staminaFill.style.background = 'linear-gradient(90deg, #e04040, #e06060)';
  } else {
    staminaFill.style.background = 'linear-gradient(90deg, #e04040, #40c060)';
  }

  if (barrelHP < 30) {
    barrelFill.style.background = 'linear-gradient(90deg, #e04040, #e06060)';
  } else {
    barrelFill.style.background = 'linear-gradient(90deg, #804020, #a06830)';
  }
}

// --- Show Result ---
function showResult() {
  const resultTitle = document.getElementById('result-title');
  const resultIcon = document.getElementById('result-icon');
  const resultScore = document.getElementById('result-score');
  const resultDetails = document.getElementById('result-details');
  const resultMessage = document.getElementById('result-message');

  // ポップアップの状態をリセット
  resultCard.style.display = 'block';
  reopenResultBtn.style.display = 'none';

  const baseScore = Math.floor(totalCarbonation * 5); // 努力点
  const pumpScore = totalPumps * 20;                  // 無駄な素振り点
  const dangerScore = Math.floor(dangerFrames * 2);   // チキンレース点

  let title = "";
  let bonusName = "";
  let bonusScore = 0;

  const playSeconds = playFrames / 60;

  if (state === GameState.CLEAR) {
    title = "【マツダの救世主】";
    bonusName = "マツダ救出ボーナス";
    bonusScore = 10000;

    resultTitle.textContent = '🎉 救出成功！';
    resultTitle.className = 'result-title clear';
    resultIcon.innerHTML = '<img src="assets/img/mazda-happy01.png" style="height:80px;object-fit:contain;">';
    resultMessage.innerHTML = '樽からマツダを救い出した！<br>借金取りを追い払え！🍺';
  } else {
    // 称号の判定 (GAMEOVER)
    if (playSeconds < 5 && gameoverReason === 'barrel') {
      title = "【破壊神RTA】";
      bonusName = "最速やらかし大爆発";
      bonusScore = 1500;
    } else if (playSeconds < 5 && gameoverReason === 'stamina') {
      title = "【秒速のもやし】";
      bonusName = "最速リタイア";
      bonusScore = 1500;
    } else if (dangerFrames > 300) {
      title = "【ギリギリを攻めすぎた愚者】";
      bonusName = "チキンレース勇敢賞";
      bonusScore = 1000;
    } else if (gameoverReason === 'barrel') {
      title = "【歩く大爆発】";
      bonusName = "器物損壊ボーナス";
      bonusScore = 500;
    } else {
      title = "【名誉ブラック社員】";
      bonusName = "労災認定ボーナス";
      bonusScore = 500;
    }

    resultTitle.className = 'result-title gameover';

    if (gameoverReason === 'stamina') {
      resultTitle.textContent = '💀 力尽きた…';
      resultIcon.innerHTML = '<img src="assets/img/player_fainted01.png" style="height:80px;object-fit:contain;">';
      resultMessage.innerHTML = 'ポンプを押しきれなかった…<br>マツダは樽の中に閉じ込められたまま。';
    } else {
      resultTitle.textContent = '💥 樽が爆発した！';
      resultIcon.innerHTML = '<img src="assets/img/mazda-dead04.png" style="height:80px;object-fit:contain;">';
      resultMessage.innerHTML = '炭酸圧が上がりすぎて樽ごと爆発！<br>マツダはビール漬けに…😱';
    }
  }

  score = baseScore + pumpScore + dangerScore + bonusScore;

  score = baseScore + pumpScore + dangerScore + bonusScore;

  resultDetails.innerHTML = `
    <div style="font-weight: bold; margin-bottom: 8px; color: #ffeb3b; font-size: 1.1em;">${title}</div>
    <div style="font-size: 0.9em; line-height: 1.4;">
      努力点 (総炭酸): +${baseScore}<br>
      ポンプ素振り点: +${pumpScore}<br>
      チキンレース点: +${dangerScore}<br>
      ${bonusName}: +${bonusScore}
    </div>
  `;

  resultScore.textContent = score;

  // スコア登録フォームのリセット
  scoreSubmitArea.style.display = 'flex';
  submitMessage.style.display = 'none';
  submitScoreBtn.disabled = false;
  submitScoreBtn.textContent = 'スコアを登録';

  setTimeout(() => {
    // showScreen('result-screen') だと game-screen を非表示にしてしまうため、
    // active クラスの追加のみ行い、背後のキャンバスが見えるようにする
    resultScreen.classList.add('active');
  }, state === GameState.CLEAR ? 0 : 600);
}

// --- Draw ---
function draw() {
  const w = canvas.width;
  const h = canvas.height;
  const safeY = h > 150 ? 70 : 0;
  const safeH = h > 150 ? h - 150 : h;
  let scaleX = w / CANVAS_W;
  let scaleY = safeH / CANVAS_H;
  if (h > w) {
    scaleX *= 0.8;
    scaleY *= 0.8;
  }

  ctx.clearRect(0, 0, w, h);

  // Background
  if (images.bg && images.bg.complete) {
    ctx.drawImage(images.bg, 0, 0, w, h);
    // Dark overlay
    ctx.fillStyle = 'rgba(10, 14, 26, 0.4)';
    ctx.fillRect(0, 0, w, h);
  } else {
    // Fallback gradient
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#1a1020');
    grad.addColorStop(1, '#0a0810');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    // Draw brick pattern
    drawBrickWall(w, h);
  }

  // Floor
  const floorY = safeY + safeH * 0.75;
  ctx.fillStyle = 'rgba(60, 40, 20, 0.5)';
  ctx.fillRect(0, floorY, w, h - floorY);
  const floorGrad = ctx.createLinearGradient(0, floorY, 0, floorY + safeH * 0.03);
  floorGrad.addColorStop(0, 'rgba(80, 60, 30, 0.6)');
  floorGrad.addColorStop(1, 'transparent');
  ctx.fillStyle = floorGrad;
  ctx.fillRect(0, floorY, w, safeH * 0.03);

  // Barrel
  const barrelX = w * 0.55 + barrelShakeX; // マツダとプレイヤーが大きくなるため、少し右に寄せる
  const barrelY = safeY + safeH * 0.62; // 少し下に下げる

  // 死亡アニメ飛び出しフェーズ および クリアアニメーション ではmazdaを樽の前景（上）に描画
  const mazdaIsForeground = (
    state === GameState.GAMEOVER &&
    gameoverReason === 'barrel' &&
    (deathAnimPhase === 'barrel-dead2' ||
      deathAnimPhase === 'mazda-dead3' ||
      deathAnimPhase === 'mazda-dead4' ||
      deathAnimPhase === 'done')
  ) || (state === GameState.CLEAR);

  // Mazda lower layer（通常・worried・barrel-shaking時）
  if (!mazdaIsForeground) {
    drawMazda(barrelX, barrelY, scaleX, scaleY);
  }

  // Barrel (drawn on top of mazda in normal state)
  drawBarrel(barrelX, barrelY, scaleX, scaleY);

  // Mazda upper layer（飛び出し以降）
  if (mazdaIsForeground) {
    drawMazda(barrelX, barrelY, scaleX, scaleY);
  }

  // Bubbles
  drawBubbles();

  // Player (pumper)
  drawPlayer(w * 0.18, safeY + safeH * 0.66, scaleX, scaleY);

  // Goats (黒ヤギ左・白ヤギ右)
  drawGoats(w * 0.32, safeY + safeH * 0.82, scaleX, scaleY);

  // Clear animation
  if (isClearAnimating) {
    drawClearAnimation(w, h, scaleX, scaleY, safeY, safeH);
  }

  // Gameover flash for barrel explosion (barrel-shaking フェーズのみ)
  if (state === GameState.GAMEOVER && gameoverReason === 'barrel' && deathAnimPhase === 'barrel-shaking') {
    const flashAlpha = Math.max(0, 0.15 * Math.sin(deathAnimTimer * 0.3));
    ctx.fillStyle = `rgba(255, 60, 0, ${flashAlpha})`;
    ctx.fillRect(0, 0, w, h);
  }
}

// --- Draw Helpers ---
function drawBrickWall(w, h) {
  ctx.fillStyle = 'rgba(100, 50, 30, 0.15)';
  const brickW = 60;
  const brickH = 25;
  for (let row = 0; row < h * 0.75 / brickH; row++) {
    const offset = row % 2 === 0 ? 0 : brickW / 2;
    for (let col = -1; col < w / brickW + 1; col++) {
      ctx.strokeStyle = 'rgba(80, 40, 20, 0.2)';
      ctx.strokeRect(col * brickW + offset, row * brickH, brickW - 2, brickH - 2);
    }
  }
}

// --- 画像ヘルパー（アスペクト比固定） ---
// drawW（ピクセル値）を基準に、naturalHeight/naturalWidth から drawH を計算。
// sy は使わず drawW から導出することで scaleX≠scaleY でも比率が崩れない。
function calcAspectH(img, drawW) {
  if (!img || !img.naturalWidth) return drawW; // フォールバック正方形
  return drawW * (img.naturalHeight / img.naturalWidth);
}

function drawBarrel(x, y, sx, sy) {
  ctx.save();

  // --- 状態に応じた樽画像を選択 ---
  let barrelKey = 'barrel02';
  let shakeX = barrelShakeX;

  if (state === GameState.GAMEOVER && gameoverReason === 'barrel') {
    if (deathAnimPhase === 'barrel-shaking') {
      barrelKey = 'barrel_dead01';
      shakeX = barrelDeadShakeX;
    } else {
      barrelKey = 'barrel_dead02';
      shakeX = 0;
    }
  } else if (state === GameState.CLEAR) {
    barrelKey = 'barrel';
    shakeX = 0;
  }

  // 幅を sx でピクセル化し、高さは画像比率から導出（sy は使わない）
  const barrelLogicW = 320; // 200 -> 320 (約1.6倍)
  const img = images[barrelKey];
  const drawW = barrelLogicW * sx;
  const drawH = img && img.naturalWidth
    ? drawW * (img.naturalHeight / img.naturalWidth)
    : drawW * 1.2; // フォールバック
  const drawX = x + shakeX - drawW / 2;
  const drawY = y - drawH / 2;

  if (img && img.complete && img.naturalWidth) {
    ctx.drawImage(img, drawX, drawY, drawW, drawH);
  } else {
    ctx.fillStyle = '#8B5E3C';
    ctx.fillRect(drawX, drawY, drawW, drawH);
  }

  // クリア成功時: 樽蓋の上に barrel-happy01/02 を交互に描画
  if (state === GameState.CLEAR) {
    const happyKey = Math.floor(Date.now() / 300) % 2 === 0 ? 'barrel_happy01' : 'barrel_happy02';
    const hImg = images[happyKey];
    if (hImg && hImg.complete && hImg.naturalWidth) {
      // 樽と同じ幅で上部レイヤーに描画する
      const hh = drawW * (hImg.naturalHeight / hImg.naturalWidth);
      ctx.drawImage(hImg, drawX, drawY - 100 * sy, drawW, hh);
    }
  }

  ctx.restore();
}

function drawMazda(barrelX, barrelY, sx, sy) {
  if (state === GameState.GAMEOVER && gameoverReason === 'barrel') {
    drawMazdaDead(barrelX, barrelY, sx, sy);
    return;
  }
  if (state === GameState.CLEAR) {
    drawMazdaClear(barrelX, barrelY, sx, sy);
    return;
  }

  ctx.save();

  // 論理幅を基準、高さはアスペクト比で自動計算
  const mazdaLogicW = 250; // 120 -> 240 (2倍)
  const mazdaCenterX = barrelX + worriedShakeX * sx;
  const mazdaCenterY = barrelY - 80 * sy; // 樽が大きくなるためオフセットを調整

  let mazdaKey;
  if (barrelHP <= 50) {
    mazdaKey = 'mazda_worried';
  } else {
    mazdaKey = `mazda_idle0${idleAnimFrame + 1}`;
  }

  const img = images[mazdaKey];
  if (img && img.complete && img.naturalWidth) {
    const drawW = mazdaLogicW * sx;
    const drawH = drawW * (img.naturalHeight / img.naturalWidth);
    ctx.drawImage(img, mazdaCenterX - drawW / 2, mazdaCenterY - drawH / 2, drawW, drawH);
  }

  ctx.restore();
}

function drawMazdaClear(barrelX, barrelY, sx, sy) {
  ctx.save();
  const mazdaLogicW = 250;
  const baseX = barrelX;
  const baseY = barrelY - 80 * sy;

  function drawClearImg(key, cx, cy) {
    const img = images[key];
    if (!img || !img.complete || !img.naturalWidth) return;
    // happy02, happy03 の時だけ 350、他は 250 (mazdaLogicW)
    const currentW = (key === 'mazda_happy02' || key === 'mazda_happy03') ? 500 : mazdaLogicW;
    const drawW = currentW * sx;
    const drawH = drawW * (img.naturalHeight / img.naturalWidth);
    ctx.drawImage(img, cx - drawW / 2, cy - drawH / 2, drawW, drawH);
  }

  if (clearAnimPhase === 'jamp') {
    // 樽の上方
    drawClearImg('mazda_jamp', baseX, baseY - 120 * sy);
  } else if (clearAnimPhase === 'happy1') {
    // 右斜め上
    drawClearImg('mazda_happy01', baseX + 100 * sx, baseY - 100 * sy);
  } else if (clearAnimPhase === 'happy2_drop') {
    // 降下中
    drawClearImg('mazda_happy02', baseX + 100 * sx, baseY - 100 * sy + clearMazdaY * sy * 2); // 落下距離もスケール
  } else if (clearAnimPhase === 'happy3' || clearAnimPhase === 'done') {
    // 降下完了先
    drawClearImg('mazda_happy03', baseX + 100 * sx, baseY - 100 * sy + 180 * sy);
  }

  ctx.restore();
}

function drawMazdaDead(barrelX, barrelY, sx, sy) {
  ctx.save();

  const mazdaLogicW = 250;
  const baseX = barrelX;
  const baseY = barrelY - 80 * sy;

  function drawDeadImg(key, cx, cy) {
    const img = images[key];
    if (!img || !img.complete || !img.naturalWidth) return;
    // dead03, dead04 の時だけ 350、他は 250 (mazdaLogicW)
    const currentW = (key === 'mazda_dead03' || key === 'mazda_dead04') ? 500 : mazdaLogicW;
    const drawW = currentW * sx;
    const drawH = drawW * (img.naturalHeight / img.naturalWidth);
    ctx.drawImage(img, cx - drawW / 2, cy - drawH / 2, drawW, drawH);
  }

  if (deathAnimPhase === 'barrel-shaking') {
    const cx = barrelX + barrelDeadShakeX;
    drawDeadImg('mazda_dead', cx, baseY);

  } else if (deathAnimPhase === 'barrel-dead2') {
    const cx = baseX + mazdaFlyX * sx;
    const cy = baseY + mazdaFlyY * sy;
    const angle = Math.atan2(mazdaFlyVY, mazdaFlyVX);
    ctx.translate(cx, cy);
    ctx.rotate(angle);
    const img = images['mazda_dead02'];
    if (img && img.complete && img.naturalWidth) {
      const drawW = mazdaLogicW * sx;
      const drawH = drawW * (img.naturalHeight / img.naturalWidth);
      ctx.drawImage(img, -drawW / 2, -drawH / 2, drawW, drawH);
    }

  } else if (deathAnimPhase === 'mazda-dead3') {
    const cx = baseX + mazdaFlyX * sx;
    const cy = baseY + mazdaFlyY * sy;
    drawDeadImg('mazda_dead03', cx, cy);

  } else if (deathAnimPhase === 'mazda-dead4' || deathAnimPhase === 'done') {
    const cx = baseX + mazdaFlyX * sx;
    const cy = baseY + mazdaFlyY * sy;
    drawDeadImg('mazda_dead04', cx, cy);
  }

  ctx.restore();
}

function drawPlayer(x, y, sx, sy) {
  ctx.save();
  ctx.translate(x, y);

  const isPumping = playerState === 'pump';
  const isDown = playerState === 'down';

  let imgKey;
  if (isDown) {
    // player_fainted01/02 を交互に
    imgKey = `player_fainted0${Math.floor(Date.now() / 400) % 2 + 1}`;
  } else if (isPumping) {
    imgKey = `player_pomping0${pompAnimFrame + 1}`;
  } else {
    imgKey = `player_idle0${idleAnimFrame + 1}`;
  }

  const img = images[imgKey];
  if (img && img.complete && img.naturalWidth > 0) {
    // 論理幅を基準にアスペクト比で高さを計算
    const playerLogicW = 280; // 160 -> 280 (約1.75倍)
    const drawW = playerLogicW * sx;
    const drawH = drawW * (img.naturalHeight / img.naturalWidth);

    // isDown時の回転描画を削除し、そのまま描画（画像自体が倒れている）
    ctx.drawImage(img, -drawW / 2, -drawH * 0.85, drawW, drawH);
  } else {
    // フォールバック
    if (isDown) {
      ctx.rotate(Math.PI / 2);
      ctx.translate(0, 40 * sy);
    }

    ctx.fillStyle = '#3060a0';
    ctx.fillRect(-15 * sx, -30 * sy, 30 * sx, 60 * sy);
    ctx.fillStyle = '#FFD5A0';
    ctx.beginPath();
    ctx.arc(0, -45 * sy, 18 * sx, 0, Math.PI * 2);
    ctx.fill();
  }

  // 体力低下時のあえぎテキスト
  if (stamina < 25 && !isDown) {
    ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.font = `bold ${14 * sx}px ${getComputedStyle(document.body).fontFamily}`;
    ctx.textAlign = 'center';
    ctx.fillText('ハァ...ハァ...', 0, -175 * sy);
    ctx.textAlign = 'left';
  }

  ctx.restore();
}

/**
 * ヤギ2頭を描画する（黒ヤギ左・白ヤギ右）
 * x, y: 2頭の中心点（論理座標 * スケール済みピクセル）
 *
 * 黒ヤギ フレーム仕様:
 *   通常時     : goat-black01 ↔ goat-black02 切り替え
 *   ポンプ押下中 : goat-black01 ↔ goat-black03 切り替え
 *   ゲーム終了時 : goat-black01 ↔ goat-black04 切り替え
 *
 * 白ヤギ フレーム仕様:
 *   通常時     : goat-white01 ↔ goat-white02 切り替え
 *   ポンプ押下中 : goat-white01 ↔ goat-white04 切り替え
 *   ゲーム終了時 : goat-white01 ↔ goat-white03 切り替え
 */
function drawGoats(x, y, sx, sy) {
  // ゲーム終了状態（GAMEOVER または CLEAR）
  const isGameEnded = (state === GameState.GAMEOVER || state === GameState.CLEAR);
  const isPumping   = (playerState === 'pump') && !isGameEnded;

  // フレーム0/1 の決定（goatAnimFrame は update() 内で毎フレーム更新）
  const frame = goatAnimFrame; // 0 or 1

  // 黒ヤギのキー
  let blackKey;
  if (isGameEnded) {
    blackKey = frame === 0 ? 'goat_black01' : 'goat_black04';
  } else if (isPumping) {
    blackKey = frame === 0 ? 'goat_black01' : 'goat_black03';
  } else {
    blackKey = frame === 0 ? 'goat_black01' : 'goat_black02';
  }

  // 白ヤギのキー
  let whiteKey;
  if (isGameEnded) {
    whiteKey = frame === 0 ? 'goat_white01' : 'goat_white03';
  } else if (isPumping) {
    whiteKey = frame === 0 ? 'goat_white01' : 'goat_white04';
  } else {
    whiteKey = frame === 0 ? 'goat_white01' : 'goat_white02';
  }

  const goatLogicW = 160; // ヤギ1頭の論理幅
  const gap = 20 * sx;   // 2頭の間隔

  // 黒ヤギ（左）
  const blackImg = images[blackKey];
  if (blackImg && blackImg.complete && blackImg.naturalWidth) {
    const drawW = goatLogicW * sx;
    const drawH = drawW * (blackImg.naturalHeight / blackImg.naturalWidth);
    const drawX = x - drawW - gap / 2;
    const drawY = y - drawH;
    ctx.drawImage(blackImg, drawX, drawY, drawW, drawH);
  }

  // 白ヤギ（右）
  const whiteImg = images[whiteKey];
  if (whiteImg && whiteImg.complete && whiteImg.naturalWidth) {
    const drawW = goatLogicW * sx;
    const drawH = drawW * (whiteImg.naturalHeight / whiteImg.naturalWidth);
    const drawX = x + gap / 2;
    const drawY = y - drawH;
    ctx.drawImage(whiteImg, drawX, drawY, drawW, drawH);
  }
}

function drawBubbles() {
  // バブルが0個ならスキップ
  if (bubbles.length === 0) return;

  ctx.save();
  for (let i = 0; i < bubbles.length; i++) {
    const b = bubbles[i];
    ctx.globalAlpha = b.alpha;

    // バブル本体（単純な半透明円 — createRadialGradient を廃止）
    ctx.fillStyle = 'rgba(240, 220, 100, 0.45)';
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
    ctx.fill();

    // ハイライト（小さい白丸）
    ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.beginPath();
    ctx.arc(b.x - b.r * 0.3, b.y - b.r * 0.3, b.r * 0.25, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.restore();
}

function drawClearAnimation(w, h, sx, sy, safeY, safeH) {
  const progress = clearAnimProgress;

  // Flash
  if (progress < 0.2) {
    ctx.fillStyle = `rgba(255, 255, 200, ${(0.2 - progress) * 3})`;
    ctx.fillRect(0, 0, w, h);
  }

  // Explosion particles
  if (progress > 0.1 && progress < 0.8) {
    const particleCount = 30;
    for (let i = 0; i < particleCount; i++) {
      const angle = (i / particleCount) * Math.PI * 2;
      const dist = progress * 400 * sx;
      const px = w / 2 + Math.cos(angle) * dist;
      const py = safeY + safeH * 0.35 + Math.sin(angle) * dist * 0.6;
      const size = (1 - progress) * 8;

      ctx.fillStyle = i % 3 === 0 ? '#f0c030' : i % 3 === 1 ? '#f08020' : '#ffffff';
      ctx.globalAlpha = (1 - progress) * 0.8;
      ctx.beginPath();
      ctx.arc(px, py, size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // "救出成功！" text
  if (progress > 0.3) {
    const textAlpha = Math.min(1, (progress - 0.3) * 3);
    ctx.save();
    ctx.globalAlpha = textAlpha;
    ctx.fillStyle = '#f0c030';
    ctx.font = `bold ${48 * sx}px 'Noto Sans JP', sans-serif`;
    ctx.textAlign = 'center';
    ctx.shadowColor = 'rgba(240, 192, 48, 0.8)';
    ctx.shadowBlur = 30;
    ctx.fillText('救出成功！', w / 2, h / 2);
    ctx.restore();
  }
}

// --- X Share ---
function shareOnX() {
  const gameUrl = window.location.href;
  const text = `マツダ危機一髪！\n俺のスコア ${score}点\nもう来なくていい🤝\n\n${gameUrl}`;
  window.open(
    `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`,
    '_blank'
  );
}

// --- Goat Animation Update (runs every frame regardless of game state) ---
function updateGoatAnim() {
  goatAnimTimer++;
  if (goatAnimTimer >= GOAT_IDLE_INTERVAL) {
    goatAnimTimer = 0;
    goatAnimFrame = (goatAnimFrame + 1) % 2;
  }
}

// --- Game Loop ---
function gameLoop() {
  update();
  if (updateClearAnim()) {
    updateBubbles();
  }
  // 樽破壊死亡アニメを毎フレーム更新
  updateDeathAnim();
  // ヤギアニメは全状態で毎フレーム更新
  updateGoatAnim();
  draw();
  requestAnimationFrame(gameLoop);
}

// ============================================
// Intro Animation
// ============================================

// イントロキャンバスサイズ調整
function resizeIntroCanvas() {
  introCanvas.width = introScreen.clientWidth;
  introCanvas.height = introScreen.clientHeight;
}

// イントロ全体の経過フレーム
let introFrame = 0;
let introFinished = false;

// シーン構成 (60fps想定)
// scene0: 0-70    こしきブリュワリー タイトル
// scene1: 70-190  マツダが平和にしている
// scene2: 190-340 借金取り1人が歩いてくる (スプライトアニメ)
// scene3: 340-440 借金取りがマツダを掴み縛る
// scene4: 440-560 借金取りがマツダを樽に投げ込む
// scene5: 560-700 プレイヤーが発見・驚き・「助けなきゃ！」
// scene6: 700-790 「マツダを救え！」タイトル → タイトル画面へ
const INTRO_SCENES = [
  { start: 0, end: 70 },  // scene 0
  { start: 70, end: 190 },  // scene 1
  { start: 190, end: 340 },  // scene 2
  { start: 340, end: 440 },  // scene 3
  { start: 440, end: 560 },  // scene 4
  { start: 560, end: 700 },  // scene 5
  { start: 700, end: 790 },  // scene 6
];
const INTRO_TOTAL_FRAMES = 790; // 約13秒

function skipIntro() {
  if (introFinished) return;
  introFinished = true;
  showScreen('title-screen');
}

// フェード値計算（alpha 0→1→… →0）
function sceneFade(frame, sceneStart, sceneEnd, fadeLen = 15) {
  const elapsed = frame - sceneStart;
  const total = sceneEnd - sceneStart;
  const fadeIn = Math.min(1, elapsed / fadeLen);
  const fadeOut = Math.min(1, (total - elapsed) / fadeLen);
  return Math.min(fadeIn, fadeOut);
}

// 画像を中央基準で描画するヘルパー
function introDraw(iCtx, key, cx, cy, w, flipH) {
  const img = images[key];
  if (!img || !img.complete || !img.naturalWidth) return;
  const h = w * (img.naturalHeight / img.naturalWidth);
  if (flipH) {
    iCtx.save();
    iCtx.translate(cx, cy);
    iCtx.scale(-1, 1);
    iCtx.drawImage(img, -w / 2, -h / 2, w, h);
    iCtx.restore();
  } else {
    iCtx.drawImage(img, cx - w / 2, cy - h / 2, w, h);
  }
}

// テキスト描画ヘルパー
function introText(iCtx, text, x, y, size, color, shadowColor) {
  iCtx.font = `bold ${size}px 'Noto Sans JP', sans-serif`;
  iCtx.fillStyle = color || 'rgba(240,230,210,0.95)';
  iCtx.textAlign = 'center';
  if (shadowColor) {
    iCtx.shadowColor = shadowColor;
    iCtx.shadowBlur = 16;
  } else {
    iCtx.shadowBlur = 0;
  }
  iCtx.fillText(text, x, y);
  iCtx.shadowBlur = 0;
}

function drawIntroScene(iCtx, iW, iH) {
  const f = introFrame;

  // 背景（常時）
  if (images.bg && images.bg.complete) {
    iCtx.drawImage(images.bg, 0, 0, iW, iH);
  } else {
    iCtx.fillStyle = '#10080a';
    iCtx.fillRect(0, 0, iW, iH);
  }
  // 共通オーバーレイ
  iCtx.fillStyle = 'rgba(0,0,0,0.55)';
  iCtx.fillRect(0, 0, iW, iH);

  const cx = iW / 2;
  const cy = iH / 2;
  const mazdaW = iW * 0.33;
  const debtorW = iW * 0.26;
  const barrelW = iW * 0.30;
  const playerW = iW * 0.26;

  // ===== シーン0: こしきブリュワリー =====
  if (f < INTRO_SCENES[1].start) {
    const alpha = sceneFade(f, INTRO_SCENES[0].start, INTRO_SCENES[0].end, 20);
    iCtx.save();
    iCtx.globalAlpha = alpha;
    introText(iCtx, 'こしきブリュワリー', cx, cy - iH * 0.05, iW * 0.06, '#f0a830', 'rgba(240,168,48,0.8)');
    introText(iCtx, '── その醸造所に、ある日事件が起きた ──', cx, cy + iH * 0.07, iW * 0.032, 'rgba(240,230,210,0.85)');
    iCtx.restore();
  }

  // ===== シーン1: マツダが平和にしている =====
  else if (f < INTRO_SCENES[2].start) {
    const alpha = sceneFade(f, INTRO_SCENES[1].start, INTRO_SCENES[1].end, 20);
    // マツダ: 01, 02
    const mSpriteIdx = Math.floor(f / 30) % 2;
    const mazdaKey = `mazda_tie0${mSpriteIdx + 1}`;
    iCtx.save();
    iCtx.globalAlpha = alpha;
    introDraw(iCtx, mazdaKey, cx, cy + iH * 0.06, mazdaW);
    introText(iCtx, '社長マツダは今日も平和だった。', cx, cy - iH * 0.28, iW * 0.042);
    iCtx.restore();
  }

  // ===== シーン2: 借金取りが歩いて登場 (スプライトアニメ) =====
  else if (f < INTRO_SCENES[3].start) {
    const sceneF = f - INTRO_SCENES[2].start;
    const alpha = sceneFade(f, INTRO_SCENES[2].start, INTRO_SCENES[2].end, 20);
    iCtx.save();
    iCtx.globalAlpha = alpha;

    // マツダ: enemyが登場したら03, 04
    const mSpriteIdx = Math.floor(f / 20) % 2;
    const mazdaKey = `mazda_tie0${mSpriteIdx + 3}`;
    introDraw(iCtx, mazdaKey, cx + iW * 0.18, cy + iH * 0.06, mazdaW * 0.85);

    // 借金取りが右から左へ歩いてくる
    const walkDuration = 110;
    const walkProgress = Math.min(1, sceneF / walkDuration);
    // イーズアウト
    const eased = 1 - Math.pow(1 - walkProgress, 2);
    const debtorTargetX = cx - iW * 0.10;
    const debtorX = iW * 1.15 + (debtorTargetX - iW * 1.15) * eased;
    const debtorY = cy + iH * 0.06;
    // 借金取り（歩く）: 03, 04, 05, 06
    const eSpriteIdx = Math.floor(sceneF / 10) % 4;
    const debtorKey = `debtor0${eSpriteIdx + 3}`;
    // 向き: 右から来るので左向き(flip)
    introDraw(iCtx, debtorKey, debtorX, debtorY, debtorW, true);

    if (sceneF > 90) {
      introText(iCtx, '借金取りがやって来た…！', cx, cy - iH * 0.28, iW * 0.042, '#e04040', 'rgba(200,0,0,0.7)');
    }
    iCtx.restore();
  }

  // ===== シーン3: 借金取りがマツダを掴み縛る =====
  else if (f < INTRO_SCENES[4].start) {
    const sceneF = f - INTRO_SCENES[3].start;
    const alpha = sceneFade(f, INTRO_SCENES[3].start, INTRO_SCENES[3].end, 20);
    iCtx.save();
    iCtx.globalAlpha = alpha;

    // マツダが縛られてもがく (05, 06, 07)
    const shake = Math.sin(sceneF * 0.6) * iW * 0.006;
    const mSpriteIdx = Math.floor(sceneF / 10) % 3;
    const mazdaKey = `mazda_tie0${mSpriteIdx + 5}`;
    introDraw(iCtx, mazdaKey, cx + iW * 0.12 + shake, cy + iH * 0.06, mazdaW);

    // 借金取りが迫る・捕まえる (01, 02)
    const eSpriteIdx = Math.floor(sceneF / 15) % 2;
    introDraw(iCtx, `debtor0${eSpriteIdx + 1}`, cx - iW * 0.14, cy + iH * 0.06, debtorW);

    introText(iCtx, '縄で縛られてしまった！', cx, cy - iH * 0.28, iW * 0.042);
    iCtx.restore();
  }

  // ===== シーン4: 借金取りがマツダを樽に投げ込む =====
  else if (f < INTRO_SCENES[5].start) {
    const sceneF = f - INTRO_SCENES[4].start;
    const alpha = sceneFade(f, INTRO_SCENES[4].start, INTRO_SCENES[4].end, 20);
    iCtx.save();
    iCtx.globalAlpha = alpha;

    const barrelCX = cx + iW * 0.27;
    const barrelCY = cy + iH * 0.12;
    const throwerX = cx - iW * 0.28;
    const throwerY = cy + iH * 0.06;

    const throwStart = 40;
    const throwDuration = 55;
    // マツダは常に 05, 06, 07
    const mSpriteIdx = Math.floor(sceneF / 8) % 3;
    const mazdaTieKey = `mazda_tie0${mSpriteIdx + 5}`;

    if (sceneF < throwStart) {
      // 樽（手前に描画）
      introDraw(iCtx, 'barrel', barrelCX, barrelCY, barrelW);

      // 溜め: 借金取りが構える + マツダを掴んでいる (01, 02, 07)
      const eSpriteIdx = Math.floor(sceneF / 8) % 3;
      const eKeyNum = eSpriteIdx === 2 ? 7 : (eSpriteIdx + 1);
      introDraw(iCtx, `debtor0${eKeyNum}`, throwerX, throwerY, debtorW);
      // マツダが借金取りの上に
      introDraw(iCtx, mazdaTieKey, throwerX + iW * 0.05, throwerY - iH * 0.15, mazdaW * 0.7);
    } else {
      // 投げ: マツダが放物線で飛ぶ
      const throwF = sceneF - throwStart;
      const progress = Math.min(1, throwF / throwDuration);
      const flyX = throwerX + (barrelCX - throwerX) * progress;
      const arcH = iH * 0.5;
      const flyY = throwerY - arcH * 4 * progress * (1 - progress);
      const rotation = progress * Math.PI * 2.5;

      // 借金取りは投げた後、去る (03, 04, 05, 06)
      let currentThrowerX = throwerX;
      let debtorKey = 'debtor01';
      if (throwF < 15) {
        debtorKey = 'debtor07'; // 投げた直後のポーズ
      } else {
        const walkF = throwF - 15;
        currentThrowerX = throwerX - (iW * 0.3) * Math.min(1, walkF / 60);
        const eWalkIdx = Math.floor(walkF / 10) % 4; // 0, 1, 2, 3
        debtorKey = `debtor0${eWalkIdx + 3}`; // 03, 04, 05, 06
      }
      introDraw(iCtx, debtorKey, currentThrowerX, throwerY, debtorW);

      // 飛んでいるマツダ(背面に描画したいので樽より先)
      iCtx.save();
      iCtx.translate(flyX, flyY);
      iCtx.rotate(rotation);
      const mImg = images[mazdaTieKey];
      if (mImg && mImg.complete && mImg.naturalWidth) {
        const mW = mazdaW * 0.72;
        const mH = mW * (mImg.naturalHeight / mImg.naturalWidth);
        iCtx.drawImage(mImg, -mW / 2, -mH / 2, mW, mH);
      }
      iCtx.restore();

      // 樽（マツダの手前になるよう後から描画）
      introDraw(iCtx, 'barrel', barrelCX, barrelCY, barrelW);
    }

    introText(iCtx, 'ビール樽に入れられてしまった！', cx, cy - iH * 0.30, iW * 0.038);
    iCtx.restore();
  }

  // ===== シーン5: プレイヤーが発見・驚き・「助けなきゃ！」 =====
  else if (f < INTRO_SCENES[6].start) {
    const sceneF = f - INTRO_SCENES[5].start;
    const alpha = sceneFade(f, INTRO_SCENES[5].start, INTRO_SCENES[5].end, 20);
    iCtx.save();
    iCtx.globalAlpha = alpha;

    const barrelCX = cx + iW * 0.22;
    const barrelCY = cy + iH * 0.10;

    // マツダが樽の上からのぞいている (上に描画→樽の下に表示するため先に描画)
    const peekOffset = Math.sin(sceneF * 0.12) * iH * 0.008; // 微妙に上下
    const mSpriteIdx = Math.floor(f / 15) % 3;
    iCtx.save();
    iCtx.globalAlpha = alpha * 0.85;
    introDraw(iCtx, `mazda_tie0${mSpriteIdx + 5}`, barrelCX, barrelCY - iH * 0.1 + peekOffset, mazdaW * 0.7);
    iCtx.restore();

    // 樽を上に被せて描画
    introDraw(iCtx, 'barrel02', barrelCX, barrelCY, barrelW);

    // プレイヤーが左から歩いてくる
    const arriveF = 50;
    const playerProgress = Math.min(1, sceneF / arriveF);
    const playerTargetX = cx - iW * 0.22;
    const playerX = -iW * 0.15 + (playerTargetX + iW * 0.15) * playerProgress;
    const playerKey = Math.floor(sceneF / 14) % 2 === 0 ? 'player_idle01' : 'player_idle02';
    introDraw(iCtx, playerKey, playerX, cy + iH * 0.05, playerW);

    // プレイヤーが到着後に驚く
    if (sceneF > arriveF + 5) {
      // ！マーク
      const excAlpha = Math.min(1, (sceneF - arriveF - 5) / 12);
      const excShake = sceneF < arriveF + 25 ? Math.sin(sceneF * 1.8) * iW * 0.01 : 0;
      iCtx.save();
      iCtx.globalAlpha = alpha * excAlpha;
      iCtx.font = `900 ${iW * 0.10}px 'Noto Sans JP', sans-serif`;
      iCtx.fillStyle = '#ffe040';
      iCtx.textAlign = 'center';
      iCtx.shadowColor = 'rgba(255,200,0,0.9)';
      iCtx.shadowBlur = 24;
      iCtx.fillText('！？', playerX + excShake, cy - iH * 0.16);
      iCtx.shadowBlur = 0;
      iCtx.restore();
    }

    // 「助けなきゃ！」決意テキスト
    if (sceneF > arriveF + 40) {
      const decideAlpha = Math.min(1, (sceneF - arriveF - 40) / 20);
      iCtx.save();
      iCtx.globalAlpha = alpha * decideAlpha;
      introText(iCtx, '助けなきゃ！', cx, cy - iH * 0.28, iW * 0.055, '#f0a830', 'rgba(240,168,48,0.9)');
      iCtx.restore();
    }
    iCtx.restore();
  }

  // ===== シーン6: 「マツダを救え！」タイトルテキスト → タイトルへ =====
  else {
    const sceneF = f - INTRO_SCENES[6].start;
    const alpha = Math.min(1, sceneF / 25);
    iCtx.save();

    // 樽とマツダ (マツダを先に描画して樽を被せる)
    const mFlip = Math.floor(f / 25) % 2 === 0;
    const mazdaKey = mFlip ? 'mazda_idle01' : 'mazda_dead';
    iCtx.globalAlpha = alpha * 0.7;
    introDraw(iCtx, mazdaKey, cx, cy - iH * 0.02, mazdaW * 0.8);

    // 樽
    iCtx.globalAlpha = alpha * 0.6;
    introDraw(iCtx, 'barrel', cx, cy + iH * 0.12, barrelW * 1.1);

    // タイトルテキスト（パルス）
    iCtx.globalAlpha = alpha;
    const scale = 1 + 0.04 * Math.sin(sceneF * 0.12);
    iCtx.save();
    iCtx.translate(cx, cy - iH * 0.30);
    iCtx.scale(scale, scale);
    introText(iCtx, 'マツダを救え！', 0, 0, iW * 0.075, '#f0a830', 'rgba(240,100,0,0.9)');
    iCtx.restore();

    iCtx.fillStyle = 'rgba(240,230,210,0.85)';
    iCtx.font = `${iW * 0.036}px 'Noto Sans JP', sans-serif`;
    iCtx.textAlign = 'center';
    iCtx.fillText('ポンプで炭酸圧を高めて樽を吹き飛ばせ！', cx, cy + iH * 0.30);
    iCtx.restore();

    if (sceneF >= INTRO_SCENES[6].end - INTRO_SCENES[6].start - 1) {
      skipIntro();
    }
  }
}

let introAnimId = null;
function introLoop() {
  if (introFinished) return;
  resizeIntroCanvas();
  const iW = introCanvas.width;
  const iH = introCanvas.height;
  introCtx.clearRect(0, 0, iW, iH);
  drawIntroScene(introCtx, iW, iH);
  introFrame++;
  introAnimId = requestAnimationFrame(introLoop);
}

// イントロをリセットして再生開始
function replayIntro() {
  introFrame = 0;
  introFinished = false;
  showScreen('intro-screen');
  introLoop();
}

// --- Event Listeners ---
startBtn.addEventListener('click', () => {
  initGame();
  showScreen('game-screen');
});

pumpBtn.addEventListener('mousedown', (e) => {
  e.preventDefault();
  onPump();
});
pumpBtn.addEventListener('touchstart', (e) => {
  e.preventDefault();
  onPump();
}, { passive: false });

// Keyboard support
document.addEventListener('keydown', (e) => {
  if (e.code === 'Space' && state === GameState.PLAYING) {
    e.preventDefault();
    onPump();
  }
  if (e.code === 'Enter' && state === GameState.TITLE) {
    e.preventDefault();
    initGame();
    showScreen('game-screen');
  }
  // イントロスキップ
  if ((e.code === 'Space' || e.code === 'Enter') && !introFinished && introScreen.classList.contains('active')) {
    e.preventDefault();
    skipIntro();
  }
});

introSkipBtn.addEventListener('click', skipIntro);
introScreen.addEventListener('click', (e) => {
  if (e.target !== introSkipBtn) skipIntro();
});
introScreen.addEventListener('touchend', (e) => {
  if (e.target !== introSkipBtn) skipIntro();
}, { passive: true });

retryBtn.addEventListener('click', () => {
  initGame();
  showScreen('game-screen');
});

// 「ストーリーを見る」ボタン: イントロをリセットして再生
titleBackBtn.addEventListener('click', replayIntro);

shareBtn.addEventListener('click', shareOnX);

window.addEventListener('resize', resizeCanvas);

// --- Init ---
loadImages(() => {
  resizeCanvas();
  resizeIntroCanvas();
  // イントロアニメ開始
  introLoop();

  // ランキングデータを裏で事前ロード
  prefetchRankingData();

  // ゲームループはバックグラウンドで開始
  gameLoop();
});
