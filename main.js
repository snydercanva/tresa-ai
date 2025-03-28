const output = document.getElementById('output');
const waveformCanvas = document.getElementById('waveform');
const canvasCtx = waveformCanvas.getContext('2d');
const orb = document.getElementById('orb');
const loading = document.getElementById('loading');
const instructionOverlay = document.getElementById('instruction-overlay');
const closeInstructionButton = document.getElementById('close-instruction');

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const recognition = new SpeechRecognition();
recognition.continuous = false;
recognition.interimResults = false;
recognition.lang = 'en-US';
recognition.maxAlternatives = 1;

let isRecording = false;
let audioContext, analyser, dataArray, source;
let isSpacePressed = false;
let currentAudio = null;

// Close instruction overlay
closeInstructionButton.addEventListener('click', () => {
    instructionOverlay.classList.add('hidden');
});

// Close overlay with Esc key
document.addEventListener('keydown', (event) => {
    if (event.code === 'Escape' && !instructionOverlay.classList.contains('hidden')) {
        instructionOverlay.classList.add('hidden');
    }
});

function updateOrbState(state) {
    orb.classList.remove('orb-idle', 'orb-listening', 'orb-speaking');
    if (state === 'listening') {
        orb.classList.add('orb-listening');
    } else if (state === 'speaking') {
        orb.classList.add('orb-speaking');
    } else {
        orb.classList.add('orb-idle');
    }
}

async function setupWaveform() {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 2048;
    dataArray = new Uint8Array(analyser.frequencyBinCount);
    source = audioContext.createMediaStreamSource(stream);
    source.connect(analyser);

    waveformCanvas.classList.remove('hidden');
    drawWaveform();
}

function drawWaveform() {
    if (!isRecording) return;

    requestAnimationFrame(drawWaveform);
    analyser.getByteTimeDomainData(dataArray);

    canvasCtx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    canvasCtx.fillRect(0, 0, waveformCanvas.width, waveformCanvas.height);

    // Draw mirrored waveform with gradient
    const gradient = canvasCtx.createLinearGradient(0, 0, 0, waveformCanvas.height);
    gradient.addColorStop(0, '#00ffcc');
    gradient.addColorStop(1, '#00ccff');

    canvasCtx.lineWidth = 3;
    canvasCtx.strokeStyle = gradient;
    canvasCtx.beginPath();

    const sliceWidth = waveformCanvas.width / dataArray.length;
    let x = 0;

    for (let i = 0; i < dataArray.length; i++) {
        const v = dataArray[i] / 128.0;
        const y = (v * waveformCanvas.height) / 2;

        if (i === 0) {
            canvasCtx.moveTo(x, y);
        } else {
            canvasCtx.lineTo(x, y);
        }

        x += sliceWidth;
    }

    canvasCtx.lineTo(waveformCanvas.width, waveformCanvas.height / 2);
    canvasCtx.stroke();

    // Mirror the waveform
    canvasCtx.beginPath();
    x = 0;
    for (let i = 0; i < dataArray.length; i++) {
        const v = dataArray[i] / 128.0;
        const y = waveformCanvas.height - (v * waveformCanvas.height) / 2;

        if (i === 0) {
            canvasCtx.moveTo(x, y);
        } else {
            canvasCtx.lineTo(x, y);
        }

        x += sliceWidth;
    }

    canvasCtx.lineTo(waveformCanvas.width, waveformCanvas.height / 2);
    canvasCtx.stroke();
}

async function startRecording() {
    if (!isRecording) {
        await setupWaveform();
        recognition.start();
        output.innerText = 'I’m listening... Speak now!';
        output.classList.remove('opacity-0');
        output.classList.add('opacity-100');
        updateOrbState('listening');
        isRecording = true;
    }
}

function stopRecording() {
    if (isRecording) {
        recognition.stop();
        if (audioContext) audioContext.close();
        waveformCanvas.classList.add('hidden');
        isRecording = false;
        updateOrbState('idle');
    }
}

async function processSpeech(transcript) {
    output.innerText = `I heard: "${transcript}"`;
    output.classList.remove('opacity-0');
    output.classList.add('opacity-100');
    loading.classList.remove('hidden');
    updateOrbState('speaking');

    try {
        const response = await fetch('http://localhost:5000/api/process', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ command: transcript })
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
        }

        const contentType = response.headers.get('content-type');
        if (contentType && contentType.includes('application/json')) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Unexpected JSON response');
        }

        const audioBlob = await response.blob();
        const audioUrl = URL.createObjectURL(audioBlob);
        console.log('Audio URL:', audioUrl);
        const audio = new Audio(audioUrl);
        currentAudio = audio;
        output.innerText = 'Speaking my response...';
        loading.classList.add('hidden');
        audio.play().catch((error) => {
            console.error('Playback error:', error);
            output.innerText = `Playback error: ${error.message}. Let’s try again!`;
            updateOrbState('idle');
            setTimeout(() => {
                output.innerText = 'Press and hold the spacebar to speak.';
                output.classList.remove('opacity-0');
                output.classList.add('opacity-100');
            }, 3000);
        });

        audio.onended = () => {
            currentAudio = null;
            output.innerText = 'I’m ready! Press and hold the spacebar to speak again.';
            output.classList.remove('opacity-0');
            output.classList.add('opacity-100');
            updateOrbState('idle');
        };
    } catch (error) {
        console.error('Fetch error:', error);
        loading.classList.add('hidden');
        output.innerText = `Oops, something went wrong: ${error.message}. Let’s try again!`;
        updateOrbState('idle');
        setTimeout(() => {
            output.innerText = 'Press and hold the spacebar to speak.';
            output.classList.remove('opacity-0');
            output.classList.add('opacity-100');
        }, 3000);
    }
}

recognition.onresult = async (event) => {
    const transcript = event.results[0][0].transcript.trim().toLowerCase();
    stopRecording();
    await processSpeech(transcript);
};

recognition.onend = () => {
    if (isRecording) {
        stopRecording();
    }
};

recognition.onerror = (event) => {
    stopRecording();
    if (event.error === 'no-speech') {
        output.innerText = 'I didn’t hear anything. Speak louder or closer to the mic!';
    } else {
        output.innerText = `Oops, an error occurred: ${event.error}. Let’s try again!`;
    }
    updateOrbState('idle');
    setTimeout(() => {
        output.innerText = 'Press and hold the spacebar to speak.';
        output.classList.remove('opacity-0');
        output.classList.add('opacity-100');
    }, 3000);
};

// Spacebar event listeners
document.addEventListener('keydown', (event) => {
    if (event.code === 'Space' && !isSpacePressed) {
        event.preventDefault();
        isSpacePressed = true;
        if (currentAudio) {
            currentAudio.pause();
            currentAudio = null;
            output.innerText = 'Response canceled. Press and hold the spacebar to speak.';
            output.classList.remove('opacity-0');
            output.classList.add('opacity-100');
            updateOrbState('idle');
        } else {
            startRecording();
        }
    } else if (event.code === 'Escape') {
        if (currentAudio) {
            currentAudio.pause();
            currentAudio = null;
            output.innerText = 'Response canceled. Press and hold the spacebar to speak.';
            output.classList.remove('opacity-0');
            output.classList.add('opacity-100');
            updateOrbState('idle');
        }
    }
});

document.addEventListener('keyup', (event) => {
    if (event.code === 'Space') {
        event.preventDefault();
        isSpacePressed = false;
        stopRecording();
    }
});