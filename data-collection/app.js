import { HandLandmarker, FilesetResolver} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs";

let handLandmarker;

const startButton = document.querySelector("#start-button");
const video = document.querySelector("#camera");

async function startCamera() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            video : { facingMode: "user" , width: {ideal: 640}, height: {ideal: 480} },
            audio: false,
        });
        video.srcObject = stream;
        console.log(stream.getVideoTracks()[0].getSettings());
    } catch (error) {
        console.error("Błąd podczas włączania kamery:", error);
    }
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