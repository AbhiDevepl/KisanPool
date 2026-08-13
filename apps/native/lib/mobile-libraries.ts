import * as ExpoAudio from "expo-audio";
import * as ExpoCalendar from "expo-calendar";
import * as ExpoImage from "expo-image";
import * as ExpoLocation from "expo-location";
import * as ExpoMaps from "expo-maps";
import * as ExpoVideo from "expo-video";

// Central import surface for the optional Expo modules selected at scaffold time.
// Import the relevant namespace from this object when wiring app-specific permissions and flows.
export const mobileLibraries = {
  ExpoLocation,
  ExpoImage,
  ExpoAudio,
  ExpoVideo,
  ExpoCalendar,
  ExpoMaps,
} as const;
