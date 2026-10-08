import { useSyncExternalStore } from "react";

function subscribe() {
  return () => {
    /* Device timezone is read on hydration; there is no subscription to release. */
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
