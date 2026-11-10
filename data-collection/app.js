import { HandLandmarker, FilesetResolver} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs";

let handLandmarker;
let lastVideoTime = -1;

const startButton = document.querySelector("#start-button");
const video = document.querySelector("#camera");
const overlay = document.querySelector("#overlay");
const ctx = overlay.getContext("2d");

const CROP_MARGIN = 0.1; // margines = 20% rozmiaru dłoni

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
        if (firstHand) {
            const box = getBoundingBox(firstHand, overlay.width, overlay.height);
            ctx.strokeStyle = "lime";
            ctx.lineWidth = 2;
            // rysowanie obrysu
            ctx.strokeRect(box.minX, box.minY, box.maxX - box.minX, box.maxY - box.minY);
            const square = getSquare(box);
            ctx.strokeStyle = "yellow";
            ctx.strokeRect(square.x, square.y, square.side, square.side);
        }
    }
    requestAnimationFrame(detectionLoop);
}

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