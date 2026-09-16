/**
 * Application constants
 *
 * Customize these values for your project.
 * You can also override via environment variables.
 */

export const APP_NAME = process.env.NEXT_PUBLIC_APP_NAME || "Bat Phone";
export const APP_URL =
  process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

/**
 * The Twilio number an employee dials to reach the bat phone.
 * Inlined at build time (NEXT_PUBLIC_*), so it must be passed as a Docker
 * build-arg for deployed builds. Empty when not configured.
 */
export const BAT_PHONE_NUMBER = process.env.NEXT_PUBLIC_BAT_PHONE_NUMBER || "";

/**
 * Address shown on the public privacy and terms pages for questions and
 * deletion requests. Inlined at build time (NEXT_PUBLIC_*). Empty when not
 * configured; the pages then fall back to generic wording.
 */
export const SUPPORT_EMAIL = process.env.NEXT_PUBLIC_SUPPORT_EMAIL || "";

/**
 * Logo configuration
 *
 * To use your own logo:
 * 1. Add your logo file to /public/images/ (supports .svg, .png, .jpg, .webp)
 * 2. Update APP_LOGO_PATH below to match your filename
 * 3. Adjust APP_LOGO_SIZE if needed
 *
 * For SVG logos, currentColor will inherit the text color.
 * For image logos, ensure good contrast in both light and dark modes.
 */
export const APP_LOGO_PATH = "/images/logo.svg";
export const APP_LOGO_SIZE = {
  width: 32,
  height: 32,
};

/**
 * Authenticated user data displayed in the navbar
 */
export interface NavUser {
  name: string;
  email: string;
  image: string | null;
}

/**
 * Navigation link types
 */
export interface NavLink {
  href: string;
  label: string;
}

/**
 * Home navigation, shown alongside session links for signed-in users.
 */
export const NAV_LINKS: readonly NavLink[] = [{ href: "/", label: "Home" }];

/**
 * Session navigation links
 *
 * Shown in the navbar whenever a session exists. The pages themselves
 * redirect unauthenticated visitors, so no role check is needed here.
 */
export const SESSION_NAV_LINKS: readonly NavLink[] = [
  { href: "/contacts", label: "Contacts" },
  { href: "/calls", label: "Calls" },
];
