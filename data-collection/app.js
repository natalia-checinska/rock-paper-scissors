import { HandLandmarker, FilesetResolver} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs";

let handLandmarker;
let lastVideoTime = -1;

const startButton = document.querySelector("#start-button");
const video = document.querySelector("#camera");
const overlay = document.querySelector("#overlay");
const ctx = overlay.getContext("2d");

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

function detectionLoop() {
    if (handLandmarker && video.readyState >= 2 && video.currentTime !== lastVideoTime) {
        lastVideoTime = video.currentTime;

        if (overlay.width !== video.videoWidth) {
            overlay.width = video.videoWidth;
            overlay.height = video.videoHeight;
        }

        const results = handLandmarker.detectForVideo(video, performance.now());

        ctx.clearRect(0,0,overlay.width, overlay.height);
        for (const hand of results.landmarks) {
            for (const point of hand) {
                ctx.beginPath();
                ctx.arc(point.x * overlay.width, point.y * overlay.height, 4, 0, 2 * Math.PI);
                ctx.fillStyle = "red";
                ctx.fill();
            }
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