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
  private audioElement: HTMLAudioElement | null = null;

  constructor(audioElementRef: RefObject<HTMLAudioElement | null>) {
    this.audioElement = audioElementRef.current;
  }

  addToQueue(audioBlob: Blob) {
    this.queue.push(audioBlob);
    if (!this.isPlaying && this.audioElement) {
      this.playNext();
    }
  }

  private playNext() {
    if (this.queue.length === 0 || !this.audioElement) {
      this.isPlaying = false;
      return;
    }

    this.isPlaying = true;
    const audioBlob = this.queue.shift();
    
    // Check if audioBlob is defined before creating URL
    if (!audioBlob) {
      console.warn("Undefined audio blob encountered");
      this.playNext(); // Skip to next item in queue
      return;
    }
    
    const audioUrl = URL.createObjectURL(audioBlob);
    
    this.audioElement.src = audioUrl;
    this.audioElement.onended = () => {
      URL.revokeObjectURL(audioUrl);
      this.playNext();
    };
    
    this.audioElement.play().catch(error => {
      console.error("Error playing audio:", error);
      this.playNext();
    });
  }

  clear() {
    this.queue = [];
    if (this.audioElement) {
      this.audioElement.pause();
      this.audioElement.src = '';
    }
    this.isPlaying = false;
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
  const audioQueue = new AudioQueue(audioElement);
  const elevenLabs = new ElevenLabsClient({
    apiKey: config.apiKey,
  });

  // Language to voice mapper
  const languageToVoiceMapper: { [key: string]: string } = {
    "en-US": "Sarah",
    "id": "RR Mila",
    "ms": "Afifah"
  };

  // Listen to message events from the data channel
  dc.addEventListener("message", async (e) => {
    const data = JSON.parse(e.data);
    
    // Handle assistant messages to generate speech
    if (data.type === "conversation.item.created" && data.item?.role === "assistant") {
      const text = data.item?.content?.[0]?.text;
      if (text && text.trim()) {
        try {
          // Log the request (similar to ApiLogger in the reference)
          console.log("TTS Request", {
            serviceName: "ElevenLabs",
            action: "synthesizeSpeech",
            params: {
              textLength: text.length,
              textPreview: text.slice(0, 50) + (text.length > 50 ? "..." : ""),
              voiceId: config.voiceId,
              modelId: config.modelId
            }
          });

          // Generate audio with ElevenLabs
          const audioStream = await elevenLabs.generate({
            voice: config.voiceId,
            text: text,
            model_id: config.modelId,
            output_format: "pcm_24000", // PCM format
          });

          // Collect audio chunks
          const chunks: Uint8Array[] = [];
          for await (const chunk of audioStream) {
            chunks.push(new Uint8Array(chunk));
          }

          // Convert to single buffer
          const pcmData = concatenateUint8Arrays(chunks);
          
          // Add WAV header for proper audio format
          const wavBuffer = addWavHeader(pcmData, 24000, 1, 16); // 24kHz, mono, 16-bit
          
          // Create blob and play
          const audioBlob = new Blob([wavBuffer], { type: 'audio/wav' });
          audioQueue.addToQueue(audioBlob);
          
        } catch (error) {
          console.error("Error generating audio with ElevenLabs:", error);
        }
      }
    }
    
    // Handle audio transcript deltas
    if (data.type === "response.audio_transcript.delta" && data.delta) {
      try {
        // Log the request
        console.log("TTS Delta Request", {
          serviceName: "ElevenLabs",
          action: "synthesizeSpeech",
          params: {
            textLength: data.delta.length,
            textPreview: data.delta,
            voiceId: config.voiceId,
            modelId: config.modelId
          }
        });

        // Generate audio with ElevenLabs
        const audioStream = await elevenLabs.generate({
          voice: config.voiceId,
          text: data.delta,
          model_id: config.modelId,
          output_format: "pcm_24000", // PCM format
        });
        
        // Collect audio chunks
        const chunks: Uint8Array[] = [];
        for await (const chunk of audioStream) {
          chunks.push(new Uint8Array(chunk));
        }
        
        // Convert to single buffer
        const pcmData = concatenateUint8Arrays(chunks);
        
        // Add WAV header for proper audio format
        const wavBuffer = addWavHeader(pcmData, 24000, 1, 16); // 24kHz, mono, 16-bit
        
        // Create blob and play
        const audioBlob = new Blob([wavBuffer], { type: 'audio/wav' });
        audioQueue.addToQueue(audioBlob);
        
      } catch (error) {
        console.error("Error streaming audio with ElevenLabs:", error);
      }
    }
    
    // Handle speech cancellation
    if (data.type === "response.cancel") {
      audioQueue.clear();
    }
  });
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