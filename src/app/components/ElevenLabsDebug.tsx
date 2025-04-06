// src/app/components/ElevenLabsDebug.tsx

import React, { useState, useEffect } from 'react';

interface ElevenLabsDebugProps {
  elevenLabsConfig: any;
  audioElementRef: React.RefObject<HTMLAudioElement | null>;
  dataChannelState: string | null;
}

const ElevenLabsDebug: React.FC<ElevenLabsDebugProps> = ({ 
  elevenLabsConfig, 
  audioElementRef,
  dataChannelState
}) => {
  const [testAudioPlayed, setTestAudioPlayed] = useState(false);
  const [debugInfo, setDebugInfo] = useState<Record<string, any>>({});

  useEffect(() => {
    setDebugInfo({
      elevenLabsApiKeyPresent: !!elevenLabsConfig?.apiKey,
      elevenLabsVoiceId: elevenLabsConfig?.voiceId,
      elevenLabsModelId: elevenLabsConfig?.modelId,
      audioElementExists: !!audioElementRef.current,
      audioElementSrc: audioElementRef.current?.src || 'none',
      dataChannelState: dataChannelState,
      browserSupportsAudio: typeof Audio !== 'undefined',
      browserAgent: navigator.userAgent,
    });
  }, [elevenLabsConfig, audioElementRef.current, dataChannelState]);

  const playTestAudio = () => {
    if (audioElementRef.current) {
      try {
        // Create a short beep sound using Web Audio API
        const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();
        
        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);
        
        oscillator.frequency.value = 440;
        gainNode.gain.value = 0.5;
        
        oscillator.start();
        setTimeout(() => {
          oscillator.stop();
          setTestAudioPlayed(true);
        }, 500);
        
        console.log("Test audio played successfully");
      } catch (error) {
        console.error("Error playing test audio:", error);
      }
    } else {
      console.error("No audio element available for test");
    }
  };

  const testVoicePlayback = async () => {
    try {
      if (!audioElementRef.current) {
        console.error("No audio element available");
        return;
      }

      // Create a simple audio blob with speech
      const response = await fetch('/api/elevenlabs/test-audio');
      if (!response.ok) {
        console.error("Failed to fetch test audio");
        return;
      }

      const audioBlob = await response.blob();
      const audioUrl = URL.createObjectURL(audioBlob);
      
      audioElementRef.current.src = audioUrl;
      audioElementRef.current.onended = () => {
        URL.revokeObjectURL(audioUrl);
        setTestAudioPlayed(true);
      };
      
      const playPromise = audioElementRef.current.play();
      if (playPromise) {
        playPromise.catch(error => {
          console.error("Error playing audio:", error);
        });
      }
    } catch (error) {
      console.error("Error testing voice playback:", error);
    }
  };

  return (
    <div className="fixed bottom-0 right-0 bg-white p-4 border border-gray-300 rounded-tl-lg text-xs max-w-xs z-50 overflow-auto max-h-80">
      <h3 className="font-bold mb-2">ElevenLabs Debug</h3>
      <ul>
        {Object.entries(debugInfo).map(([key, value]) => (
          <li key={key}>
            <span className="font-semibold">{key}:</span> {JSON.stringify(value)}
          </li>
        ))}
      </ul>
      <div className="mt-2 flex gap-2">
        <button 
          onClick={playTestAudio} 
          className="bg-blue-500 text-white px-2 py-1 rounded text-xs"
        >
          Test Audio
        </button>
        <button 
          onClick={testVoicePlayback} 
          className="bg-green-500 text-white px-2 py-1 rounded text-xs"
        >
          Test Voice
        </button>
        <span>{testAudioPlayed ? '✅ Audio played' : ''}</span>
      </div>
    </div>
  );
};

export default ElevenLabsDebug;