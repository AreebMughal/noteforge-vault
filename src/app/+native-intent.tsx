/**
 * Microsoft sign-in returns to msal<client id>://auth?code=…. expo-auth-session
 * picks that URL up itself; the router must ignore it rather than look for an
 * "/auth" screen (which would show "unmatched route" over the sign-in).
 */
export function redirectSystemPath({ path }: { path: string; initial: boolean }) {
  try {
    if (/^(?:noteforgevault|msal[0-9a-f-]+):\/\/auth(?:[/?#]|$)/i.test(path) || /^\/?auth(?:[/?#]|$)/i.test(path)) return null;
  } catch {
    // Never throw from here.
  }
  return path;
}
