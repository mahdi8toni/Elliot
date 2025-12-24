export interface AudioConfig {
  sampleRate: number;
}

export interface StreamState {
  isConnected: boolean;
  isSpeaking: boolean; // Is the user speaking?
  isAiSpeaking: boolean; // Is the AI speaking?
  error: string | null;
}
