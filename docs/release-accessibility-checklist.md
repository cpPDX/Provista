# Mobile release accessibility checklist

Run this checklist on a physical iPhone before release. The Playwright suite covers the same semantic contracts in Chromium and WebKit, but it cannot operate VoiceOver itself or reproduce every physical safe-area inset.

## VoiceOver

1. Turn on VoiceOver and open List.
2. Confirm each shopping item is announced as “Mark as purchased, button, not pressed”; activate it and confirm the state changes to pressed immediately.
3. Confirm “Done shopping” is reached directly from the sticky bar without opening its summary.
4. Open the trip review. Confirm VoiceOver announces one “Where did you shop?” selector, then only the three price exceptions. Confirm known prices are a collapsed disclosure.
5. Open Add to List and swipe through the dialog. Focus must remain in the dialog, the close control must have a useful name, and closing must return focus to Add.
6. Trigger a saved update and confirm the toast is announced once without moving focus.

## One-handed latency run

Use browser network throttling or a proxy that adds 800–1200 ms to API requests.

1. Add a new catalog item inline from List, then repeat from Pantry.
2. Check 20 items rapidly, undo one before its first request finishes, and confirm every tap changes the screen within 150 ms.
3. Finish a 20-item trip at one store with 17 fresh known prices and three missing prices. Time from Done shopping to completion; target under 20 seconds.
4. Sign in as a Member and mark milk Running low, then adjust its optional exact quantity. Neither action should ask for admin approval.
5. From Home, activate Plan dinner and confirm today’s dinner field receives focus.

## Display and motion

1. Set iOS Larger Text to 200%. Check Home, Plan, List, Pantry, the sticky cart, and trip review for clipped text or horizontal scrolling.
2. Enable Reduce Motion. Confirm tab changes, check-off, modals, skeletons, and toasts do not animate.
3. Test portrait and landscape on a notched iPhone. Confirm content, the cart bar, and bottom navigation remain outside the status, home-indicator, and rounded-corner safe areas.
4. In light and dim environments, verify primary-button text, muted card copy, focus rings, warning states, and destructive actions remain readable.
