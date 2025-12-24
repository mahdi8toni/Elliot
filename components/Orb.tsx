import React from 'react';

interface OrbProps {
  isActive: boolean;
  volume: number; // 0 to 1
  isAiSpeaking: boolean;
}

const Orb: React.FC<OrbProps> = ({ isActive, volume, isAiSpeaking }) => {
  // Base scale is 1, max scale is ~1.5 based on volume
  const scale = isActive ? 1 + volume * 1.5 : 1;
  
  // Dynamic glow opacity based on activity
  const glowOpacity = isActive ? 0.6 + (volume * 0.4) : 0.2;
  
  // Color shift slightly if AI is speaking (e.g., brighter white center)
  const coreColor = isAiSpeaking ? 'bg-white' : 'bg-neon';

  return (
    <div className="relative flex items-center justify-center w-64 h-64">
      {/* Outer Glow Ring */}
      <div 
        className="absolute rounded-full bg-neon blur-2xl transition-all duration-75 ease-out"
        style={{
          width: '100%',
          height: '100%',
          opacity: glowOpacity * 0.5,
          transform: `scale(${scale * 1.2})`,
        }}
      />
      
      {/* Inner Glow */}
      <div 
        className="absolute rounded-full bg-cyan-600 blur-xl transition-all duration-75 ease-out"
        style={{
          width: '80%',
          height: '80%',
          opacity: glowOpacity,
          transform: `scale(${scale * 1.1})`,
        }}
      />

      {/* Core Orb */}
      <div 
        className={`relative z-10 rounded-full ${coreColor} shadow-[0_0_50px_rgba(0,240,255,0.6)] transition-all duration-75 ease-out`}
        style={{
          width: '60%',
          height: '60%',
          transform: `scale(${scale})`,
        }}
      >
        {/* Subtle interior gradient/texture */}
        <div className="absolute inset-0 rounded-full bg-gradient-to-tr from-blue-900/30 to-white/40" />
      </div>
    </div>
  );
};

export default Orb;