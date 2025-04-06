// src/app/lib/elevenLabsConnection.ts
import { RefObject } from "react";
import { ElevenLabsClient } from "elevenlabs";
import * as crypto from "crypto";

export interface ElevenLabsConfig {
    apiKey: string;
    voiceId: string;
    modelId: string;
    stability: number;
    similarityBoost: number;
}

class AudioQueue {
    private queue: Blob[] = [];
    private isPlaying: boolean = false;
    private audioElement: RefObject<HTMLAudioElement | null>;

    constructor(audioElementRef: RefObject<HTMLAudioElement | null>) {
        this.audioElement = audioElementRef;
    }

    addToQueue(audioBlob: Blob) {
        this.queue.push(audioBlob);

        if (!this.isPlaying) {
            this.playNext();
        }
    }

    private playNext() {
        if (this.queue.length === 0 || !this.audioElement.current) {
            this.isPlaying = false;
            return;
        }

        this.isPlaying = true;
        const audioBlob = this.queue.shift();
        if (!audioBlob) {
            this.playNext();
            return;
        }

        const audioUrl = URL.createObjectURL(audioBlob);
        console.log("Playing audio from URL:", audioUrl);

        this.audioElement.current.src = audioUrl;
        this.audioElement.current.onended = () => {
            URL.revokeObjectURL(audioUrl);
            this.playNext();
        };

        this.audioElement.current.play()
            .then(() => console.log("Audio playback started"))
            .catch(error => {
                console.error("Error playing audio:", error);
                // Try to autoplay with user interaction
                const playPromise = this.audioElement.current?.play();
                if (playPromise) {
                    playPromise.catch(() => {
                        console.warn("Autoplay prevented - waiting for user interaction");
                    });
                }
                this.playNext();
            });
    }

    clear() {
        this.queue = [];
        if (this.audioElement.current) {
            this.audioElement.current.pause();
            this.audioElement.current.src = '';
        }
        this.isPlaying = false;
        console.log("Audio queue cleared");
    }
}

/**
 * Adds a WAV header to raw PCM data.
 * @param pcmData - Raw PCM audio data.
 * @param sampleRate - Sample rate of the audio (e.g., 24000).
 * @param channels - Number of channels (1 for mono, 2 for stereo).
 * @param bitDepth - Bit depth of the audio (e.g., 16).
 * @returns Buffer containing the WAV file.
 */
function addWavHeader(pcmData: Uint8Array, sampleRate: number, channels: number, bitDepth: number): Uint8Array {
    const byteRate = (sampleRate * channels * bitDepth) / 8;
    const blockAlign = (channels * bitDepth) / 8;
    const dataSize = pcmData.length;

    // WAV header structure
    const header = new Uint8Array(44);

    // RIFF chunk descriptor
    const riffText = new TextEncoder().encode("RIFF");
    header.set(riffText, 0);
    new DataView(header.buffer).setUint32(4, 36 + dataSize, true);
    const waveText = new TextEncoder().encode("WAVE");
    header.set(waveText, 8);

    // fmt sub-chunk
    const fmtText = new TextEncoder().encode("fmt ");
    header.set(fmtText, 12);
    new DataView(header.buffer).setUint32(16, 16, true); // Subchunk1 size (16 for PCM)
    new DataView(header.buffer).setUint16(20, 1, true); // Audio format (1 for PCM)
    new DataView(header.buffer).setUint16(22, channels, true);
    new DataView(header.buffer).setUint32(24, sampleRate, true);
    new DataView(header.buffer).setUint32(28, byteRate, true);
    new DataView(header.buffer).setUint16(32, blockAlign, true);
    new DataView(header.buffer).setUint16(34, bitDepth, true);

    // data sub-chunk
    const dataText = new TextEncoder().encode("data");
    header.set(dataText, 36);
    new DataView(header.buffer).setUint32(40, dataSize, true);

    // Combine header and PCM data
    const wavFile = new Uint8Array(header.length + pcmData.length);
    wavFile.set(header);
    wavFile.set(pcmData, header.length);

    return wavFile;
}

export async function createElevenLabsConnection(
    config: ElevenLabsConfig,
    audioElement: RefObject<HTMLAudioElement | null>,
    dc: RTCDataChannel
): Promise<void> {
    console.log("Setting up ElevenLabs connection with config:", {
        voiceId: config.voiceId,
        modelId: config.modelId
    });

    if (!config.apiKey) {
        console.error("ElevenLabs API key is missing");
        return;
    }

    const audioQueue = new AudioQueue(audioElement);
    const elevenLabs = new ElevenLabsClient({
        apiKey: config.apiKey,
    });

    // Handle data channel messages
    dc.addEventListener("message", async (e) => {
        try {
            const data = JSON.parse(e.data);
            console.log("Received data channel message type:", data.type);

            // Handle assistant messages that need TTS
            if (data.type === "conversation.item.created" && data.item?.role === "assistant") {
                const text = data.item?.content?.[0]?.text;
                if (text && text.trim()) {
                    console.log("Processing TTS for assistant message:", text.slice(0, 50) + "...");
                    processTextToSpeech(text, elevenLabs, config, audioQueue);
                }
            }

            // Handle audio transcript deltas (streamed speech)
            if (data.type === "response.audio_transcript.delta" && data.delta) {
                console.log("Processing TTS for delta:", data.delta);
                processTextToSpeech(data.delta, elevenLabs, config, audioQueue);
            }

            // Handle speech cancellation
            if (data.type === "response.cancel") {
                console.log("Cancelling audio playback");
                audioQueue.clear();
            }
        } catch (error) {
            console.error("Error processing data channel message:", error);
        }
    });

    console.log("ElevenLabs connection setup complete");
}

async function processTextToSpeech(
    text: string,
    client: ElevenLabsClient,
    config: ElevenLabsConfig,
    audioQueue: AudioQueue
): Promise<void> {
    try {
        console.log(`Generating speech for: "${text.slice(0, 30)}..."`);

        const audioStream = await client.generate({
            voice: config.voiceId,
            text: text,
            model_id: config.modelId,
            voice_settings: {
                stability: config.stability,
                similarity_boost: config.similarityBoost
            },
            output_format: "mp3_44100_32", // Use mp3 instead of pcm for broader compatibility
        });

        // Collect audio chunks
        const chunks: Uint8Array[] = [];
        for await (const chunk of audioStream) {
            chunks.push(new Uint8Array(chunk));
        }

        // Combine chunks into a single blob
        const audioData = concatenateUint8Arrays(chunks);
        const audioBlob = new Blob([audioData], { type: 'audio/mp3' });

        // Add to playback queue
        audioQueue.addToQueue(audioBlob);
        console.log("Added audio to playback queue");

    } catch (error) {
        console.error("Error generating speech:", error);
    }
}


// Helper function to concatenate Uint8Arrays
function concatenateUint8Arrays(arrays: Uint8Array[]): Uint8Array {
    // Calculate the combined length
    const totalLength = arrays.reduce((length, array) => length + array.length, 0);

    // Create a new array with the total length
    const result = new Uint8Array(totalLength);

    // Copy each array into the result
    let offset = 0;
    for (const array of arrays) {
        result.set(array, offset);
        offset += array.length;
    }

    return result;
}

// Helper for API routes
export async function getElevenLabsVoices(apiKey: string): Promise<any[]> {
    const elevenLabs = new ElevenLabsClient({
        apiKey: apiKey,
    });

    try {
        const voices = (await elevenLabs.voices.getAll()).voices;
        return voices;
    } catch (error) {
        console.error("Error fetching ElevenLabs voices:", error);
        return [];
    }
}