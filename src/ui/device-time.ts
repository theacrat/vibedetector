import { useSyncExternalStore } from "react";

function subscribe() {
  return () => {
    // Intl exposes no timezone-change event; hydration reads the device snapshot once.
  };
}
function deviceTimeZone() {
  return new Intl.DateTimeFormat().resolvedOptions().timeZone;
}
function serverTimeZone() {
  return "UTC";
}
function useDeviceTimeZone() {
  return useSyncExternalStore(subscribe, deviceTimeZone, serverTimeZone);
}
export { useDeviceTimeZone };
