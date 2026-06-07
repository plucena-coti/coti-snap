/**
 * Detects if the current device is a mobile device based on userAgent.
 * Evaluated once at module load — device type doesn't change mid-session.
 */
const detectMobile = (): boolean => {
  if (typeof navigator === 'undefined') {
    return false;
  }

  const ua = navigator.userAgent || '';

  // Standard mobile indicators
  const mobileRegex =
    /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile|mobile|CriOS/i;

  // Also check for touch-only small screens as a fallback
  // (some in-app browsers strip mobile identifiers from UA)
  const isSmallTouchScreen =
    'ontouchstart' in window &&
    window.matchMedia?.('(max-width: 768px)')?.matches;

  return mobileRegex.test(ua) || isSmallTouchScreen;
};

/**
 * True when the app is running on a mobile device.
 * Snap installation is not supported on mobile — users should go through
 * contract onboarding instead.
 */
export const isMobile: boolean = detectMobile();
