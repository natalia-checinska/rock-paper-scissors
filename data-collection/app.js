import { HandLandmarker, FilesetResolver} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs";
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.110.1/+esm";


const SUPABASE_URL = "https://najpevnffbifbhjkrnsu.supabase.co";
const SUPABASE_KEY = "sb_publishable_iKQLMLniEuXyLFh3qRgvWg_FFoM7pXZ";
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

let handLandmarker;
let lastCapture = null; // ostatnia klatka z poprawnie widoczną dłonią
let lastVideoTime = -1;

let testSessionId = null; // id sesji, do której dopinamy zdjęcia
let testFrameIndex = 0; // kolejny numer zdjęcia w sesji

const CROP_SIZE = 256; // zapisujemy 256x256 a będziemy trenowac na 128x128

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

const CROP_MARGIN = 0.2; // margines = 20% rozmiaru dłoni

async function startCamera() {
    startButton.disabled = true;
    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            video : { facingMode: "user" , width: {ideal: 640}, height: {ideal: 480} },
            audio: false,
        });
        video.srcObject = stream;
        console.log(stream.getVideoTracks()[0].getSettings());
        detectionLoop();
    } catch (error) {
        console.error("Błąd podczas włączania kamery:", error);
        startButton.disabled = false;
    }
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

function detectionLoop() {
    if (handLandmarker && video.readyState >= 2 && video.currentTime !== lastVideoTime) {
        lastVideoTime = video.currentTime;

        if (overlay.width !== video.videoWidth) {
            overlay.width = video.videoWidth;
            overlay.height = video.videoHeight;
        }

        const result = handLandmarker.detectForVideo(video, performance.now());

        ctx.clearRect(0,0,overlay.width, overlay.height);
        for (const hand of result.landmarks) {
            for (const point of hand) {
                ctx.beginPath();
                ctx.arc(point.x * overlay.width, point.y * overlay.height, 4, 0, 2 * Math.PI);
                ctx.fillStyle = "red";
                ctx.fill();
            }
        }
        const firstHand = result.landmarks[0];
        // gdy dłoń wykryta i cała mieści się w kadrze
        if (firstHand && isHandInsideFrame(firstHand)) {
            const box = getBoundingBox(firstHand, overlay.width, overlay.height);
            const square = clampSquareToFrame(getSquare(box), overlay.width, overlay.height);
            ctx.strokeStyle = "yellow";
            ctx.lineWidth = 2;
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

async function testSave() {

    const sessionID = crypto.randomUUID();

    const {error} = await supabase.from("sessions").insert({
        id: sessionID,
        participant_id: "test",
        consent_at: new Date().toISOString(),
        user_agent: navigator.userAgent,
        app_version: "0.0.1-test",
        notes: "pierwszy test zapisu",
    });
    if (error) {
        console.error("Błąd podczas zapisu sesji", error);
        return;
    } 
    console.log("Sesja zapisana: ", sessionID);
    testSessionId = sessionID;
    testFrameIndex = 0;

}

async function testSaveImage() {
    if (!lastCapture) { console.warn("Brak dłoni w kadrze, nie zapisano"); return; }
    if (!testSessionId) { console.warn("Kliknij test zapisu"); return; }

    const capture = lastCapture;
    saveCtx.drawImage(cropPreview, 0, 0) // kopia wycinka
    const brightness = computeBrightness(saveCtx);
    const blob = await canvasToJpeg(saveCanvas);

    const imageId = crypto.randomUUID();
    const filePath = `${testSessionId}/${imageId}.jpg`;

    const {error : uploadError} = await supabase.storage
        .from("hand-crops")
        .upload(filePath, blob, {contentType: "image/jpeg", upsert: false});
    if (uploadError) {console.error("Błąd wysyłania zdjęcia:", uploadError); return;}

    const {error : insertError} = await supabase.from("images").insert({
        id: imageId,
        session_id: testSessionId,
        round: 1,
        frame_index: testFrameIndex,
        gesture: "rock",
        landmarks: capture.landmarks.map((p) => [p.x,p.y,p.z]),
        world_landmarks: capture.worldLandmarks.map((p) => [p.x,p.y,p.z]),
        crop_x: capture.square.x,
        crop_y: capture.square.y,
        crop_side: capture.square.side,
        frame_width: capture.frameWidth,
        frame_height: capture.frameHeight,
        brightness: brightness,
        handedness: capture.handedness.categoryName,
        handedness_score: capture.handedness.score,
        file_path: filePath,
        captured_at: capture.capturedAt,
    });
    if (insertError) { console.error("Błąd zapisu wiersza:", insertError); return;}
    
    console.log("Zdjęcie zapisane:", filePath);
    testFrameIndex++;
}
document.querySelector("#test-save-button").addEventListener("click", testSave);
document.querySelector("#test-image-button").addEventListener("click", testSaveImage);

startButton.addEventListener("click", startCamera);


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
    } catch (error) {
        console.error("Nie udało się wczytać modelu", error);
    }
}

loadModel();