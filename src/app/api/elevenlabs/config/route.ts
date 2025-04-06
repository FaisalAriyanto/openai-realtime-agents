import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    apiKey: process.env.ELEVENLABS_API_KEY || "",
    defaultVoiceId: process.env.ELEVENLABS_DEFAULT_VOICE_ID || "Sarah", // Using name instead of ID
    defaultModelId: process.env.ELEVENLABS_MODEL_ID || "eleven_flash_v2_5", // Updated model
    defaultStability: parseFloat(process.env.ELEVENLABS_STABILITY || "0.5"),
    defaultSimilarityBoost: parseFloat(process.env.ELEVENLABS_SIMILARITY_BOOST || "0.75"),
  });
}