// Firebase project (public identifiers — safe to ship; access is protected by firestore.rules)
export const firebaseConfig = {
  apiKey: "AIzaSyCPBhJ7Sfb_aX_Ojd7obeWfFOTuVRXCja0",
  authDomain: "anu-me.firebaseapp.com",
  projectId: "anu-me",
  storageBucket: "anu-me.firebasestorage.app",
  messagingSenderId: "573209589312",
  appId: "1:573209589312:web:08daf6801bd1392648d1a5"
};

// Cloudinary unsigned upload preset (Cloudinary → Settings → Upload → Upload presets).
export const CLOUDINARY = {
  cloudName: "dgeapuy5y",
  uploadPreset: "anu-me",
  folder: "anu-me"
};

// Memories lock PIN length
export const PIN_LENGTH = 4;

// Upload limits (Cloudinary free plan: 10 MB images, 100 MB videos)
export const LIMITS = {
  imageMB: 10,
  videoMB: 100,
  voiceSeconds: 300
};

// WebRTC servers for live calls. STUN works on most Wi-Fi networks.
// For calls between two different mobile networks add a TURN server,
// e.g. a free one from https://www.metered.ca/tools/openrelay/ :
//   { urls: "turn:YOUR-TURN-HOST:443?transport=tcp", username: "…", credential: "…" }
export const ICE_SERVERS = [
  { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] },
  { urls: "stun:stun.cloudflare.com:3478" }
];
