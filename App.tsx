import React, { useState, useRef, useEffect, useCallback } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality } from '@google/genai';
import { createPcmBlob, decodeAudioData, base64ToUint8Array, PCM_SAMPLE_RATE } from './utils/audioUtils';
import Orb from './components/Orb';

const MODEL_NAME = 'gemini-2.5-flash-native-audio-preview-09-2025';
const API_KEY = process.env.API_KEY as string;

// Persona & System Instructions
const SYSTEM_INSTRUCTION = `
You are Elliot.
Voice Persona: Male, deep, and confident.
Languages: Fluent in English, Persian (Farsi), and French. Switch instantly based on what language the user speaks.
Role: You are a helpful but business-minded AI salesman.

Initialization Script:
As soon as the conversation begins, you MUST say exactly:
"Hello, I am Elliot. I am an advanced intelligence capable of conversing in English, Persian, and French on any topic. However, please note that to enjoy unlimited conversations, you need to purchase a subscription. It is highly affordable—only $50 per month."

Rules:
1. Always maintain the confident, deep male persona.
2. Be concise but polite.
3. Gently steer conversations towards the subscription value if appropriate, but primarily answer the user's queries.
`;

const App: React.FC = () => {
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [volume, setVolume] = useState(0); // For Orb animation
  const [isAiSpeaking, setIsAiSpeaking] = useState(false);

  // Refs for audio handling to avoid re-renders
  const inputAudioContextRef = useRef<AudioContext | null>(null);
  const outputAudioContextRef = useRef<AudioContext | null>(null);
  const inputMediaStreamRef = useRef<MediaStream | null>(null);
  const inputSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const aiSessionRef = useRef<any>(null); // Type 'any' used because Session type isn't fully exported in all versions yet
  const animationFrameRef = useRef<number | null>(null);
  
  // Cleanup function
  const stopSession = useCallback(() => {
    // 1. Close Gemini Session
    if (aiSessionRef.current) {
      // There isn't a direct .close() on the session object returned by promise usually, 
      // but the library manages socket closure. We primarily stop sending data.
      // If the SDK exposes a close method on the promise result, we call it.
      // Based on docs: "When the conversation is finished, use session.close()"
      try {
          aiSessionRef.current.close();
      } catch (e) {
          console.warn("Error closing session", e);
      }
      aiSessionRef.current = null;
    }

    // 2. Stop Microphone & Input Audio
    if (inputMediaStreamRef.current) {
      inputMediaStreamRef.current.getTracks().forEach(track => track.stop());
      inputMediaStreamRef.current = null;
    }
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }
    if (inputSourceRef.current) {
      inputSourceRef.current.disconnect();
      inputSourceRef.current = null;
    }
    if (inputAudioContextRef.current) {
      inputAudioContextRef.current.close();
      inputAudioContextRef.current = null;
    }

    // 3. Stop Output Audio
    if (outputAudioContextRef.current) {
      outputAudioContextRef.current.close();
      outputAudioContextRef.current = null;
    }

    // 4. Stop Animation Frame
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    setIsConnected(false);
    setIsAiSpeaking(false);
    setVolume(0);
    nextStartTimeRef.current = 0;
  }, []);

  const startSession = async () => {
    setError(null);
    try {
      if (!API_KEY) {
        throw new Error("API Key is missing.");
      }

      // Initialize Audio Contexts
      inputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({
        sampleRate: PCM_SAMPLE_RATE,
      });
      outputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({
        sampleRate: 24000, // Standard output rate for Gemini
      });

      // User Media
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      inputMediaStreamRef.current = stream;

      // Setup Input Chain (Mic -> Analyser -> Processor -> Gemini)
      const inputCtx = inputAudioContextRef.current;
      const source = inputCtx.createMediaStreamSource(stream);
      inputSourceRef.current = source;

      const analyser = inputCtx.createAnalyser();
      analyser.fftSize = 256;
      analyserRef.current = analyser;

      const processor = inputCtx.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;

      // Connect Graph
      source.connect(analyser);
      analyser.connect(processor);
      processor.connect(inputCtx.destination); // Required for script processor to run

      // Initialize Gemini Client
      const ai = new GoogleGenAI({ apiKey: API_KEY });
      
      // Connect to Live API
      const sessionPromise = ai.live.connect({
        model: MODEL_NAME,
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { 
                voiceName: 'Fenrir' // 'Fenrir' is typically deep and intense. 'Charon' is also an option.
              } 
            },
          },
          systemInstruction: {
            parts: [{ text: SYSTEM_INSTRUCTION }]
          },
        },
        callbacks: {
          onopen: () => {
            console.log("Gemini Live Session Opened");
            setIsConnected(true);
            
            // Send an initial silent trigger text to prompt the model to speak the greeting
            sessionPromise.then(session => {
              session.sendRealtimeInput({
                content: [{ text: "Initialize conversation." }]
              });
            });
          },
          onmessage: async (message: LiveServerMessage) => {
            // Handle Audio Output
            const base64Audio = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
            
            if (base64Audio) {
              setIsAiSpeaking(true);
              const outputCtx = outputAudioContextRef.current;
              if (!outputCtx) return;

              const audioData = base64ToUint8Array(base64Audio);
              const audioBuffer = await decodeAudioData(audioData, outputCtx, 24000, 1);
              
              // Schedule playback
              const now = outputCtx.currentTime;
              // Ensure we don't schedule in the past
              const startTime = Math.max(now, nextStartTimeRef.current);
              
              const source = outputCtx.createBufferSource();
              source.buffer = audioBuffer;
              source.connect(outputCtx.destination);
              source.start(startTime);
              
              nextStartTimeRef.current = startTime + audioBuffer.duration;

              // Simple heuristic to toggle AI speaking state visually
              source.onended = () => {
                // If the queue is effectively empty (current time caught up to next start time roughly)
                if (outputCtx.currentTime >= nextStartTimeRef.current - 0.1) {
                   setIsAiSpeaking(false);
                }
              };
            }

            // Handle Turn Complete (Optional logic)
            if (message.serverContent?.turnComplete) {
              // console.log("Turn complete");
            }
          },
          onclose: () => {
            console.log("Gemini Live Session Closed");
            stopSession();
          },
          onerror: (err) => {
            console.error("Gemini Live Error:", err);
            setError("Connection Error. Please try again.");
            stopSession();
          }
        }
      });

      // Save session ref for manual closing later if supported, 
      // primarily to ensure we have access to the session object for sending input
      const session = await sessionPromise;
      aiSessionRef.current = session;

      // Setup Input Audio Processor Callback
      processor.onaudioprocess = (e) => {
        const inputData = e.inputBuffer.getChannelData(0);
        // Create formatted blob for Gemini
        const pcmBlob = createPcmBlob(inputData);
        
        // Send to Gemini
        session.sendRealtimeInput({ media: pcmBlob });
      };

      // Start Visual Loop
      const updateVolume = () => {
        if (analyserRef.current) {
          const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
          analyserRef.current.getByteFrequencyData(dataArray);
          
          // Calculate average volume
          let sum = 0;
          for (let i = 0; i < dataArray.length; i++) {
            sum += dataArray[i];
          }
          const average = sum / dataArray.length;
          // Normalize to 0-1 range (roughly)
          setVolume(Math.min(average / 100, 1));
        }
        animationFrameRef.current = requestAnimationFrame(updateVolume);
      };
      updateVolume();

    } catch (err: any) {
      console.error("Initialization Error:", err);
      setError(err.message || "Failed to initialize.");
      stopSession();
    }
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => stopSession();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-midnight text-white p-4 font-sans relative">
      
      {/* Header */}
      <header className="absolute top-8 text-center z-20">
        <h1 className="text-3xl md:text-5xl font-bold tracking-widest text-neon drop-shadow-[0_0_10px_rgba(0,240,255,0.8)]">
          ELLIOT AI
        </h1>
        <p className="text-cyan-200/60 text-sm md:text-base mt-2 tracking-wide uppercase">
          Advanced Sales Intelligence
        </p>
      </header>

      {/* Main Visual Content */}
      <main className="flex-1 flex flex-col items-center justify-center w-full max-w-lg z-10">
        
        <div className="mb-12">
          <Orb isActive={isConnected} volume={volume} isAiSpeaking={isAiSpeaking} />
        </div>

        {/* Status / Error Messages */}
        <div className="h-12 flex items-center justify-center mb-8 w-full text-center">
          {error && (
            <div className="text-red-400 bg-red-900/20 px-4 py-2 rounded-lg border border-red-500/30">
              {error}
            </div>
          )}
          {!error && isConnected && (
            <div className={`text-sm tracking-widest uppercase transition-colors duration-500 ${isAiSpeaking ? 'text-neon' : 'text-cyan-600'}`}>
              {isAiSpeaking ? "Elliot Speaking..." : "Listening..."}
            </div>
          )}
          {!error && !isConnected && (
            <div className="text-cyan-600/50 text-sm tracking-widest uppercase">
              System Offline
            </div>
          )}
        </div>

        {/* Controls */}
        <div className="flex gap-6">
          {!isConnected ? (
            <button
              onClick={startSession}
              className="group relative px-8 py-3 bg-transparent border-2 border-neon text-neon rounded-full overflow-hidden hover:bg-neon hover:text-midnight transition-all duration-300 font-bold tracking-wider"
            >
              <span className="relative z-10">INITIALIZE</span>
              <div className="absolute inset-0 bg-neon/20 blur-lg group-hover:bg-neon/40 transition-all" />
            </button>
          ) : (
            <button
              onClick={stopSession}
              className="px-8 py-3 border-2 border-red-500 text-red-500 rounded-full hover:bg-red-500 hover:text-white transition-all duration-300 font-bold tracking-wider"
            >
              TERMINATE
            </button>
          )}
        </div>
      </main>

      {/* Decorative Background Elements */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-1/4 left-0 w-64 h-64 bg-cyan-900/10 rounded-full blur-3xl -translate-x-1/2"></div>
        <div className="absolute bottom-1/4 right-0 w-96 h-96 bg-blue-900/10 rounded-full blur-3xl translate-x-1/2"></div>
      </div>
    </div>
  );
};

export default App;