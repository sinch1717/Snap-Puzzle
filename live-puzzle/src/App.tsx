import React, { useEffect, useRef, useState, useCallback } from 'react';
import { FilesetResolver, HandLandmarker, DrawingUtils } from '@mediapipe/tasks-vision';
import { Loader2, RotateCcw, Trophy, Hand, Timer, ListOrdered, ArrowRight, User, Star, Wifi, WifiOff } from 'lucide-react';
import confetti from 'canvas-confetti';

// --- FIREBASE IMPORTS ---
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged, signInWithCustomToken } from 'firebase/auth';
import type { User as FirebaseUser } from 'firebase/auth';
import { getFirestore, collection, addDoc, onSnapshot } from 'firebase/firestore';

// --- FIREBASE INIT ---
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const appId = import.meta.env.VITE_APP_ID || 'live-puzzle-dev';

// --- UTILS ---

function captureFrame(video: HTMLVideoElement, width: number, height: number): ImageData {
  const offscreen = document.createElement('canvas');
  offscreen.width = width;
  offscreen.height = height;
  const ctx = offscreen.getContext('2d');
  if (!ctx) throw new Error('Could not get context');
  ctx.translate(width, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(video, 0, 0, width, height);
  return ctx.getImageData(0, 0, width, height);
}

function generatePuzzleState(cols: number, rows: number) {
  const tiles = [];
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      tiles.push({ currentX: x, currentY: y, origX: x, origY: y, id: y * cols + x });
    }
  }
  for (let i = tiles.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [tiles[i], tiles[j]] = [tiles[j], tiles[i]];
  }
  return tiles;
}

function checkWinCondition(tiles: any[]) {
  return tiles.every((tile, index) => tile.id === index);
}

// Count extended fingers (returns 0-5)
function countExtendedFingers(hand: any[]): number {
  const tips = [8, 12, 16, 20];
  const pips = [6, 10, 14, 18];
  let count = 0;

  // Thumb (special case: compare x distance from wrist)
  const thumbTip = hand[4];
  const thumbMcp = hand[2];
  const wrist = hand[0];
  if (Math.hypot(thumbTip.x - wrist.x, thumbTip.y - wrist.y) >
      Math.hypot(thumbMcp.x - wrist.x, thumbMcp.y - wrist.y)) {
    count++;
  }

  // Other 4 fingers
  for (let i = 0; i < tips.length; i++) {
    const tip = hand[tips[i]];
    const pip = hand[pips[i]];
    if (tip.y < pip.y) count++;
  }

  return count;
}

function renderPuzzleGame(
  ctx: CanvasRenderingContext2D,
  imageSource: HTMLCanvasElement,
  tiles: any[],
  cols: number,
  rows: number,
  destWidth: number,
  destHeight: number,
  dragInfo: { index: number; x: number; y: number } | null,
  hoverIndex: number | null,
  flashTiles: Set<number>
) {
  const destTileW = destWidth / cols;
  const destTileH = destHeight / rows;
  const srcTileW = imageSource.width / cols;
  const srcTileH = imageSource.height / rows;

  ctx.fillStyle = '#111';
  ctx.fillRect(0, 0, destWidth, destHeight);

  const drawTile = (tile: any, dx: number, dy: number, width: number, height: number, isDragging = false) => {
    const sx = tile.origX * srcTileW;
    const sy = tile.origY * srcTileH;
    ctx.save();
    if (isDragging) {
      ctx.shadowColor = 'rgba(0,0,0,0.5)';
      ctx.shadowBlur = 15;
      ctx.shadowOffsetY = 10;
      ctx.strokeStyle = '#ccff00';
      ctx.lineWidth = 2;
    } else {
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1;
    }
    ctx.drawImage(imageSource, sx, sy, srcTileW, srcTileH, dx, dy, width, height);
    ctx.strokeRect(dx, dy, width, height);
    ctx.restore();
  };

  tiles.forEach((tile, currentIndex) => {
    const drawCol = currentIndex % cols;
    const drawRow = Math.floor(currentIndex / cols);
    const dx = drawCol * destTileW;
    const dy = drawRow * destTileH;

    if (dragInfo && dragInfo.index === currentIndex) {
      ctx.fillStyle = '#222';
      ctx.fillRect(dx, dy, destTileW, destTileH);
      ctx.strokeStyle = '#333';
      ctx.strokeRect(dx, dy, destTileW, destTileH);
    } else {
      if (dragInfo && hoverIndex === currentIndex) {
        ctx.save();
        ctx.globalAlpha = 0.5;
        drawTile(tile, dx, dy, destTileW, destTileH);
        ctx.fillStyle = 'rgba(204, 255, 0, 0.2)';
        ctx.fillRect(dx, dy, destTileW, destTileH);
        ctx.strokeStyle = '#ccff00';
        ctx.lineWidth = 2;
        ctx.strokeRect(dx, dy, destTileW, destTileH);
        ctx.restore();
      } else {
        drawTile(tile, dx, dy, destTileW, destTileH);
        // Flash green if tile just landed correctly
        if (flashTiles.has(currentIndex)) {
          ctx.save();
          ctx.fillStyle = 'rgba(204, 255, 0, 0.45)';
          ctx.fillRect(dx, dy, destTileW, destTileH);
          ctx.strokeStyle = '#ccff00';
          ctx.lineWidth = 3;
          ctx.strokeRect(dx, dy, destTileW, destTileH);
          ctx.restore();
        }
      }
    }
  });

  if (dragInfo) {
    const tile = tiles[dragInfo.index];
    const dragW = destTileW * 1.1;
    const dragH = destTileH * 1.1;
    drawTile(tile, dragInfo.x - dragW / 2, dragInfo.y - dragH / 2, dragW, dragH, true);
  }
}

// --- CONSTANTS ---
const PINCH_THRESHOLD = 0.05;
const FRAME_THRESHOLD = 0.1;
const RESET_DWELL_MS = 1500;
const FLASH_DURATION_MS = 500;

type GameState = 'SCANNING' | 'COUNTDOWN' | 'PLAYING' | 'SOLVED' | 'LEADERBOARD';

type LeaderboardEntry = {
  id?: string;
  name: string;
  time: number;
  moves: number;
  grid: number;
  date: number;
};

// --- COMPONENT ---
const GestureCamera: React.FC = () => {
  const [modelLoaded, setModelLoaded] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [gameState, setGameState] = useState<GameState>('SCANNING');
  const [error, setError] = useState<string | null>(null);
  const [timeElapsed, setTimeElapsed] = useState(0);
  const [moveCount, setMoveCount] = useState(0);
  const [gridSize, setGridSize] = useState(3);
  const [detectedFingers, setDetectedFingers] = useState<number | null>(null);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [isNewRecord, setIsNewRecord] = useState(false);

  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>(() => {
    try {
      const cached = localStorage.getItem('live-puzzle-leaderboard-cache');
      return cached ? JSON.parse(cached) : [];
    } catch { return []; }
  });

  const [playerName, setPlayerName] = useState('');
  const [personalBest, setPersonalBest] = useState<number | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [user, setUser] = useState<FirebaseUser | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const handLandmarkerRef = useRef<HandLandmarker | null>(null);
  const requestRef = useRef<number | null>(null);
  const thumbnailRef = useRef<HTMLCanvasElement | null>(null);

  const puzzleTilesRef = useRef<any[]>([]);
  const puzzleImageCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const gameBoardCoordsRef = useRef<{ minX: number; maxX: number; minY: number; maxY: number } | null>(null);

  const smoothCursorRef = useRef({ x: 0, y: 0 });
  const dragRef = useRef<{ isDragging: boolean; tileIndex: number | null }>({ isDragging: false, tileIndex: null });
  const lastPinchTimeRef = useRef(0);
  const lastFrameCoordsRef = useRef<any>(null);
  const fistHoldStartRef = useRef<number | null>(null);
  const moveCountRef = useRef(0);
  const gridSizeRef = useRef(3);
  const gameStateRef = useRef<GameState>('SCANNING');

  // Flash tiles state (set of array indices that should flash green)
  const flashTilesRef = useRef<Map<number, number>>(new Map()); // index -> expiry timestamp

  // Keep refs in sync
  useEffect(() => { gridSizeRef.current = gridSize; }, [gridSize]);
  useEffect(() => { gameStateRef.current = gameState; }, [gameState]);

  // --- AUTH ---
  useEffect(() => {
    const initAuth = async () => {
      try {
        // @ts-ignore
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
          // @ts-ignore
          await signInWithCustomToken(auth, __initial_auth_token);
        } else {
          await signInAnonymously(auth);
        }
      } catch { await signInAnonymously(auth); }
    };
    initAuth();
    const unsub = onAuthStateChanged(auth, setUser);
    const storedName = localStorage.getItem('live-puzzle-player-name');
    if (storedName) setPlayerName(storedName);
    const storedBest = localStorage.getItem('live-puzzle-personal-best');
    if (storedBest) setPersonalBest(parseInt(storedBest));
    return () => unsub();
  }, []);

  // --- LEADERBOARD ---
  useEffect(() => {
    if (!user) return;
    const ref = collection(db, 'artifacts', appId, 'public', 'data', 'leaderboard');
    setIsConnected(false);
    const unsub = onSnapshot(ref, (snapshot) => {
      setIsConnected(true);
      const scores: LeaderboardEntry[] = [];
      snapshot.forEach((doc) => scores.push({ id: doc.id, ...doc.data() } as LeaderboardEntry));
      scores.sort((a, b) => a.time - b.time);
      const top = scores.slice(0, 50);
      setLeaderboard(top);
      localStorage.setItem('live-puzzle-leaderboard-cache', JSON.stringify(top));
    }, () => setIsConnected(false));
    return () => unsub();
  }, [user]);

  // --- MEDIAPIPE ---
  useEffect(() => {
    const init = async () => {
      try {
        const vision = await FilesetResolver.forVisionTasks(
          'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm'
        );
        handLandmarkerRef.current = await HandLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
            delegate: 'GPU',
          },
          runningMode: 'VIDEO',
          numHands: 2,
        });
        setModelLoaded(true);
      } catch { setError('AI Model failed to load.'); }
    };
    init();
  }, []);

  // --- CAMERA ---
  useEffect(() => {
    const start = async () => {
      if (!videoRef.current) return;
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
        });
        videoRef.current.srcObject = stream;
        videoRef.current.onloadedmetadata = () => {
          videoRef.current?.play().then(() => setCameraReady(true));
        };
      } catch { setError('Camera access denied.'); }
    };
    start();
  }, []);

  // --- TIMER ---
  useEffect(() => {
    let interval: number;
    if (gameState === 'PLAYING') {
      const startTime = Date.now() - timeElapsed;
      interval = window.setInterval(() => setTimeElapsed(Date.now() - startTime), 100);
    }
    return () => clearInterval(interval);
  }, [gameState]);

  // --- FLASH TILES CLEANUP ---
  useEffect(() => {
    const interval = window.setInterval(() => {
      const now = Date.now();
      let changed = false;
      flashTilesRef.current.forEach((expiry, idx) => {
        if (now > expiry) { flashTilesRef.current.delete(idx); changed = true; }
      });
      if (changed) setFlashTilesState(new Set(flashTilesRef.current.keys()));
    }, 50);
    return () => clearInterval(interval);
  }, []);

  // Dummy state setter just to trigger re-renders when flash tiles change
  const [, setFlashTilesState] = useState<Set<number>>(new Set());

  const resetGame = () => {
    setGameState('SCANNING');
    gameStateRef.current = 'SCANNING';
    puzzleTilesRef.current = [];
    dragRef.current = { isDragging: false, tileIndex: null };
    gameBoardCoordsRef.current = null;
    fistHoldStartRef.current = null;
    setTimeElapsed(0);
    setMoveCount(0);
    moveCountRef.current = 0;
    setIsSubmitting(false);
    setIsNewRecord(false);
    setCountdown(null);
    flashTilesRef.current.clear();
    setFlashTilesState(new Set());
    thumbnailRef.current = null;
  };

  const triggerConfetti = () => {
    confetti({ particleCount: 180, spread: 80, origin: { y: 0.5 }, colors: ['#ccff00', '#ffffff', '#000000'] });
    setTimeout(() => confetti({ particleCount: 80, angle: 60, spread: 55, origin: { x: 0 } }), 300);
    setTimeout(() => confetti({ particleCount: 80, angle: 120, spread: 55, origin: { x: 1 } }), 500);
  };

  const submitScore = async () => {
    if (!playerName.trim() || !user || isSubmitting) return;
    setIsSubmitting(true);
    const cleanName = playerName.trim().toUpperCase();
    localStorage.setItem('live-puzzle-player-name', cleanName);
    if (personalBest === null || timeElapsed < personalBest) {
      setPersonalBest(timeElapsed);
      localStorage.setItem('live-puzzle-personal-best', timeElapsed.toString());
    }
    try {
      await addDoc(collection(db, 'artifacts', appId, 'public', 'data', 'leaderboard'), {
        name: cleanName,
        time: timeElapsed,
        moves: moveCountRef.current,
        grid: gridSizeRef.current,
        date: Date.now(),
      });
      setGameState('LEADERBOARD');
    } catch {
      alert('Could not save score. Connection error.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const formatTime = (ms: number) => {
    const totalSeconds = Math.floor(ms / 1000);
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // --- MAIN RENDER LOOP ---
  const renderLoop = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const landmarker = handLandmarkerRef.current;
    if (!video || !canvas || !cameraReady) { requestRef.current = requestAnimationFrame(renderLoop); return; }
    if (video.readyState < 2) { requestRef.current = requestAnimationFrame(renderLoop); return; }

    if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const width = canvas.width;
    const height = canvas.height;

    ctx.clearRect(0, 0, width, height);

    let results: any = null;
    if (landmarker && modelLoaded) {
      results = landmarker.detectForVideo(video, performance.now());
    }

    const currentState = gameStateRef.current;

    // ---- SCANNING / LEADERBOARD / COUNTDOWN ----
    if (currentState === 'SCANNING' || currentState === 'LEADERBOARD' || currentState === 'COUNTDOWN') {
      ctx.save();
      ctx.translate(width, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(video, 0, 0, width, height);
      ctx.restore();

      if (currentState === 'SCANNING') {
        // Finger detection for grid size (one hand)
        if (results?.landmarks?.length >= 1) {
          const hand = results.landmarks[0];
          const fingers = countExtendedFingers(hand);
          if (fingers >= 3 && fingers <= 5) {
            setDetectedFingers(fingers);
            setGridSize(fingers);
            gridSizeRef.current = fingers;
          } else {
            setDetectedFingers(null);
          }
        } else {
          setDetectedFingers(null);
        }

        // Two-hand frame + pinch to capture
        if (results?.landmarks?.length === 2) {
          const h1 = results.landmarks[0];
          const h2 = results.landmarks[1];
          const d1 = Math.hypot(h1[8].x - h1[4].x, h1[8].y - h1[4].y);
          const d2 = Math.hypot(h2[8].x - h2[4].x, h2[8].y - h2[4].y);

          let validFrame = false;
          if (d1 > FRAME_THRESHOLD && d2 > FRAME_THRESHOLD) {
            const allX = [h1[8].x, h1[4].x, h2[8].x, h2[4].x];
            const allY = [h1[8].y, h1[4].y, h2[8].y, h2[4].y];
            lastFrameCoordsRef.current = {
              minX: Math.min(...allX), maxX: Math.max(...allX),
              minY: Math.min(...allY), maxY: Math.max(...allY),
            };
            validFrame = true;
          }

          if (d1 < PINCH_THRESHOLD && d2 < PINCH_THRESHOLD && lastFrameCoordsRef.current) {
            const now = Date.now();
            if (now - lastPinchTimeRef.current > 1000) {
              lastPinchTimeRef.current = now;
              // Start countdown
              setGameState('COUNTDOWN');
              gameStateRef.current = 'COUNTDOWN';
              setCountdown(3);

              let count = 3;
              const countInterval = setInterval(() => {
                count--;
                if (count <= 0) {
                  clearInterval(countInterval);
                  setCountdown(null);

                  // Capture
                  const fullFrame = captureFrame(video, width, height);
                  const c = lastFrameCoordsRef.current;
                  const sx = (1 - c.maxX) * width;
                  const sy = c.minY * height;
                  const sw = ((1 - c.minX) * width) - sx;
                  const sh = (c.maxY * height) - sy;

                  if (sw > 0 && sh > 0) {
                    const cropCanvas = document.createElement('canvas');
                    cropCanvas.width = sw * 2;
                    cropCanvas.height = sh * 2;
                    const cropCtx = cropCanvas.getContext('2d');
                    const tempC = document.createElement('canvas');
                    tempC.width = width;
                    tempC.height = height;
                    tempC.getContext('2d')?.putImageData(fullFrame, 0, 0);
                    cropCtx?.drawImage(tempC, sx, sy, sw, sh, 0, 0, cropCanvas.width, cropCanvas.height);

                    // Make thumbnail
                    const thumb = document.createElement('canvas');
                    thumb.width = 120;
                    thumb.height = 80;
                    thumb.getContext('2d')?.drawImage(cropCanvas, 0, 0, 120, 80);
                    thumbnailRef.current = thumb;

                    puzzleImageCanvasRef.current = cropCanvas;
                    puzzleTilesRef.current = generatePuzzleState(gridSizeRef.current, gridSizeRef.current);
                    gameBoardCoordsRef.current = { ...c };
                    moveCountRef.current = 0;
                    setMoveCount(0);
                    setTimeElapsed(0);
                    setGameState('PLAYING');
                    gameStateRef.current = 'PLAYING';
                  }
                } else {
                  setCountdown(count);
                }
              }, 1000);
            }
          }

          // Draw frame overlay
          if (lastFrameCoordsRef.current && validFrame) {
            const c = lastFrameCoordsRef.current;
            const sx = (1 - c.maxX) * width;
            const ex = (1 - c.minX) * width;
            const sy = c.minY * height;
            const ey = c.maxY * height;
            ctx.strokeStyle = '#ccff00';
            ctx.lineWidth = 4;
            ctx.strokeRect(sx, sy, ex - sx, ey - sy);
            ctx.fillStyle = 'white';
            ctx.font = 'bold 14px monospace';
            ctx.fillText('PINCH TO CAPTURE', sx, sy - 8);
          }
        }
      }
    }

    // ---- PLAYING / SOLVED ----
    else if ((currentState === 'PLAYING' || currentState === 'SOLVED') && puzzleImageCanvasRef.current && gameBoardCoordsRef.current) {
      ctx.save();
      ctx.translate(width, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(video, 0, 0, width, height);
      ctx.restore();

      const c = gameBoardCoordsRef.current;
      const boardSX = (1 - c.maxX) * width;
      const boardSY = c.minY * height;
      const boardW = ((1 - c.minX) * width) - boardSX;
      const boardH = (c.maxY * height) - boardSY;

      let hoverIndex: number | null = null;
      let isPinching = false;
      let rawPointerX = 0;
      let rawPointerY = 0;
      let interactingHand: any = null;

      if (results?.landmarks?.length > 0) {
        const hand = results.landmarks[0];
        interactingHand = hand;
        const indexTip = hand[8];
        const thumbTip = hand[4];
        rawPointerX = (1 - (indexTip.x + thumbTip.x) / 2) * width;
        rawPointerY = ((indexTip.y + thumbTip.y) / 2) * height;
        const dist = Math.hypot(indexTip.x - thumbTip.x, indexTip.y - thumbTip.y);
        isPinching = dist < PINCH_THRESHOLD;
        const distMove = Math.hypot(rawPointerX - smoothCursorRef.current.x, rawPointerY - smoothCursorRef.current.y);
        const alpha = distMove > 100 ? 1 : 0.4;
        smoothCursorRef.current.x = smoothCursorRef.current.x * (1 - alpha) + rawPointerX * alpha;
        smoothCursorRef.current.y = smoothCursorRef.current.y * (1 - alpha) + rawPointerY * alpha;
      }

      const cursorX = smoothCursorRef.current.x;
      const cursorY = smoothCursorRef.current.y;
      const relX = cursorX - boardSX;
      const relY = cursorY - boardSY;
      const COLS = gridSizeRef.current;
      const ROWS = gridSizeRef.current;

      if (relX >= 0 && relX <= boardW && relY >= 0 && relY <= boardH) {
        const col = Math.floor(relX / (boardW / COLS));
        const row = Math.floor(relY / (boardH / ROWS));
        if (col >= 0 && col < COLS && row >= 0 && row < ROWS) {
          hoverIndex = row * COLS + col;
        }
      }

      if (currentState === 'PLAYING') {
        if (isPinching) {
          if (!dragRef.current.isDragging && hoverIndex !== null) {
            dragRef.current = { isDragging: true, tileIndex: hoverIndex };
          }
        } else {
          if (dragRef.current.isDragging) {
            const startIndex = dragRef.current.tileIndex;
            const endIndex = hoverIndex;
            if (startIndex !== null && endIndex !== null && startIndex !== endIndex) {
              const newTiles = [...puzzleTilesRef.current];
              [newTiles[startIndex], newTiles[endIndex]] = [newTiles[endIndex], newTiles[startIndex]];
              puzzleTilesRef.current = newTiles;
              moveCountRef.current++;
              setMoveCount(moveCountRef.current);

              // Check which tiles are now in correct position & flash them
              const now = Date.now();
              [startIndex, endIndex].forEach((idx) => {
                if (newTiles[idx].id === idx) {
                  flashTilesRef.current.set(idx, now + FLASH_DURATION_MS);
                }
              });
              setFlashTilesState(new Set(flashTilesRef.current.keys()));

              if (checkWinCondition(newTiles)) {
                // Check personal best
                const storedBest = localStorage.getItem('live-puzzle-personal-best');
                const best = storedBest ? parseInt(storedBest) : null;
                const newRecord = best === null || timeElapsed < best;
                setIsNewRecord(newRecord);
                if (newRecord) {
                  setTimeout(triggerConfetti, 200);
                }
                setGameState('SOLVED');
                gameStateRef.current = 'SOLVED';
              }
            }
            dragRef.current = { isDragging: false, tileIndex: null };
          }
        }
      }

      // Render puzzle
      ctx.save();
      ctx.translate(boardSX, boardSY);
      renderPuzzleGame(
        ctx,
        puzzleImageCanvasRef.current,
        puzzleTilesRef.current,
        COLS, ROWS,
        boardW, boardH,
        dragRef.current.isDragging && dragRef.current.tileIndex !== null
          ? { index: dragRef.current.tileIndex, x: relX, y: relY }
          : null,
        hoverIndex,
        flashTilesRef.current.size > 0 ? new Set(
          [...flashTilesRef.current.entries()]
            .filter(([, exp]) => Date.now() < exp)
            .map(([idx]) => idx)
        ) : new Set()
      );
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 4;
      ctx.strokeRect(0, 0, boardW, boardH);
      ctx.restore();

      // Cursor
      if (results?.landmarks?.length > 0) {
        ctx.beginPath();
        ctx.arc(cursorX, cursorY, 10, 0, Math.PI * 2);
        if (dragRef.current.isDragging) {
          ctx.fillStyle = '#ccff00';
          ctx.fill();
        } else {
          ctx.strokeStyle = '#ccff00';
          ctx.lineWidth = 2;
          ctx.stroke();
        }
      }

      // Fist reset
      let isFist = false;
      if (interactingHand) {
        const wrist = interactingHand[0];
        const tips = [8, 12, 16, 20];
        const pips = [6, 10, 14, 18];
        const closed = tips.filter((tipIdx, i) => {
          const tip = interactingHand[tipIdx];
          const pip = interactingHand[pips[i]];
          return Math.hypot(tip.x - wrist.x, tip.y - wrist.y) < Math.hypot(pip.x - wrist.x, pip.y - wrist.y);
        });
        isFist = closed.length === 4;
      }

      if (isFist && currentState === 'PLAYING') {
        if (!fistHoldStartRef.current) fistHoldStartRef.current = performance.now();
        const elapsed = performance.now() - fistHoldStartRef.current;
        const progress = Math.min(elapsed / RESET_DWELL_MS, 1);
        const cx = width / 2;
        const cy = height / 2;
        ctx.save();
        ctx.beginPath();
        ctx.arc(cx, cy, 50, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.fill();
        ctx.beginPath();
        ctx.arc(cx, cy, 50, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * progress);
        ctx.strokeStyle = '#ccff00';
        ctx.lineWidth = 6;
        ctx.lineCap = 'round';
        ctx.stroke();
        ctx.fillStyle = 'white';
        ctx.font = 'bold 14px monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('RESETTING', cx, cy - 5);
        ctx.font = '10px monospace';
        ctx.fillText('Hold Fist', cx, cy + 10);
        ctx.restore();
        if (elapsed > RESET_DWELL_MS) resetGame();
      } else {
        fistHoldStartRef.current = null;
      }
    }

    // Draw skeleton
    if (results?.landmarks && currentState !== 'LEADERBOARD') {
      const drawingUtils = new DrawingUtils(ctx);
      for (const landmarks of results.landmarks) {
        ctx.save();
        ctx.translate(width, 0);
        ctx.scale(-1, 1);
        drawingUtils.drawConnectors(landmarks, HandLandmarker.HAND_CONNECTIONS, { color: '#ffffff', lineWidth: 3 });
        drawingUtils.drawLandmarks(landmarks, { color: '#ffffff', radius: 3, lineWidth: 1 });
        ctx.restore();
      }
    }

    requestRef.current = requestAnimationFrame(renderLoop);
  }, [cameraReady, modelLoaded]);

  useEffect(() => {
    requestRef.current = requestAnimationFrame(renderLoop);
    return () => { if (requestRef.current) cancelAnimationFrame(requestRef.current); };
  }, [renderLoop]);

  return (
    <div className="relative w-full h-full bg-black overflow-hidden rounded-xl">
      <video ref={videoRef} className="hidden" playsInline muted autoPlay />
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full object-cover mx-auto" />

      {/* Grid size selector UI */}
      {gameState === 'SCANNING' && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-20 flex flex-col items-center gap-2 pointer-events-none">
          <div className="flex gap-2">
            {[3, 4, 5].map((n) => (
              <div
                key={n}
                className={`w-10 h-10 rounded-lg flex items-center justify-center font-mono font-bold text-sm border-2 transition-all ${
                  gridSize === n
                    ? 'bg-[#ccff00] text-black border-[#ccff00] scale-110'
                    : 'bg-black/50 text-white/50 border-white/20'
                }`}
              >
                {n}×{n}
              </div>
            ))}
          </div>
          <p className="text-[10px] text-white/50">
            {detectedFingers ? `Detected: ${detectedFingers} fingers` : 'Show 3–5 fingers to set grid'}
          </p>
        </div>
      )}

      {/* Countdown overlay */}
      {gameState === 'COUNTDOWN' && countdown !== null && (
        <div className="absolute inset-0 flex items-center justify-center z-30 pointer-events-none">
          <div className="text-[120px] font-black text-[#ccff00] drop-shadow-2xl animate-ping" style={{ animationDuration: '0.8s' }}>
            {countdown}
          </div>
        </div>
      )}

      {/* Timer + Moves */}
      {gameState === 'PLAYING' && (
        <div className="absolute top-6 left-1/2 -translate-x-1/2 z-20 flex items-center gap-4 bg-zinc-900/80 text-white px-4 py-2 rounded-full border border-white/10 shadow-xl backdrop-blur">
          <Timer className="w-4 h-4 text-[#ccff00]" />
          <span className="font-mono text-lg font-bold tracking-wider">{formatTime(timeElapsed)}</span>
          <span className="text-white/30">|</span>
          <span className="font-mono text-sm text-white/70">{moveCount} moves</span>
        </div>
      )}

      {/* Thumbnail preview */}
      {(gameState === 'PLAYING') && thumbnailRef.current && (
        <div className="absolute bottom-6 right-6 z-20 rounded-lg overflow-hidden border-2 border-white/20 shadow-lg opacity-70 hover:opacity-100 transition-opacity pointer-events-none">
          <canvas
            ref={(el) => { if (el && thumbnailRef.current) { el.width = 120; el.height = 80; el.getContext('2d')?.drawImage(thumbnailRef.current, 0, 0); } }}
            width={120}
            height={80}
          />
          <p className="text-[9px] text-center text-white/50 bg-black/60 py-0.5">TARGET</p>
        </div>
      )}

      {/* Leaderboard button */}
      {gameState === 'SCANNING' && (
        <button
          onClick={() => setGameState('LEADERBOARD')}
          className="absolute top-6 left-6 z-30 flex items-center gap-2 bg-zinc-900/80 text-white px-4 py-2 rounded-full border border-white/10 hover:bg-zinc-800 transition-colors cursor-pointer pointer-events-auto"
        >
          <ListOrdered className="w-4 h-4 text-[#ccff00]" />
          <span className="text-xs font-bold uppercase">Leaderboard</span>
        </button>
      )}

      {/* Instructions */}
      <div className="absolute top-4 right-4 z-20 pointer-events-none">
        <div className="text-[10px] text-white/70 bg-black/60 p-3 rounded-lg backdrop-blur border border-white/10 text-right shadow-xl">
          {gameState === 'SCANNING' && (
            <>
              <p className="font-bold text-[#ccff00] mb-1">PHASE 1: SETUP</p>
              <p>Show 3–5 fingers → set grid</p>
              <p>Frame with 2 hands → Pinch to snap</p>
            </>
          )}
          {gameState === 'PLAYING' && (
            <>
              <p className="font-bold text-[#ccff00] mb-1">PHASE 2: SOLVE</p>
              <p>Pinch to pick up</p>
              <p>Drag & drop to swap</p>
              <p className="text-[#ccff00] mt-1">Hold fist to reset</p>
            </>
          )}
          {gameState === 'SOLVED' && <p className="font-bold text-[#ccff00]">PUZZLE SOLVED!</p>}
          {gameState === 'LEADERBOARD' && <p className="font-bold text-[#ccff00]">TOP PLAYERS</p>}
        </div>
      </div>

      {/* Solved overlay */}
      {gameState === 'SOLVED' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center z-30 bg-black/80 backdrop-blur-md">
          <Trophy className={`w-20 h-20 drop-shadow-lg mb-4 ${isNewRecord ? 'text-[#ccff00]' : 'text-white'}`} />
          {isNewRecord && (
            <div className="mb-2 px-4 py-1 bg-[#ccff00] text-black text-xs font-black rounded-full uppercase tracking-widest animate-bounce">
              🏆 New Record!
            </div>
          )}
          <h2 className="text-3xl font-bold text-white mb-2">COMPLETE!</h2>
          <div className="flex items-center gap-4 mb-2">
            <div className="flex items-center gap-2">
              <Timer className="w-4 h-4 text-[#ccff00]" />
              <span className="text-xl font-mono font-bold text-white">{formatTime(timeElapsed)}</span>
            </div>
            <span className="text-white/30">·</span>
            <span className="text-sm font-mono text-white/70">{moveCount} moves</span>
            <span className="text-white/30">·</span>
            <span className="text-sm font-mono text-white/50">{gridSize}×{gridSize}</span>
          </div>

          <div className="flex flex-col items-center gap-4 w-full max-w-xs mt-6">
            <p className="text-zinc-400 text-sm">Enter your name for the leaderboard</p>
            <div className="flex items-center gap-2 w-full">
              <div className="relative flex-1">
                <User className="absolute left-0 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                <input
                  type="text"
                  placeholder="YOUR NAME"
                  maxLength={10}
                  value={playerName}
                  onChange={(e) => setPlayerName(e.target.value)}
                  className="w-full bg-transparent border-b-2 border-[#ccff00] text-center text-xl text-white outline-none py-2 pl-6 font-mono uppercase focus:border-white transition-colors placeholder:text-zinc-700 pointer-events-auto"
                  onKeyDown={(e) => e.key === 'Enter' && submitScore()}
                  autoFocus
                />
              </div>
              <button
                onClick={submitScore}
                disabled={!playerName.trim() || isSubmitting}
                className="bg-[#ccff00] hover:bg-[#b3e600] disabled:opacity-50 disabled:cursor-not-allowed text-black p-2 rounded-full transition-transform hover:scale-105 pointer-events-auto"
              >
                {isSubmitting ? <Loader2 size={24} className="animate-spin" /> : <ArrowRight size={24} />}
              </button>
            </div>
          </div>

          <button onClick={resetGame} className="mt-6 text-white/40 hover:text-white text-xs underline pointer-events-auto">
            Skip & Play Again
          </button>
        </div>
      )}

      {/* Leaderboard */}
      {gameState === 'LEADERBOARD' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center z-30 bg-black/90 backdrop-blur-xl">
          <div className="w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                <ListOrdered className="w-8 h-8 text-[#ccff00]" />
                <h2 className="text-2xl font-bold text-white tracking-widest uppercase">Leaderboard</h2>
              </div>
              <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-white/5 border border-white/10">
                {isConnected
                  ? <><Wifi className="w-3 h-3 text-green-400" /><span className="text-[10px] text-green-400 font-mono">LIVE</span></>
                  : <><WifiOff className="w-3 h-3 text-red-400" /><span className="text-[10px] text-red-400 font-mono">OFFLINE</span></>
                }
              </div>
            </div>

            <div className="bg-white/5 rounded-xl border border-white/10 overflow-hidden mb-4 max-h-[45vh] overflow-y-auto">
              {leaderboard.length === 0 ? (
                <div className="p-8 text-center text-zinc-500">
                  {isConnected
                    ? <p>No records yet. Be the first!</p>
                    : <div className="flex flex-col items-center gap-2"><Loader2 className="w-6 h-6 animate-spin text-[#ccff00]" /><span>Connecting...</span></div>
                  }
                </div>
              ) : (
                <div className="divide-y divide-white/5">
                  <div className="grid grid-cols-5 p-3 bg-white/5 text-[10px] text-zinc-400 font-bold uppercase tracking-wider sticky top-0 backdrop-blur-md">
                    <span>#</span>
                    <span className="col-span-2">Player</span>
                    <span>Time</span>
                    <span>Grid</span>
                  </div>
                  {leaderboard.map((entry, i) => (
                    <div
                      key={entry.id || i}
                      className={`grid grid-cols-5 items-center p-3 text-sm transition-colors ${entry.name === playerName ? 'bg-[#ccff00]/10' : 'hover:bg-white/5'}`}
                    >
                      <span className={`font-mono font-bold ${i === 0 ? 'text-[#ccff00]' : 'text-zinc-500'}`}>#{i + 1}</span>
                      <span className={`col-span-2 font-bold truncate ${entry.name === playerName ? 'text-[#ccff00]' : 'text-white'}`}>{entry.name}</span>
                      <span className="font-mono text-[#ccff00] text-xs">{formatTime(entry.time)}</span>
                      <span className="font-mono text-white/40 text-xs">{entry.grid ? `${entry.grid}×${entry.grid}` : '3×3'}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {personalBest !== null && (
              <div className="bg-[#ccff00]/10 rounded-xl p-3 mb-4 border border-[#ccff00]/20 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Star className="w-4 h-4 text-[#ccff00]" fill="currentColor" />
                  <span className="text-sm font-bold text-white uppercase">Your Best</span>
                </div>
                <span className="font-mono font-bold text-[#ccff00]">{formatTime(personalBest)}</span>
              </div>
            )}

            <div className="flex justify-center">
              <button
                onClick={resetGame}
                className="bg-[#ccff00] hover:bg-[#b3e600] text-black font-bold py-3 px-8 rounded-full flex items-center gap-2 transition-transform hover:scale-105 pointer-events-auto cursor-pointer"
              >
                <RotateCcw size={20} /> Back to Game
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reset button */}
      {gameState === 'PLAYING' && (
        <button
          onClick={resetGame}
          className="absolute bottom-6 left-6 z-20 bg-zinc-800/80 hover:bg-zinc-700 text-white p-3 rounded-full border border-white/10 transition-colors pointer-events-auto cursor-pointer"
        >
          <RotateCcw size={20} />
        </button>
      )}

      {/* Hand hint */}
      {gameState === 'PLAYING' && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-10 flex items-center gap-2 text-white/40 text-xs pointer-events-none">
          <Hand className="w-4 h-4" />
          <span>Pinch to drag · Fist to reset</span>
        </div>
      )}

      {/* Loaders & errors */}
      {!cameraReady && !error && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-zinc-900 text-white z-20">
          <Loader2 className="w-10 h-10 animate-spin text-[#ccff00] mb-4" />
          <p className="text-sm tracking-wider uppercase">Initializing Camera...</p>
        </div>
      )}
      {cameraReady && !modelLoaded && !error && (
        <div className="absolute top-4 left-4 z-20 flex items-center gap-2 bg-black/60 backdrop-blur px-3 py-1.5 rounded-full border border-[#ccff00]/30">
          <Loader2 className="w-3 h-3 animate-spin text-[#ccff00]" />
          <span className="text-[10px] uppercase tracking-wide text-[#ccff00]">Loading AI...</span>
        </div>
      )}
      {error && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-zinc-900/90 text-red-400 z-30 p-4 text-center">
          <p className="font-bold">Error</p>
          <p className="text-sm">{error}</p>
        </div>
      )}
    </div>
  );
};

export default function App() {
  return (
    <div className="w-screen h-screen flex flex-col items-center justify-center bg-zinc-950 relative" style={{ fontFamily: '"JetBrains Mono", monospace' }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;700&display=swap');
      `}</style>
      <div className="absolute top-4 left-0 right-0 text-center z-10 pointer-events-none">
        <h1 className="text-2xl font-bold tracking-widest text-[#ccff00] uppercase drop-shadow-md">Live Puzzle</h1>
        <p className="text-zinc-400 text-xs mt-1">Show fingers → Frame → Pinch → Solve</p>
      </div>
      <div className="relative w-[95vw] h-[85vh] bg-zinc-900 rounded-xl overflow-hidden shadow-2xl border border-zinc-800">
        <GestureCamera />
      </div>
    </div>
  );
}