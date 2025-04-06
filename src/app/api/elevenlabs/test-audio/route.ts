import { NextResponse } from "next/server";
import { ElevenLabsClient } from "elevenlabs";

export async function GET() {
  const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
  
  if (!ELEVENLABS_API_KEY) {
    return NextResponse.json(
      { error: "ElevenLabs API key not configured" },
      { status: 500 }
    );
  }

  try {
    const client = new ElevenLabsClient({
      apiKey: ELEVENLABS_API_KEY,
    });
    
    // Generate a simple test audio
    const audioStream = await client.generate({
      voice: "Sarah",
      text: "This is a test of the ElevenLabs integration.",
      model_id: "eleven_flash_v2_5",
      voice_settings: {
        stability: 0.5,
        similarity_boost: 0.75
      },
    });
    
    // Collect audio chunks
    const chunks: Uint8Array[] = [];
    for await (const chunk of audioStream) {
      chunks.push(new Uint8Array(chunk));
    }
    
    // Create a Blob from the chunks
    const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
    const audioData = new Uint8Array(totalLength);
    
    let offset = 0;
    for (const chunk of chunks) {
      audioData.set(chunk, offset);
      offset += chunk.length;
    }
    
    return new NextResponse(audioData, {
      headers: {
        "Content-Type": "audio/mpeg",
      },
    });
  } catch (error) {
    console.error("Error generating test audio:", error);
    return NextResponse.json(
      { error: "Failed to generate test audio" },
      { status: 500 }
    );
  }
}