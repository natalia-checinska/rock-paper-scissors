import { HandLandmarker, FilesetResolver} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs";
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.110.1/+esm";


const SUPABASE_URL = "https://najpevnffbifbhjkrnsu.supabase.co";
const SUPABASE_KEY = "sb_publishable_iKQLMLniEuXyLFh3qRgvWg_FFoM7pXZ";
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const APP_VERSION = "1.0.0-dev" // dev to testu

// ?debug w adresie włącza podgląd wycinka i punkty dłoni (dla autorki, nie dla uczestników)
const DEBUG = new URLSearchParams(window.location.search).has("debug");

let handLandmarker;
let lastCapture = null; // ostatnia klatka z poprawnie widoczną dłonią
let lastVideoTime = -1;

let sessionId = null;
let sessionPlan = null; // wylosowany plan 4 rund
let currentRound = 0;
let cameraFacing = null;

let pendingUploads = []; // obietnice wysyłania
let failedUploads = 0; // ile zdjęć wysłano

const CROP_SIZE = 256; // zapisujemy 256x256 a będziemy trenowac na 128x128

const screens = document.querySelectorAll(".screen");
const stage = document.querySelector("#stage");

const roundStartButton = document.querySelector("#round-start-button");
const gestureEmoji = document.querySelector("#gesture-emoji");
const captureMessage = document.querySelector("#capture-message");
const countdown = document.querySelector("#countdown");
const progressFill = document.querySelector("#capture-progress-fill");
const participantCode = document.querySelector("#participant-code");

const consentCheckbox = document.querySelector("#consent-checkbox");
const roundTitle = document.querySelector("#round-title");
const roundInstruction = document.querySelector("#round-instruction");
const startButton = document.querySelector("#start-button");
const video = document.querySelector("#camera");
const overlay = document.querySelector("#overlay");
const ctx = overlay.getContext("2d");

const cropPreview = document.querySelector("#crop-preview");
const cropCtx = cropPreview.getContext("2d");

const saveCanvas = document.createElement("canvas"); // płótno jedynie w pamięci
saveCanvas.width = CROP_SIZE;
saveCanvas.height = CROP_SIZE;
const saveCtx = saveCanvas.getContext("2d", {willReadFrequently: true}); // przyspiesza odczyt pikseli z canvas

cropPreview.width = CROP_SIZE;
cropPreview.height = CROP_SIZE;
cropPreview.hidden = !DEBUG; // podgląd wycinka tylko w trybie debug

const CROP_MARGIN = 0.2; // margines = 20% rozmiaru dłoni

const GESTURE_EMOJI = { rock: "✊", paper: "✋", scissors: "✌️" };
const GESTURE_NAMES = { rock: "Kamień", paper: "Papier", scissors: "Nożyce" };


const NONE_HINTS = {
    one_finger: "☝️",
    crossed_fingers: "🤞",
    call_me: "🤙",
    ok: "👌",
    pinched_fingers: "🤌",
    thumbs_down: "👎",
    love_you: "🤟",
    thumbs_up: "👍",
};

const ROUND_COUNT = 4;
const SHOTS_PER_SERIES = 10;
const SHOT_INTERVAL_MS = 300; // odstęp między zdjęciami
const FIRST_COUNTDOWN_S = 5; // odliczanie przed pierwszym gestem
const COUNTDOWN_S = 3;

const ROUND_INSTRUCTIONS = [
    "Ustaw się tak, aby dłoń była dobrze widoczna.",
    "Zmień rękę na drugą.",
    "Zmień miejsce lub oświetlenie.",
    "Znowu zmień rękę.",
]


async function startCamera() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            video : { facingMode: "user" , width: {ideal: 640}, height: {ideal: 480} },
            audio: false,
        });
        video.srcObject = stream;
        const settings = stream.getVideoTracks()[0].getSettings();
        cameraFacing = ["user","environment"].includes(settings.facingMode) ? settings.facingMode : null;
        detectionLoop();
        return true;
    } catch (error) {
        console.error("Błąd podczas włączania kamery:", error);
        showScreen("camera-error");
        return false;
    }
}

async function runCountdown(seconds) {
    for (let i = seconds; i >= 1; i-- ) {
        countdown.textContent = i;
        // restart animacji "wyskoczenia" liczby: zdejmij klasę, wymuś przeliczenie, dodaj z powrotem
        countdown.classList.remove("tick");
        void countdown.offsetWidth;
        countdown.classList.add("tick");
        await sleep(1000);
    }
    countdown.textContent = "";
}

// pasek postępu: szerokość w % (płynność daje transition w CSS)
function setProgress(count, animate = true) {
    progressFill.style.transition = animate ? "" : "none";
    progressFill.style.width = `${(count / SHOTS_PER_SERIES) * 100}%`;
}

// js w przeglądarce jest jednowątkowy - dlatego potrzebujemy uzywac await sleep
function sleep(ms) {
    return new Promise ((resolve) => setTimeout(resolve,ms));
}

async function runRound() {
    roundStartButton.disabled = true;
    showScreen("capture");
    const round = sessionPlan[currentRound];

    for (let s = 0; s < round.steps.length; s++) {
        const step = round.steps[s];
        showGesture(step);
        await runCountdown(s === 0 ? FIRST_COUNTDOWN_S : COUNTDOWN_S);   // 5 s przed pierwszym gestem, potem 3 s
        await captureSeries(step, round.round);
    }

    currentRound++;
    if (currentRound < ROUND_COUNT) {
        showRoundScreen();
    }
    else {
        showScreen("uploading");
        await Promise.all(pendingUploads);
        console.log("Niewysłane zdjęcia: ", failedUploads);
        participantCode.textContent = getParticipantId();
        showScreen("thanks");
    }
}

async function takeShot() {
    const capture = lastCapture;
    saveCtx.drawImage(cropPreview,0,0);
    const brightness = computeBrightness(saveCtx);
    const blob = await canvasToJpeg(saveCanvas);
    return { capture, brightness, blob };
}

async function captureSeries(step, round) {
    let shots = 0;
    setProgress(0, false); // reset bez animacji
    
    while (shots < SHOTS_PER_SERIES) {
        if (lastCapture) {
            showGesture(step);
            const shot = await takeShot();
            pendingUploads.push(uploadShot(shot,round,step,shots));
            shots++;
            setProgress(shots);
            await sleep(SHOT_INTERVAL_MS);
        }
        else {
            captureMessage.textContent = "Pokaż całą dłoń w kadrze";
            await sleep(100);
        }
    }
}

function showGesture(step) {
    // same emotki, bez podpisu; napis pojawia się tylko przy prośbie o dłoń
    gestureEmoji.textContent = step.gesture === "none" ? NONE_HINTS[step.hint] : GESTURE_EMOJI[step.gesture];
    captureMessage.textContent = "";
}

function showRoundScreen() {
    roundStartButton.disabled = false;
    const round = sessionPlan[currentRound];
    roundTitle.textContent = `Runda ${round.round} z ${ROUND_COUNT}`;
    roundInstruction.textContent = round.instruction;
    showScreen("round");
}
function getParticipantId() {
    const fromLink = new URLSearchParams(window.location.search).get("participant");
    if (fromLink) return fromLink;

    const saved = localStorage.getItem("participantId");
    if (saved) return saved;

    const newId = crypto.randomUUID();
    localStorage.setItem("participantId", newId);
    return newId;
}
function updateStartButton() {
    const modelReady = Boolean(handLandmarker);
    startButton.disabled = !(modelReady && consentCheckbox.checked);
    startButton.textContent = modelReady ? "Start" : "Ładowanie...";
}
function showScreen(name) {
    for (const screen of screens) {
        screen.hidden = screen.id !== `screen-${name}`;
    }
    stage.hidden = !(name === "round" || name === "capture");
}
function getBoundingBox(landmarks, frameWidth, frameHeight) {
    // zbieramy najbardziej skrajne punkty x i y
    // landmarks - lista 21 punktów; x, y w zakresie 0-1
    // landmarks.map - dla każdego elementu liczy wynik
    const xs = landmarks.map((p) => p.x * frameWidth); // funkcja strzałkowa, bierze p i zwraca równanie
    const ys = landmarks.map((p) => p.y * frameHeight);
    // xs, ys - listy 21 współrzędnych x i y w pikselach
    const minX = Math.min(...xs); // lewa krawędź
    const maxX = Math.max(...xs); // prawa krawędź
    const minY = Math.min(...ys); // górna krawędź
    const maxY = Math.max(...ys); // dolna krawędź

    return { minX, maxX, minY, maxY };
}

function getSquare(box){
    const width = box.maxX - box.minX;
    const height = box.maxY - box.minY;
    const centerX = (box.minX + box.maxX) / 2;
    const centerY = (box.minY + box.maxY) / 2;

    // dłuższy bok + margines z każdej strony
    const side = Math.max(width,height) * (1 + 2 * CROP_MARGIN);  
    
    // lewy górny róg kwadratu
    return { x: centerX - side / 2, y: centerY - side / 2, side };
}

function clampSquareToFrame(square, frameWidth, frameHeight) {
    // kwadrat nie może być większy niz klatka
    const side = Math.min(square.side, frameWidth, frameHeight);
    // przycinanie liczby do przedziału
    const x = Math.min(Math.max(square.x, 0), frameWidth - side);
    const y = Math.min(Math.max(square.y, 0), frameHeight - side);
    return { x, y, side };
}

function isHandInsideFrame(landmarks){
    // czy każdy element spełnia warunek (jest w zakresie 0-1)
    return landmarks.every((p) => p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1);
}

function computeBrightness(ctx) {
    const data = ctx.getImageData(0,0,CROP_SIZE,CROP_SIZE).data;
    let sum = 0;
    
    for (let i = 0; i < data.length; i += 4) {
        const R = data[i];
        const G = data[i + 1];
        const B = data[i + 2];
        sum += (R + G + B) / 3; // średnia jasność konkretnego piksela
    }

    return sum / (data.length / 4); // średnia jasność na piksel
}

function canvasToJpeg(canvas) {
    return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9));
    // 0.9 -> 90% jakość jpeg
}

function shuffle(array) {
    const result = [...array];
    for (let i = result.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
}

function buildSessionPlan(){
    const hints = shuffle(Object.keys(NONE_HINTS)).slice(0,ROUND_COUNT);

    const plan = [];
    for (let r = 0; r < ROUND_COUNT; r++) {
        const gestures = shuffle(["rock", "paper", "scissors", "none"]);
        plan.push({
            round: r + 1,
            instruction: ROUND_INSTRUCTIONS[r],
            steps:
            gestures.map((g) => ({
                gesture: g,
                hint: g === "none" ? hints[r] : null,
            })),
        });
    }
    return plan;
}

function detectionLoop() {
    if (handLandmarker && video.readyState >= 2 && video.currentTime !== lastVideoTime) {
        lastVideoTime = video.currentTime;

        if (overlay.width !== video.videoWidth) {
            overlay.width = video.videoWidth;
            overlay.height = video.videoHeight;
        }

        const result = handLandmarker.detectForVideo(video, performance.now());

        ctx.clearRect(0,0,overlay.width, overlay.height);
        if (DEBUG) { // punkty dłoni tylko w trybie debug
            for (const hand of result.landmarks) {
                for (const point of hand) {
                    ctx.beginPath();
                    ctx.arc(point.x * overlay.width, point.y * overlay.height, 4, 0, 2 * Math.PI);
                    ctx.fillStyle = "red";
                    ctx.fill();
                }
            }
        }
        const firstHand = result.landmarks[0];
        // gdy dłoń wykryta i cała mieści się w kadrze
        if (firstHand && isHandInsideFrame(firstHand)) {
            const box = getBoundingBox(firstHand, overlay.width, overlay.height);
            const square = clampSquareToFrame(getSquare(box), overlay.width, overlay.height);
            ctx.strokeStyle = "rgba(122, 162, 255, 0.9)"; // jasnoniebieska ramka
            ctx.lineWidth = 3;
            ctx.strokeRect(square.x, square.y, square.side, square.side);

            cropCtx.drawImage(
                video, // skąd
                square.x, square.y, square.side, square.side, // który fragment wziąć
                0, 0, CROP_SIZE, CROP_SIZE // gdzie i jak duży narysować
            );

            lastCapture = {
                landmarks: firstHand,
                worldLandmarks: result.worldLandmarks[0],
                handedness: result.handedness[0][0],
                square: square,
                frameWidth: overlay.width,
                frameHeight: overlay.height,
                capturedAt: new Date().toISOString(),
            };
        }
        else {
            cropCtx.clearRect(0, 0, CROP_SIZE, CROP_SIZE); // czyszczenie poglądu przy braku dłoni
            lastCapture = null; // dłoń nie jest widoczna
        }
    }
    requestAnimationFrame(detectionLoop);
}

async function createSession(consentAt) {
    sessionId = crypto.randomUUID();
    const params = new URLSearchParams(window.location.search);

    const { error } = await supabase.from("sessions").insert({
        id: sessionId,
        participant_id: getParticipantId(),
        consent_at: consentAt,
        user_agent: navigator.userAgent,
        app_version: APP_VERSION,
        camera_facing: cameraFacing,
        notes: params.get("note"),
    });

    if (error) {
        console.error("Błąd zapisu sesji:", error);
        return false;
    }
    return true;
}

async function onStartClick() {
    startButton.disabled = true;
    const consentAt = new Date().toISOString();

    const cameraOk = await startCamera();
    if (!cameraOk) return;

    const sessionOk = await createSession(consentAt);
    if (!sessionOk) { showScreen("error"); return; }

    sessionPlan = buildSessionPlan();
    currentRound = 0;
    showRoundScreen();
}

async function uploadShot(shot,round,step,frameIndex) {
    try {
        const capture = shot.capture;

        const imageId = crypto.randomUUID();
        const filePath = `${sessionId}/${imageId}.jpg`;

        const {error : uploadError} = await supabase.storage
            .from("hand-crops")
            .upload(filePath, shot.blob, {contentType: "image/jpeg", upsert: false});
        if (uploadError) {
            console.error("Błąd wysyłania zdjęcia:", uploadError); 
            failedUploads++;
            return;
        }

        const {error : insertError} = await supabase.from("images").insert({
            id: imageId,
            session_id: sessionId,
            round: round,
            frame_index: frameIndex,
            gesture: step.gesture,
            prompt_hint: step.hint,
            landmarks: capture.landmarks.map((p) => [p.x,p.y,p.z]),
            world_landmarks: capture.worldLandmarks.map((p) => [p.x,p.y,p.z]),
            crop_x: capture.square.x,
            crop_y: capture.square.y,
            crop_side: capture.square.side,
            frame_width: capture.frameWidth,
            frame_height: capture.frameHeight,
            brightness: shot.brightness,
            handedness: capture.handedness.categoryName,
            handedness_score: capture.handedness.score,
            file_path: filePath,
            captured_at: capture.capturedAt,
        });
        if (insertError) { 
            console.error("Błąd zapisu wiersza:", insertError); 
            failedUploads++;
            return;
        }
        
        console.log("Zdjęcie zapisane:", filePath);
    } catch (error) {
        console.error("Nieoczekiwany błąd wywołania", error);
        failedUploads++;
    }
}


startButton.addEventListener("click", onStartClick);

consentCheckbox.addEventListener("change", updateStartButton);

roundStartButton.addEventListener("click", runRound);

async function loadModel() {
    try {
        const vision = await FilesetResolver.forVisionTasks(
            "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm"
        );
        handLandmarker = await HandLandmarker.createFromOptions(vision, {
            baseOptions: { modelAssetPath: "../models/hand_landmarker.task"},
            runningMode: "VIDEO",
            numHands: 1,
        });
        console.log("Model MediaPipe gotowy");
        updateStartButton();
    } catch (error) {
        console.error("Nie udało się wczytać modelu", error);
    }
}

showScreen("welcome");

loadModel();

